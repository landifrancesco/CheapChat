import { z } from 'zod';
import { createUploadthing, type FileRouter } from 'uploadthing/next';
import { UploadThingError } from 'uploadthing/server';
import { getSessionFromRequest } from '@/lib/session';
import { registerUploadedAttachment } from '@/features/files/server/attachments';

const f = createUploadthing();

export const cheapChatFileRouter = {
  chatAttachment: f(
    {
      image: { maxFileSize: '8MB', maxFileCount: 8 },
      pdf: { maxFileSize: '16MB', maxFileCount: 8 },
      text: { maxFileSize: '8MB', maxFileCount: 8 },
      blob: { maxFileSize: '16MB', maxFileCount: 8 },
    },
    {
      awaitServerData: true,
    }
  )
    .input(
      z.object({
        chatId: z.string().nullable().optional(),
      })
    )
    .middleware(async ({ req, input }) => {
      const session = await getSessionFromRequest(req);
      if (!session) {
        throw new UploadThingError('Unauthorized');
      }

      return {
        visitorId: session.visitorId,
        chatId: input.chatId ?? null,
      };
    })
    .onUploadComplete(async ({ metadata, file }) => {
      const attachment = await registerUploadedAttachment({
        visitorId: metadata.visitorId,
        chatId: metadata.chatId,
        fileKey: file.key,
        ufsUrl: file.ufsUrl,
        appUrl: file.appUrl,
        filename: file.name,
        mimeType: file.type,
        size: file.size,
      });

      return {
        attachmentId: attachment.id,
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        size: attachment.size,
        status: attachment.status,
      };
    }),
} satisfies FileRouter;

export type CheapChatFileRouter = typeof cheapChatFileRouter;
