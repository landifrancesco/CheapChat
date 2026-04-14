import crypto from 'node:crypto';
import { UTApi } from 'uploadthing/server';
import { prisma } from '@/lib/prisma';
import { decryptAppConfig, encryptAppConfig } from '@/lib/encryption';
import { getSession } from '@/lib/session';
import { readProviderConfig } from '@/features/settings/server/store';

const ATTACHMENT_STATE_KEY = 'uploadthing_attachment_registry_v1';
const FALLBACK_UPLOADTHING_LIMIT_BYTES = 2 * 1024 * 1024 * 1024;
const EVICTION_START_RATIO = 0.9;
const EVICTION_TARGET_RATIO = 0.8;

export type StoredAttachment = {
  id: string;
  visitorId: string;
  chatId: string | null;
  fileKey: string;
  ufsUrl: string;
  appUrl: string | null;
  filename: string;
  mimeType: string;
  size: number;
  extractedText: string | null;
  status: 'available' | 'evicted';
  uploadedAt: string;
  evictedAt: string | null;
};

type UsageSnapshot = {
  totalBytes: number;
  appTotalBytes: number;
  filesUploaded: number;
  limitBytes: number;
  fetchedAt: string;
};

type AttachmentRegistry = {
  attachments: StoredAttachment[];
  usage: UsageSnapshot | null;
};

export type UploadThingUsage = {
  configured: boolean;
  enabled: boolean;
  connected: boolean;
  totalBytes: number;
  appTotalBytes: number;
  filesUploaded: number;
  limitBytes: number;
  nearLimit: boolean;
  cachedAt: string | null;
};

function defaultRegistry(): AttachmentRegistry {
  return {
    attachments: [],
    usage: null,
  };
}

async function loadAttachmentRegistry() {
  try {
    const config = await prisma.appConfig.findUnique({
      where: { key: ATTACHMENT_STATE_KEY },
    });

    if (!config) {
      return defaultRegistry();
    }

    return JSON.parse(decryptAppConfig(config.value)) as AttachmentRegistry;
  } catch (error) {
    console.error('Failed to load attachment registry:', error);
    return defaultRegistry();
  }
}

async function saveAttachmentRegistry(state: AttachmentRegistry) {
  try {
    await prisma.appConfig.upsert({
      where: { key: ATTACHMENT_STATE_KEY },
      update: { value: encryptAppConfig(JSON.stringify(state)) },
      create: {
        key: ATTACHMENT_STATE_KEY,
        value: encryptAppConfig(JSON.stringify(state)),
      },
    });
  } catch (error) {
    console.error('Failed to save attachment registry:', error);
  }
}

function buildUsageSnapshot(usage: {
  totalBytes: number;
  appTotalBytes: number;
  filesUploaded: number;
  limitBytes: number;
}): UsageSnapshot {
  return {
    ...usage,
    fetchedAt: new Date().toISOString(),
  };
}

export async function getUploadThingToken() {
  const config = await readProviderConfig('uploadthing');
  if (!config?.enabled || !config.apiKey) {
    return null;
  }

  return config.apiKey;
}

async function requireUploadThingToken() {
  const token = await getUploadThingToken();
  if (!token) {
    throw new Error('UploadThing is not configured. Add your token in Settings first.');
  }

  return token;
}

export async function createUploadThingApi() {
  const token = await requireUploadThingToken();
  return new UTApi({ token });
}

async function getReadableUploadUrl(utapi: UTApi, fileKey: string, fallbackUrl: string) {
  try {
    const probe = await fetch(fallbackUrl, { method: 'HEAD' });
    if (probe.ok) {
      return fallbackUrl;
    }
  } catch {
    // Ignore and fall back to signed URLs.
  }

  const signed = await utapi.generateSignedURL(fileKey);
  return signed.ufsUrl;
}

export async function registerUploadedAttachment(params: {
  visitorId: string;
  chatId: string | null;
  fileKey: string;
  ufsUrl: string;
  appUrl?: string | null;
  filename: string;
  mimeType: string;
  size: number;
}) {
  const utapi = await createUploadThingApi();
  const downloadUrl = await getReadableUploadUrl(utapi, params.fileKey, params.ufsUrl);
  const { parseUploadedFile } = await import('@/features/files/server/upload');
  let parsed = null as Awaited<ReturnType<typeof parseUploadedFile>> | null;

  try {
    parsed = await parseUploadedFile({
      filename: params.filename,
      size: params.size,
      mimeType: params.mimeType,
      downloadUrl,
    });
  } catch (error) {
    console.error(`Failed to index uploaded file ${params.filename}:`, error);
    parsed = {
      filename: params.filename,
      size: params.size,
      mimeType: params.mimeType || 'application/octet-stream',
      extractedText:
        `File uploaded successfully, but CheapChat could not extract readable text from ${params.filename} ` +
        `in the current server runtime. Ask the user to re-upload in TXT/CSV/MD format if they need direct analysis.`,
    };
  }

  const state = await loadAttachmentRegistry();
  const existing = state.attachments.find((attachment) => attachment.fileKey === params.fileKey);
  const record: StoredAttachment = {
    id: existing?.id ?? crypto.randomUUID(),
    visitorId: params.visitorId,
    chatId: params.chatId,
    fileKey: params.fileKey,
    ufsUrl: params.ufsUrl,
    appUrl: params.appUrl ?? null,
    filename: parsed.filename,
    mimeType: parsed.mimeType,
    size: parsed.size,
    extractedText: parsed.extractedText,
    status: 'available',
    uploadedAt: existing?.uploadedAt ?? new Date().toISOString(),
    evictedAt: null,
  };

  state.attachments = [...state.attachments.filter((attachment) => attachment.fileKey !== params.fileKey), record];
  await saveAttachmentRegistry(state);

  await enforceUploadThingQuota();

  const refreshedState = await loadAttachmentRegistry();
  return refreshedState.attachments.find((attachment) => attachment.fileKey === params.fileKey) ?? record;
}

export async function assignAttachmentsToChat(attachmentIds: string[], chatId: string, visitorId: string) {
  if (attachmentIds.length === 0) {
    return [];
  }

  const state = await loadAttachmentRegistry();
  const updated: StoredAttachment[] = [];

  state.attachments = state.attachments.map((attachment) => {
    if (!attachmentIds.includes(attachment.id) || attachment.visitorId !== visitorId) {
      return attachment;
    }

    const next = { ...attachment, chatId };
    updated.push(next);
    return next;
  });

  await saveAttachmentRegistry(state);
  return updated;
}

export async function getAttachmentsByIds(attachmentIds: string[]) {
  if (attachmentIds.length === 0) {
    return [];
  }

  const state = await loadAttachmentRegistry();
  return state.attachments.filter((attachment) => attachmentIds.includes(attachment.id));
}

export async function getChatAttachments(chatId: string, visitorId?: string) {
  const state = await loadAttachmentRegistry();
  return state.attachments
    .filter((attachment) => attachment.chatId === chatId && (!visitorId || attachment.visitorId === visitorId))
    .sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt));
}

export async function deleteChatAttachments(chatId: string, visitorId: string) {
  const state = await loadAttachmentRegistry();
  const attachmentsToDelete = state.attachments.filter(
    (attachment) => attachment.chatId === chatId && attachment.visitorId === visitorId
  );

  if (attachmentsToDelete.length === 0) {
    return { deletedCount: 0 };
  }

  const token = await getUploadThingToken();
  const utapi = token ? new UTApi({ token }) : null;

  for (const attachment of attachmentsToDelete) {
    if (!utapi || attachment.status === 'evicted') {
      continue;
    }

    try {
      await utapi.deleteFiles(attachment.fileKey);
    } catch (error) {
      console.error(`Failed to delete UploadThing file ${attachment.fileKey}:`, error);
    }
  }

  state.attachments = state.attachments.filter(
    (attachment) => !(attachment.chatId === chatId && attachment.visitorId === visitorId)
  );
  await saveAttachmentRegistry(state);

  return { deletedCount: attachmentsToDelete.length };
}

export async function syncAttachmentsToMessage(messageId: string, attachmentIds: string[], visitorId: string) {
  const attachments = (await getAttachmentsByIds(attachmentIds)).filter((attachment) => attachment.visitorId === visitorId);
  if (attachments.length === 0) {
    return;
  }

  await prisma.attachment.createMany({
    data: attachments.map((attachment) => ({
      messageId,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      size: attachment.size,
      extractedText: attachment.status === 'available' ? attachment.extractedText : null,
    })),
  });
}

export async function getUploadThingUsage() {
  const config = await readProviderConfig('uploadthing');
  const state = await loadAttachmentRegistry();

  if (!config?.apiKey) {
    return {
      configured: false,
      enabled: false,
      connected: false,
      totalBytes: 0,
      appTotalBytes: 0,
      filesUploaded: 0,
      limitBytes: FALLBACK_UPLOADTHING_LIMIT_BYTES,
      nearLimit: false,
      cachedAt: state.usage?.fetchedAt ?? null,
    } satisfies UploadThingUsage;
  }

  if (!config.enabled) {
    return {
      configured: true,
      enabled: false,
      connected: false,
      totalBytes: 0,
      appTotalBytes: 0,
      filesUploaded: 0,
      limitBytes: state.usage?.limitBytes ?? FALLBACK_UPLOADTHING_LIMIT_BYTES,
      nearLimit: false,
      cachedAt: state.usage?.fetchedAt ?? null,
    } satisfies UploadThingUsage;
  }

  try {
    const utapi = new UTApi({ token: config.apiKey });
    const usage = await utapi.getUsageInfo();
    state.usage = buildUsageSnapshot(usage);
    await saveAttachmentRegistry(state);

    return {
      configured: true,
      enabled: true,
      connected: true,
      totalBytes: usage.totalBytes,
      appTotalBytes: usage.appTotalBytes,
      filesUploaded: usage.filesUploaded,
      limitBytes: usage.limitBytes,
      nearLimit: usage.appTotalBytes >= usage.limitBytes * EVICTION_START_RATIO,
      cachedAt: state.usage.fetchedAt,
    } satisfies UploadThingUsage;
  } catch (error) {
    console.error('Failed to fetch UploadThing usage:', error);

    return {
      configured: true,
      enabled: true,
      connected: false,
      totalBytes: state.usage?.totalBytes ?? 0,
      appTotalBytes: state.usage?.appTotalBytes ?? 0,
      filesUploaded: state.usage?.filesUploaded ?? 0,
      limitBytes: state.usage?.limitBytes ?? FALLBACK_UPLOADTHING_LIMIT_BYTES,
      nearLimit: (state.usage?.appTotalBytes ?? 0) >= (state.usage?.limitBytes ?? FALLBACK_UPLOADTHING_LIMIT_BYTES) * EVICTION_START_RATIO,
      cachedAt: state.usage?.fetchedAt ?? null,
    } satisfies UploadThingUsage;
  }
}

export async function getCurrentUserUploadThingUsage() {
  const session = await getSession();
  if (!session) {
    return null;
  }

  return getUploadThingUsage();
}

export async function enforceUploadThingQuota() {
  const token = await getUploadThingToken();
  if (!token) {
    return { evicted: [] as StoredAttachment[], usage: null as UsageSnapshot | null };
  }

  const utapi = new UTApi({ token });
  const usage = await utapi.getUsageInfo();
  const limitBytes = usage.limitBytes || FALLBACK_UPLOADTHING_LIMIT_BYTES;
  const startBytes = Math.floor(limitBytes * EVICTION_START_RATIO);
  const targetBytes = Math.floor(limitBytes * EVICTION_TARGET_RATIO);

  const state = await loadAttachmentRegistry();
  state.usage = buildUsageSnapshot({
    ...usage,
    limitBytes,
  });

  if (usage.appTotalBytes <= startBytes) {
    await saveAttachmentRegistry(state);
    return { evicted: [] as StoredAttachment[], usage: state.usage };
  }

  const evicted: StoredAttachment[] = [];
  let estimatedBytes = usage.appTotalBytes;

  for (const attachment of state.attachments.sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt))) {
    if (attachment.status !== 'available') {
      continue;
    }

    if (estimatedBytes <= targetBytes) {
      break;
    }

    try {
      const result = await utapi.deleteFiles(attachment.fileKey);
      if (!result.success) {
        continue;
      }

      const nextAttachment = {
        ...attachment,
        status: 'evicted' as const,
        evictedAt: new Date().toISOString(),
        extractedText: null,
      };

      state.attachments = state.attachments.map((candidate) => (candidate.id === attachment.id ? nextAttachment : candidate));
      evicted.push(nextAttachment);
      estimatedBytes = Math.max(estimatedBytes - attachment.size, 0);
    } catch (error) {
      console.error(`Failed to evict UploadThing file ${attachment.fileKey}:`, error);
    }
  }

  state.usage = buildUsageSnapshot({
    totalBytes: usage.totalBytes,
    appTotalBytes: estimatedBytes,
    filesUploaded: usage.filesUploaded,
    limitBytes,
  });
  await saveAttachmentRegistry(state);

  return { evicted, usage: state.usage };
}
