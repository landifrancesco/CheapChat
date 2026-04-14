'use server';

import { getCurrentUserUploadThingUsage } from '@/features/files/server/attachments';

export async function getUploadThingUsageAction() {
  return getCurrentUserUploadThingUsage();
}
