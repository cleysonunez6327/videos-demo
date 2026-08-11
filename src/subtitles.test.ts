import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { generateSrt, splitIntoCues, formatSrtTime } from "./subtitles.js";

describe("formatSrtTime", () => {
  test("formats zero", () => {
    assert.equal(formatSrtTime(0), "00:00:00,000");
  });

  test("pads every field", () => {
    assert.equal(formatSrtTime(1_000), "00:00:01,000");
    assert.equal(formatSrtTime(61_500), "00:01:01,500");
  });

  test("carries into hours", () => {
    assert.equal(formatSrtTime(3_661_042), "01:01:01,042");
  });

  test("keeps milliseconds under 1000 after rounding", () => {
    // 999.6ms must not render as ",1000" — that is not a valid SRT timestamp.
    const formatted = formatSrtTime(999.6);
    assert.match(formatted, /^\d{2}:\d{2}:\d{2},\d{3}$/);
    assert.ok(Number(formatted.slice(-3)) < 1000, `got ${formatted}`);
  });
});

describe("splitIntoCues", () => {
  test("keeps a short sentence as one cue", () => {
    assert.deepEqual(splitIntoCues("Hola mundo."), ["Hola mundo."]);
  });

  test("splits on sentence boundaries", () => {
    assert.deepEqual(
      splitIntoCues("Primera. Segunda! Tercera?"),
      ["Primera.", "Segunda!", "Tercera?"]
    );
  });

  test("splits an over-long sentence at commas", () => {
    const long =
      "Extraer datos de la web es tedioso, el HTML llega sucio, " +
      "el contenido carga por JavaScript, y encima aparecen bloqueos.";
    const cues = splitIntoCues(long);
    assert.ok(cues.length > 1, "should have split");
    for (const cue of cues) {
      assert.ok(cue.length <= 80, `cue too long (${cue.length}): ${cue}`);
    }
  });

  test("falls back to word boundaries when there are no commas", () => {
    const long = "palabra ".repeat(30).trim();
    const cues = splitIntoCues(long);
    for (const cue of cues) {
      assert.ok(cue.length <= 80, `cue too long (${cue.length})`);
    }
  });

  test("never loses words", () => {
    const text = "Uno dos tres, cuatro cinco seis, siete ocho nueve diez.";
    const words = (s: string): string[] => s.split(/\s+/).filter(Boolean);
    assert.deepEqual(
      splitIntoCues(text).flatMap(words),
      words(text)
    );
  });

  test("returns no cues for blank narration", () => {
    assert.deepEqual(splitIntoCues("   "), []);
  });
});

describe("generateSrt", () => {
  test("returns just a newline when nothing has narration", () => {
    const srt = generateSrt([
      { narration: undefined, videoDurationMs: 3000, audioDurationMs: 0 },
    ]);
    assert.equal(srt, "\n");
  });

  test("numbers cues sequentially across segments", () => {
    const srt = generateSrt([
      { narration: "Uno.", videoDurationMs: 2000, audioDurationMs: 2000 },
      { narration: "Dos.", videoDurationMs: 2000, audioDurationMs: 2000 },
    ]);
    const indices = srt.split("\n\n").map(block => block.split("\n")[0]);
    assert.deepEqual(indices, ["1", "2"]);
  });

  test("advances the clock by videoDuration, not audioDuration", () => {
    // A segment whose video runs longer than its narration must still push
    // the next cue out by the full video length, or subtitles drift early.
    const srt = generateSrt([
      { narration: "Uno.", videoDurationMs: 8000, audioDurationMs: 2000 },
      { narration: "Dos.", videoDurationMs: 2000, audioDurationMs: 2000 },
    ]);
    const secondStart = srt.split("\n\n")[1]?.split("\n")[1]?.split(" --> ")[0];
    assert.equal(secondStart, "00:00:08,000");
  });

  test("segments without narration still consume time", () => {
    const srt = generateSrt([
      { narration: undefined, videoDurationMs: 5000, audioDurationMs: 0 },
      { narration: "Después.", videoDurationMs: 2000, audioDurationMs: 2000 },
    ]);
    assert.match(srt, /^1\n00:00:05,000 --> /);
  });

  test("applies the initial offset for the title card", () => {
    const srt = generateSrt(
      [{ narration: "Hola.", videoDurationMs: 2000, audioDurationMs: 2000 }],
      3000
    );
    assert.match(srt, /^1\n00:00:03,000 --> 00:00:05,000\nHola\./);
  });

  test("splits one narration into consecutive, non-overlapping cues", () => {
    const srt = generateSrt([{
      narration:
        "Extraer datos de la web es tedioso, el HTML llega sucio, " +
        "el contenido carga por JavaScript, y encima aparecen bloqueos.",
      videoDurationMs: 10_000,
      audioDurationMs: 10_000,
    }]);
    const blocks = srt.trim().split("\n\n");
    assert.ok(blocks.length > 1);

    let previousEnd = "00:00:00,000";
    for (const block of blocks) {
      const [start, end] = (block.split("\n")[1] ?? "").split(" --> ");
      assert.equal(start, previousEnd, "cues must be contiguous");
      previousEnd = end ?? "";
    }
    assert.equal(previousEnd, "00:00:10,000", "last cue must end with the audio");
  });

  test("produces valid timestamps even for whitespace-only narration", () => {
    // The schema allows " " through min(1), which yields zero cues; the
    // divisor must not turn into NaN and poison every timestamp.
    const srt = generateSrt([
      { narration: "   ", videoDurationMs: 2000, audioDurationMs: 2000 },
      { narration: "Real.", videoDurationMs: 2000, audioDurationMs: 2000 },
    ]);
    assert.doesNotMatch(srt, /NaN/, "timestamps must never contain NaN");
  });
});
