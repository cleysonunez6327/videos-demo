import { execa } from "execa";

/**
 * Duration of a media file in seconds, or null when it cannot be read.
 *
 * ffprobe is the only thing that knows how long an encoded file actually is —
 * container headers lie, and the TTS providers' own estimates are worse — so
 * every caller that needs a duration ends up here. It lived twice, once in
 * the audio cache and once in the gallery, which is one copy too many for
 * ten lines that hide a subprocess.
 *
 * Failure is a value rather than an exception: the callers all have a
 * sensible answer for "unknown" and none of them want a throw.
 */
async function probeDurationSec(filePath: string): Promise<number | null> {
  try {
    const { stdout } = await execa("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "csv=p=0",
      filePath,
    ]);
    const seconds = Number.parseFloat(stdout.trim());
    return Number.isFinite(seconds) ? seconds : null;
  } catch {
    return null;
  }
}

export { probeDurationSec };
