import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { escapeFilterPath, quoteConcatPath } from "./merger.js";

describe("quoteConcatPath", () => {
  test("wraps an ordinary path in single quotes", () => {
    assert.equal(quoteConcatPath("/demo/pz/audio/a.mp3"), "'/demo/pz/audio/a.mp3'");
  });

  test("closes and reopens the quote around an apostrophe", () => {
    // ffmpeg has no escape character inside single quotes, so the only way to
    // include one is to leave the quoted run, emit it escaped, and go back in.
    assert.equal(quoteConcatPath("/tmp/Joe's Coffee/a.mp3"), "'/tmp/Joe'\\''s Coffee/a.mp3'");
  });

  test("handles several apostrophes", () => {
    assert.equal(quoteConcatPath("a'b'c"), "'a'\\''b'\\''c'");
  });

  test("leaves spaces alone — the quotes already cover them", () => {
    assert.equal(quoteConcatPath("/a b/c d.mp3"), "'/a b/c d.mp3'");
  });
});

describe("escapeFilterPath", () => {
  test("escapes the characters a filtergraph reads as syntax", () => {
    assert.equal(
      escapeFilterPath("/demo/a,b/c[d]/e.srt"),
      "/demo/a\\,b/c\\[d\\]/e.srt"
    );
  });

  test("escapes a Windows drive colon", () => {
    assert.equal(escapeFilterPath("C:/demo/x.srt"), "C\\:/demo/x.srt");
  });

  test("escapes backslashes before anything else, so they are not doubled twice", () => {
    assert.equal(escapeFilterPath("a\\b"), "a\\\\b");
  });

  test("leaves a plain path untouched", () => {
    assert.equal(escapeFilterPath("/demo/pz/pz.srt"), "/demo/pz/pz.srt");
  });
});
