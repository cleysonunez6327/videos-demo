interface SubtitleSegment {
  narration: string | undefined;
  /** On-screen text when it differs from the narration. */
  subtitle?: string | undefined;
  videoDurationMs: number;
  audioDurationMs: number;
}

/**
 * Which text a track reads from.
 *
 * `spoken` follows the voice. `onScreen` prefers the segment's own subtitle and
 * falls back to the narration, so a playbook only has to write the field for
 * the segments where the two differ.
 */
type SubtitleSource = "spoken" | "onScreen";

function textFor(segment: SubtitleSegment, source: SubtitleSource): string | undefined {
  return source === "onScreen" ? segment.subtitle ?? segment.narration : segment.narration;
}

const MAX_CUE_CHARS = 80;

function formatSrtTime(ms: number): string {
  // Round once, up front. Flooring the seconds and separately rounding the
  // remainder lets 999.6ms become 0s + 1000ms — "00:00:00,1000", which is not
  // a valid SRT timestamp. Cue boundaries are fractional, so this is reachable.
  const total = Math.max(0, Math.round(ms));
  const totalSeconds = Math.floor(total / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const millis = total % 1000;
  return (
    String(hours).padStart(2, "0") +
    ":" +
    String(minutes).padStart(2, "0") +
    ":" +
    String(seconds).padStart(2, "0") +
    "," +
    String(millis).padStart(3, "0")
  );
}

function splitIntoCues(text: string): string[] {
  // Step 1: split into sentences
  const sentences = text.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) ?? [text];
  const cues: string[] = [];

  for (const raw of sentences) {
    const sentence = raw.trim();
    if (!sentence) continue;

    if (sentence.length <= MAX_CUE_CHARS) {
      cues.push(sentence);
      continue;
    }

    // Step 2: split long sentences at commas
    const parts = sentence.split(/,\s*/);
    let current = "";
    for (const part of parts) {
      const candidate = current ? `${current}, ${part}` : part;
      if (candidate.length <= MAX_CUE_CHARS) {
        current = candidate;
      } else {
        if (current) cues.push(current);
        current = part;
      }
    }

    // Step 3: if still too long, split at word boundaries
    if (current.length <= MAX_CUE_CHARS) {
      if (current) cues.push(current);
    } else {
      const words = current.split(/\s+/);
      let line = "";
      for (const word of words) {
        const candidate = line ? `${line} ${word}` : word;
        if (candidate.length <= MAX_CUE_CHARS) {
          line = candidate;
        } else {
          if (line) cues.push(line);
          line = word;
        }
      }
      if (line) cues.push(line);
    }
  }

  return cues;
}

function generateSrt(
  segments: SubtitleSegment[],
  initialOffsetMs = 0,
  source: SubtitleSource = "spoken"
): string {
  const entries: string[] = [];
  let index = 1;
  let offsetMs = initialOffsetMs;

  for (const segment of segments) {
    const text = textFor(segment, source);
    if (text) {
      // Cue lengths are measured on the text being shown, but the durations
      // still come from the audio: a translation is rarely the same length as
      // what was said, and pacing the cues by the spoken text would drift.
      const cues = splitIntoCues(text);
      const totalChars = cues.reduce((sum, c) => sum + c.length, 0);

      let cueOffsetMs = offsetMs;
      for (const cue of cues) {
        const proportion = cue.length / totalChars;
        const durationMs = segment.audioDurationMs * proportion;
        const startMs = cueOffsetMs;
        const endMs = cueOffsetMs + durationMs;

        entries.push(
          `${index}\n${formatSrtTime(startMs)} --> ${formatSrtTime(endMs)}\n${cue}`
        );
        index++;
        cueOffsetMs = endMs;
      }
    }
    offsetMs += segment.videoDurationMs;
  }

  return entries.join("\n\n") + "\n";
}

export { generateSrt, splitIntoCues, formatSrtTime, textFor };
export type { SubtitleSegment, SubtitleSource };
