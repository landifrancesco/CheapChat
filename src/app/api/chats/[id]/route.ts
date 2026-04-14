import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionFromRequest } from '@/lib/session';
import { deleteChatAttachments } from '@/features/files/server/attachments';
import { loadProjectState, saveProjectState } from '@/features/chat/server/project-state';

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
    const [chat, state] = await Promise.all([
      prisma.chat.findUnique({
        where: {
          id,
          visitorId: session.visitorId,
        },
        include: {
          messages: {
            orderBy: { createdAt: 'asc' },
            include: { attachments: true },
          },
        },
      }),
      loadProjectState(session.visitorId),
    ]);

    if (!chat) {
      return NextResponse.json({ error: 'Chat not found.' }, { status: 404 });
    }

    const projectId = state.chatAssignments[id] ?? null;
    const project = projectId ? state.projects.find((item) => item.id === projectId) ?? null : null;

    return NextResponse.json({
      id: chat.id,
      title: chat.title,
      createdAt: chat.createdAt.toISOString(),
      updatedAt: chat.updatedAt.toISOString(),
      modelProvider: chat.modelProvider,
      modelName: chat.modelName,
      projectId,
      project: project
        ? {
            id: project.id,
            name: project.name,
            instructions: project.instructions ?? '',
          }
        : null,
      messages: chat.messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        model: message.model,
        createdAt: message.createdAt.toISOString(),
        attachments: message.attachments.map((attachment) => ({
          id: attachment.id,
          filename: attachment.filename,
          mimeType: attachment.mimeType,
          size: attachment.size,
        })),
      })),
    });
  } catch (error) {
    console.error('Failed to load chat details:', error);
    return NextResponse.json({ error: 'Failed to load chat.' }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await context.params;
    const body = await request.json();
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title) {
      return NextResponse.json({ error: 'Title is required.' }, { status: 400 });
    }

    await prisma.chat.update({
      where: {
        id,
        visitorId: session.visitorId,
      },
      data: { title },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Failed to update chat:', error);
    return NextResponse.json({ error: 'Failed to update chat.' }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await context.params;
    await deleteChatAttachments(id, session.visitorId);

    await prisma.chat.delete({
      where: {
        id,
        visitorId: session.visitorId,
      },
    });

    const state = await loadProjectState(session.visitorId);
    delete state.chatAssignments[id];
    await saveProjectState(session.visitorId, state);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Failed to delete chat:', error);
    return NextResponse.json({ error: 'Failed to delete chat.' }, { status: 500 });
  }
}
