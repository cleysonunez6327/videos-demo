import type { Page } from "playwright";
import { execa } from "execa";
import type { SetupStep, Condition } from "./schema.js";
import { executeAction } from "./executor.js";

/**
 * Whether a URL matches a glob pattern: `**` spans path separators, `*` does not.
 *
 * The two wildcards are swapped in through a placeholder rather than one after
 * the other. Replacing `**` with `.*` first and then `*` with `[^/]*` rewrites
 * the star that the first pass just produced, so `**\/dashboard` compiled to
 * `^.[^/]*\/dashboard$` and matched nothing — every `url:` condition using `**`
 * silently evaluated false, which reads exactly like a step being skipped on
 * purpose.
 */
function urlMatches(pattern: string, url: string): boolean {
  const ANY = "\u0000";
  const source = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, ANY)
    .replace(/\*/g, "[^/]*")
    .replaceAll(ANY, ".*");
  return new RegExp(`^${source}$`).test(url);
}

async function checkCondition(
  page: Page,
  condition: Condition
): Promise<boolean> {
  if (condition.visible) {
    const count = await page.locator(condition.visible).count();
    if (count === 0) return false;
  }
  if (condition.hidden) {
    const count = await page.locator(condition.hidden).count();
    if (count > 0) return false;
  }
  if (condition.url) {
    if (!urlMatches(condition.url, page.url())) return false;
  }
  return true;
}

/** Extract keeps the guard tied to the real union member, so the `else`
 *  branch narrows to the browser-action variant instead of the whole union. */
function isRunStep(step: SetupStep): step is Extract<SetupStep, { run: string }> {
  return "run" in step;
}

async function executeSetup(
  page: Page | null,
  steps: SetupStep[],
  options: { cwd?: string } = {}
): Promise<void> {
  for (const step of steps) {
    // Check condition
    const condition = step.if;
    if (condition && page) {
      const met = await checkCondition(page, condition);
      if (!met) continue;
    }

    if (isRunStep(step)) {
      process.stderr.write(`  run: ${step.run}\n`);
      try {
        await execa("sh", ["-c", step.run], {
          stdout: process.stderr,
          stderr: process.stderr,
          stdin: "ignore",
          // Spread rather than pass undefined: execa's options reject an
          // explicit undefined cwd under exactOptionalPropertyTypes.
          ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
        });
      } catch (err: any) {
        throw new Error(`Setup command failed: ${step.run}\n${err.message}`);
      }
    } else {
      if (!page) {
        throw new Error("Setup browser action requires an open page");
      }
      await executeAction(page, step);
    }
  }
}

export { executeSetup, checkCondition, urlMatches };
