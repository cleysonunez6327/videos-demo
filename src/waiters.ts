import type { Page } from "playwright";
import type { DoneCondition } from "./schema.js";

const DEFAULT_TIMEOUT = 15000;

/**
 * Escape a value going inside a double-quoted CSS attribute selector.
 *
 * The value is interpolated straight into the selector, so a quote or a
 * backslash in it does not fail loudly — it produces a different, valid
 * selector that quietly matches something else, or nothing.
 */
function escapeAttributeValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

async function waitForDone(
  page: Page,
  done: DoneCondition,
  timeout = DEFAULT_TIMEOUT
): Promise<void> {
  const t = done.timeout ?? timeout;
  const promises: Promise<unknown>[] = [];

  if (done.visible)
    promises.push(
      page.locator(done.visible)
        .waitFor({ state: "visible", timeout: t })
    );
  if (done.hidden)
    promises.push(
      page.locator(done.hidden)
        .waitFor({ state: "hidden", timeout: t })
    );
  if (done.networkIdle)
    promises.push(
      page.waitForLoadState("networkidle", { timeout: t })
    );
  if (done.url)
    promises.push(
      page.waitForURL(done.url, { timeout: t })
    );
  if (done.stable)
    promises.push(
      waitForDomStable(page, done.stable, t)
    );
  if (done.text)
    promises.push(
      page.locator(done.text.selector)
        .filter({ hasText: done.text.has })
        .waitFor({ state: "visible", timeout: t })
    );
  if (done.attribute)
    promises.push(
      page.locator(
        `${done.attribute.selector}` +
        `[${done.attribute.name}="${escapeAttributeValue(done.attribute.value)}"]`
      ).waitFor({ state: "visible", timeout: t })
    );

  if (promises.length > 0) {
    await Promise.all(promises);
  }
}

/**
 * Resolve once the DOM has been quiet for `quietMs`, or give up after
 * `capMs`.
 *
 * The cap is the point of this signature. Without it the in-page promise
 * never settles on a page that keeps mutating, and `page.evaluate` has no
 * timeout of its own — so the render hangs with nothing on screen explaining
 * why. A condition that cannot be met should fail like every other waiter.
 *
 * `characterData` is deliberately not observed. Text that changes without
 * touching nodes is almost always a clock, a countdown or a progress figure,
 * and treating those as movement would make `stable` unsatisfiable on exactly
 * the screens demos like to end on. Structural change is the signal we want.
 */
async function waitForDomStable(
  page: Page,
  quietMs: number,
  capMs: number
): Promise<void> {
  const settled = await page.evaluate(
    ({ quiet, cap }: { quiet: number; cap: number }) =>
      new Promise<boolean>((resolve) => {
        let timer: ReturnType<typeof setTimeout>;

        const finish = (value: boolean): void => {
          clearTimeout(timer);
          clearTimeout(capTimer);
          observer.disconnect();
          resolve(value);
        };

        const observer = new MutationObserver(() => {
          clearTimeout(timer);
          timer = setTimeout(() => finish(true), quiet);
        });

        const capTimer = setTimeout(() => finish(false), cap);

        observer.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
        });
        timer = setTimeout(() => finish(true), quiet);
      }),
    { quiet: quietMs, cap: capMs }
  );

  if (!settled) {
    throw new Error(
      `DOM never went quiet for ${quietMs}ms within ${capMs}ms. ` +
      `Something on the page keeps changing — raise the timeout, lower ` +
      `\`stable\`, or wait on a selector instead.`
    );
  }
}

export { waitForDone, escapeAttributeValue };
