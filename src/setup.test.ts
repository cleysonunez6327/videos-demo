import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { urlMatches } from "./setup.js";

describe("urlMatches", () => {
  test("** spans path separators", () => {
    // The regression that motivated this: a login step conditioned on
    // "**/dashboard" never ran, because the compiled pattern matched nothing.
    assert.ok(urlMatches("**/dashboard", "http://skywalker:4300/dashboard"));
    assert.ok(urlMatches("**/settings", "https://app.example.com/a/b/c/settings"));
  });

  test("* stops at a path separator", () => {
    assert.ok(urlMatches("http://host/*", "http://host/one"));
    assert.ok(!urlMatches("http://host/*", "http://host/one/two"));
  });

  test("does not match a different path", () => {
    assert.ok(!urlMatches("**/dashboard", "http://skywalker:4300/cp/dashboard/c-spy/overview"));
    assert.ok(!urlMatches("**/dashboard", "http://skywalker:4300/sign-in"));
  });

  test("treats regex metacharacters in the pattern as literals", () => {
    assert.ok(urlMatches("**/c-spy/overview", "http://host/cp/dashboard/c-spy/overview"));
    assert.ok(!urlMatches("**/a.c", "http://host/abc"));
  });
});
