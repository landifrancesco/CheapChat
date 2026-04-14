import { LLMProfile, LLMResponse, Message } from './types';
import { readProviderConfig } from '@/features/settings/server/store';
import { callGemini } from './providers/gemini';
import { callOpenAICompatible } from './providers/openai-compatible';
import { getBaseUrl, getOpenRouterFallbackModels, PROFILE_PRIORITY } from './catalog';

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function callProvider(
  providerId: string, 
  model: string, 
  messages: Message[], 
  options?: { temperature?: number; maxTokens?: number },
  baseUrlOverride?: string
): Promise<LLMResponse> {
  const config = await readProviderConfig(providerId);
  if (!config || !config.enabled || !config.apiKey) {
    throw new Error(`Provider ${providerId} is not configured or disabled.`);
  }

  const clientOptions = {
    apiKey: config.apiKey,
    model,
    messages,
    ...options,
  };

  switch (providerId) {
    case 'google':
      return await callGemini(clientOptions);
    case 'groq':
    case 'cerebras':
    case 'openrouter':
    case 'mistral':
    {
      const baseUrl = baseUrlOverride || getBaseUrl(providerId);
      if (!baseUrl) throw new Error(`Missing baseURL for OpenAI-compatible provider: ${providerId}`);
      const openRouterBody =
        providerId === 'openrouter'
          ? {
              models: getOpenRouterFallbackModels(model),
              provider: {
                allow_fallbacks: true,
              },
            }
          : undefined;

      return await callOpenAICompatible(
        {
          ...clientOptions,
          extraBody: openRouterBody,
          extraHeaders:
            providerId === 'openrouter'
              ? {
                  'HTTP-Referer': 'https://cheapchat.local',
                  'X-Title': 'CheapChat',
                }
              : undefined,
        },
        baseUrl,
        providerId
      );
    }
    default:
      throw new Error(`Unknown providerId: ${providerId}`);
  }
}

export async function callRoutedLLM(
  profile: LLMProfile,
  messages: Message[],
  options?: { 
    temperature?: number; 
    maxTokens?: number;
    directModel?: { providerId: string; model: string }
  }
): Promise<LLMResponse> {
  if (options?.directModel) {
    console.log(`[Router] Direct model selection: ${options.directModel.providerId}:${options.directModel.model}`);
    return await callProvider(
      options.directModel.providerId,
      options.directModel.model,
      messages,
      { temperature: options.temperature, maxTokens: options.maxTokens }
    );
  }

  const attempts = PROFILE_PRIORITY[profile];
  let lastError: Error | null = null;

  for (const record of attempts) {
    try {
      console.log(`[Router] Attempting ${record.providerId}:${record.model} for ${profile} profile...`);
      return await callProvider(
        record.providerId,
        record.model,
        messages,
        { temperature: options?.temperature, maxTokens: options?.maxTokens },
        record.baseUrl
      );
    } catch (error: unknown) {
      const errorMessage = getErrorMessage(error);
      const msg = errorMessage.toLowerCase();
      const isRetriable = 
        msg.includes('429') || 
        msg.includes('rate limit') || 
        msg.includes('400') || 
        msg.includes('404') || 
        msg.includes('not found') ||
        msg.includes('invalid') ||
        msg.includes('fetch');

      if (isRetriable) {
        console.warn(`[Router] ${record.providerId}:${record.model} failed (${errorMessage}). Trying next fallback...`);
        lastError = error instanceof Error ? error : new Error(errorMessage);
        continue;
      }
      
      console.error(`[Router] Critical error on ${record.providerId}:${record.model}:`, errorMessage);
      lastError = error instanceof Error ? error : new Error(errorMessage);
      continue;
    }
  }

  throw new Error(`All providers for profile ${profile} failed. Last error: ${lastError?.message || 'Unknown'}`);
}
