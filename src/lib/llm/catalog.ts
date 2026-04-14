import { LLMProfile, ProviderId } from './types';

export type ModelRecord = {
  providerId: ProviderId;
  model: string;
  label?: string;
  group?: string;
  description?: string;
  bestFor?: string;
  contextWindow?: string;
  maxOutputTokens?: string;
  baseUrl?: string;
};

export const PROFILE_OPTIONS: Array<{ value: LLMProfile; label: string }> = [
  { value: 'FAST', label: 'Smart: Fast' },
  { value: 'REASONING', label: 'Smart: Reasoning' },
  { value: 'CODING', label: 'Smart: Coding' },
];

export const SELECTABLE_MODEL_OPTIONS: ModelRecord[] = [
  {
    providerId: 'google',
    model: 'gemini-2.5-flash-lite',
    label: 'Gemini 2.5 Flash-Lite',
    group: 'Google AI Studio',
    description: 'Fastest and lightest',
    bestFor: 'Quick chat, fast document passes, and high-throughput tasks',
    contextWindow: '1,048,576 input tokens',
    maxOutputTokens: '65,536 output tokens',
  },
  {
    providerId: 'google',
    model: 'gemini-2.5-flash',
    label: 'Gemini 2.5 Flash',
    group: 'Google AI Studio',
    description: 'Better reasoning, still quick',
    bestFor: 'Balanced reasoning, agents, and large multi-file context',
    contextWindow: '1,048,576 input tokens',
    maxOutputTokens: '65,536 output tokens',
  },
  {
    providerId: 'groq',
    model: 'llama-3.1-8b-instant',
    label: 'Llama 3.1 8B Instant',
    group: 'Groq',
    description: 'Very low latency',
    bestFor: 'Realtime chat, quick edits, and fast drafting',
    contextWindow: '131,072 context tokens',
    maxOutputTokens: '131,072 output tokens',
  },
  {
    providerId: 'groq',
    model: 'llama-3.3-70b-versatile',
    label: 'Llama 3.3 70B Versatile',
    group: 'Groq',
    description: 'Balanced quality and speed',
    bestFor: 'Higher-quality general chat, analysis, and coding help',
    contextWindow: '131,072 context tokens',
    maxOutputTokens: '32,768 output tokens',
  },
  {
    providerId: 'groq',
    model: 'deepseek-r1-distill-llama-70b',
    label: 'DeepSeek R1 Distill Llama 70B',
    group: 'Groq',
    description: 'Stronger reasoning',
    bestFor: 'Step-by-step reasoning, math, debugging, and logic-heavy prompts',
    contextWindow: 'Long-context reasoning model',
    maxOutputTokens: 'Provider page does not list an exact max output value',
  },
  {
    providerId: 'cerebras',
    model: 'llama-3.1-8b',
    label: 'Llama 3.1 8B',
    group: 'Cerebras',
    description: 'Fast throughput',
    bestFor: 'Speed-critical chat and batch-style text generation',
    contextWindow: '8k free tier / 32k paid tiers',
    maxOutputTokens: '8k',
  },
  {
    providerId: 'cerebras',
    model: 'llama-3.3-70b',
    label: 'Llama 3.3 70B',
    group: 'Cerebras',
    description: 'Larger, stronger answers',
    bestFor: 'Richer answers for chat, coding, math, and reasoning',
    contextWindow: 'Free tier context listed, exact value not shown on model page',
    maxOutputTokens: 'Not listed on the current model page',
  },
  {
    providerId: 'mistral',
    model: 'mistral-small-latest',
    label: 'Mistral Small',
    group: 'Mistral',
    description: 'Balanced general model',
    bestFor: 'General work, document QA, and lower-cost everyday use',
    contextWindow: '128k context',
    maxOutputTokens: 'Provider docs expose 128k context for the latest small line',
  },
  {
    providerId: 'mistral',
    model: 'mistral-large-latest',
    label: 'Mistral Large',
    group: 'Mistral',
    description: 'Best quality in Mistral line',
    bestFor: 'Complex reasoning, richer writing, and harder multi-step tasks',
    contextWindow: '256k context',
    maxOutputTokens: 'Provider docs expose 256k context for the latest large line',
  },
  {
    providerId: 'openrouter',
    model: 'meta-llama/llama-3.3-70b-instruct:free',
    label: 'Llama 3.3 70B Instruct',
    group: 'OpenRouter',
    description: 'Free fallback, strong generalist',
    bestFor: 'Free general-purpose fallback with strong multilingual chat',
    contextWindow: '128,000 context tokens',
    maxOutputTokens: 'Provider-routed free model',
  },
  {
    providerId: 'openrouter',
    model: 'qwen/qwen3-coder:free',
    label: 'Qwen 3 Coder',
    group: 'OpenRouter',
    description: 'Coding-focused',
    bestFor: 'Repository questions, code generation, and technical debugging',
    contextWindow: '262,000 context tokens',
    maxOutputTokens: 'Provider-routed free model',
  },
  {
    providerId: 'openrouter',
    model: 'google/gemma-3-27b-it:free',
    label: 'Gemma 3 27B Instruct',
    group: 'OpenRouter',
    description: 'Free balanced fallback',
    bestFor: 'Free balanced chat, multilingual prompts, and structured outputs',
    contextWindow: '131,072 context tokens',
    maxOutputTokens: 'Provider-routed free model',
  },
];

export const PROFILE_PRIORITY: Record<LLMProfile, ModelRecord[]> = {
  FAST: [
    { providerId: 'google', model: 'gemini-2.5-flash-lite' },
    { providerId: 'groq', model: 'llama-3.1-8b-instant' },
    { providerId: 'groq', model: 'llama-3.3-70b-versatile' },
    { providerId: 'openrouter', model: 'google/gemma-3-27b-it:free' },
    { providerId: 'cerebras', model: 'llama-3.1-8b' },
    { providerId: 'mistral', model: 'mistral-small-latest' },
  ],
  REASONING: [
    { providerId: 'google', model: 'gemini-2.5-flash' },
    { providerId: 'groq', model: 'deepseek-r1-distill-llama-70b' },
    { providerId: 'openrouter', model: 'meta-llama/llama-3.3-70b-instruct:free' },
    { providerId: 'cerebras', model: 'llama-3.3-70b' },
    { providerId: 'mistral', model: 'mistral-large-latest' },
    { providerId: 'openrouter', model: 'google/gemma-3-27b-it:free' },
  ],
  CODING: [
    { providerId: 'openrouter', model: 'qwen/qwen3-coder:free' },
    { providerId: 'google', model: 'gemini-2.5-flash' },
    { providerId: 'google', model: 'gemini-2.5-flash-lite' },
    { providerId: 'groq', model: 'llama-3.3-70b-versatile' },
  ],
};

export const DEFAULT_CHAT_TARGET = 'profile:FAST';

export function getBaseUrl(providerId: ProviderId): string | undefined {
  switch (providerId) {
    case 'groq':
      return 'https://api.groq.com/openai/v1';
    case 'openrouter':
      return 'https://openrouter.ai/api/v1';
    case 'cerebras':
      return 'https://api.cerebras.ai/v1';
    case 'mistral':
      return 'https://api.mistral.ai/v1';
    default:
      return undefined;
  }
}

export function isSelectableFreeModel(providerId: string, model: string): boolean {
  return SELECTABLE_MODEL_OPTIONS.some((option) => option.providerId === providerId && option.model === model);
}

export function getSelectableModel(providerId: string, model: string): ModelRecord | undefined {
  return SELECTABLE_MODEL_OPTIONS.find((option) => option.providerId === providerId && option.model === model);
}

export function getOpenRouterFallbackModels(primaryModel: string): string[] {
  return [
    primaryModel,
    ...SELECTABLE_MODEL_OPTIONS.filter((option) => option.providerId === 'openrouter' && option.model !== primaryModel).map(
      (option) => option.model
    ),
  ];
}

export function parseChatTarget(target: string): { kind: 'profile'; profile: LLMProfile } | { kind: 'model'; providerId: ProviderId; model: string } {
  if (target.startsWith('profile:')) {
    const profile = target.replace('profile:', '') as LLMProfile;
    if (PROFILE_OPTIONS.some((option) => option.value === profile)) {
      return { kind: 'profile', profile };
    }
    return { kind: 'profile', profile: 'FAST' };
  }

  const selectableModel = SELECTABLE_MODEL_OPTIONS.find((option) => `${option.providerId}|${option.model}` === target);
  if (selectableModel) {
    return { kind: 'model', providerId: selectableModel.providerId, model: selectableModel.model };
  }

  return { kind: 'profile', profile: 'FAST' };
}
