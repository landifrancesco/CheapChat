'use server';

import { getSession } from '@/lib/session';
import { ProviderConfig, readProviderConfig, writeProviderConfig } from '@/features/settings/server/store';
import { normalizeProviderSecret } from '@/features/settings/server/provider-config';

export async function getProviderConfig(provider: string): Promise<ProviderConfig | null> {
  const session = await getSession();
  if (!session) return null; // Protect from unauthenticated access

  return readProviderConfig(provider);
}

export async function saveProviderConfig(provider: string, config: ProviderConfig) {
  const session = await getSession();
  if (!session) throw new Error('Unauthorized'); // Protect from unauthenticated access

  await writeProviderConfig(provider, {
    ...config,
    apiKey: normalizeProviderSecret(provider, config.apiKey),
  });

  return { success: true };
}
