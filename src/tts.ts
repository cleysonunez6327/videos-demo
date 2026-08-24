// ─── Backward Compatibility Wrapper ──────────────────────────
// This file re-exports the old API for compatibility with existing code.
// New code should import from './tts/' directly.

import { ensureAudio, checkBalance, isRetryableStatus, API_KEY_ENV } from './tts/index.js';

// Re-export the old API
export { ensureAudio, checkBalance, isRetryableStatus, API_KEY_ENV };

// Re-export types
export type { TtsResult } from './tts/index.js';
