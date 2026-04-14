import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { decryptAppConfig } from '@/lib/encryption';
import { getSessionFromRequest } from '@/lib/session';

type ProjectRecord = {
  id: string;
  name: string;
  createdAt: string;
  instructions?: string;
};

type ProjectState = {
  projects: ProjectRecord[];
  chatAssignments: Record<string, string | null>;
};

function getProjectStateKey(visitorId: string) {
  return `chat_projects_${visitorId}`;
}

function defaultProjectState(): ProjectState {
  return { projects: [], chatAssignments: {} };
}

function normalizeProjectState(state: ProjectState): ProjectState {
  return {
    projects: Array.isArray(state.projects)
      ? state.projects.map((project) => ({
          ...project,
          instructions: project.instructions ?? '',
        }))
      : [],
    chatAssignments: state.chatAssignments ?? {},
  };
}

async function loadProjectState(visitorId: string): Promise<ProjectState> {
  try {
    const config = await prisma.appConfig.findUnique({
      where: { key: getProjectStateKey(visitorId) },
    });

    if (!config) {
      return defaultProjectState();
    }

    return normalizeProjectState(JSON.parse(decryptAppConfig(config.value)) as ProjectState);
  } catch (error) {
    console.error(`Failed to load project state for visitor ${visitorId}:`, error);
    return defaultProjectState();
  }
}

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const [chatResult, projectState] = await Promise.all([
      prisma.chat.findMany({
        where: { visitorId: session.visitorId },
        orderBy: { createdAt: 'desc' },
      }),
      loadProjectState(session.visitorId),
    ]);

    return NextResponse.json({
      chats: chatResult.map((chat) => ({
        id: chat.id,
        title: chat.title,
        createdAt: chat.createdAt.toISOString(),
        projectId: projectState.chatAssignments[chat.id] ?? null,
      })),
      projects: projectState.projects.map((project) => ({
        id: project.id,
        name: project.name,
        instructions: project.instructions ?? '',
        createdAt: project.createdAt,
      })),
    });
  } catch (error) {
    console.error('Workspace API error:', error);
    return NextResponse.json({ error: 'Failed to load workspace' }, { status: 500 });
  }
}
