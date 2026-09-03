import type { Result } from '../domain/types.js';
import type { TTSError } from '../domain/errors.js';
import type {
  TTSRequest,
  TTSResponse,
  VoiceInfo,
  HealthStatus,
  CompareEntry,
  VoxCpmRequest,
} from '../domain/voices.js';
import type { VoxCpmPort } from '../ports/tts-port.js';
import {
  TTS_CONFIG,
  calculateVoxCpmTimeout,
  formatFromContentType,
  getExtensionForFormat,
} from '../domain/voices.js';
import {
  TTSError as createTTSError,
  httpStatusToTTSError,
} from '../domain/errors.js';
import { Ok, Err } from '../domain/types.js';
import type { CloneMode } from '../domain/types.js';
import { z } from 'zod';

// ─── Response Schemas ───────────────────────────────────────

// Shapes verified against the running lab, which differs from llms.txt in
// three places: `vram` is a human-readable string, there is a single `model`
// rather than a list, and /api/voices wraps its array in an object. Fields we
// do not use stay optional so a server-side addition cannot break a render.
const HealthSchema = z.object({
  status: z.string().optional(),
  engine: z.string().optional(),
  model: z.string().optional(),
  license: z.string().optional(),
  device: z.string().optional(),
  loaded: z.boolean().optional(),
  vram: z.string().optional(),
  modes: z.array(z.string()).optional(),
  sample_rate: z.number().optional(),
  ref_max_sec_default: z.number().optional(),
  ref_max_sec_cap: z.number().optional(),
  voices_ultimate: z.array(z.string()).default([]),
  voices_simple_only: z.array(z.string()).default([]),
});

const VoicesSchema = z.object({
  source: z.string().optional(),
  note: z.string().optional(),
  voices: z.array(
    z.object({
      slug: z.string(),
      name: z.string().optional(),
      language: z.string().optional(),
      source_sec: z.number().optional(),
      ic_cut_sec: z.number().optional(),
      ic_method: z.string().optional(),
      has_transcript: z.boolean().optional(),
      ref_text: z.string().optional(),
    })
  ).default([]),
});

const ErrorDetailSchema = z.object({ detail: z.string() });

const RecloneSchema = z.object({
  ic_cut_sec: z.number(),
  ic_method: z.string(),
  ref_text: z.string(),
  warnings: z.array(z.string()).default([]),
});

const CompareSchema = z.record(
  z.string(),
  z.object({
    ok: z.boolean().default(true),
    audio_sec: z.number().optional(),
    gen_sec: z.number().optional(),
    license: z.string().optional(),
    url: z.string().optional(),
    error: z.string().optional(),
  })
);

// ─── Helpers ────────────────────────────────────────────────

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/**
 * Pull the server's `{ "detail": "..." }` out of a failed response, falling
 * back to the raw body so an unexpected error shape still says something.
 */
async function readErrorDetail(response: Response): Promise<string> {
  const body = await response.text().catch(() => '');
  const parsed = ErrorDetailSchema.safeParse(safeJsonParse(body));
  return parsed.success ? parsed.data.detail : body.slice(0, 300) || response.statusText;
}

/** Environment variable that overrides where the VoxCPM2 lab lives. */
export const BASE_URL_ENV = 'VOXCPM_BASE_URL';

/**
 * Where to reach the lab, most specific source first: what the playbook says,
 * then the environment, then the public default.
 *
 * The environment sits in the middle so one export can move a whole machine
 * onto the tailnet route without editing any playbook, while a playbook that
 * names a host still gets it.
 */
export function resolveBaseUrl(explicit?: string): string {
  const chosen = explicit?.trim()
    || process.env[BASE_URL_ENV]?.trim()
    || TTS_CONFIG.voxcpm.baseUrl;
  return chosen.replace(/\/+$/, '');
}

// ─── VoxCPM2 Implementation ─────────────────────────────────

/**
 * Client for the VoxCPM2 lab.
 *
 * Two things about this service shape the code:
 * - It holds a global GPU lock, so requests must be serialized. Never fan out.
 * - It starts cold, so the first call pays ~90 s of model load. Timeouts
 *   include that budget; `warmup()` gets it out of the way before a batch.
 */
export class VoxCpmTTSClient implements VoxCpmPort {
  readonly provider = 'voxcpm' as const;

  private readonly config = TTS_CONFIG.voxcpm;
  private readonly baseUrl: string;

  constructor(customBaseUrl?: string) {
    this.baseUrl = resolveBaseUrl(customBaseUrl);
  }

  private url(endpoint: string): string {
    return `${this.baseUrl}${endpoint}`;
  }

  /** GET a JSON endpoint and validate it against a schema. */
  private async getJson<S extends z.ZodTypeAny>(
    endpoint: string,
    schema: S,
    timeoutMs: number
  ): Promise<Result<z.infer<S>, TTSError>> {
    const url = this.url(endpoint);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, { signal: controller.signal });

      if (!response.ok) {
        return Err(httpStatusToTTSError('voxcpm', response.status, await readErrorDetail(response)));
      }

      const parsed = schema.safeParse(await response.json());
      if (!parsed.success) {
        return Err(createTTSError.invalidResponse(endpoint, parsed.error.message));
      }

      return Ok(parsed.data);
    } catch (e) {
      if (controller.signal.aborted) {
        return Err(createTTSError.timeout(url, timeoutMs));
      }
      return Err(createTTSError.networkError(url, e instanceof Error ? e.message : String(e)));
    } finally {
      clearTimeout(timer);
    }
  }

  /** POST a JSON body and validate the JSON response against a schema. */
  private async postJson<S extends z.ZodTypeAny>(
    endpoint: string,
    body: unknown,
    schema: S,
    timeoutMs: number
  ): Promise<Result<z.infer<S>, TTSError>> {
    const url = this.url(endpoint);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        return Err(httpStatusToTTSError('voxcpm', response.status, await readErrorDetail(response)));
      }

      const parsed = schema.safeParse(await response.json());
      if (!parsed.success) {
        return Err(createTTSError.invalidResponse(endpoint, parsed.error.message));
      }

      return Ok(parsed.data);
    } catch (e) {
      if (controller.signal.aborted) {
        return Err(createTTSError.timeout(url, timeoutMs));
      }
      return Err(createTTSError.networkError(url, e instanceof Error ? e.message : String(e)));
    } finally {
      clearTimeout(timer);
    }
  }

  async healthCheck(): Promise<Result<HealthStatus, TTSError>> {
    const result = await this.getJson(this.config.healthEndpoint, HealthSchema, 10_000);
    if (!result.ok) return Err(result.error);

    const data = result.value;
    // The lab reports which voices carry a transcript rather than one flat
    // list, so the full catalogue is the two buckets joined.
    const voices = [...data.voices_ultimate, ...data.voices_simple_only];

    return Ok({
      provider: 'voxcpm',
      healthy: data.loaded !== false && data.status !== 'error',
      models: data.model ? [data.model] : [],
      voices,
      voicesUltimate: data.voices_ultimate,
      voicesSimpleOnly: data.voices_simple_only,
      ...(data.vram !== undefined ? { vram: data.vram } : {}),
    });
  }

  async listVoices(): Promise<Result<readonly VoiceInfo[], TTSError>> {
    const result = await this.getJson(this.config.voicesEndpoint, VoicesSchema, 10_000);
    if (!result.ok) return Err(result.error);

    return Ok(result.value.voices.map((v): VoiceInfo => {
      // Only a voice with an archived transcript can be conditioned in
      // `ultimate` mode; the rest are timbre-only.
      const supportsUltimate = v.has_transcript ?? false;
      return {
        slug: v.slug,
        name: v.name ?? v.slug,
        type: 'cloned',
        language: v.language ?? 'unknown',
        supportsUltimate,
        description: supportsUltimate
          ? 'cloned voice with transcript (ultimate + simple)'
          : 'cloned voice without transcript (simple only)',
      };
    }));
  }

  async synthesize(request: TTSRequest): Promise<Result<TTSResponse, TTSError>> {
    return this.synthesizeVoxCpm({
      text: request.text ?? '',
      ...(request.voiceSlug ? { voice: request.voiceSlug } : {}),
      ...(request.mode ? { mode: request.mode } : {}),
      ...(request.style ? { style: request.style } : {}),
      ...(request.format ? { format: request.format } : {}),
      ...(request.language ? { language: request.language } : {}),
      ...(request.cfgValue !== undefined ? { cfgValue: request.cfgValue } : {}),
      ...(request.inferenceTimesteps !== undefined
        ? { inferenceTimesteps: request.inferenceTimesteps }
        : {}),
      ...(request.refMaxSec !== undefined ? { refMaxSec: request.refMaxSec } : {}),
      ...(request.normalize !== undefined ? { normalize: request.normalize } : {}),
      ...(request.denoise !== undefined ? { denoise: request.denoise } : {}),
    });
  }

  async synthesizeVoxCpm(request: VoxCpmRequest): Promise<Result<TTSResponse, TTSError>> {
    const text = request.text?.trim() ?? '';
    if (!text) {
      return Err(createTTSError.invalidRequest('text', 'Text cannot be empty'));
    }

    // Without a voice the model needs a description to design one from.
    if (!request.voice && !request.style) {
      return Err(
        createTTSError.invalidRequest(
          'voice/style',
          'VoxCPM2 requires either `voice` (clone an archived voice) or ' +
          '`style` (design a voice from a description)'
        )
      );
    }

    // Under `ultimate` the model speaks the style directive out loud instead of
    // acting on it. The server silently degrades to `simple`; fail loudly here
    // so the caller picks deliberately rather than wondering why nuance is gone.
    if (request.style && request.mode === 'ultimate') {
      return Err(
        createTTSError.invalidRequest(
          'style',
          'VoxCPM2 cannot combine `style` with `mode: "ultimate"` — the model ' +
          'reads the style directive aloud. Use `mode: "simple"` for style ' +
          'control, or drop `style` to keep the speaker nuances of `ultimate`.'
        )
      );
    }

    if (request.refMaxSec !== undefined && request.refMaxSec > this.config.maxRefMaxSec) {
      return Err(
        createTTSError.invalidRequest(
          'refMaxSec',
          `refMaxSec is ${request.refMaxSec}; the lab caps reference audio at ` +
          `${this.config.maxRefMaxSec} seconds.`
        )
      );
    }

    const timeout = calculateVoxCpmTimeout(text.length);
    const url = this.url(this.config.ttsEndpoint);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          voice: request.voice ?? null,
          mode: request.mode ?? this.config.defaultMode,
          style: request.style ?? '',
          format: request.format ?? 'mp3',
          language: request.language ?? 'Spanish',
          cfg_value: request.cfgValue ?? this.config.defaultCfgValue,
          inference_timesteps:
            request.inferenceTimesteps ?? this.config.defaultInferenceTimesteps,
          ref_max_sec: request.refMaxSec ?? this.config.defaultRefMaxSec,
          normalize: request.normalize ?? false,
          denoise: request.denoise ?? false,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const detail = await readErrorDetail(response);

        // 404 means the slug is unknown; 400 covers "this voice has no
        // transcript, so `ultimate` is not available for it".
        if (response.status === 404) {
          return Err(createTTSError.voiceNotFound(request.voice ?? '(designed)', []));
        }

        return Err(httpStatusToTTSError('voxcpm', response.status, detail));
      }

      const modeHeader = response.headers.get('X-Mode');
      const styleFallback = response.headers.get('X-Style-Fallback') === '1';
      const contentType = response.headers.get('Content-Type') ?? 'audio/mpeg';
      const format = formatFromContentType(contentType);

      const audioBuffer = await response.arrayBuffer();
      if (audioBuffer.byteLength === 0) {
        return Err(createTTSError.emptyAudio('voxcpm'));
      }

      return Ok({
        audioBuffer,
        format,
        extension: getExtensionForFormat(format),
        styleFallback,
        ...(modeHeader === 'ultimate' || modeHeader === 'simple'
          ? { mode: modeHeader as CloneMode }
          : {}),
      });
    } catch (e) {
      if (controller.signal.aborted) {
        return Err(createTTSError.timeout(url, timeout));
      }
      return Err(createTTSError.unknownError('voxcpm', e));
    } finally {
      clearTimeout(timer);
    }
  }

  async reclone(params: Readonly<{
    slug: string;
    refMaxSec?: number;
    useClaude?: boolean;
  }>): Promise<Result<Readonly<{
    icCutSec: number;
    icMethod: string;
    refText: string;
    warnings: readonly string[];
  }>, TTSError>> {
    if (params.refMaxSec !== undefined && params.refMaxSec > this.config.maxRefMaxSec) {
      return Err(
        createTTSError.invalidRequest(
          'refMaxSec',
          `refMaxSec is ${params.refMaxSec}; the lab caps reference audio at ` +
          `${this.config.maxRefMaxSec} seconds.`
        )
      );
    }

    // Re-transcribing with Whisper is the slow path, so give it room.
    const result = await this.postJson(
      this.config.recloneEndpoint,
      {
        slug: params.slug,
        ref_max_sec: params.refMaxSec ?? this.config.defaultRefMaxSec,
        use_claude: params.useClaude ?? true,
      },
      RecloneSchema,
      this.config.maxTimeoutMs
    );

    if (!result.ok) return Err(result.error);

    return Ok({
      icCutSec: result.value.ic_cut_sec,
      icMethod: result.value.ic_method,
      refText: result.value.ref_text,
      warnings: result.value.warnings,
    });
  }

  async compare(params: Readonly<{
    text: string;
    voice: string;
    language?: string;
  }>): Promise<Result<readonly CompareEntry[], TTSError>> {
    // Three engines run back to back behind one GPU lock, so this is the
    // slowest call the lab offers.
    const result = await this.postJson(
      this.config.compareEndpoint,
      {
        text: params.text,
        voice: params.voice,
        language: params.language ?? 'Spanish',
      },
      CompareSchema,
      this.config.maxTimeoutMs
    );

    if (!result.ok) return Err(result.error);

    return Ok(
      Object.entries(result.value).map(([engine, entry]): CompareEntry => ({
        engine,
        ok: entry.ok,
        ...(entry.audio_sec !== undefined ? { audioSec: entry.audio_sec } : {}),
        ...(entry.gen_sec !== undefined ? { genSec: entry.gen_sec } : {}),
        ...(entry.license !== undefined ? { license: entry.license } : {}),
        ...(entry.url !== undefined ? { url: `${this.baseUrl}${entry.url}` } : {}),
        ...(entry.error !== undefined ? { error: entry.error } : {}),
      }))
    );
  }

  async unloadModel(): Promise<Result<void, TTSError>> {
    return this.postVoid(this.config.unloadEndpoint, 30_000);
  }

  async warmup(): Promise<Result<void, TTSError>> {
    // Loading ~5 GB is the whole point of this call, so allow the cold-start
    // budget plus slack rather than a generic short timeout.
    return this.postVoid(this.config.warmupEndpoint, this.config.coldStartMs * 2);
  }

  /** POST an endpoint whose response body we do not care about. */
  private async postVoid(endpoint: string, timeoutMs: number): Promise<Result<void, TTSError>> {
    const url = this.url(endpoint);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, { method: 'POST', signal: controller.signal });

      if (!response.ok) {
        return Err(httpStatusToTTSError('voxcpm', response.status, await readErrorDetail(response)));
      }

      return Ok(undefined);
    } catch (e) {
      if (controller.signal.aborted) {
        return Err(createTTSError.timeout(url, timeoutMs));
      }
      return Err(createTTSError.networkError(url, e instanceof Error ? e.message : String(e)));
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Create a VoxCPM2 TTS client.
 *
 * @param customBaseUrl — Beats VOXCPM_BASE_URL and the public default
 */
export function createVoxCpmClient(customBaseUrl?: string): VoxCpmPort {
  return new VoxCpmTTSClient(customBaseUrl);
}
