import { ProviderClientOptions, LLMResponse } from '../types';

const PROVIDER_TIMEOUT_MS = 25_000;

export async function callOpenAICompatible(
  options: ProviderClientOptions,
  baseURL: string,
  providerId: string
): Promise<LLMResponse> {
  const { apiKey, model, messages, temperature = 0.7, maxTokens, extraBody, extraHeaders } = options;

  let response: Response;

  try {
    response = await fetch(`${baseURL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        ...extraHeaders,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: maxTokens,
        ...extraBody,
      }),
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new Error(`${providerId} request timed out after ${PROVIDER_TIMEOUT_MS / 1000}s`);
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
    throw new Error(`${providerId} API Error (${response.status}): ${errorMessage}`);
  }

  const data = await response.json();
  const choice = data.choices?.[0];
  const text = choice?.message?.content || choice?.text || '';

  return {
    text,
    model,
    providerId,
    usage: {
      promptTokens: data.usage?.prompt_tokens || 0,
      completionTokens: data.usage?.completion_tokens || 0,
      totalTokens: data.usage?.total_tokens || 0,
    },
    raw: data
  };
}
