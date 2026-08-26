import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { zoomTargetOrigin } from "./zoom.js";

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
