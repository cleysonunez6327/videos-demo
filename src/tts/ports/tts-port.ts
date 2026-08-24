import type { Result } from '../domain/types.js';
import type { TTSError } from '../domain/errors.js';
import type {
  TTSRequest,
  TTSResponse,
  VoiceInfo,
  HealthStatus,
  CompareEntry,
  Llm4AgentsRequest,
  VoxCpmRequest,
} from '../domain/voices.js';

/**
 * TTS Provider Port — defines the contract for TTS implementations.
 *
 * This interface enables:
 * - Multiple provider implementations (llm4agents, VoxCPM2, future providers)
 * - Easy testing with mock implementations
 * - Provider swapping without changing business logic
 *
 * All methods return Result<T, TTSError> to force error handling.
 */
export interface TTSPort {
  /**
   * Provider identifier.
   */
  readonly provider: string;

  /**
   * Check if the provider is healthy and ready.
   * Returns provider status including loaded models, available voices, etc.
   */
  healthCheck(): Promise<Result<HealthStatus, TTSError>>;

  /**
   * List all available voices from this provider.
   */
  listVoices(): Promise<Result<readonly VoiceInfo[], TTSError>>;

  /**
   * Synthesize speech from text.
   *
   * @param request — Provider-specific request parameters
   * @returns Audio bytes with metadata (duration, sample rate, etc.)
   */
  synthesize(request: TTSRequest): Promise<Result<TTSResponse, TTSError>>;

  /**
   * Get account balance (if applicable).
   * Returns error for providers that don't support balance checking.
   */
  getBalance?(): Promise<Result<{ available: string; amount: number }, TTSError>>;
}

/**
 * Provider-specific port extensions.
 *
 * Each provider can extend the base port with provider-specific methods
 * while maintaining the common interface.
 */

/**
 * llm4agents-specific TTS operations.
 */
export interface Llm4AgentsPort extends TTSPort {
  readonly provider: 'llm4agents';

  /**
   * Synthesize with llm4agents-specific request.
   */
  synthesizeLlm4Agents(request: Llm4AgentsRequest): Promise<Result<TTSResponse, TTSError>>;
}

/**
 * VoxCPM2-specific TTS operations (skywalker:7862).
 */
export interface VoxCpmPort extends TTSPort {
  readonly provider: 'voxcpm';

  /**
   * Synthesize with a VoxCPM2-specific request.
   */
  synthesizeVoxCpm(request: VoxCpmRequest): Promise<Result<TTSResponse, TTSError>>;

  /**
   * Rebuild a voice's reference from its archived original, without
   * re-uploading audio. Useful to try a different reference length.
   *
   * Note: this rewrites the shared `reference.wav`, so it affects every lab
   * on the box, not just this one.
   */
  reclone(params: Readonly<{
    slug: string;
    refMaxSec?: number;
    useClaude?: boolean;
  }>): Promise<Result<Readonly<{
    icCutSec: number;
    icMethod: string;
    refText: string;
    warnings: readonly string[];
  }>, TTSError>>;

  /**
   * Run the same text through all three engines on the box and report how
   * each did. A downed engine does not invalidate the others.
   */
  compare(params: Readonly<{
    text: string;
    voice: string;
    language?: string;
  }>): Promise<Result<readonly CompareEntry[], TTSError>>;

  /**
   * Unload the model from VRAM to free memory.
   */
  unloadModel(): Promise<Result<void, TTSError>>;

  /**
   * Warm up (preload) the model into VRAM. The lab starts cold on purpose,
   * so call this before a batch to keep the first segment from paying for it.
   */
  warmup(): Promise<Result<void, TTSError>>;
}

/**
 * Factory function to create a TTS client for a given provider.
 *
 * @param provider — The provider name ('llm4agents' or 'voxcpm')
 * @param config — Optional provider-specific configuration
 * @returns A configured TTSPort implementation
 */
export type TTSPortFactory = (
  provider: 'llm4agents' | 'voxcpm',
  config?: Readonly<Record<string, unknown>>
) => TTSPort;
