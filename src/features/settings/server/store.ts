import { prisma } from '@/lib/prisma';
import { decryptAppConfig, encryptAppConfig } from '@/lib/encryption';

export type ProviderConfig = {
  apiKey: string;
  enabled: boolean;
};

export async function readProviderConfig(provider: string): Promise<ProviderConfig | null> {
  try {
    const config = await prisma.appConfig.findUnique({
      where: { key: `provider_${provider}` },
    });

    if (!config) {
      return null;
    }

    const decrypted = decryptAppConfig(config.value);
    return JSON.parse(decrypted) as ProviderConfig;
  } catch (error) {
    console.error(`Failed to read provider config for ${provider}:`, error);
    return null;
  }
}

export async function writeProviderConfig(provider: string, config: ProviderConfig) {
  const payload = JSON.stringify(config);
  const encrypted = encryptAppConfig(payload);

  await prisma.appConfig.upsert({
    where: { key: `provider_${provider}` },
    update: { value: encrypted },
    create: { key: `provider_${provider}`, value: encrypted },
  });
}
