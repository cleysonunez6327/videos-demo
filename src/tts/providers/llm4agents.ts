import type { Result } from '../domain/types.js';
import type { TTSError } from '../domain/errors.js';
import type {
  TTSRequest,
  TTSResponse,
  VoiceInfo,
  HealthStatus,
  Llm4AgentsRequest,
} from '../domain/voices.js';
import type { Llm4AgentsPort } from '../ports/tts-port.js';
import { TTS_CONFIG, formatFromContentType } from '../domain/voices.js';
import { TTSError as createTTSError } from '../domain/errors.js';
import { Ok, Err, ModelId, VoiceName } from '../domain/types.js';
import { z } from 'zod';

// ─── Environment ────────────────────────────────────────────

const API_KEY_ENV = 'LLM4AGENTS_API_KEY';

export { API_KEY_ENV };

function readApiKey(): string {
  const key = process.env[API_KEY_ENV]?.trim();
  if (!key) {
    throw new Error(
      `${API_KEY_ENV} is not set.\n` +
      `  Register at ${TTS_CONFIG.llm4agents.baseUrl}/docs to get a key, then either\n` +
      `  put it in a .env file (see .env.example) or export it:\n` +
      `    export ${API_KEY_ENV}=your-key`
    );
  }
  return key;
}

// ─── Response Schemas ───────────────────────────────────────

const ErrorResponseSchema = z.object({
  error: z.string(),
  message: z.string(),
  requestId: z.string().optional(),
});

const BalanceResponseSchema = z.object({
  availableUsd: z.string(),
  availableUsdCents: z.number(),
});

// ─── Request Utilities ─────────────────────────────────────

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

async function describeFailure(response: Response): Promise<string> {
  const body = await response.text().catch(() => '');
  const parsed = ErrorResponseSchema.safeParse(safeJsonParse(body));
  const detail = parsed.success
    ? `${parsed.data.error}: ${parsed.data.message}`
    : body.slice(0, 200) || response.statusText;

  return `HTTP ${response.status} — ${detail}`;
}

// ─── HTTP Client ───────────────────────────────────────────

async function apiFetch(
  url: string,
  init: Readonly<{ method: 'GET' | 'POST'; body?: string }>
): Promise<Result<Response, TTSError>> {
  const apiKey = readApiKey();
  const config = TTS_CONFIG.llm4agents;
  let lastError = '';

  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.defaultTimeout);

    let response: Response | null = null;

    try {
      response = await fetch(url, {
        method: init.method,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(init.body ? { body: init.body } : {}),
        signal: controller.signal,
      });
    } catch (err) {
      lastError = controller.signal.aborted
        ? `timed out after ${config.defaultTimeout / 1000}s`
        : String(err);
    } finally {
      clearTimeout(timer);
    }

    if (response?.ok) return Ok(response);

    if (response) {
      const statusDesc = await describeFailure(response);

      // Don't retry client errors (except 429 rate limit)
      if (response.status !== 429 && response.status < 500) {
        return Err(createTTSError.invalidRequest('request', statusDesc));
      }

      lastError = statusDesc;

      if (attempt < config.maxRetries) {
        process.stderr.write(
          `  retrying (${attempt}/${config.maxRetries - 1}): ${lastError.split('\n')[0]}\n`
        );
        await new Promise(r => setTimeout(r, config.retryBaseDelayMs * attempt));
      }
    }
  }

  return Err(createTTSError.networkError(url, lastError));
}

// ─── llm4agents Implementation ──────────────────────────────

export class Llm4AgentsTTSClient implements Llm4AgentsPort {
  readonly provider = 'llm4agents' as const;

  private readonly baseUrl = TTS_CONFIG.llm4agents.baseUrl;
  private readonly speechEndpoint = `${this.baseUrl}${TTS_CONFIG.llm4agents.speechEndpoint}`;
  private readonly balanceEndpoint = `${this.baseUrl}${TTS_CONFIG.llm4agents.balanceEndpoint}`;

  async healthCheck(): Promise<Result<HealthStatus, TTSError>> {
    // Use balance check as health indicator for llm4agents
    const balanceResult = await this.getBalance();
    if (!balanceResult.ok) {
      return Err(balanceResult.error);
    }

    return Ok({
      provider: 'llm4agents',
      healthy: true,
      models: [TTS_CONFIG.llm4agents.defaultModel],
      balance: balanceResult.value.available,
    });
  }

  async listVoices(): Promise<Result<readonly VoiceInfo[], TTSError>> {
    // llm4agents has fixed voice list per model
    const voices = ['eve', 'ara', 'rex', 'sal', 'leo'].map(v => ({
      slug: v,
      name: v.charAt(0).toUpperCase() + v.slice(1),
      type: 'standard' as const,
      language: 'English',
      description: `Grok TTS voice: ${v}`,
    }));

    return Ok(voices);
  }

  async synthesize(request: TTSRequest): Promise<Result<TTSResponse, TTSError>> {
    // Convert unified request to llm4agents-specific
    const llm4agentsRequest: Llm4AgentsRequest = {
      model: ModelId(request.model ?? TTS_CONFIG.llm4agents.defaultModel),
      voice: VoiceName(request.voiceName ?? TTS_CONFIG.llm4agents.defaultVoice),
      speed: request.speed ?? TTS_CONFIG.llm4agents.defaultSpeed,
      input: request.text ?? '', // Will be validated in synthesizeLlm4Agents
    };

    return this.synthesizeLlm4Agents(llm4agentsRequest);
  }

  async synthesizeLlm4Agents(
    request: Llm4AgentsRequest
  ): Promise<Result<TTSResponse, TTSError>> {
    const config = TTS_CONFIG.llm4agents;

    // Validate input length
    if (request.input.length > config.maxInputChars) {
      return Err(createTTSError.textTooLong(request.input.length, config.maxInputChars));
    }

    const responseResult = await apiFetch(this.speechEndpoint, {
      method: 'POST',
      body: JSON.stringify({
        model: request.model,
        input: request.input,
        voice: request.voice,
        speed: request.speed,
        response_format: 'mp3',
      }),
    });

    if (!responseResult.ok) {
      return Err(responseResult.error);
    }

    const response = responseResult.value;
    const audioBuffer = await response.arrayBuffer();
    const audioBytes = new Uint8Array(audioBuffer);

    if (audioBytes.byteLength === 0) {
      return Err(createTTSError.emptyAudio('llm4agents'));
    }

    const contentType = response.headers.get('Content-Type') ?? 'audio/mpeg';
    const format = formatFromContentType(contentType);

    return Ok({
      audioBuffer: audioBytes,
      format,
      extension: 'mp3',
    });
  }

  async getBalance(): Promise<Result<{ available: string; amount: number }, TTSError>> {
    const responseResult = await apiFetch(this.balanceEndpoint, { method: 'GET' });
    if (!responseResult.ok) {
      return Err(responseResult.error);
    }

    const response = responseResult.value;
    const parsed = BalanceResponseSchema.safeParse(await response.json());

    if (!parsed.success) {
      return Err(createTTSError.invalidResponse('BalanceResponse', 'unknown'));
    }

    return Ok({
      available: parsed.data.availableUsd,
      amount: parsed.data.availableUsdCents,
    });
  }
}

/**
 * Create an llm4agents TTS client.
 */
export function createLlm4AgentsClient(): Llm4AgentsPort {
  return new Llm4AgentsTTSClient();
}
