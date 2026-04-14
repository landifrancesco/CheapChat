import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/session';
import { loadProjectState, saveProjectState } from '@/features/chat/server/project-state';

export const runtime = 'nodejs';

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

export async function PUT(request: Request, context: RouteContext) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await context.params;
    const body = await request.json();
    const projectId = typeof body.projectId === 'string' ? body.projectId : null;

    const state = await loadProjectState(session.visitorId);
    state.chatAssignments[id] = projectId;
    await saveProjectState(session.visitorId, state);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Failed to move chat to project:', error);
    return NextResponse.json({ error: 'Failed to move chat to project.' }, { status: 500 });
  }
}
