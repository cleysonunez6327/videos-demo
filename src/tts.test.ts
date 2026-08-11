import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { isRetryableStatus } from "./tts.js";

describe("isRetryableStatus", () => {
  test("retries rate limits and server faults", () => {
    // The provider returns a bare 500 often enough that a render would
    // otherwise die minutes in, with earlier segments already paid for.
    for (const status of [429, 500, 502, 503, 504]) {
      assert.ok(isRetryableStatus(status), `${status} should be retried`);
    }
  });

  test("does not retry failures that will repeat identically", () => {
    // Bad request, bad key, no balance, unknown model: retrying burns time
    // and, for 402, would re-reserve balance on every attempt.
    for (const status of [400, 401, 402, 404, 409, 422]) {
      assert.ok(!isRetryableStatus(status), `${status} should not be retried`);
    }
  });
});
