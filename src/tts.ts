import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execa } from "execa";
import { z } from "zod";
import type { Playbook, Segment } from "./schema.js";

// ─── llm4agents API ──────────────────────────────────

/** Environment variable holding the llm4agents API key. */
const API_KEY_ENV = "LLM4AGENTS_API_KEY";

const API_BASE_URL = "https://api.llm4agents.com";
const SPEECH_ENDPOINT = `${API_BASE_URL}/v1/audio/speech`;
const BALANCE_ENDPOINT = `${API_BASE_URL}/api/v1/balance`;

/** Hard limit documented by the speech endpoint — longer input returns 400. */
const MAX_INPUT_CHARS = 15000;

const REQUEST_TIMEOUT_MS = 120_000;

/** Actionable hints for the status codes the speech endpoint documents. */
const STATUS_HINTS: Readonly<Record<number, string | undefined>> = {
  400: "Check the narration length and the voice id for this model.",
  401: `Invalid or missing API key — check ${API_KEY_ENV}.`,
  402: "Insufficient balance. Top up your llm4agents account and retry.",
  404: "Unknown model. Check `tts.model` in the playbook.",
  429: "Rate limited (120 requests/min per key). Retry in a moment.",
  502: "The upstream TTS provider failed. Your balance was refunded.",
};

/** Error envelope returned by the API for every non-2xx response. */
const ErrorResponseSchema = z.object({
  error: z.string(),
  message: z.string(),
  requestId: z.string().optional(),
});

const BalanceResponseSchema = z.object({
  availableUsd: z.string(),
  availableUsdCents: z.number(),
});

interface TtsResult {
  audioPath: string;
  durationMs: number;
}

// ─── Request plumbing ────────────────────────────────

function readApiKey(): string {
  const key = process.env[API_KEY_ENV]?.trim();
  if (!key) {
    throw new Error(
      `${API_KEY_ENV} is not set.\n` +
      `  Register an agent at ${API_BASE_URL}/docs to get a key, then either\n` +
      `  put it in a .env file (see .env.example) or export it:\n` +
      `    export ${API_KEY_ENV}=your-key`
    );
  }
  return key;
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/**
 * Turn a failed response into a message that says what went wrong and what
 * to do about it. The API always returns `{ error, message }` on failure.
 */
async function describeFailure(response: Response): Promise<string> {
  const body = await response.text().catch(() => "");
  const parsed = ErrorResponseSchema.safeParse(safeJsonParse(body));
  const detail = parsed.success
    ? `${parsed.data.error}: ${parsed.data.message}`
    : body.slice(0, 200) || response.statusText;

  const hint = STATUS_HINTS[response.status];
  return [`HTTP ${response.status} — ${detail}`, hint]
    .filter((line): line is string => Boolean(line))
    .join("\n  ");
}

/**
 * POST to an llm4agents endpoint with bearer auth and a hard timeout.
 * Rejects with a descriptive error on any non-2xx response.
 */
async function apiFetch(
  url: string,
  init: Readonly<{ method: "GET" | "POST"; body?: string }>
): Promise<Response> {
  const apiKey = readApiKey();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
      ...(init.body ? { body: init.body } : {}),
      signal: controller.signal,
    });
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(
        `Request to ${url} timed out after ${REQUEST_TIMEOUT_MS / 1000}s`
      );
    }
    throw new Error(`Request to ${url} failed: ${String(err)}`);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new Error(`${url}\n  ${await describeFailure(response)}`);
  }
  return response;
}

// ─── Speech synthesis ────────────────────────────────

interface SpeechRequest {
  readonly model: string;
  readonly voice: string;
  readonly speed: number;
  readonly input: string;
}

/**
 * Synthesize speech via the OpenAI-compatible llm4agents endpoint.
 * Returns raw mp3 bytes — the endpoint responds with audio, not JSON.
 */
async function synthesizeSpeech(request: SpeechRequest): Promise<Uint8Array> {
  if (request.input.length > MAX_INPUT_CHARS) {
    throw new Error(
      `Narration is ${request.input.length} characters; the TTS endpoint ` +
      `accepts at most ${MAX_INPUT_CHARS}. Split the segment in two.`
    );
  }

  const response = await apiFetch(SPEECH_ENDPOINT, {
    method: "POST",
    body: JSON.stringify({
      model: request.model,
      input: request.input,
      voice: request.voice,
      speed: request.speed,
      response_format: "mp3",
    }),
  });

  const audio = new Uint8Array(await response.arrayBuffer());
  if (audio.byteLength === 0) {
    throw new Error("TTS endpoint returned an empty audio body");
  }
  return audio;
}

/**
 * Fetch the account balance. Used by `ndemo doctor` to prove the key works
 * before a render burns time on a 402.
 */
async function checkBalance(): Promise<{ availableUsd: string; availableUsdCents: number }> {
  const response = await apiFetch(BALANCE_ENDPOINT, { method: "GET" });
  const parsed = BalanceResponseSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error("Unexpected balance response shape from the API");
  }
  return parsed.data;
}

// ─── Audio cache ─────────────────────────────────────

/**
 * Cache key for a rendered narration. Every input that changes the audio
 * must be part of it, or a config change would silently reuse stale files.
 */
function ttsHash(
  input: Readonly<{ narration: string; model: string; voice: string; speed: number }>
): string {
  return crypto
    .createHash("sha256")
    .update(`${input.narration}|${input.model}|${input.voice}|${input.speed}`)
    .digest("hex")
    .slice(0, 8);
}

/**
 * Delete any stale audio files for a segment ID that don't match the current hash.
 */
function cleanStaleAudio(audioDir: string, segmentId: string, currentHash: string): void {
  if (!fs.existsSync(audioDir)) return;
  const currentName = `${segmentId}-${currentHash}.mp3`;
  const prefix = `${segmentId}-`;
  for (const file of fs.readdirSync(audioDir)) {
    if (file.startsWith(prefix) && file.endsWith(".mp3") && file !== currentName) {
      fs.unlinkSync(path.join(audioDir, file));
    }
  }
}

/**
 * Ensure TTS audio exists for a segment, regenerating if the narration or any
 * tts setting changed. Deletes stale audio files automatically.
 */
async function ensureAudio(
  segment: Segment,
  playbook: Playbook,
  outputDir: string
): Promise<TtsResult> {
  const narration = segment.narration;
  if (!narration) {
    throw new Error(`Segment "${segment.id}" has no narration to synthesize`);
  }

  const { model, voice, speed } = playbook.tts;
  const audioDir = path.join(outputDir, "audio");
  fs.mkdirSync(audioDir, { recursive: true });

  const hash = ttsHash({ narration, model, voice, speed });
  const audioPath = path.join(audioDir, `${segment.id}-${hash}.mp3`);

  cleanStaleAudio(audioDir, segment.id, hash);

  if (!fs.existsSync(audioPath)) {
    const audio = await synthesizeSpeech({ model, voice, speed, input: narration });
    fs.writeFileSync(audioPath, audio);
  }

  return { audioPath, durationMs: await probeDuration(audioPath) };
}

async function probeDuration(audioPath: string): Promise<number> {
  const { stdout } = await execa("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "csv=p=0",
    audioPath,
  ]);
  const seconds = parseFloat(stdout.trim());
  if (isNaN(seconds)) {
    throw new Error(`Could not probe duration of ${audioPath}`);
  }
  return Math.round(seconds * 1000);
}

export { ensureAudio, probeDuration, checkBalance, API_KEY_ENV };
export type { TtsResult };
