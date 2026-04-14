export type Message = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type LLMProfile = 'FAST' | 'REASONING' | 'CODING';

export type ProviderId = 'google' | 'groq' | 'openrouter' | 'cerebras' | 'mistral';

export type LLMResponse = {
  text: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model: string;
  providerId: string;
  raw?: unknown;
};

export type ProviderClientOptions = {
  apiKey: string;
  model: string;
  messages: Message[];
  temperature?: number;
  maxTokens?: number;
  extraBody?: Record<string, unknown>;
  extraHeaders?: Record<string, string>;
};
