import { NextRequest } from 'next/server';
import { createRouteHandler } from 'uploadthing/next';
import { getUploadThingToken } from '@/features/files/server/attachments';
import { cheapChatFileRouter } from '@/features/files/server/uploadthing';

export const runtime = 'nodejs';
export const maxDuration = 60;

async function resolveHandler() {
  const token = await getUploadThingToken();
  if (!token) {
    return null;
  }

  return createRouteHandler({
    router: cheapChatFileRouter,
    config: {
      token,
    },
  });
}

async function handleMissingToken() {
  return Response.json(
    { error: 'UploadThing is not configured yet. Add your token in Settings before uploading files.' },
    { status: 503 }
  );
}

export async function GET(req: NextRequest) {
  const handler = await resolveHandler();
  if (!handler) {
    return handleMissingToken();
  }

  return handler.GET(req);
}

export async function POST(req: NextRequest) {
  const handler = await resolveHandler();
  if (!handler) {
    return handleMissingToken();
  }

  return handler.POST(req);
}
