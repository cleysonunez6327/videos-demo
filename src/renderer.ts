import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { execa } from "execa";
import { loadPlaybook, saveSegmentDurations } from "./playbook-io.js";
import { runSegment } from "./executor.js";
import { executeSetup } from "./setup.js";
import { ensureAudio } from "./tts.js";
import { mergeAudioVideo } from "./merger.js";
import { generateSrt } from "./subtitles.js";
import { zoomExtensionArgs, setBrowserZoom } from "./zoom.js";
import type { Page } from "playwright";
import type { TitleCard } from "./schema.js";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Show a full-screen card and hold it. Used for both the opening and the
 * closing card, which share a shape.
 *
 * The card is a data: URL, where the zoom extension's content script does
 * not run — so every size here is in viewport units. Absolute sizes would
 * render against the full scaled viewport (3840px at scale 2) and come out
 * unreadably small.
 */
async function showCard(
  page: Page,
  card: TitleCard,
  colorScheme: "light" | "dark"
): Promise<void> {
  const isDark = colorScheme === "dark";
  const bg = isDark ? "#1a1a2e" : "#f5f5f5";
  const fg = isDark ? "#e0e0e0" : "#1a1a1a";
  const muted = isDark ? "#a0a0b0" : "#666666";

  const body = card.stat
    ? `  <div class="stat-value">${escapeHtml(card.stat.value)}</div>
  <div class="stat-label">${escapeHtml(card.stat.label)}</div>
  <div class="stat-attribution">${escapeHtml(card.title)}${
        card.subtitle ? ` · ${escapeHtml(card.subtitle)}` : ""
      }</div>`
    : `  <h1>${escapeHtml(card.title)}</h1>
  ${card.subtitle ? `<p>${escapeHtml(card.subtitle)}</p>` : ""}`;

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 100vw; height: 100vh;
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    background: ${bg}; color: ${fg};
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
  h1 { font-size: 4.2vw; font-weight: 700; text-align: center; line-height: 1.2; }
  p  { font-size: 1.9vw; font-weight: 400; margin-top: 1.2vw; color: ${muted}; text-align: center; }

  /* Stat card: the number carries the frame and the name is attribution
     underneath, so the result registers before anyone reads the brand. */
  .stat-value { font-size: 11vw; font-weight: 800; line-height: 1; letter-spacing: -0.02em; }
  .stat-label { font-size: 2.4vw; font-weight: 500; margin-top: 1vw; color: ${muted}; text-align: center; }
  .stat-attribution { font-size: 1.5vw; font-weight: 400; margin-top: 3vw; color: ${muted}; text-align: center; }
</style></head><body>
${body}
</body></html>`;

  await page.goto(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`, {
    waitUntil: "load",
  });
  await new Promise(r => setTimeout(r, card.duration));
}

async function render(
  playbookPath: string,
  outputPath?: string
): Promise<void> {
  const playbook = loadPlaybook(playbookPath);

  // A segment with narration but no actions is legitimate — it holds the
  // current screen for as long as the narration runs. Only a segment with
  // neither produces nothing at all, and that is almost always a mistake.
  const emptySegments = playbook.segments.filter(
    s => s.actions.length === 0 && !s.narration
  );
  if (emptySegments.length > 0) {
    const ids = emptySegments.map(s => s.id).join(", ");
    throw new Error(
      `Cannot render: these segments have neither narration nor actions, ` +
      `so they would contribute nothing: ${ids}\n` +
      `Give them narration, give them actions, or remove them.`
    );
  }

  const playbookDir = path.dirname(path.resolve(playbookPath));
  const playbookName = path.basename(playbookPath, path.extname(playbookPath));
  const outputDir = path.resolve(playbookDir, playbook.recording.outputDir);
  fs.mkdirSync(outputDir, { recursive: true });

  // Step 1: TTS
  console.log("Generating TTS audio...");
  const audioResults: Array<{ id: string; audioPath: string | null; durationMs: number }> = [];
  for (const segment of playbook.segments) {
    process.stdout.write(`  ${segment.id}...`);
    if (segment.narration) {
      const result = await ensureAudio(segment, playbook, outputDir);
      segment.audioDuration = result.durationMs;
      audioResults.push({ id: segment.id, audioPath: result.audioPath, durationMs: result.durationMs });
      console.log(` ${(result.durationMs / 1000).toFixed(1)}s`);
    } else {
      segment.audioDuration = 0;
      audioResults.push({ id: segment.id, audioPath: null, durationMs: 0 });
      console.log(" (no narration)");
    }
  }

  // Save updated durations back to playbook
  saveSegmentDurations(playbookPath, playbook.segments);
  console.log("  Audio durations saved to playbook.");

  // Step 2: Headless replay with CDP screencast
  console.log("\nRecording video...");
  const framesDir = path.join(outputDir, ".frames");
  fs.mkdirSync(framesDir, { recursive: true });

  // Use a physically larger viewport so CDP screencast (which captures at
  // logical pixel dimensions) produces high-resolution frames. Real browser
  // zoom via the bundled extension then scales content up to fill this
  // viewport while keeping vh/vw units correct.
  const scaledWidth = playbook.app.viewport.width * playbook.app.scale;
  const scaledHeight = playbook.app.viewport.height * playbook.app.scale;
  const zoomPercent = playbook.app.zoom * playbook.app.scale * 100;

  // Extensions require a persistent context and --headless=new.
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ndemo-render-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      "--headless=new",
      ...zoomExtensionArgs(),
    ],
    viewport: { width: scaledWidth, height: scaledHeight },
    deviceScaleFactor: 1,
    colorScheme: playbook.app.colorScheme,
    locale: "en-US",
  });

  // Wait for the zoom extension's service worker to be ready.
  if (context.serviceWorkers().length === 0) {
    await context.waitForEvent("serviceworker", { timeout: 5000 });
  }

  const page = context.pages()[0] || await context.newPage();

  // Navigate to app and apply real browser zoom (needs an HTTP page for
  // the extension content script). Zoom persists across navigations.
  let startUrl = playbook.app.url;
  await page.goto(playbook.app.url, { waitUntil: "load" });
  await setBrowserZoom(page, zoomPercent);

  if (playbook.app.setup) {
    console.log("  Running setup...");
    await executeSetup(page, playbook.app.setup);
    startUrl = page.url();
  }

  // Start CDP screencast for high-quality frame capture
  const cdp = await context.newCDPSession(page);

  interface CapturedFrame {
    filePath: string;
    timestamp: number;
  }
  const frames: CapturedFrame[] = [];
  let frameIndex = 0;
  let screencastStopped = false;

  cdp.on("Page.screencastFrame", (params) => {
    // Frames keep arriving while the screencast is being torn down. Writing
    // one is harmless, but acking it against a closed session rejects — and
    // an unhandled rejection in an event handler takes the process down with
    // the whole render, after every segment has already been recorded.
    if (screencastStopped) return;

    const filePath = path.join(framesDir, `frame-${String(frameIndex).padStart(7, "0")}.jpeg`);
    const timestamp = params.metadata.timestamp ?? (Date.now() / 1000);
    frameIndex++;
    fs.writeFileSync(filePath, Buffer.from(params.data, "base64"));
    frames.push({ filePath, timestamp });

    void cdp
      .send("Page.screencastFrameAck", { sessionId: params.sessionId })
      .catch(() => {
        // The session closed between the frame arriving and this ack.
      });
  });

  await cdp.send("Page.startScreencast", {
    format: "jpeg",
    quality: 95,
    maxWidth: scaledWidth,
    maxHeight: scaledHeight,
    everyNthFrame: 1,
  });

  // Track total pre-segment time (title card + navigation) so the merger
  // can insert matching silence.  The screencast is already running, so any
  // time spent here appears in the video and must be mirrored in the audio.
  const preSegmentStart = Date.now();

  // Title card
  if (playbook.titleCard) {
    console.log("  Recording title card...");
    await showCard(page, playbook.titleCard, playbook.app.colorScheme);
  }

  // Navigate to the app for segment recording
  await page.goto(startUrl, { waitUntil: "load" });

  const preSegmentDurationMs = Date.now() - preSegmentStart;

  // Record segments
  const segmentTimings: Array<{ id: string; durationMs: number; audioDurationMs: number }> = [];

  for (const segment of playbook.segments) {
    process.stdout.write(`  ${segment.id}...`);

    const result = await runSegment(page, segment, {
      cursor: true,
      audioDurationMs: segment.audioDuration ?? 0,
      onActionError: async () => {
        await page.screenshot({
          path: path.join(outputDir, `error-${segment.id}.png`),
        });
      },
    });

    if (!result.ok) {
      screencastStopped = true;
      await cdp.send("Page.stopScreencast").catch(() => {});
      await cdp.detach().catch(() => {});
      await context.close();
      fs.rmSync(userDataDir, { recursive: true, force: true });
      throw new Error(
        `Render failed at segment "${segment.id}", action ${result.actionIndex}: ${result.error}`
      );
    }

    segment.videoDuration = result.durationMs;
    segmentTimings.push({
      id: segment.id,
      durationMs: result.durationMs,
      audioDurationMs: segment.audioDuration ?? 0,
    });
    console.log(` ${(result.durationMs / 1000).toFixed(1)}s`);
  }

  // End card, still inside the screencast so it lands in the video. Its
  // duration is tracked separately: the merger owes it matching silence.
  let postSegmentDurationMs = 0;
  if (playbook.endCard) {
    console.log("  Recording end card...");
    const endCardStart = Date.now();
    await showCard(page, playbook.endCard, playbook.app.colorScheme);
    postSegmentDurationMs = Date.now() - endCardStart;
  }

  // Stop the screencast, then let any frame already in flight land before
  // detaching. Frame writes are synchronous, so the only thing to wait for
  // is delivery of events the browser has already sent.
  screencastStopped = true;
  await cdp.send("Page.stopScreencast").catch(() => {});
  await new Promise(r => setTimeout(r, 200));
  await cdp.detach().catch(() => {});
  await context.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });

  // Save video durations back to playbook, plus the measured lead-in so a
  // later `ndemo subtitles` can reproduce the same offsets.
  saveSegmentDurations(playbookPath, playbook.segments, preSegmentDurationMs);

  const firstFrame = frames[0];
  const lastFrame = frames[frames.length - 1];
  if (!firstFrame || !lastFrame) {
    throw new Error("No frames captured");
  }

  console.log(`  Captured ${frames.length} frames`);

  // Assemble frames into video using ffmpeg concat demuxer.
  // The expected total duration lets us hold the last frame long enough to
  // cover static segments where the screencast sends no new frames.
  const expectedTotalSec =
    (preSegmentDurationMs +
      segmentTimings.reduce((s, t) => s + t.durationMs, 0) +
      postSegmentDurationMs) / 1000;

  const concatFilePath = path.join(framesDir, "frames.txt");
  let concatContent = "";
  for (const [i, frame] of frames.entries()) {
    const next = frames[i + 1];
    const duration = next
      ? next.timestamp - frame.timestamp
      : Math.max(
          expectedTotalSec - (frame.timestamp - firstFrame.timestamp),
          1 / 30,
        );
    concatContent += `file '${path.resolve(frame.filePath)}'\n`;
    concatContent += `duration ${Math.max(duration, 0.001).toFixed(6)}\n`;
  }
  // concat demuxer needs the last file repeated without duration
  concatContent += `file '${path.resolve(lastFrame.filePath)}'\n`;
  fs.writeFileSync(concatFilePath, concatContent);

  const videoPath = path.join(outputDir, `${playbookName}-video.mp4`);
  await execa("ffmpeg", [
    "-y",
    "-f", "concat",
    "-safe", "0",
    "-i", concatFilePath,
    "-r", String(playbook.recording.fps),
    "-c:v", "libx264",
    "-crf", "17",
    "-preset", "slow",
    "-pix_fmt", "yuv420p",
    videoPath,
  ]);

  // Clean up frames
  fs.rmSync(framesDir, { recursive: true, force: true });

  // Step 3: Merge
  console.log("\nMerging audio and video...");
  const finalOutput = outputPath ?? path.join(outputDir, `${playbookName}.mp4`);

  // audioResults and segmentTimings are built in lockstep with segments;
  // zip them once here so the missing-data case is stated rather than assumed.
  const renderedSegments = playbook.segments.map((s, i) => {
    const audio = audioResults[i];
    const timing = segmentTimings[i];
    if (!audio || !timing) {
      throw new Error(`Missing render data for segment "${s.id}"`);
    }
    return {
      id: s.id,
      narration: s.narration,
      audioPath: audio.audioPath,
      audioDurationMs: s.audioDuration ?? 0,
      videoDurationMs: timing.durationMs,
    };
  });

  // Subtitles are written before the merge, not after: burning them in is a
  // video filter, so the file has to exist by the time ffmpeg runs.
  const srtPath = finalOutput.replace(/\.mp4$/, ".srt");
  const srtContent = generateSrt(
    renderedSegments.map(s => ({
      narration: s.narration,
      videoDurationMs: s.videoDurationMs,
      audioDurationMs: s.audioDurationMs,
    })),
    preSegmentDurationMs
  );
  fs.writeFileSync(srtPath, srtContent);

  const music = playbook.music
    ? {
        // Resolved against the playbook, so a playbook stays portable.
        path: path.resolve(playbookDir, playbook.music.path),
        volume: playbook.music.volume,
        fadeOutMs: playbook.music.fadeOutMs,
      }
    : undefined;

  if (music && !fs.existsSync(music.path)) {
    throw new Error(`Music file not found: ${music.path}`);
  }
  if (playbook.subtitles.burn) console.log("  Burning subtitles (re-encoding)...");
  if (music) console.log("  Mixing background music...");

  await mergeAudioVideo({
    videoPath,
    segments: renderedSegments,
    outputPath: finalOutput,
    outputDir,
    preSegmentDurationMs,
    postSegmentDurationMs,
    burn: playbook.subtitles.burn
      ? {
          srtPath,
          fontSize: playbook.subtitles.fontSize,
          primaryColour: playbook.subtitles.primaryColour,
          outlineColour: playbook.subtitles.outlineColour,
          marginV: playbook.subtitles.marginV,
        }
      : undefined,
    music,
  });

  // Clean up intermediate video
  if (videoPath !== finalOutput) {
    try { fs.unlinkSync(videoPath); } catch {}
  }

  // Summary
  const stats = fs.statSync(finalOutput);
  const sizeMb = (stats.size / (1024 * 1024)).toFixed(1);
  const totalDuration =
    preSegmentDurationMs +
    segmentTimings.reduce((s, t) => s + t.durationMs, 0) +
    postSegmentDurationMs;
  const minutes = Math.floor(totalDuration / 60000);
  const seconds = Math.round((totalDuration % 60000) / 1000);

  console.log(`\n✓ ${finalOutput}`);
  console.log(`  Duration: ${minutes}m ${seconds}s`);
  console.log(`  Size: ${sizeMb} MB`);
  console.log(`  Segments: ${playbook.segments.length}`);
  console.log(`  Subtitles: ${srtPath}`);
}

export { render };
