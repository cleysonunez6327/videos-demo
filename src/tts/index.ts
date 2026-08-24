// ─── Public API ─────────────────────────────────────────────

// Domain types (types only)
export type {
  // Branded types
  VoiceSlug,
  AudioFormat,
  LanguageCode,
  ModelId,
  VoiceName,
  // Type aliases
  KnownVoice,
  CloneMode,
  VoxCpmLanguage,
  GrokVoice,
  TTSProvider,
  // State types
  GenerationState,
  // Result type
  Result,
  // Re-exported from other modules
  TTSError,
} from './domain/types.js';

export type {
  TTSRequest,
  TTSResponse,
  VoiceInfo,
  HealthStatus,
  CompareEntry,
  Llm4AgentsRequest,
  VoxCpmRequest,
} from './domain/voices.js';

// Domain constructors (values, not types)
export {
  VoiceSlug as VoiceSlugCtor,
  AudioFormat as AudioFormatCtor,
  LanguageCode as LanguageCodeCtor,
  ModelId as ModelIdCtor,
  VoiceName as VoiceNameCtor,
} from './domain/types.js';

// Error handling
export {
  TTSError as TTSErrorHelpers,
  formatTTSError,
  httpStatusToTTSError,
  catchToResult,
  asyncCatchToResult,
} from './domain/errors.js';

// Configuration and constants
export {
  KNOWN_VOICES,
  CLONE_MODES,
  VOXCPM_LANGUAGES,
  GROK_VOICES,
  TTS_PROVIDERS,
} from './domain/types.js';
export {
  TTS_CONFIG,
  createLlm4AgentsRequest,
  createVoxCpmRequest,
  calculateVoxCpmTimeout,
  getExtensionForFormat,
  formatFromContentType,
} from './domain/voices.js';

// Result utilities
export { Ok, Err } from './domain/types.js';

// Ports (interfaces)
export type { TTSPort, Llm4AgentsPort, VoxCpmPort, TTSPortFactory } from './ports/tts-port.js';

// Factory
export { createTTSClient, getAvailableProviders, isValidProvider } from './factory.js';

// Cache utilities
export {
  ttsCacheKey,
  getCachePath,
  ensureAudioDir,
  cleanStaleAudio,
  hasCachedAudio,
  readCachedAudio,
  writeCachedAudio,
  probeDuration,
  getCacheStatus,
} from './cache.js';

// Provider implementations (for direct use if needed)
export { Llm4AgentsTTSClient, createLlm4AgentsClient, API_KEY_ENV } from './providers/llm4agents.js';
export { VoxCpmTTSClient, createVoxCpmClient, resolveBaseUrl, BASE_URL_ENV } from './providers/voxcpm.js';

// ─── Pipeline entry points ───────────────────────────────────

import { createTTSClient as factory } from './factory.js';
import { ttsCacheKey, writeCachedAudio, probeDuration, cleanStaleAudio, getCacheStatus } from './cache.js';
import type { TTSRequest } from './domain/voices.js';
import {
  ModelId,
  VoiceName,
  VoiceSlug,
  AudioFormat,
  LanguageCode,
} from './domain/types.js';
import { formatTTSError } from './domain/errors.js';
import type { Segment, Playbook, TtsConfig } from '../schema.js';

/**
 * Legacy TTS result type, kept for the render/player pipeline.
 */
export interface TtsResult {
  audioPath: string;
  durationMs: number;
}

/**
 * Translate a playbook's `tts` block into a provider request.
 *
 * Kept pure and separate from the I/O below so the mapping can be tested
 * without touching the network.
 */
export function buildTTSRequest(tts: TtsConfig, narration: string): TTSRequest {
  if (tts.provider === 'llm4agents') {
    return {
      provider: 'llm4agents',
      text: narration,
      model: ModelId(tts.model),
      voiceName: VoiceName(tts.voice),
      speed: tts.speed,
    };
  }

  return {
    provider: 'voxcpm',
    text: narration,
    mode: tts.mode,
    format: AudioFormat(tts.format),
    language: LanguageCode(tts.language),
    cfgValue: tts.cfgValue,
    inferenceTimesteps: tts.inferenceTimesteps,
    refMaxSec: tts.refMaxSec,
    normalize: tts.normalize,
    denoise: tts.denoise,
    ...(tts.voice ? { voiceSlug: VoiceSlug(tts.voice) } : {}),
    ...(tts.style ? { style: tts.style } : {}),
  };
}

/**
 * Ensure TTS audio exists for a segment, regenerating when anything that
 * affects the audio changed. Stale files for the segment are removed so the
 * audio directory never accumulates orphans from earlier settings.
 *
 * @param segment — The segment to generate audio for
 * @param playbook — The playbook containing TTS configuration
 * @param outputDir — Directory to write audio files
 * @returns Path to audio file and duration in milliseconds
 */
export async function ensureAudio(
  segment: Segment,
  playbook: Playbook,
  outputDir: string
): Promise<TtsResult> {
  const narration = segment.narration;
  if (!narration) {
    throw new Error(`Segment "${segment.id}" has no narration to synthesize`);
  }

  const tts = playbook.tts;
  const request = buildTTSRequest(tts, narration);

  // Every input that changes the audio is part of the key, or a config change
  // would silently reuse a stale file.
  const cacheKey = ttsCacheKey(request);
  const extension = tts.provider === 'voxcpm' ? tts.format : 'mp3';

  cleanStaleAudio(outputDir, segment.id, cacheKey);

  const cached = getCacheStatus(outputDir, segment.id, cacheKey, extension);
  if (!cached.exists) {
    const client = factory(
      tts.provider,
      tts.provider === 'voxcpm' && tts.baseUrl ? { baseUrl: tts.baseUrl } : undefined
    );

    const result = await client.synthesize(request);
    if (!result.ok) {
      throw new Error(
        `TTS synthesis failed for segment "${segment.id}":\n  ${formatTTSError(result.error)}`
      );
    }

    // The server downgrades `ultimate` to `simple` rather than failing, and a
    // silent downgrade is exactly the kind of thing you notice three renders later.
    if (result.value.styleFallback) {
      process.stderr.write(
        `  note: VoxCPM2 fell back to mode "simple" for segment "${segment.id}" ` +
        `because a style directive was present.\n`
      );
    }

    const written = writeCachedAudio(
      outputDir,
      segment.id,
      cacheKey,
      result.value.audioBuffer,
      extension
    );

    if (!written.ok) {
      throw new Error(`Failed to write audio: ${formatTTSError(written.error)}`);
    }
  }

  const durationResult = await probeDuration(cached.path);
  if (!durationResult.ok) {
    throw new Error(`Could not probe audio duration: ${formatTTSError(durationResult.error)}`);
  }

  return { audioPath: cached.path, durationMs: durationResult.value };
}

/**
 * Check the TTS service balance (llm4agents only).
 * Used by `ndemo doctor`.
 */
export async function checkBalance(): Promise<{ availableUsd: string; availableUsdCents: number }> {
  const client = factory('llm4agents');
  const result = await client.getBalance?.();

  if (!result) {
    throw new Error('The llm4agents client does not expose a balance endpoint');
  }

  if (!result.ok) {
    throw new Error(`Failed to check balance: ${formatTTSError(result.error)}`);
  }

  return {
    availableUsd: result.value.available,
    availableUsdCents: result.value.amount,
  };
}

/**
 * Check if an HTTP status is retryable for TTS requests.
 *
 * Rate limits and server-side faults are transient; the provider returns a
 * bare 500 often enough that a render would otherwise die minutes in, after
 * the audio for earlier segments was already paid for. Everything else —
 * bad request, bad key, no balance, unknown voice — fails the same way on
 * every attempt, so retrying only burns time.
 */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}
