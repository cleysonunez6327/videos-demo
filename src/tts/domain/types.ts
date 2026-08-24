// ─── Branded Types ────────────────────────────────────────

/** Brand utility for nominal typing */
type Brand<T, B extends string> = T & { readonly __brand: B }

/** Slug of a cloned voice. Shared across every lab on skywalker. */
export type VoiceSlug = Brand<string, 'VoiceSlug'>

/** Audio output format */
export type AudioFormat = Brand<string, 'AudioFormat'>

/** Language code for TTS */
export type LanguageCode = Brand<string, 'LanguageCode'>

/** Model identifier for TTS provider */
export type ModelId = Brand<string, 'ModelId'>

/** Voice name for llm4agents */
export type VoiceName = Brand<string, 'VoiceName'>

// ─── Voice catalogue ─────────────────────────────────────

/**
 * Voices known to exist on skywalker at the time of writing.
 *
 * This list is a convenience for error messages and docs, NOT a whitelist:
 * voices are cloned from the lab UI and appear in the API immediately, so any
 * hardcoded list goes stale. `VoiceSlug()` accepts any non-empty slug and the
 * server is the authority — query `/api/voices` for the current catalogue.
 */
export const KNOWN_VOICES = [
  'allison', 'angie', 'ariana', 'brian', 'daniel',
  'hutch', 'jeremy', 'jessica', 'marshall'
] as const;

export type KnownVoice = typeof KNOWN_VOICES[number];

/**
 * Cloning modes offered by VoxCPM2.
 *
 * - `ultimate` — reference audio **plus its transcript**. Carries the speaker's
 *   cadence, not just the timbre. Requires an archived transcript for the voice.
 * - `simple` — reference audio only. Clones timbre; use for voices with no
 *   transcript, or when you need `style` (see below).
 *
 * `style` is expressed as a `(...)` prefix inside the text. Under `ultimate`
 * the model does audio continuation and treats all text as content to speak —
 * it reads the style directive out loud and garbles the sentence. The lab
 * degrades to `simple` on its own and flags it with `X-Style-Fallback: 1`.
 */
export const CLONE_MODES = ['ultimate', 'simple'] as const;
export type CloneMode = typeof CLONE_MODES[number];

/**
 * Languages accepted by VoxCPM2. Informational only — the model infers the
 * language from the text itself.
 */
export const VOXCPM_LANGUAGES = [
  'Auto', 'Spanish', 'English', 'Chinese', 'Japanese', 'Korean',
  'German', 'French', 'Russian', 'Portuguese', 'Italian'
] as const;

export type VoxCpmLanguage = typeof VOXCPM_LANGUAGES[number];

/** Grok TTS voices (llm4agents) */
export const GROK_VOICES = ['eve', 'ara', 'rex', 'sal', 'leo'] as const;
export type GrokVoice = typeof GROK_VOICES[number];

// ─── Domain Constructors ───────────────────────────────────

export function VoiceSlug(raw: string): VoiceSlug {
  const slug = raw.trim();
  if (!slug) {
    throw new Error(
      `Voice slug cannot be empty. Known voices: ${KNOWN_VOICES.join(', ')} ` +
      `(query /api/voices for the current list).`
    );
  }
  return slug as VoiceSlug;
}

export function AudioFormat(raw: 'wav' | 'mp3'): AudioFormat {
  if (raw !== 'wav' && raw !== 'mp3') {
    throw new Error(`Invalid audio format: ${raw}. Must be 'wav' or 'mp3'.`);
  }
  return raw as AudioFormat;
}

export function LanguageCode(raw: VoxCpmLanguage): LanguageCode {
  if (!VOXCPM_LANGUAGES.includes(raw)) {
    throw new Error(`Invalid language: ${raw}. Use one of: ${VOXCPM_LANGUAGES.join(', ')}`);
  }
  return raw as LanguageCode;
}

export function ModelId(raw: string): ModelId {
  if (!raw || raw.length < 1) {
    throw new Error('Model ID cannot be empty');
  }
  return raw as ModelId;
}

export function VoiceName(raw: string): VoiceName {
  // Voices are model-specific on llm4agents, so only the Grok list is known
  // here. Anything else is the API's call to accept or reject, exactly as the
  // playbook schema treats it.
  const normalized = raw.trim().toLowerCase();
  if (!normalized) {
    throw new Error(`Voice name cannot be empty. Grok voices: ${GROK_VOICES.join(', ')}`);
  }
  return normalized as VoiceName;
}

// ─── Result Type ───────────────────────────────────────────

/**
 * Result type for operations that can fail.
 * Forces the caller to handle both success and error cases.
 */
export type Result<T, E> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export const Ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const Err = <E>(error: E): Result<never, E> => ({ ok: false, error });

// ─── Provider Selection ─────────────────────────────────────

/** Supported TTS providers */
export const TTS_PROVIDERS = ['llm4agents', 'voxcpm'] as const;
export type TTSProvider = typeof TTS_PROVIDERS[number];

// ─── State Types ───────────────────────────────────────────

/**
 * Generation state machine (discriminated union).
 * Impossible states are unrepresentable.
 */
export type GenerationState =
  | { status: 'idle' }
  | { status: 'generating'; startTime: Date; text: string }
  | { status: 'completed'; audioPath: string; durationMs: number }
  | { status: 'failed'; error: TTSErrorType };

// ─── Re-export types for convenience ───────────────────────
export type { TTSError } from './errors.js';
export type { TTSResponse, TTSRequest } from './voices.js';

// Import TTSError for use in this file
import type { TTSError as TTSErrorType } from './errors.js';
