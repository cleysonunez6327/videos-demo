import type { TTSPort } from './ports/tts-port.js';
import { createLlm4AgentsClient } from './providers/llm4agents.js';
import { createVoxCpmClient } from './providers/voxcpm.js';
import type { TTSProvider } from './domain/types.js';

/**
 * TTS Client Factory.
 *
 * Creates the appropriate TTS client based on provider name.
 * All clients implement the TTSPort interface for consistency.
 *
 * @example
 * ```ts
 * const client = createTTSClient('llm4agents');
 * const health = await client.healthCheck();
 * ```
 *
 * @example
 * ```ts
 * const client = createTTSClient('voxcpm', { baseUrl: 'http://localhost:7862' });
 * const voices = await client.listVoices();
 * ```
 */
export function createTTSClient(
  provider: TTSProvider = 'llm4agents',
  config?: Readonly<Record<string, unknown>>
): TTSPort {
  switch (provider) {
    case 'llm4agents':
      return createLlm4AgentsClient();

    case 'voxcpm': {
      const baseUrl = config?.['baseUrl'];
      return createVoxCpmClient(typeof baseUrl === 'string' ? baseUrl : undefined);
    }

    default: {
      // Exhaustive check — compiler will error if new provider is added without case
      const _exhaustive: never = provider;
      throw new Error(`Unknown TTS provider: ${String(_exhaustive)}`);
    }
  }
}

/**
 * Get a list of available TTS providers.
 */
export function getAvailableProviders(): readonly TTSProvider[] {
  return ['llm4agents', 'voxcpm'] as const;
}

/**
 * Validate if a provider name is supported.
 */
export function isValidProvider(provider: string): provider is TTSProvider {
  return getAvailableProviders().includes(provider as TTSProvider);
}
