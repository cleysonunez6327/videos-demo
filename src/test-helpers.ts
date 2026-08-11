/**
 * Test-only helper: take the first element of a list, failing loudly when the
 * list is empty. Keeps assertions readable under noUncheckedIndexedAccess
 * without reaching for a non-null assertion, and turns "cannot read property
 * of undefined" into a statement of what the test expected.
 */
function first<T>(items: readonly T[], what = "item"): T {
  const item = items[0];
  if (item === undefined) {
    throw new Error(`Expected at least one ${what}, got none`);
  }
  return item;
}

export { first };
