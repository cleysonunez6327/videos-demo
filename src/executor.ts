import type { Page } from "playwright";
import type { Action, Segment } from "./schema.js";
import { toLocator } from "./locators.js";
import { waitForDone } from "./waiters.js";
import { pointAt, clickEffect, hideCursor } from "./cursor.js";

async function executeAction(
  page: Page,
  action: Action,
  options: { cursor?: boolean | undefined } = {}
): Promise<void> {
  const showCursor = options.cursor ?? false;

  // Registered before the action runs: the dialog opens during the click and
  // blocks it until something answers.
  if (action.dialog) {
    const answer = action.dialog;
    page.once("dialog", (dialog) => {
      // Swallow the rejection: the daemon's page outlives a single `play`, so
      // a handler left over from an earlier run may have answered this dialog
      // already, and the late reply throws "No dialog is showing".
      void (answer === "accept" ? dialog.accept() : dialog.dismiss()).catch(() => {});
    });
  }

  if (action.type === "wait") {
    await page.waitForTimeout(action.duration);
    // A wait carrying a `done` is asking to pause *until* something is true,
    // with the duration as a floor. Returning early here made the condition
    // silently decorative, which reads as a passing step right up until the
    // next action fails on a page that was never ready.
    if (action.done) await waitForDone(page, action.done);
    return;
  }

  if (action.type === "press") {
    await page.keyboard.press(action.key);
    if (action.done) await waitForDone(page, action.done);
    return;
  }

  const locator = toLocator(page, action.target);

  if (showCursor && (action.type === "click" || action.type === "type"
      || action.type === "hover" || action.type === "select")) {
    await pointAt(page, locator);
  }

  switch (action.type) {
    case "click":
      if (showCursor) await clickEffect(page);
      await locator.click();
      break;
    case "type":
      if (showCursor) await hideCursor(page);
      await locator.fill("");
      await locator.pressSequentially(
        action.text,
        { delay: action.delay ?? 80 }
      );
      break;
    case "hover":
      await locator.hover();
      if (showCursor) await hideCursor(page);
      break;
    case "scroll":
      await locator.scrollIntoViewIfNeeded();
      break;
    case "select":
      if (showCursor) await clickEffect(page);
      await locator.selectOption(action.option);
      break;
  }

  if (action.done) {
    await waitForDone(page, action.done);
  }
}

interface SegmentResult {
  ok: boolean;
  error?: string;
  actionIndex?: number;
}

async function executeSegment(
  page: Page,
  segment: Segment,
  options: { cursor?: boolean | undefined } = {}
): Promise<SegmentResult> {
  let index = 0;
  for (const action of segment.actions) {
    try {
      await executeAction(page, action, options);
    } catch (err) {
      return {
        ok: false,
        error: String(err),
        actionIndex: index,
      };
    }
    index++;
  }
  return { ok: true };
}

/**
 * Shared orchestration for playing a segment with optional audio.
 * Used by both `play` and `render`.
 *
 * - Handles timing (after vs parallel)
 * - Optionally plays audio via a playAudio callback
 * - Waits for audio duration to ensure segment fills the narration
 * - Returns the actual wall-clock duration of the segment
 */
interface RunSegmentOptions {
  cursor?: boolean | undefined;
  audioDurationMs?: number | undefined;
  playAudio?: (() => { kill: () => void; promise: Promise<unknown> }) | undefined;
  onActionStart?: ((action: Action, index: number) => void) | undefined;
  onActionDone?: ((action: Action, index: number) => void) | undefined;
  onActionError?: ((err: unknown, action: Action, index: number) => void) | undefined;
}

async function runSegment(
  page: Page,
  segment: Segment,
  options: RunSegmentOptions = {}
): Promise<{ ok: boolean; durationMs: number; error?: string; actionIndex?: number }> {
  const timing = segment.timing ?? "after";
  const audioDurationMs = options.audioDurationMs ?? 0;
  const segmentStart = Date.now();

  // Start audio
  let audioHandle: { kill: () => void; promise: Promise<unknown> } | null = null;
  if (options.playAudio) {
    audioHandle = options.playAudio();
  }

  // "after" timing: wait for narration to finish before running actions
  if (timing === "after" && audioDurationMs > 0 && segment.actions.length > 0) {
    await page.waitForTimeout(audioDurationMs);
    if (audioHandle) {
      try { await audioHandle.promise; } catch {}
      audioHandle = null;
    }
  }

  // Execute actions
  let index = 0;
  for (const action of segment.actions) {
    options.onActionStart?.(action, index);

    try {
      await executeAction(page, action, { cursor: options.cursor });
      options.onActionDone?.(action, index);
    } catch (err) {
      options.onActionError?.(err, action, index);
      if (audioHandle) audioHandle.kill();
      return {
        ok: false,
        durationMs: Date.now() - segmentStart,
        error: String(err),
        actionIndex: index,
      };
    }
    index++;
  }

  // Pad to audio duration
  const elapsed = Date.now() - segmentStart;
  const remaining = audioDurationMs - elapsed;
  if (remaining > 0) {
    await page.waitForTimeout(remaining);
  }

  // Wait for audio to finish
  if (audioHandle) {
    try { await audioHandle.promise; } catch {}
  }

  return {
    ok: true,
    durationMs: Date.now() - segmentStart,
  };
}

export { executeAction, executeSegment, runSegment };
export type { SegmentResult, RunSegmentOptions };
