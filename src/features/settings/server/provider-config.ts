import type { ProviderConfig } from '@/features/settings/server/store';

export const SETTINGS_PROVIDER_IDS = ['google', 'groq', 'cerebras', 'mistral', 'openrouter', 'uploadthing'] as const;

export type SettingsProviderId = (typeof SETTINGS_PROVIDER_IDS)[number];

export function normalizeProviderSecret(provider: string, rawValue: string) {
  const value = rawValue.trim().replace(/^['"]|['"]$/g, '');

  if (provider !== 'uploadthing' || !value) {
    return value;
  }

  const stripped = value
    .replace(/^export\s+UPLOADTHING_TOKEN\s*=\s*/i, '')
    .replace(/^UPLOADTHING_TOKEN\s*=\s*/i, '')
    .trim()
    .replace(/^['"]|['"]$/g, '');

  if (/^(sk|usk|utsk)_/i.test(stripped)) {
    throw new Error('UploadThing needs the v7 token, not the secret key. Paste the raw UPLOADTHING_TOKEN value from the UploadThing dashboard.');
  }

  try {
    const decoded = JSON.parse(Buffer.from(stripped, 'base64').toString('utf8')) as {
      apiKey?: string;
      appId?: string;
      regions?: unknown;
    };

    if (!decoded.apiKey || !decoded.appId || !Array.isArray(decoded.regions)) {
      throw new Error('Invalid UploadThing token');
    }
  } catch {
    throw new Error('Invalid UploadThing token. Paste the raw token value only, not `UPLOADTHING_TOKEN=` and not the secret key.');
  }

  return stripped;
}

export function toMaskedConfig(config: ProviderConfig | null) {
  return {
    apiKey: config?.apiKey ? '********************************' : '',
    enabled: config?.enabled ?? true,
  };
}
