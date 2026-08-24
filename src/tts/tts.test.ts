import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ttsCacheKey } from "./cache.js";
import { createVoxCpmRequest, calculateVoxCpmTimeout, TTS_CONFIG } from "./domain/voices.js";
import type { TTSRequest } from "./domain/voices.js";

/** Minimal VoxCPM2 request; each test overrides only what it is about. */
function req(extra: Partial<TTSRequest> = {}): TTSRequest {
  return { provider: "voxcpm", text: "Hola", ...extra } as TTSRequest;
}

describe("ttsCacheKey", () => {
  test("is stable for the same request", () => {
    assert.equal(ttsCacheKey(req()), ttsCacheKey(req()));
  });

  test("changes when the narration changes", () => {
    assert.notEqual(ttsCacheKey(req()), ttsCacheKey(req({ text: "Adiós" })));
  });

  test("changes for every field that reaches the audio", () => {
    // A config edit that reused a stale file is the failure this guards:
    // the render would silently ship the previous take.
    const base = ttsCacheKey(req());
    const variants: Partial<TTSRequest>[] = [
      { voiceSlug: "angie" as never },
      { mode: "simple" },
      { style: "tono urgente" },
      { language: "English" as never },
      { format: "wav" as never },
      { cfgValue: 3 },
      { inferenceTimesteps: 20 },
      { refMaxSec: 29 },
      { normalize: true },
      { denoise: true },
    ];
    for (const v of variants) {
      const key = Object.keys(v)[0];
      assert.notEqual(ttsCacheKey(req(v)), base, `${key} should change the key`);
    }
  });

  test("separates providers that would otherwise collide", () => {
    assert.notEqual(
      ttsCacheKey({ provider: "voxcpm", text: "Hola" } as TTSRequest),
      ttsCacheKey({ provider: "llm4agents", text: "Hola" } as TTSRequest)
    );
  });
});

describe("createVoxCpmRequest", () => {
  test("needs a voice or a style", () => {
    assert.throws(() => createVoxCpmRequest({ text: "Hola" }), /voice.*style/s);
  });

  test("a style alone implies simple", () => {
    // Under `ultimate` the model reads the directive out loud instead of
    // acting on it, so asking for a style has to pick the other mode.
    const r = createVoxCpmRequest({ text: "Hola", style: "tono de documental" });
    assert.equal(r.mode, "simple");
  });

  test("without a style the default keeps the speaker's cadence", () => {
    assert.equal(createVoxCpmRequest({ text: "Hola", voice: "angie" }).mode, "ultimate");
  });

  test("refuses a style riding along with an explicit ultimate", () => {
    assert.throws(
      () => createVoxCpmRequest({ text: "Hola", voice: "angie", style: "urgente", mode: "ultimate" }),
      /ultimate/
    );
  });

  test("keeps an explicit simple when a style is present", () => {
    const r = createVoxCpmRequest({ text: "Hola", voice: "angie", style: "urgente", mode: "simple" });
    assert.equal(r.mode, "simple");
  });

  test("caps reference audio at what the lab accepts", () => {
    const cap = TTS_CONFIG.voxcpm.maxRefMaxSec;
    assert.doesNotThrow(() => createVoxCpmRequest({ text: "Hola", voice: "angie", refMaxSec: cap }));
    assert.throws(
      () => createVoxCpmRequest({ text: "Hola", voice: "angie", refMaxSec: cap + 1 }),
      /reference audio/
    );
  });

  test("rejects empty text", () => {
    assert.throws(() => createVoxCpmRequest({ text: "   ", voice: "angie" }), /non-empty/);
  });

  test("omits optional fields rather than setting them undefined", () => {
    // exactOptionalPropertyTypes is on: a present-but-undefined key would be
    // serialised into the request body as null.
    const r = createVoxCpmRequest({ text: "Hola", voice: "angie" });
    assert.ok(!("style" in r), "style should be absent");
    assert.ok(!("format" in r), "format should be absent");
  });
});

describe("calculateVoxCpmTimeout", () => {
  const { minTimeoutMs, maxTimeoutMs, coldStartMs } = TTS_CONFIG.voxcpm;

  test("always covers the cold start", () => {
    // The lab loads its model on the first request, so even one word has to
    // wait for that or a fresh service times out on the opening segment.
    assert.ok(calculateVoxCpmTimeout(1) >= coldStartMs);
  });

  test("stays inside its bounds", () => {
    for (const len of [0, 1, 500, 50_000]) {
      const t = calculateVoxCpmTimeout(len);
      assert.ok(t >= minTimeoutMs && t <= maxTimeoutMs, `${len} chars gave ${t}`);
    }
  });

  test("grows with the text", () => {
    assert.ok(calculateVoxCpmTimeout(20_000) > calculateVoxCpmTimeout(100));
  });
});
