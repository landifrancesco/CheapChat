import { NextResponse } from 'next/server';
import {
  buildChatMarkdown,
  buildChatPdf,
  loadChatExport,
  slugifyFilename,
} from '@/features/chat/server/export';
import { getSessionFromRequest } from '@/lib/session';

export const runtime = 'nodejs';

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await context.params;
    const chat = await loadChatExport(id, session.visitorId);
    if (!chat) {
      return NextResponse.json({ error: 'Chat not found.' }, { status: 404 });
    }

    const url = new URL(request.url);
    const format = url.searchParams.get('format') ?? 'markdown';
    const basename = slugifyFilename(chat.title, `chat-${chat.id}`);

    if (format === 'markdown') {
      return new Response(buildChatMarkdown(chat), {
        headers: {
          'Content-Type': 'text/markdown; charset=utf-8',
          'Content-Disposition': `attachment; filename="${basename}.md"`,
          'Cache-Control': 'no-store',
        },
      });
    }

    if (format === 'pdf') {
      return new Response(buildChatPdf(chat), {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${basename}.pdf"`,
          'Cache-Control': 'no-store',
        },
      });
    }

    return NextResponse.json({ error: 'Unsupported export format.' }, { status: 400 });
  } catch (error) {
    console.error('Failed to export chat:', error);
    return NextResponse.json({ error: 'Failed to export chat.' }, { status: 500 });
  }
}
