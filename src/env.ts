import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Repo root — the compiled env.js sits in dist/, one level below it. */
const SKILL_DIR = path.resolve(__dirname, "..");

/**
 * Load `.env` files into process.env.
 *
 * Real environment variables always win: process.loadEnvFile() never
 * overwrites a key that is already set, so the first file to define a key
 * is the one that sticks. Order is therefore most-specific first — the
 * project ndemo was invoked from, then the skill's own directory.
 *
 * Missing files are normal, not an error. A malformed file is skipped
 * rather than taking down the CLI.
 */
function loadEnvFiles(): void {
  // process.loadEnvFile landed in Node 20.12; degrade to env-only below that.
  if (typeof process.loadEnvFile !== "function") return;

  const seen = new Set<string>();
  for (const dir of [process.cwd(), SKILL_DIR]) {
    const envPath = path.join(dir, ".env");
    if (seen.has(envPath)) continue;
    seen.add(envPath);

    if (!fs.existsSync(envPath)) continue;
    try {
      process.loadEnvFile(envPath);
    } catch {
      // Unreadable or malformed — fall through to the real environment.
    }
  }
}

export { loadEnvFiles, SKILL_DIR };
