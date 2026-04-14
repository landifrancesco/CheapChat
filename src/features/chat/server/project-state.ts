import { prisma } from '@/lib/prisma';
import { decryptAppConfig, encryptAppConfig } from '@/lib/encryption';

export type ProjectRecord = {
  id: string;
  name: string;
  createdAt: string;
  instructions?: string;
};

export type ProjectState = {
  projects: ProjectRecord[];
  chatAssignments: Record<string, string | null>;
};

export type ProjectContext = {
  id: string;
  name: string;
  instructions: string;
  relatedChats: Array<{
    id: string;
    title: string;
    excerpt: string | null;
  }>;
};

export function getProjectStateKey(visitorId: string) {
  return `chat_projects_${visitorId}`;
}

export function normalizeProjectState(state: ProjectState): ProjectState {
  return {
    projects: state.projects.map((project) => ({
      ...project,
      instructions: project.instructions ?? '',
    })),
    chatAssignments: state.chatAssignments ?? {},
  };
}

export async function loadProjectState(visitorId: string): Promise<ProjectState> {
  try {
    const config = await prisma.appConfig.findUnique({
      where: { key: getProjectStateKey(visitorId) },
    });

    if (!config) {
      return { projects: [], chatAssignments: {} };
    }

    return normalizeProjectState(JSON.parse(decryptAppConfig(config.value)) as ProjectState);
  } catch (error) {
    console.error(`Failed to load project state for visitor ${visitorId}:`, error);
    return { projects: [], chatAssignments: {} };
  }
}

export async function saveProjectState(visitorId: string, state: ProjectState) {
  try {
    await prisma.appConfig.upsert({
      where: { key: getProjectStateKey(visitorId) },
      update: { value: encryptAppConfig(JSON.stringify(state)) },
      create: {
        key: getProjectStateKey(visitorId),
        value: encryptAppConfig(JSON.stringify(state)),
      },
    });
  } catch (error) {
    console.error(`Failed to save project state for visitor ${visitorId}:`, error);
  }
}

export async function getProjectContextForChat(chatId: string, visitorId: string): Promise<ProjectContext | null> {
  const state = await loadProjectState(visitorId);
  const projectId = state.chatAssignments[chatId] ?? null;
  if (!projectId) {
    return null;
  }

  const project = state.projects.find((item) => item.id === projectId);
  if (!project) {
    return null;
  }

  const relatedChatIds = Object.entries(state.chatAssignments)
    .filter(([assignedChatId, assignedProjectId]) => assignedProjectId === projectId && assignedChatId !== chatId)
    .map(([assignedChatId]) => assignedChatId);

  if (relatedChatIds.length === 0) {
    return {
      id: project.id,
      name: project.name,
      instructions: project.instructions ?? '',
      relatedChats: [],
    };
  }

  const relatedChats = await prisma.chat.findMany({
    where: {
      visitorId,
      id: { in: relatedChatIds },
    },
    orderBy: { updatedAt: 'desc' },
    take: 6,
    include: {
      messages: {
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  });

  return {
    id: project.id,
    name: project.name,
    instructions: project.instructions ?? '',
    relatedChats: relatedChats.map((chat) => ({
      id: chat.id,
      title: chat.title,
      excerpt: chat.messages[0]?.content ?? null,
    })),
  };
}
