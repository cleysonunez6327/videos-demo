import type { Page } from "playwright";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

/** Path to the zoom extension bundled by the playwright-zoom package. */
const ZOOM_EXTENSION_PATH = path.join(
  path.dirname(require.resolve("playwright-zoom")),
  "lib",
  "zoom-extension",
);

/**
 * Chrome args needed to load the zoom extension.
 * Must be spread into the `args` array when launching the browser.
 */
function zoomExtensionArgs(): string[] {
  return [
    `--disable-extensions-except=${ZOOM_EXTENSION_PATH}`,
    `--load-extension=${ZOOM_EXTENSION_PATH}`,
  ];
}

/**
 * Set real browser zoom on a page via the playwright-zoom extension.
 *
 * This triggers `chrome.tabs.setZoom()` through the extension, which
 * behaves like Ctrl+/- zoom: viewport units (vh/vw) adjust, media
 * queries respond, and `window.innerWidth`/`innerHeight` reflect the
 * zoomed viewport. The zoom persists across navigations within the tab.
 *
 * The page must be on an HTTP(S) URL (not about:blank or data:) so the
 * extension's content script is active.
 *
 * Chrome scopes zoom per origin, so this only covers the origin the page is
 * on right now. Use `keepZoomAcrossOrigins` when a demo navigates elsewhere.
 */
async function setBrowserZoom(page: Page, zoomPercent: number): Promise<void> {
  // Uses the same postMessage protocol as playwright-zoom's setBrowserZoom,
  // but typed against playwright's Page (not @playwright/test's Page).
  await page.evaluate(
    (zoom: number) => window.postMessage({ type: "setTabZoom", browserZoom: zoom }, "*"),
    zoomPercent,
  );
  // The extension applies zoom asynchronously; wait for it to take effect.
  await page.waitForTimeout(200);
}

/**
 * The origin `setBrowserZoom` would apply to, or null if the page is
 * somewhere the extension's content script cannot reach.
 */
function zoomTargetOrigin(url: string): string | null {
  try {
    const { protocol, origin } = new URL(url);
    return protocol === "http:" || protocol === "https:" ? origin : null;
  } catch {
    return null;
  }
}

/**
 * Apply zoom now, and again whenever the page lands on an origin that has
 * not been zoomed yet.
 *
 * `chrome.tabs.setZoom` defaults to per-origin scope, so zoom does *not*
 * survive a cross-origin navigation the way it survives a same-origin one:
 * the new origin starts at 100%. A demo that opens a marketing site and then
 * its dashboard on another subdomain records the second half at a fraction
 * of the intended size — legible in the browser, unreadable in the video.
 */
async function keepZoomAcrossOrigins(page: Page, zoomPercent: number): Promise<void> {
  const zoomed = new Set<string>();

  const apply = async (): Promise<void> => {
    const origin = zoomTargetOrigin(page.url());
    if (origin === null || zoomed.has(origin)) return;
    zoomed.add(origin);
    try {
      await setBrowserZoom(page, zoomPercent);
    } catch {
      // Page navigated again or closed mid-flight; let the next load retry.
      zoomed.delete(origin);
    }
  };

  page.on("load", () => void apply());
  await apply();
}

export {
  ZOOM_EXTENSION_PATH,
  zoomExtensionArgs,
  setBrowserZoom,
  keepZoomAcrossOrigins,
  zoomTargetOrigin,
};
