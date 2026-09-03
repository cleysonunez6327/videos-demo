import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { probeDurationSec } from '../media.js';
import type { Result } from './domain/types.js';
import type { TTSError } from './domain/errors.js';
import { Ok, Err } from './domain/types.js';
import { TTSError as TtsErrorHelpers } from './domain/errors.js';

// Alias for convenience
const TTSErrorHelpersCtor = TtsErrorHelpers;
import type { TTSRequest } from './domain/voices.js';

// ─── Cache Key Generation ───────────────────────────────────

/**
 * Generate a cache key for TTS audio.
 * Includes all parameters that affect audio output.
 */
export function ttsCacheKey(request: Readonly<TTSRequest>): string {
  // Order matters only in that it must be stable; every field that changes the
  // rendered audio has to appear, or a config edit would reuse a stale file.
  const parts = [
    request.provider,
    request.text ?? '',
    // llm4agents
    request.model ?? '',
    request.voiceName ?? '',
    request.speed ?? '',
    // VoxCPM2
    request.voiceSlug ?? '',
    request.mode ?? '',
    request.style ?? '',
    request.language ?? '',
    request.format ?? '',
    request.cfgValue ?? '',
    request.inferenceTimesteps ?? '',
    request.refMaxSec ?? '',
    request.normalize ?? '',
    request.denoise ?? '',
  ];

  return crypto
    .createHash('sha256')
    .update(parts.join('|'))
    .digest('hex')
    .slice(0, 12);
}

// ─── Cache File Management ───────────────────────────────────

/**
 * Get the cache file path for a given segment and cache key.
 */
export function getCachePath(
  outputDir: string,
  segmentId: string,
  cacheKey: string,
  extension: 'wav' | 'mp3' = 'mp3'
): string {
  const audioDir = path.join(outputDir, 'audio');
  return path.join(audioDir, `${segmentId}-${cacheKey}.${extension}`);
}

/**
 * Ensure the audio directory exists.
 */
export function ensureAudioDir(outputDir: string): string {
  const audioDir = path.join(outputDir, 'audio');
  fs.mkdirSync(audioDir, { recursive: true });
  return audioDir;
}

/**
 * Delete stale audio files for a segment that don't match the current cache key.
 */
export function cleanStaleAudio(
  outputDir: string,
  segmentId: string,
  currentCacheKey: string
): void {
  const audioDir = path.join(outputDir, 'audio');
  if (!fs.existsSync(audioDir)) return;

  const prefix = `${segmentId}-`;

  for (const file of fs.readdirSync(audioDir)) {
    if (file.startsWith(prefix) && !file.endsWith(`-${currentCacheKey}.mp3`) && !file.endsWith(`-${currentCacheKey}.wav`)) {
      const fullPath = path.join(audioDir, file);
      try {
        fs.unlinkSync(fullPath);
      } catch (e) {
        // Ignore errors when cleaning up stale files
      }
    }
  }
}

/**
 * Check if cached audio exists for a segment.
 */
export function hasCachedAudio(
  outputDir: string,
  segmentId: string,
  cacheKey: string,
  extension: 'wav' | 'mp3' = 'mp3'
): boolean {
  const audioPath = getCachePath(outputDir, segmentId, cacheKey, extension);
  return fs.existsSync(audioPath);
}

/**
 * Read cached audio as ArrayBuffer.
 */
export function readCachedAudio(
  outputDir: string,
  segmentId: string,
  cacheKey: string,
  extension: 'wav' | 'mp3' = 'mp3'
): Result<ArrayBuffer, TTSError> {
  const audioPath = getCachePath(outputDir, segmentId, cacheKey, extension);

  if (!fs.existsSync(audioPath)) {
    return Err(TTSErrorHelpersCtor.invalidRequest('cache', `No cached audio found at ${audioPath}`));
  }

  try {
    const buffer = fs.readFileSync(audioPath);
    return Ok(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
  } catch (e) {
    return Err(TTSErrorHelpersCtor.unknownError('cache', e));
  }
}

/**
 * Write audio data to cache.
 */
export function writeCachedAudio(
  outputDir: string,
  segmentId: string,
  cacheKey: string,
  audioBuffer: ArrayBuffer | Uint8Array,
  extension: 'wav' | 'mp3' = 'mp3'
): Result<string, TTSError> {
  const audioPath = getCachePath(outputDir, segmentId, cacheKey, extension);
  ensureAudioDir(outputDir);

  try {
    const buffer = audioBuffer instanceof Uint8Array
      ? Buffer.from(audioBuffer)
      : Buffer.from(audioBuffer);

    fs.writeFileSync(audioPath, buffer);
    return Ok(audioPath);
  } catch (e) {
    return Err(TTSErrorHelpersCtor.unknownError('cache', e));
  }
}

// ─── Duration Probing ───────────────────────────────────────

/**
 * Probe the duration of an audio file using ffprobe.
 */
export async function probeDuration(audioPath: string): Promise<Result<number, TTSError>> {
  const seconds = await probeDurationSec(audioPath);
  if (seconds === null) {
    return Err(TTSErrorHelpersCtor.invalidResponse('duration', audioPath));
  }
  return Ok(Math.round(seconds * 1000));
}

/**
 * Get both the cache path and check if it exists.
 */
export function getCacheStatus(
  outputDir: string,
  segmentId: string,
  cacheKey: string,
  extension: 'wav' | 'mp3' = 'mp3'
): { path: string; exists: boolean } {
  const audioPath = getCachePath(outputDir, segmentId, cacheKey, extension);
  return {
    path: audioPath,
    exists: fs.existsSync(audioPath),
  };
}
