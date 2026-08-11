import fs from "node:fs";
import path from "node:path";
import { execa } from "execa";

interface MergeSegment {
  id: string;
  audioPath: string | null;
  audioDurationMs: number;
  videoDurationMs: number;
}

interface BurnOptions {
  readonly srtPath: string;
  readonly fontSize: number;
  readonly primaryColour: string;
  readonly outlineColour: string;
  readonly marginV: number;
}

interface MusicOptions {
  readonly path: string;
  readonly volume: number;
  readonly fadeOutMs: number;
}

interface MergeOptions {
  videoPath: string;
  segments: MergeSegment[];
  outputPath: string;
  outputDir: string;
  /** Dead time before the first segment (title card + navigation). */
  preSegmentDurationMs?: number;
  /** Dead time after the last segment (end card). */
  postSegmentDurationMs?: number;
  /** Burn subtitles into the picture. Forces a video re-encode. */
  burn?: BurnOptions | undefined;
  music?: MusicOptions | undefined;
}

/** Generate a silent mp3 of the given length. */
async function writeSilence(filePath: string, durationMs: number): Promise<void> {
  await execa("ffmpeg", [
    "-y",
    "-f", "lavfi",
    "-i", "anullsrc=r=44100:cl=mono",
    "-t", String(durationMs / 1000),
    "-q:a", "9",
    filePath,
  ]);
}

/**
 * ffmpeg filter arguments take colons and commas as separators, so a Windows
 * drive letter or a comma in a directory name would be parsed as syntax.
 * Escaping is per the filtergraph rules, not shell quoting.
 */
function escapeFilterPath(filePath: string): string {
  return filePath
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/,/g, "\\,")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]");
}

/**
 * Concatenate the per-segment narration into one track, padding every gap
 * with silence so the audio stays aligned with the picture.
 */
async function buildNarrationTrack(options: MergeOptions): Promise<string> {
  const { segments, outputDir } = options;
  const audioDir = path.join(outputDir, "audio");
  fs.mkdirSync(audioDir, { recursive: true });

  const audioFiles: string[] = [];
  const scratch: string[] = [];

  if (options.preSegmentDurationMs && options.preSegmentDurationMs > 0) {
    const silencePath = path.join(audioDir, "silence-lead-in.mp3");
    await writeSilence(silencePath, options.preSegmentDurationMs);
    audioFiles.push(silencePath);
    scratch.push(silencePath);
  }

  for (const segment of segments) {
    if (segment.audioPath) audioFiles.push(segment.audioPath);

    // Fill the rest of the segment (or all of it, when there is no narration).
    const gapMs = segment.audioPath
      ? Math.max(0, segment.videoDurationMs - segment.audioDurationMs)
      : segment.videoDurationMs;
    if (gapMs > 50) {
      const silencePath = path.join(audioDir, `silence-${segment.id}.mp3`);
      await writeSilence(silencePath, gapMs);
      audioFiles.push(silencePath);
      scratch.push(silencePath);
    }
  }

  if (options.postSegmentDurationMs && options.postSegmentDurationMs > 0) {
    const silencePath = path.join(audioDir, "silence-lead-out.mp3");
    await writeSilence(silencePath, options.postSegmentDurationMs);
    audioFiles.push(silencePath);
    scratch.push(silencePath);
  }

  const filelistPath = path.join(outputDir, "filelist.txt");
  fs.writeFileSync(
    filelistPath,
    audioFiles.map(f => `file '${path.resolve(f)}'`).join("\n")
  );
  scratch.push(filelistPath);

  const combinedAudioPath = path.join(outputDir, "combined-audio.mp3");
  await execa("ffmpeg", [
    "-y",
    "-f", "concat",
    "-safe", "0",
    "-i", filelistPath,
    "-c", "copy",
    combinedAudioPath,
  ]);

  for (const file of scratch) {
    try { fs.unlinkSync(file); } catch { /* non-critical */ }
  }
  return combinedAudioPath;
}

async function mergeAudioVideo(options: MergeOptions): Promise<void> {
  const { videoPath, outputPath } = options;

  const narrationPath = await buildNarrationTrack(options);
  const totalMs =
    (options.preSegmentDurationMs ?? 0) +
    options.segments.reduce((sum, s) => sum + s.videoDurationMs, 0) +
    (options.postSegmentDurationMs ?? 0);

  const args: string[] = ["-y", "-i", videoPath, "-i", narrationPath];
  if (options.music) args.push("-stream_loop", "-1", "-i", options.music.path);

  if (options.music) {
    // Loop the bed, trim it to the video, fade it out at the end, then mix
    // it under the narration. `duration=first` keeps the mix the length of
    // the narration rather than the looped bed.
    //
    // normalize=0 matters: amix divides every input by the number of inputs
    // by default, so mixing in a quiet bed would drop the narration ~6dB.
    // Adding music must not make the voice quieter.
    const fadeStartSec = Math.max(0, (totalMs - options.music.fadeOutMs) / 1000);
    args.push(
      "-filter_complex",
      `[2:a]atrim=0:${(totalMs / 1000).toFixed(3)},` +
        `volume=${options.music.volume},` +
        `afade=t=out:st=${fadeStartSec.toFixed(3)}:d=${(options.music.fadeOutMs / 1000).toFixed(3)}[bed];` +
        `[1:a][bed]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]`,
      "-map", "0:v",
      "-map", "[aout]"
    );
  } else {
    args.push("-map", "0:v", "-map", "1:a");
  }

  if (options.burn) {
    const b = options.burn;
    // Burning draws into the picture, so the video cannot be stream-copied.
    args.push(
      "-vf",
      `subtitles='${escapeFilterPath(b.srtPath)}':force_style='` +
        `FontSize=${b.fontSize},` +
        `PrimaryColour=${b.primaryColour},` +
        `OutlineColour=${b.outlineColour},` +
        `BorderStyle=1,Outline=2,Shadow=0,` +
        `Alignment=2,MarginV=${b.marginV}'`,
      "-c:v", "libx264",
      "-crf", "18",
      "-preset", "medium",
      "-pix_fmt", "yuv420p"
    );
  } else {
    args.push("-c:v", "copy");
  }

  args.push(
    "-c:a", "aac",
    "-b:a", "192k",
    "-movflags", "+faststart",
    "-shortest",
    outputPath
  );

  await execa("ffmpeg", args);

  try { fs.unlinkSync(narrationPath); } catch { /* non-critical */ }
}

export { mergeAudioVideo, escapeFilterPath };
export type { MergeOptions, BurnOptions, MusicOptions };
