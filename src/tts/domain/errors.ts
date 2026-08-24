import type { Result } from './types.js';

// ─── TTS Error Hierarchy (discriminated unions) ───────────────

/**
 * All TTS-related errors.
 * Each variant carries relevant context for debugging and user feedback.
 */
export type TTSError =
  // Network and transport errors
  | { kind: 'network_error'; url: string; message: string }
  | { kind: 'timeout'; endpoint: string; timeoutMs: number }
  | { kind: 'service_unavailable'; provider: string; reason: string | undefined }

  // Authentication and authorization
  | { kind: 'auth_failed'; provider: string; reason: string }
  | { kind: 'invalid_api_key'; provider: string; envVar: string | undefined }

  // Input validation errors
  | { kind: 'invalid_request'; field: string; message: string }
  | { kind: 'text_too_long'; length: number; max: number }
  | { kind: 'voice_not_found'; voice: string; available: readonly string[] }

  // Provider-specific errors
  | { kind: 'insufficient_balance'; provider: string; available: string }
  | { kind: 'rate_limited'; provider: string; retryAfter: number | undefined }
  | { kind: 'synthesis_failed'; provider: string; reason: string }

  // Response parsing errors
  | { kind: 'invalid_response'; expected: string; received: string }
  | { kind: 'empty_audio'; provider: string }

  // Unknown errors
  | { kind: 'unknown_error'; provider: string; cause: unknown };

// ─── Error Constructors ─────────────────────────────────────

export const TTSError = {
  networkError: (url: string, message: string): TTSError => ({
    kind: 'network_error',
    url,
    message,
  }),

  timeout: (endpoint: string, timeoutMs: number): TTSError => ({
    kind: 'timeout',
    endpoint,
    timeoutMs,
  }),

  serviceUnavailable: (provider: string, reason?: string): TTSError => {
    const error: TTSError = {
      kind: 'service_unavailable',
      provider,
      reason: undefined as string | undefined,
    };
    if (reason !== undefined) error.reason = reason;
    return error;
  },

  authFailed: (provider: string, reason: string): TTSError => ({
    kind: 'auth_failed',
    provider,
    reason,
  }),

  invalidApiKey: (provider: string, envVar?: string): TTSError => {
    const error: TTSError = {
      kind: 'invalid_api_key',
      provider,
      envVar: undefined as string | undefined,
    };
    if (envVar !== undefined) error.envVar = envVar;
    return error;
  },

  invalidRequest: (field: string, message: string): TTSError => ({
    kind: 'invalid_request',
    field,
    message,
  }),

  textTooLong: (length: number, max: number): TTSError => ({
    kind: 'text_too_long',
    length,
    max,
  }),

  voiceNotFound: (voice: string, available: readonly string[]): TTSError => ({
    kind: 'voice_not_found',
    voice,
    available,
  }),

  insufficientBalance: (provider: string, available: string): TTSError => ({
    kind: 'insufficient_balance',
    provider,
    available,
  }),

  rateLimited: (provider: string, retryAfter?: number): TTSError => {
    const error: TTSError = {
      kind: 'rate_limited',
      provider,
      retryAfter: undefined as number | undefined,
    };
    if (retryAfter !== undefined) error.retryAfter = retryAfter;
    return error;
  },

  synthesisFailed: (provider: string, reason: string): TTSError => ({
    kind: 'synthesis_failed',
    provider,
    reason,
  }),

  invalidResponse: (expected: string, received: string): TTSError => ({
    kind: 'invalid_response',
    expected,
    received,
  }),

  emptyAudio: (provider: string): TTSError => ({
    kind: 'empty_audio',
    provider,
  }),

  unknownError: (provider: string, cause: unknown): TTSError => ({
    kind: 'unknown_error',
    provider,
    cause,
  }),
};

// ─── Error Formatting ───────────────────────────────────────

/**
 * Format an error for human-readable output.
 * Includes actionable hints where applicable.
 */
export function formatTTSError(error: TTSError): string {
  const hints: Record<string, string> = {
    'auth_failed': 'Check your API key configuration.',
    'invalid_api_key': `Verify your credentials are set correctly.`,
    'insufficient_balance': 'Top up your account balance.',
    'rate_limited': 'Wait a moment before retrying.',
    'text_too_long': 'Split your narration into smaller segments.',
    'voice_not_found': 'Check available voices for this provider.',
    'network_error': 'Check your network connection.',
    'timeout': 'The request took too long. Try a shorter text.',
    'service_unavailable': 'The TTS service is down. Try again later.',
  };

  const base = `${error.kind.replace(/_/g, ' ')}`;

  switch (error.kind) {
    case 'network_error':
      return `${base}: ${error.url} - ${error.message}\n  ${hints['network_error']}`;

    case 'timeout':
      return `${base}: ${error.endpoint} timed out after ${error.timeoutMs}ms\n  ${hints['timeout']}`;

    case 'service_unavailable':
      return `${base}: ${error.provider}${error.reason ? ` - ${error.reason}` : ''}\n  ${hints['service_unavailable']}`;

    case 'auth_failed':
      return `${base}: ${error.provider} - ${error.reason}\n  ${hints['auth_failed']}`;

    case 'invalid_api_key':
      return `${base}: ${error.provider}${error.envVar ? ` (check ${error.envVar})` : ''}\n  ${hints['invalid_api_key']}`;

    case 'invalid_request':
      return `${base}: ${error.field} - ${error.message}`;

    case 'text_too_long':
      return `${base}: ${error.length} chars (max ${error.max})\n  ${hints['text_too_long']}`;

    case 'voice_not_found':
      return `${base}: "${error.voice}"\n  Available: ${error.available.join(', ')}\n  ${hints['voice_not_found']}`;

    case 'insufficient_balance':
      return `${base}: ${error.provider} - ${error.available} available\n  ${hints['insufficient_balance']}`;

    case 'rate_limited':
      return `${base}: ${error.provider}${error.retryAfter ? ` (retry after ${error.retryAfter}s)` : ''}\n  ${hints['rate_limited']}`;

    case 'synthesis_failed':
      return `${base}: ${error.provider} - ${error.reason}`;

    case 'invalid_response':
      return `${base}: expected ${error.expected}, got ${error.received}`;

    case 'empty_audio':
      return `${base}: ${error.provider} returned an empty audio file`;

    case 'unknown_error':
      return `${base}: ${error.provider} - ${String(error.cause)}`;
  }
}

// ─── HTTP Status to Error Mapping ──────────────────────────

/**
 * Convert an HTTP status code and response to a TTSError.
 */
export function httpStatusToTTSError(
  provider: string,
  status: number,
  responseText: string
): TTSError {
  switch (status) {
    case 400:
      return TTSError.invalidRequest('request', responseText || 'Bad request');
    case 401:
      return TTSError.authFailed(provider, responseText || 'Invalid credentials');
    case 402:
      return TTSError.insufficientBalance(provider, responseText || 'No balance');
    case 404:
      return TTSError.voiceNotFound('unknown', []);
    case 429:
      return TTSError.rateLimited(provider);
    case 500:
    case 502:
    case 503:
    case 504:
      return TTSError.serviceUnavailable(provider, responseText || 'Server error');
    default:
      return TTSError.unknownError(provider, `HTTP ${status}: ${responseText}`);
  }
}

// ─── Result Utilities ───────────────────────────────────────

/**
 * Convert a thrown error to a Result.
 */
export function catchToResult<T>(
  fn: () => T,
  provider: string
): Result<T, TTSError> {
  try {
    return { ok: true, value: fn() };
  } catch (e) {
    if (e instanceof Error) {
      return { ok: false, error: TTSError.unknownError(provider, e.message) };
    }
    return { ok: false, error: TTSError.unknownError(provider, e) };
  }
}

/**
 * Convert a rejected promise to a Result.
 */
export async function asyncCatchToResult<T>(
  fn: () => Promise<T>,
  provider: string
): Promise<Result<T, TTSError>> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    if (e instanceof Error) {
      return { ok: false, error: TTSError.unknownError(provider, e.message) };
    }
    return { ok: false, error: TTSError.unknownError(provider, e) };
  }
}

// ─── Export alias ───────────────────────────────────────────
// Alias for compatibility with existing imports
export { TTSError as createTTSError };

