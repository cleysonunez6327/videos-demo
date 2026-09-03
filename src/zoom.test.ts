import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { zoomTargetOrigin, extensionZoom } from "./zoom.js";

describe("zoomTargetOrigin", () => {
  test("keeps the origin, dropping path and query", () => {
    assert.equal(
      zoomTargetOrigin("https://payzum.com/en/pricing?a=1"),
      "https://payzum.com"
    );
  });

  test("treats a subdomain as its own origin — this is the bug it guards", () => {
    assert.notEqual(
      zoomTargetOrigin("https://merchant.payzum.com/sign-in"),
      zoomTargetOrigin("https://payzum.com/")
    );
  });

  test("distinguishes ports, which Chrome scopes separately too", () => {
    assert.notEqual(
      zoomTargetOrigin("http://skywalker:4300/"),
      zoomTargetOrigin("http://skywalker:7862/")
    );
  });

  test("returns null where the content script cannot run", () => {
    for (const url of ["about:blank", "data:text/html,<p>x", "chrome://version", "nonsense"]) {
      assert.equal(zoomTargetOrigin(url), null, url);
    }
  });
});

describe("extensionZoom", () => {
  test("rounds a zoom the extension would otherwise discard", () => {
    // 2.2 × scale 2 × 100 — the value that recorded a whole demo at 100%.
    assert.equal(extensionZoom(2.2 * 2 * 100), 440);
  });

  test("always returns an integer, which is what the guard requires", () => {
    for (const zoom of [1, 1.1, 1.25, 1.5, 1.75, 2, 2.2, 2.5, 3]) {
      for (const scale of [1, 2, 3]) {
        const value = extensionZoom(zoom * scale * 100);
        assert.ok(Number.isInteger(value), `${zoom}×${scale} dio ${value}`);
      }
    }
  });

  test("leaves values that were already exact alone", () => {
    assert.equal(extensionZoom(1.25 * 2 * 100), 250);
  });
});
