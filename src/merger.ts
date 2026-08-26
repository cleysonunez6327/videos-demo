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
  readonly box: boolean;
}

/** A subtitle file to carry inside the mp4, selectable by the viewer. */
interface SubtitleTrack {
  readonly path: string;
  readonly language: string;
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
  subtitleTracks?: readonly SubtitleTrack[] | undefined;
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
  // Re-encoded rather than stream-copied. The parts do not share a sample
  // rate — the TTS lab returns 48 kHz and the generated silence is 44.1 —
  // and a copy concat yields one file whose rate changes mid-stream. Every
  // change makes ffmpeg rebuild the filter graph downstream, which resets
  // loudnorm and feeds NaN to the encoder. Cheap: this track is seconds long.
  await execa("ffmpeg", [
    "-y",
    "-f", "concat",
    "-safe", "0",
    "-i", filelistPath,
    "-ar", "48000",
    "-ac", "1",
    "-c:a", "libmp3lame",
    "-q:a", "2",
    combinedAudioPath,
  ]);

  for (const file of scratch) {
    try { fs.unlinkSync(file); } catch { /* non-critical */ }
  }
  return combinedAudioPath;
}

/**
 * Loudness target for the narration, EBU R128.
 *
 * Cloned voices arrive at whatever level their reference audio had: measured
 * across two demos, `angie` peaked at -3.3 dBFS and `jeremy` at -9.3, so a
 * viewer watching the series back to back had to reach for the volume between
 * videos. Levelling here rather than per-voice keeps that fix in one place as
 * the roster grows.
 *
 * -16 LUFS is the usual target for spoken word on the web, and -1.5 dBTP
 * leaves headroom for the lossy encode that follows.
 */
/** Target and input conditioning shared by both loudnorm passes. */
const LOUDNESS_TARGET = "I=-16:TP=-1.5:LRA=11";
const NARRATION_FORMAT = "aresample=48000,aformat=channel_layouts=mono";

interface LoudnessStats {
  readonly input_i: string;
  readonly input_tp: string;
  readonly input_lra: string;
  readonly input_thresh: string;
  readonly target_offset: string;
}

/**
 * Measure the narration so the second pass can hit the target exactly.
 *
 * One-pass loudnorm estimates as it goes and drifts on material with long
 * gaps: measured across three demos it landed at -16.8, -16.9 and -18.3 LUFS,
 * and that last one is audibly quieter in a run of videos. Measuring first
 * costs one extra decode of a track that is seconds long.
 *
 * Returns null when the measurement cannot be parsed, in which case the caller
 * falls back to the single pass — being 1.5 LU out beats failing the render.
 */
async function measureLoudness(audioPath: string): Promise<LoudnessStats | null> {
  try {
    const { stderr } = await execa("ffmpeg", [
      "-i", audioPath,
      "-af", `${NARRATION_FORMAT},loudnorm=${LOUDNESS_TARGET}:print_format=json`,
      "-f", "null", "-",
    ], { reject: false });

    // ffmpeg writes the JSON block last, after its usual banner and progress.
    const match = stderr.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as Partial<LoudnessStats>;
    if (!parsed.input_i || !parsed.target_offset) return null;
    return parsed as LoudnessStats;
  } catch {
    return null;
  }
}

/** Filter chain that levels the narration, using measurements when available. */
function narrationLoudnessFilter(stats: LoudnessStats | null): string {
  const loudnorm = stats
    ? `loudnorm=${LOUDNESS_TARGET}:measured_I=${stats.input_i}:` +
      `measured_TP=${stats.input_tp}:measured_LRA=${stats.input_lra}:` +
      `measured_thresh=${stats.input_thresh}:offset=${stats.target_offset}:linear=true`
    : `loudnorm=${LOUDNESS_TARGET}`;
  // The rate is pinned on both sides: loudnorm resamples to 192 kHz
  // internally, and the encoder should not see that.
  return `${NARRATION_FORMAT},${loudnorm},aresample=48000`;
}

async function mergeAudioVideo(options: MergeOptions): Promise<void> {
  const { videoPath, outputPath } = options;

  const narrationPath = await buildNarrationTrack(options);
  const loudness = narrationLoudnessFilter(await measureLoudness(narrationPath));
  const totalMs =
    (options.preSegmentDurationMs ?? 0) +
    options.segments.reduce((sum, s) => sum + s.videoDurationMs, 0) +
    (options.postSegmentDurationMs ?? 0);

  const args: string[] = ["-y", "-i", videoPath, "-i", narrationPath];
  if (options.music) args.push("-stream_loop", "-1", "-i", options.music.path);

  // Subtitle files come in after the media, so their input indices start past
  // the video, the narration and the optional music bed.
  const tracks = options.subtitleTracks ?? [];
  const firstTrackInput = options.music ? 3 : 2;
  for (const track of tracks) args.push("-i", track.path);

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
      `[1:a]${loudness}[voice];` +
        `[2:a]atrim=0:${(totalMs / 1000).toFixed(3)},` +
        `volume=${options.music.volume},` +
        `afade=t=out:st=${fadeStartSec.toFixed(3)}:d=${(options.music.fadeOutMs / 1000).toFixed(3)}[bed];` +
        `[voice][bed]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]`,
      "-map", "0:v",
      "-map", "[aout]"
    );
  } else {
    args.push(
      "-filter_complex", `[1:a]${loudness}[aout]`,
      "-map", "0:v",
      "-map", "[aout]"
    );
  }

  if (options.burn) {
    const b = options.burn;
    // Burning draws into the picture, so the video cannot be stream-copied.
    args.push(
      "-vf",
      `subtitles='${escapeFilterPath(b.srtPath)}':force_style='` +
        `FontSize=${b.fontSize},` +
        `PrimaryColour=${b.primaryColour},` +
        `OutlineColour=${b.box ? "&H80000000" : b.outlineColour},` +
        // BorderStyle=3 fills a box with OutlineColour; Outline becomes its
        // padding. The &H80 alpha keeps the picture readable through it.
        `BorderStyle=${b.box ? 3 : 1},Outline=${b.box ? 4 : 2},Shadow=0,` +
        `Alignment=2,MarginV=${b.marginV}'`,
      "-c:v", "libx264",
      "-crf", "18",
      "-preset", "medium",
      "-pix_fmt", "yuv420p"
    );
  } else {
    args.push("-c:v", "copy");
  }

  // mov_text is the only subtitle codec mp4 carries. Browsers ignore it — they
  // need a <track> pointing at the sidecar — but desktop players and phones
  // expose it as a language picker, which is the point of shipping it.
  tracks.forEach((track, i) => {
    args.push("-map", `${firstTrackInput + i}:s`);
    args.push(`-metadata:s:s:${i}`, `language=${track.language}`);
  });
  if (tracks.length > 0) args.push("-c:s", "mov_text");

  args.push(
    "-c:a", "aac",
    "-b:a", "192k",
    "-movflags", "+faststart",
    // Length is stated rather than inferred. `-shortest` looks at every mapped
    // stream, and a subtitle track ends with the last spoken cue — which is
    // earlier than the picture whenever a demo holds on screen after the
    // narration stops. Once subtitles moved inside the mp4, they started
    // deciding where the video ended: a 46 s recording came out at 40 s, with
    // the closing segment missing and nothing reported.
    "-t", (totalMs / 1000).toFixed(3),
    outputPath
  );

  await execa("ffmpeg", args);

  try { fs.unlinkSync(narrationPath); } catch { /* non-critical */ }
}

export { mergeAudioVideo, escapeFilterPath };
export type { MergeOptions, BurnOptions, MusicOptions };
