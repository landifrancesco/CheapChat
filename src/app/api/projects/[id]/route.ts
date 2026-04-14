import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/session';
import { loadProjectState, saveProjectState } from '@/features/chat/server/project-state';

export const runtime = 'nodejs';

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await context.params;
    const body = await request.json();
    const state = await loadProjectState(session.visitorId);

    state.projects = state.projects.map((project) =>
      project.id === id
        ? {
            ...project,
            ...(typeof body.name === 'string' && body.name.trim() ? { name: body.name.trim() } : {}),
            ...(typeof body.instructions === 'string' ? { instructions: body.instructions.trim() } : {}),
          }
        : project
    );

    await saveProjectState(session.visitorId, state);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Failed to update project:', error);
    return NextResponse.json({ error: 'Failed to update project.' }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await context.params;
    const state = await loadProjectState(session.visitorId);
    state.projects = state.projects.filter((project) => project.id !== id);

    for (const [chatId, assignedProjectId] of Object.entries(state.chatAssignments)) {
      if (assignedProjectId === id) {
        state.chatAssignments[chatId] = null;
      }
    }

    await saveProjectState(session.visitorId, state);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Failed to delete project:', error);
    return NextResponse.json({ error: 'Failed to delete project.' }, { status: 500 });
  }
}
