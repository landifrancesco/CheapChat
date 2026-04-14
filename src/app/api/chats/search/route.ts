import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionFromRequest } from '@/lib/session';
import { loadProjectState } from '@/features/chat/server/project-state';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q')?.trim() ?? '';
    if (!query) {
      return NextResponse.json([]);
    }

    const [chats, state] = await Promise.all([
      prisma.chat.findMany({
        where: {
          visitorId: session.visitorId,
          OR: [
            {
              title: {
                contains: query,
                mode: 'insensitive',
              },
            },
            {
              messages: {
                some: {
                  content: {
                    contains: query,
                    mode: 'insensitive',
                  },
                },
              },
            },
          ],
        },
        include: {
          messages: {
            where: {
              content: {
                contains: query,
                mode: 'insensitive',
              },
            },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
        orderBy: { updatedAt: 'desc' },
        take: 25,
      }),
      loadProjectState(session.visitorId),
    ]);

    return NextResponse.json(
      chats.map((chat) => ({
        id: chat.id,
        title: chat.title,
        createdAt: chat.createdAt.toISOString(),
        projectId: state.chatAssignments[chat.id] ?? null,
        matchSnippet: chat.messages[0]?.content ?? null,
      }))
    );
  } catch (error) {
    console.error('Failed to search chats:', error);
    return NextResponse.json({ error: 'Failed to search chats.' }, { status: 500 });
  }
}
