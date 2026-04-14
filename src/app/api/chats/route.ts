import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionFromRequest } from '@/lib/session';
import { loadProjectState, saveProjectState } from '@/features/chat/server/project-state';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const modelProvider = typeof body.modelProvider === 'string' ? body.modelProvider : 'routed';
    const modelName = typeof body.modelName === 'string' ? body.modelName : 'FAST';
    const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : 'New Chat';
    const projectId = typeof body.projectId === 'string' ? body.projectId : null;

    const chat = await prisma.chat.create({
      data: {
        visitorId: session.visitorId,
        modelProvider,
        modelName,
        title,
      },
    });

    if (projectId) {
      const state = await loadProjectState(session.visitorId);
      state.chatAssignments[chat.id] = projectId;
      await saveProjectState(session.visitorId, state);
    }

    return NextResponse.json({
      id: chat.id,
      title: chat.title,
      createdAt: chat.createdAt.toISOString(),
      projectId,
    });
  } catch (error) {
    console.error('Failed to create chat:', error);
    return NextResponse.json({ error: 'Failed to create chat.' }, { status: 500 });
  }
}
