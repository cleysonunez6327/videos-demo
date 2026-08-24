import {
  VoiceSlug,
  AudioFormat,
  LanguageCode,
  ModelId,
  VoiceName,
  type CloneMode,
  type VoxCpmLanguage,
  type GrokVoice,
} from './types.js';

// ─── Provider Configuration ───────────────────────────────────

export const TTS_CONFIG = {
  // llm4agents configuration
  llm4agents: {
    baseUrl: 'https://api.llm4agents.com',
    speechEndpoint: '/v1/audio/speech',
    balanceEndpoint: '/api/v1/balance',
    maxInputChars: 15000,
    defaultTimeout: 120_000, // 2 minutes
    maxRetries: 3,
    retryBaseDelayMs: 1500,
    defaultModel: 'x-ai/grok-voice-tts-1.0',
    defaultVoice: 'sal',
    defaultSpeed: 1.0,
  },

  // VoxCPM2 lab configuration
  voxcpm: {
    /**
     * Public HTTPS front for the lab, over a Cloudflare Tunnel.
     *
     * The tailnet address (`http://skywalker:7862`) is faster and has no
     * request ceiling, but it only resolves from inside the tailnet — and this
     * repo is public, so it would be useless to anyone else. Point
     * VOXCPM_BASE_URL at the tailnet host to get that route back.
     *
     * One caveat that only applies to this route: Cloudflare cuts proxied
     * requests at about 100 s with a 524. The lab generates at roughly half of
     * real time, so that ceiling sits near three minutes of audio per request
     * — far beyond any single demo narration, but a limit that the tailnet
     * route does not have.
     */
    baseUrl: 'https://voicelab.vocaltwin.io',
    healthEndpoint: '/api/health',
    voicesEndpoint: '/api/voices',
    ttsEndpoint: '/api/tts',
    recloneEndpoint: '/api/reclone',
    compareEndpoint: '/api/compare',
    warmupEndpoint: '/api/warmup',
    unloadEndpoint: '/api/unload',

    /** Output is always 48 kHz. */
    sampleRate: 48_000,

    /**
     * The lab starts cold on purpose — the first request pays for loading a
     * ~5 GB model. Budget for it on top of the synthesis estimate, or call
     * `warmup()` before a batch.
     */
    coldStartMs: 90_000,

    /**
     * Measured on skywalker: 74 s of audio generated in 35 s, i.e. roughly
     * half of real time. Contrast with the old Qwen lab at ~4x real time.
     */
    generationMultiplier: 0.5,

    /** Rough Spanish speaking rate, used to estimate audio length from text. */
    charsPerSecond: 15,

    minTimeoutMs: 120_000,
    maxTimeoutMs: 900_000,

    defaultMode: 'ultimate' as CloneMode,
    defaultCfgValue: 2.0,
    defaultInferenceTimesteps: 10,

    /**
     * Seconds of reference audio to condition on. The lab caps this at 45 and
     * always cuts at the nearest natural pause below the requested value, so
     * the (audio, transcript) pair never drifts apart. 15 s is the default for
     * continuity with earlier comparisons; 25-30 s gives the model more cadence
     * to work with — worth an A/B listen rather than assuming it sounds better.
     */
    defaultRefMaxSec: 15,
    maxRefMaxSec: 45,
  },
} as const;

// ─── TTS Request Types ──────────────────────────────────────

/**
 * Request parameters for llm4agents provider.
 */
export type Llm4AgentsRequest = Readonly<{
  model: ModelId;
  voice: VoiceName;
  speed: number;
  input: string;
}>;

/**
 * Request parameters for the VoxCPM2 lab.
 *
 * Either `voice` (clone an archived voice) or `style` (design a voice from a
 * description) must be present. See `CloneMode` for why `style` and
 * `mode: 'ultimate'` cannot be combined.
 */
export type VoxCpmRequest = Readonly<{
  text: string;
  voice?: VoiceSlug;
  mode?: CloneMode;
  style?: string;
  format?: AudioFormat;
  language?: LanguageCode;
  cfgValue?: number;
  inferenceTimesteps?: number;
  refMaxSec?: number;
  normalize?: boolean;
  denoise?: boolean;
}>;

/**
 * Unified TTS request that works with any provider.
 * The provider-specific fields are optional.
 */
export type TTSRequest = Readonly<{
  provider: 'llm4agents' | 'voxcpm';
  /** Text to synthesize. Required by every provider. */
  text?: string;
  // llm4agents fields
  model?: ModelId;
  voiceName?: VoiceName;
  speed?: number;
  // VoxCPM2 fields
  voiceSlug?: VoiceSlug;
  mode?: CloneMode;
  style?: string;
  format?: AudioFormat;
  language?: LanguageCode;
  cfgValue?: number;
  inferenceTimesteps?: number;
  refMaxSec?: number;
  normalize?: boolean;
  denoise?: boolean;
}>;

// ─── TTS Response Types ─────────────────────────────────────

/**
 * Response from TTS synthesis containing the audio and metadata.
 */
export type TTSResponse = Readonly<{
  /** Raw audio bytes */
  audioBuffer: ArrayBuffer | Uint8Array;
  /** Sample rate in Hz — 48000 on VoxCPM2, provider-dependent elsewhere */
  sampleRate: number;
  /** Duration of the generated audio in seconds */
  durationSec: number;
  /** How long the synthesis took in seconds */
  generationSec: number;
  /** Output format */
  format: AudioFormat;
  /** File extension for the output */
  extension: 'wav' | 'mp3';
  /** Mode the server actually used (VoxCPM2 only) */
  mode?: CloneMode;
  /** True when the server downgraded `ultimate` to `simple` to honour `style` */
  styleFallback?: boolean;
}>;

/**
 * Voice catalog entry from the provider.
 */
export type VoiceInfo = Readonly<{
  slug: string;
  name: string;
  type: 'cloned' | 'designed' | 'standard';
  language: string;
  /** Whether the voice has an archived transcript, i.e. supports `ultimate`. */
  supportsUltimate?: boolean;
  description?: string;
}>;

/**
 * Health check response from a provider.
 */
export type HealthStatus = Readonly<{
  provider: 'llm4agents' | 'voxcpm';
  healthy: boolean;
  models: readonly string[];
  /** Human-readable, e.g. "VRAM: 16.1/23.6 GiB en uso" — not a number. */
  vram?: string;
  voices?: readonly string[];
  /** Voices with an archived transcript — eligible for `mode: 'ultimate'` */
  voicesUltimate?: readonly string[];
  /** Voices without a transcript — `mode: 'simple'` only */
  voicesSimpleOnly?: readonly string[];
  balance?: string;
}>;

/**
 * One engine's entry in a `/api/compare` response.
 */
export type CompareEntry = Readonly<{
  engine: string;
  ok: boolean;
  audioSec?: number;
  genSec?: number;
  license?: string;
  /** Path served by the VoxCPM2 process itself — relative to its base URL. */
  url?: string;
  error?: string;
}>;

// ─── Request Validators ─────────────────────────────────────

/**
 * Validate and construct an Llm4AgentsRequest.
 */
export function createLlm4AgentsRequest(
  params: {
    model?: string;
    voice?: string;
    speed?: number;
    input: string;
  }
): Llm4AgentsRequest {
  const config = TTS_CONFIG.llm4agents;

  if (params.input.length > config.maxInputChars) {
    throw new Error(
      `Input is ${params.input.length} characters; ` +
      `llm4agents accepts at most ${config.maxInputChars}.`
    );
  }

  if (params.speed !== undefined && (params.speed <= 0 || params.speed > 4)) {
    throw new Error(`Speed must be between 0 and 4, got ${params.speed}`);
  }

  return {
    model: ModelId(params.model ?? config.defaultModel),
    voice: VoiceName((params.voice ?? config.defaultVoice) as GrokVoice),
    speed: params.speed ?? config.defaultSpeed,
    input: params.input,
  };
}

/**
 * Validate and construct a VoxCpmRequest.
 *
 * Enforces the two rules the lab documents: you need a voice or a style, and
 * a style cannot ride along with `ultimate` (the model would read it aloud).
 */
export function createVoxCpmRequest(
  params: {
    text: string;
    voice?: string;
    mode?: CloneMode;
    style?: string;
    format?: 'wav' | 'mp3';
    language?: VoxCpmLanguage;
    cfgValue?: number;
    inferenceTimesteps?: number;
    refMaxSec?: number;
    normalize?: boolean;
    denoise?: boolean;
  }
): VoxCpmRequest {
  const config = TTS_CONFIG.voxcpm;

  if (!params.text.trim()) {
    throw new Error('VoxCPM2 requires non-empty text');
  }

  if (!params.voice && !params.style) {
    throw new Error(
      'VoxCPM2 requires either `voice` (clone an archived voice) or ' +
      '`style` (design a voice from a description)'
    );
  }

  if (params.refMaxSec !== undefined && params.refMaxSec > config.maxRefMaxSec) {
    throw new Error(
      `refMaxSec is ${params.refMaxSec}; the lab caps reference audio at ` +
      `${config.maxRefMaxSec} seconds.`
    );
  }

  // A style directive under `ultimate` gets spoken out loud, so pick `simple`
  // unless the caller explicitly asked for `ultimate`.
  const mode: CloneMode = params.mode ?? (params.style ? 'simple' : config.defaultMode);

  if (params.style && mode === 'ultimate') {
    throw new Error(
      'VoxCPM2 cannot combine `style` with `mode: "ultimate"` — the model reads ' +
      'the style directive aloud and garbles the sentence. Use `mode: "simple"` ' +
      'for style control, or drop `style` to keep the speaker nuances of `ultimate`.'
    );
  }

  return {
    text: params.text,
    mode,
    cfgValue: params.cfgValue ?? config.defaultCfgValue,
    inferenceTimesteps: params.inferenceTimesteps ?? config.defaultInferenceTimesteps,
    refMaxSec: params.refMaxSec ?? config.defaultRefMaxSec,
    normalize: params.normalize ?? false,
    denoise: params.denoise ?? false,
    ...(params.voice ? { voice: VoiceSlug(params.voice) } : {}),
    ...(params.style ? { style: params.style } : {}),
    ...(params.format ? { format: AudioFormat(params.format) } : {}),
    ...(params.language ? { language: LanguageCode(params.language) } : {}),
  };
}

// ─── Timeout Calculator ──────────────────────────────────────

/**
 * Pick a request timeout for VoxCPM2 from the length of the text.
 *
 * Synthesis runs at roughly half of real time, but the first request after a
 * restart also pays for the model load, so the cold-start budget is always
 * included — an unwarmed lab must not time out on a short segment.
 */
export function calculateVoxCpmTimeout(textLength: number): number {
  const config = TTS_CONFIG.voxcpm;
  const estimatedAudioSec = textLength / config.charsPerSecond;
  const synthesisMs = estimatedAudioSec * config.generationMultiplier * 1000;
  const budget = config.coldStartMs + synthesisMs;

  return Math.min(
    config.maxTimeoutMs,
    Math.max(config.minTimeoutMs, Math.round(budget))
  );
}

// ─── Audio Utilities ─────────────────────────────────────────

/**
 * Get the file extension for a given audio format.
 */
export function getExtensionForFormat(format: AudioFormat): 'wav' | 'mp3' {
  return format === 'wav' ? 'wav' : 'mp3';
}

/**
 * Detect audio format from content type header.
 */
export function formatFromContentType(contentType: string): AudioFormat {
  if (contentType.includes('mpeg') || contentType.includes('mp3')) {
    return AudioFormat('mp3');
  }
  return AudioFormat('wav');
}
