import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
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
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) {
      return NextResponse.json({ error: 'Project name is required.' }, { status: 400 });
    }

    const state = await loadProjectState(session.visitorId);
    const project = {
      id: crypto.randomUUID(),
      name,
      instructions: '',
      createdAt: new Date().toISOString(),
    };

    state.projects.push(project);
    await saveProjectState(session.visitorId, state);

    return NextResponse.json(project);
  } catch (error) {
    console.error('Failed to create project:', error);
    return NextResponse.json({ error: 'Failed to create project.' }, { status: 500 });
  }
}
