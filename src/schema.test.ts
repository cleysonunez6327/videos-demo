import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { PlaybookSchema } from "./schema.js";
import { first } from "./test-helpers.js";

const base = {
  app: { url: "http://localhost:3000/" },
  segments: [
    { id: "intro", intent: "mostrar", actions: [{ type: "wait", duration: 1000 }] },
  ],
};

function parseTts(tts?: unknown) {
  return PlaybookSchema.safeParse(tts === undefined ? base : { ...base, tts });
}

function issues(result: ReturnType<typeof parseTts>): string {
  return result.success
    ? ""
    : result.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join(" | ");
}

describe("tts config", () => {
  test("defaults to grok + sal at normal speed", () => {
    const result = parseTts();
    assert.ok(result.success);
    assert.deepEqual(result.data.tts, {
      provider: "llm4agents",
      model: "x-ai/grok-voice-tts-1.0",
      voice: "sal",
      speed: 1,
    });
  });

  test("accepts every documented voice, case-insensitively", () => {
    for (const voice of ["eve", "ara", "rex", "sal", "leo", "SAL", "Leo"]) {
      assert.ok(parseTts({ voice }).success, `${voice} should be accepted`);
    }
  });

  test("rejects an OpenAI voice with an actionable message", () => {
    const result = parseTts({ voice: "alloy" });
    assert.ok(!result.success);
    assert.match(issues(result), /eve, ara, rex, sal, leo/);
  });

  test("rejects the old openai provider so stale playbooks fail loudly", () => {
    assert.ok(!parseTts({ provider: "openai" }).success);
    assert.ok(!parseTts({ provider: "elevenlabs" }).success);
  });

  test("does not police voices for other models", () => {
    // Voices are model-specific; only the model we know about is validated.
    assert.ok(parseTts({ model: "otro/tts", voice: "cualquiera" }).success);
  });

  test("bounds speed to the range the API accepts", () => {
    assert.ok(parseTts({ speed: 4 }).success);
    assert.ok(!parseTts({ speed: 4.1 }).success);
    assert.ok(!parseTts({ speed: 0 }).success);
    assert.ok(!parseTts({ speed: -1 }).success);
  });
});

describe("tts config: voxcpm", () => {
  function parseVox(extra: Record<string, unknown>) {
    return parseTts({ provider: "voxcpm", ...extra });
  }

  test("clones an archived voice with ultimate by default", () => {
    const result = parseVox({ voice: "jeremy" });
    assert.ok(result.success, issues(result));
    assert.deepEqual(result.data.tts, {
      provider: "voxcpm",
      voice: "jeremy",
      mode: "ultimate",
      format: "mp3",
      language: "Spanish",
      cfgValue: 2.0,
      inferenceTimesteps: 10,
      refMaxSec: 15,
      normalize: false,
      denoise: false,
    });
  });

  test("accepts a voice slug the client does not know about", () => {
    // Voices are cloned from the lab UI and appear in the API at once, so a
    // hardcoded list here would reject a voice that actually exists.
    assert.ok(parseVox({ voice: "recien-clonada" }).success);
  });

  test("needs a voice or a style", () => {
    const result = parseVox({});
    assert.ok(!result.success);
    assert.match(issues(result), /voice.*style/s);
  });

  test("a style alone implies simple, since ultimate would speak it aloud", () => {
    const result = parseVox({ style: "tono de documental" });
    assert.ok(result.success, issues(result));
    assert.equal(result.data.tts.provider, "voxcpm");
    if (result.data.tts.provider === "voxcpm") {
      assert.equal(result.data.tts.mode, "simple");
    }
  });

  test("rejects style combined with an explicit ultimate", () => {
    const result = parseVox({ voice: "jeremy", style: "urgente", mode: "ultimate" });
    assert.ok(!result.success);
    assert.match(issues(result), /style/);
  });

  test("keeps an explicit mode when there is no style", () => {
    const result = parseVox({ voice: "jeremy", mode: "simple" });
    assert.ok(result.success, issues(result));
    if (result.success && result.data.tts.provider === "voxcpm") {
      assert.equal(result.data.tts.mode, "simple");
    }
  });

  test("caps reference audio at the length the lab accepts", () => {
    assert.ok(parseVox({ voice: "jeremy", refMaxSec: 45 }).success);
    assert.ok(!parseVox({ voice: "jeremy", refMaxSec: 46 }).success);
  });

  test("takes a baseUrl override for when MagicDNS does not resolve", () => {
    const result = parseVox({ voice: "jeremy", baseUrl: "http://100.74.189.100:7862" });
    assert.ok(result.success, issues(result));
    assert.ok(!parseVox({ voice: "jeremy", baseUrl: "no-es-una-url" }).success);
  });

  test("rejects an unknown provider", () => {
    assert.ok(!parseTts({ provider: "qwen3", voice: "jeremy" }).success);
  });
});

describe("segments", () => {
  test("requires a lowercase hyphenated id", () => {
    for (const id of ["Intro", "intro_1", "-intro", "intro segmento"]) {
      const result = PlaybookSchema.safeParse({
        ...base,
        segments: [{ id, intent: "x", actions: [] }],
      });
      assert.ok(!result.success, `${id} should be rejected`);
    }
  });

  test("allows a segment with no narration", () => {
    const result = PlaybookSchema.safeParse({
      ...base,
      segments: [{ id: "muda", intent: "x", actions: [] }],
    });
    assert.ok(result.success);
    assert.equal(first(result.data.segments, "segment").narration, undefined);
  });

  test("defaults timing to after and actions to empty", () => {
    const result = PlaybookSchema.safeParse({
      ...base,
      segments: [{ id: "x", intent: "y" }],
    });
    assert.ok(result.success);
    const segment = first(result.data.segments, "segment");
    assert.equal(segment.timing, "after");
    assert.deepEqual(segment.actions, []);
  });

  test("requires at least one segment", () => {
    assert.ok(!PlaybookSchema.safeParse({ ...base, segments: [] }).success);
  });
});

describe("titleCard", () => {
  const withCard = (titleCard: unknown) =>
    PlaybookSchema.safeParse({ ...base, titleCard });

  test("holds for 600ms by default — the card is dead air before segment one", () => {
    const result = withCard({ title: "Demo" });
    assert.ok(result.success);
    assert.equal(result.data.titleCard?.duration, 600);
  });

  test("accepts a plain title card without a stat", () => {
    const result = withCard({ title: "Demo", subtitle: "Un subtítulo" });
    assert.ok(result.success);
    assert.equal(result.data.titleCard?.stat, undefined);
  });

  test("accepts a stat card leading with the metric", () => {
    const result = withCard({
      title: "AiCrawl.io",
      stat: { value: "10x", label: "menos tokens por página" },
    });
    assert.ok(result.success);
    assert.equal(result.data.titleCard?.stat?.value, "10x");
  });

  test("a stat needs both its value and its label", () => {
    assert.ok(!withCard({ title: "X", stat: { value: "10x" } }).success);
    assert.ok(!withCard({ title: "X", stat: { label: "algo" } }).success);
    assert.ok(!withCard({ title: "X", stat: { value: "", label: "algo" } }).success);
  });

  test("still requires a title, since the stat card uses it as attribution", () => {
    assert.ok(!withCard({ stat: { value: "10x", label: "algo" } }).success);
  });
});

describe("preSegmentDuration", () => {
  test("is optional and defaults to absent", () => {
    const result = PlaybookSchema.safeParse(base);
    assert.ok(result.success);
    assert.equal(result.data.preSegmentDuration, undefined);
  });

  test("accepts zero but not a negative lead-in", () => {
    assert.ok(PlaybookSchema.safeParse({ ...base, preSegmentDuration: 0 }).success);
    assert.ok(!PlaybookSchema.safeParse({ ...base, preSegmentDuration: -1 }).success);
  });
});

describe("actions", () => {
  const withAction = (action: unknown) =>
    PlaybookSchema.safeParse({
      ...base,
      segments: [{ id: "x", intent: "y", actions: [action] }],
    });

  test("wait and press need no target", () => {
    assert.ok(withAction({ type: "wait", duration: 500 }).success);
    assert.ok(withAction({ type: "press", key: "Enter" }).success);
  });

  test("click and type require a target", () => {
    assert.ok(!withAction({ type: "click" }).success);
    assert.ok(!withAction({ type: "type", text: "hola" }).success);
  });

  test("a target needs at least one field", () => {
    assert.ok(!withAction({ type: "click", target: {} }).success);
    assert.ok(withAction({ type: "click", target: { selector: "#x" } }).success);
  });

  test("rejects unknown action types", () => {
    assert.ok(!withAction({ type: "teleport", target: { selector: "#x" } }).success);
  });
});

describe("app", () => {
  test("rejects a url that is not absolute", () => {
    const result = PlaybookSchema.safeParse({ ...base, app: { url: "/local" } });
    assert.ok(!result.success);
  });

  test("carries the documented viewport and zoom defaults", () => {
    const result = PlaybookSchema.safeParse(base);
    assert.ok(result.success);
    assert.equal(result.data.app.scale, 2);
    assert.equal(result.data.app.zoom, 1.25);
    assert.equal(result.data.app.colorScheme, "light");
  });
});
