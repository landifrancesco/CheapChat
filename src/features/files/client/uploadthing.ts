'use client';

import { generateReactHelpers } from '@uploadthing/react';
import type { CheapChatFileRouter } from '@/features/files/server/uploadthing';

export const { useUploadThing } = generateReactHelpers<CheapChatFileRouter>({
  url: '/api/uploadthing',
});
