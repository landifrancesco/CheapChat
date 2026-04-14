import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/session';
import { readProviderConfig, writeProviderConfig } from '@/features/settings/server/store';
import { normalizeProviderSecret, SETTINGS_PROVIDER_IDS, toMaskedConfig } from '@/features/settings/server/provider-config';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const session = await getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const entries = await Promise.all(
      SETTINGS_PROVIDER_IDS.map(async (provider) => [provider, toMaskedConfig(await readProviderConfig(provider))] as const)
    );

    return NextResponse.json({ providers: Object.fromEntries(entries) });
  } catch (error) {
    console.error('Failed to load provider settings:', error);
    return NextResponse.json({ error: 'Failed to load provider settings' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = (await request.json()) as {
      configs?: Array<{ id: string; apiKey?: string; enabled?: boolean }>;
    };

    const configs = Array.isArray(body.configs) ? body.configs : [];

    for (const config of configs) {
      if (!SETTINGS_PROVIDER_IDS.includes(config.id as (typeof SETTINGS_PROVIDER_IDS)[number])) {
        continue;
      }

      const current = await readProviderConfig(config.id);
      const rawApiKey = typeof config.apiKey === 'string' ? config.apiKey : '';
      const nextApiKey =
        rawApiKey === ''
          ? ''
          : rawApiKey.startsWith('***')
            ? current?.apiKey ?? ''
            : normalizeProviderSecret(config.id, rawApiKey);

      await writeProviderConfig(config.id, {
        apiKey: nextApiKey,
        enabled: typeof config.enabled === 'boolean' ? config.enabled : current?.enabled ?? true,
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to save provider settings:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save provider settings' },
      { status: 500 }
    );
  }
}
