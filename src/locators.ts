import type { Page, Locator } from "playwright";
import type { Target } from "./schema.js";

/**
 * Resolve a target to a locator, combining every field it carries.
 *
 * Each field used to be a separate early return, so the first one present
 * won and the rest were dropped without a word — while the documentation
 * said fields could be combined to narrow a match. They can now: the parts
 * are intersected, so `{ role: link, name: "Webhook", selector: "nav a" }`
 * means all three, which is usually what someone reaches for when a bare
 * selector turns out to be ambiguous.
 */
function toLocator(page: Page, target: Target): Locator {
  const parts: Locator[] = [];

  if (target.role) {
    // `name` is an option of this call rather than a part of its own; the
    // schema rejects a name without a role for exactly that reason.
    parts.push(
      page.getByRole(
        target.role,
        target.name === undefined ? {} : { name: target.name }
      )
    );
  }
  if (target.label) parts.push(page.getByLabel(target.label));
  if (target.text) parts.push(page.getByText(target.text));
  if (target.placeholder) parts.push(page.getByPlaceholder(target.placeholder));
  if (target.testId) parts.push(page.getByTestId(target.testId));
  if (target.selector) parts.push(page.locator(target.selector));

  const [first, ...rest] = parts;
  if (!first) {
    throw new Error(
      `Cannot resolve locator from target: ${JSON.stringify(target)}`
    );
  }
  return rest.reduce((combined, part) => combined.and(part), first);
}

export { toLocator };
