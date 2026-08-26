import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { generateSrt, textFor } from "./subtitles.js";
import type { SubtitleSegment } from "./subtitles.js";

const seg = (over: Partial<SubtitleSegment> = {}): SubtitleSegment => ({
  narration: "One URL in, the whole picture out.",
  videoDurationMs: 4000,
  audioDurationMs: 4000,
  ...over,
});

describe("textFor", () => {
  test("the spoken track always follows the voice", () => {
    const s = seg({ subtitle: "Una URL, el panorama completo." });
    assert.equal(textFor(s, "spoken"), "One URL in, the whole picture out.");
  });

  test("the on-screen track prefers the segment's own subtitle", () => {
    const s = seg({ subtitle: "Una URL, el panorama completo." });
    assert.equal(textFor(s, "onScreen"), "Una URL, el panorama completo.");
  });

  test("without a subtitle both tracks read the same", () => {
    // Only the segments that actually differ need the field, so the common
    // case must not require writing the narration twice.
    const s = seg();
    assert.equal(textFor(s, "onScreen"), textFor(s, "spoken"));
  });

  test("a segment with no narration yields nothing to show", () => {
    const s = seg({ narration: undefined });
    assert.equal(textFor(s, "spoken"), undefined);
    assert.equal(textFor(s, "onScreen"), undefined);
  });
});

describe("generateSrt with two sources", () => {
  const segments = [seg({ subtitle: "Una URL, el panorama completo." })];

  test("each source produces its own wording", () => {
    assert.match(generateSrt(segments, 0, "onScreen"), /panorama completo/);
    assert.match(generateSrt(segments, 0, "spoken"), /whole picture out/);
  });

  test("the tracks stay aligned in time", () => {
    // Cue text is measured on what is shown, but the clock comes from the
    // audio: a translation is rarely the same length, and pacing by the wrong
    // text would drift the two tracks apart.
    const stamps = (srt: string) => srt.match(/\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}/g) ?? [];
    const a = stamps(generateSrt(segments, 0, "onScreen"));
    const b = stamps(generateSrt(segments, 0, "spoken"));
    assert.ok(a.length > 0, "expected at least one cue");
    assert.equal(a[0]?.split(" --> ")[0], b[0]?.split(" --> ")[0], "same start");
    assert.equal(a.at(-1)?.split(" --> ")[1], b.at(-1)?.split(" --> ")[1], "same end");
  });

  test("defaults to the spoken text when no source is given", () => {
    assert.equal(generateSrt(segments, 0), generateSrt(segments, 0, "spoken"));
  });
});
