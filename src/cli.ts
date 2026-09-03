#!/usr/bin/env node

import { Command } from "commander";
import { open, close, reset } from "./browser.js";
import { connect } from "./browser.js";
import { readPageState } from "./page-reader.js";
import { play } from "./player.js";
import { render } from "./renderer.js";
import { generateSrt } from "./subtitles.js";
import { loadPlaybook } from "./playbook-io.js";
import { checkBalance, API_KEY_ENV } from "./tts.js";
import { loadEnvFiles } from "./env.js";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

// Populate process.env from .env files before any command runs. No module
// read env at import time, so doing it here is early enough.
loadEnvFiles();

/** The single source of truth for the version is package.json. */
function readVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    return (require("../package.json") as { version?: string }).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const program = new Command();

program
  .name("ndemo")
  .description("Narrated demo video toolkit")
  // Read rather than repeated: the literal here sat at 0.1.0 while the three
  // manifests moved to 0.3.x, so `ndemo --version` reported a release that had
  // not existed for a while.
  .version(readVersion());

/**
 * Wrap a command so success and failure leave the process the same way
 * everywhere.
 *
 * Seven handlers carried an identical try/exit/catch/exit block; the only
 * thing that varied was the call in the middle. The message loses a
 * redundant prefix too: interpolating an Error prints its own "Error:" on
 * top of ours, so a failed render used to announce itself as
 * "Error: Error: Render failed at segment ...".
 */
function runCommand<Args extends readonly unknown[]>(
  run: (...args: Args) => Promise<void>
): (...args: Args) => Promise<never> {
  return async (...args: Args): Promise<never> => {
    try {
      await run(...args);
      process.exit(0);
    } catch (err) {
      console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  };
}

// ─── open ────────────────────────────────────────────

program
  .command("open")
  .description("Launch browser daemon and navigate to app")
  .argument("<playbook>", "Path to playbook YAML file")
  .action(runCommand(async (playbook: string) => {
    await open(playbook);
  }));

// ─── close ───────────────────────────────────────────

program
  .command("close")
  .description("Shut down browser daemon")
  .action(runCommand(async () => {
    await close();
  }));

// ─── reset ───────────────────────────────────────────

program
  .command("reset")
  .description("Navigate back to app URL (fresh state)")
  .action(runCommand(async () => {
    await reset();
  }));

// ─── page-state ──────────────────────────────────────

program
  .command("page-state")
  .description("Print current page accessibility tree")
  .option("--screenshot", "Also save a screenshot")
  .action(runCommand(async (options: { screenshot?: boolean }) => {
    const { page } = await connect();
    const output = await readPageState(page, {
      screenshot: options.screenshot,
    });
    console.log(output);
  }));

// ─── play ────────────────────────────────────────────

program
  .command("play")
  .description("Play segments in the live browser")
  .argument("<playbook>", "Path to playbook YAML file")
  .option("--segment <id>", "Play just this segment")
  .option("--from <id>", "Play from this segment")
  .option("--to <id>", "Stop after this segment")
  .option("--audio", "Play TTS narration audio alongside actions")
  .action(runCommand(async (playbook: string, options: {
    segment?: string;
    from?: string;
    to?: string;
    audio?: boolean;
  }) => {
    await play(playbook, options);
  }));

// ─── render ──────────────────────────────────────────

program
  .command("render")
  .description("Full pipeline: TTS → replay → merge → mp4")
  .argument("<playbook>", "Path to playbook YAML file")
  .option("--output <path>", "Output file path")
  .action(runCommand(async (playbook: string, options: { output?: string }) => {
    await render(playbook, options.output);
  }));

// ─── subtitles ───────────────────────────────────

program
  .command("subtitles")
  .description("Generate SRT subtitle file from playbook")
  .argument("<playbook>", "Path to playbook YAML file")
  .option("--output <path>", "Output SRT file path")
  .action(runCommand(async (playbookPath: string, options: { output?: string }) => {
    const playbook = loadPlaybook(playbookPath);
    const playbookName = path.basename(playbookPath, path.extname(playbookPath));
    const outputDir = path.resolve(path.dirname(playbookPath), playbook.recording.outputDir);

    // Timings only exist once a render has measured them. Without them every
    // cue would silently collapse to 00:00:00,000.
    const untimed = playbook.segments.filter(s => s.videoDuration === undefined);
    if (untimed.length > 0) {
      throw new Error(
        `No timing data for: ${untimed.map(s => s.id).join(", ")}\n` +
        `Subtitles are built from measured durations, so render first:\n` +
        `  ndemo render ${playbookPath}`
      );
    }

    const srtContent = generateSrt(
      playbook.segments.map(s => ({
        narration: s.narration,
        videoDurationMs: s.videoDuration ?? 0,
        audioDurationMs: s.audioDuration ?? 0,
      })),
      playbook.preSegmentDuration ?? 0
    );

    const srtPath = options.output ?? path.join(outputDir, `${playbookName}.srt`);
    fs.writeFileSync(srtPath, srtContent);
    console.log(`✓ ${srtPath}`);
  }));

// ─── doctor ──────────────────────────────────────────

program
  .command("doctor")
  .description("Check dependencies")
  .action(async () => {
    let allOk = true;

    const nodeVersion = process.version;
    const nodeMajor = parseInt(nodeVersion.slice(1));
    if (nodeMajor >= 20) {
      console.log(`  ✓ node ${nodeVersion} (≥ 20 required)`);
    } else {
      console.log(`  ✗ node ${nodeVersion} (≥ 20 required)`);
      allOk = false;
    }

    try {
      const ffmpegVersion = execSync("ffmpeg -version", { encoding: "utf-8" })
        .split("\n")[0]
        ?.match(/version\s+([\d.]+)/)?.[1] ?? "unknown";
      console.log(`  ✓ ffmpeg ${ffmpegVersion}`);
    } catch {
      console.log("  ✗ ffmpeg not found");
      allOk = false;
    }

    try {
      const ffprobeVersion = execSync("ffprobe -version", { encoding: "utf-8" })
        .split("\n")[0]
        ?.match(/version\s+([\d.]+)/)?.[1] ?? "unknown";
      console.log(`  ✓ ffprobe ${ffprobeVersion}`);
    } catch {
      console.log("  ✗ ffprobe not found");
      allOk = false;
    }

    try {
      const { chromium } = await import("playwright");
      const browser = await chromium.launch({ headless: true });
      await browser.close();
      console.log("  ✓ playwright browsers installed (chromium)");
    } catch {
      console.log("  ✗ playwright browsers not installed");
      console.log("    Run: npx playwright install chromium");
      allOk = false;
    }

    if (process.env[API_KEY_ENV]) {
      console.log(`  ✓ ${API_KEY_ENV} is set`);
      // Prove the key actually works, so a render doesn't fail on a 401/402
      // after minutes of recording.
      try {
        const balance = await checkBalance();
        if (balance.availableUsdCents > 0) {
          console.log(`  ✓ llm4agents balance: ${balance.availableUsd}`);
        } else {
          console.log(`  ✗ llm4agents balance is ${balance.availableUsd} — TTS will fail`);
          allOk = false;
        }
      } catch (err) {
        console.log(`  ✗ llm4agents API unreachable or key rejected`);
        console.log(`    ${String(err).replace(/\n/g, "\n    ")}`);
        allOk = false;
      }
    } else {
      console.log(`  ✗ ${API_KEY_ENV} not set (required for TTS)`);
      allOk = false;
    }

    process.exit(allOk ? 0 : 1);
  });

program.parse();
