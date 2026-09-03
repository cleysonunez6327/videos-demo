import { test, describe } from "node:test";
import assert from "node:assert/strict";
import type { Page } from "playwright";
import { waitForDone, escapeAttributeValue } from "./waiters.js";
import type { DoneCondition } from "./schema.js";

/**
 * A stand-in for the handful of Page methods the waiters touch. It records
 * what it was asked to wait for, so the tests can assert on the arguments
 * rather than on browser behaviour.
 */
interface Call {
  readonly method: string;
  readonly args: readonly unknown[];
}

function fakePage(evaluateResult: unknown = true): {
  page: Page;
  calls: readonly Call[];
} {
  const calls: Call[] = [];
  const record = (method: string) => (...args: readonly unknown[]) => {
    calls.push({ method, args });
    return Promise.resolve();
  };

  const locator = {
    waitFor: record("locator.waitFor"),
    filter: () => locator,
  };

  const page = {
    locator: (selector: string) => {
      calls.push({ method: "locator", args: [selector] });
      return locator;
    },
    waitForLoadState: record("waitForLoadState"),
    waitForURL: record("waitForURL"),
    evaluate: (_fn: unknown, arg: unknown) => {
      calls.push({ method: "evaluate", args: [arg] });
      return Promise.resolve(evaluateResult);
    },
  };

  // The fake implements only what these waiters reach for; the cast is the
  // usual test-fixture escape, not a claim that this is a real Page.
  return { page: page as unknown as Page, calls };
}

function find(calls: readonly Call[], method: string): Call | undefined {
  return calls.find(c => c.method === method);
}

describe("waitForDone: timeouts", () => {
  test("passes the condition's timeout to networkIdle", async () => {
    // Regression: this waiter used to be called with no options at all, so it
    // silently used Playwright's 30s default and ignored the playbook.
    const { page, calls } = fakePage();
    await waitForDone(page, { networkIdle: true, timeout: 5000 } as DoneCondition);

    const call = find(calls, "waitForLoadState");
    assert.ok(call, "networkIdle no esperó nada");
    assert.deepEqual(call.args, ["networkidle", { timeout: 5000 }]);
  });

  test("falls back to the default timeout when the condition omits one", async () => {
    const { page, calls } = fakePage();
    await waitForDone(page, { networkIdle: true } as DoneCondition);

    assert.deepEqual(find(calls, "waitForLoadState")?.args[1], { timeout: 15000 });
  });

  test("hands the stable waiter both the quiet period and a cap", async () => {
    const { page, calls } = fakePage();
    await waitForDone(page, { stable: 500, timeout: 9000 } as DoneCondition);

    assert.deepEqual(find(calls, "evaluate")?.args[0], { quiet: 500, cap: 9000 });
  });

  test("caps the stable waiter with the default when none is given", async () => {
    const { page, calls } = fakePage();
    await waitForDone(page, { stable: 500 } as DoneCondition);

    assert.deepEqual(find(calls, "evaluate")?.args[0], { quiet: 500, cap: 15000 });
  });
});

describe("waitForDone: stable that never settles", () => {
  test("fails instead of hanging when the cap is reached", async () => {
    // The in-page promise resolves false when its cap fires. Before this,
    // nothing resolved at all and the render hung with no explanation.
    const { page } = fakePage(false);

    await assert.rejects(
      () => waitForDone(page, { stable: 500, timeout: 2000 } as DoneCondition),
      /never went quiet for 500ms within 2000ms/
    );
  });

  test("resolves quietly when the DOM does settle", async () => {
    const { page } = fakePage(true);
    await waitForDone(page, { stable: 500 } as DoneCondition);
  });
});

describe("waitForDone: composition", () => {
  test("awaits every condition it was given, not just the first", async () => {
    const { page, calls } = fakePage();
    await waitForDone(page, {
      visible: ".a",
      hidden: ".b",
      networkIdle: true,
      url: "**/x",
      stable: 300,
      timeout: 7000,
    } as DoneCondition);

    for (const method of ["waitForLoadState", "waitForURL", "evaluate"]) {
      assert.ok(find(calls, method), `no esperó por ${method}`);
    }
    assert.equal(calls.filter(c => c.method === "locator.waitFor").length, 2);
  });

  test("does nothing when the condition is empty", async () => {
    const { page, calls } = fakePage();
    await waitForDone(page, {} as DoneCondition);
    assert.equal(calls.length, 0);
  });
});

describe("escapeAttributeValue", () => {
  test("escapes a quote that would close the selector early", () => {
    // `[data-x="a" b]` is a different, valid selector — it fails silently
    // rather than loudly, which is the worst kind of wrong.
    assert.equal(escapeAttributeValue('a" b'), 'a\\" b');
  });

  test("escapes backslashes before quotes, so they are not doubled twice", () => {
    assert.equal(escapeAttributeValue("a\\b"), "a\\\\b");
  });

  test("leaves an ordinary value untouched", () => {
    assert.equal(escapeAttributeValue("dark"), "dark");
  });
});
