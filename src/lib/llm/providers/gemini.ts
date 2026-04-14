import { Message, ProviderClientOptions, LLMResponse } from '../types';

const PROVIDER_TIMEOUT_MS = 25_000;

export async function callGemini(options: ProviderClientOptions): Promise<LLMResponse> {
  const { apiKey, model, messages, temperature = 0.7 } = options;

  const systemInstructionText = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content.trim())
    .filter(Boolean)
    .join('\n\n');

  const contents = messages
    .filter((message) => message.role !== 'system')
    .map((message: Message) => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: message.content }],
    }));

  const payload = {
    ...(systemInstructionText
      ? {
          system_instruction: {
            parts: [{ text: systemInstructionText }],
          },
        }
      : {}),
    contents,
    generationConfig: {
      temperature,
      maxOutputTokens: options.maxTokens,
    },
  };

  let response: Response;

  try {
    response = await fetch(`https://generativelanguage.googleapis.com/v1/models/${model}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new Error(`Google AI Studio request timed out after ${PROVIDER_TIMEOUT_MS / 1000}s`);
    }
    throw error;
  }

  if (!response.ok) {
    const errorBody = await response.text();
    let errorMessage = response.statusText;

    try {
      const errorJson = JSON.parse(errorBody);
      errorMessage = errorJson.error?.message || errorJson.message || errorMessage;
    } catch {
      errorMessage = errorBody || errorMessage;
    }

    throw new Error(`Google AI Studio API Error (${response.status}): ${errorMessage}`);
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text || '').join('') || '';

  return {
    text,
    model,
    providerId: 'google',
    usage: {
      promptTokens: data.usageMetadata?.promptTokenCount || 0,
      completionTokens: data.usageMetadata?.candidatesTokenCount || 0,
      totalTokens: (data.usageMetadata?.promptTokenCount || 0) + (data.usageMetadata?.candidatesTokenCount || 0),
    },
    raw: data
  };
}
