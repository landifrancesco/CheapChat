'use server';

import crypto from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/session';
import { revalidatePath } from 'next/cache';
import { deleteChatAttachments } from '@/features/files/server/attachments';
import { loadProjectState, saveProjectState } from '@/features/chat/server/project-state';

type ChatSearchResult = {
  id: string;
  title: string;
  createdAt: Date;
  projectId: string | null;
  matchSnippet: string | null;
};

export async function getChats() {
  const session = await getSession();
  if (!session) return [];

  const [chats, state] = await Promise.all([
    prisma.chat.findMany({
      where: { visitorId: session.visitorId },
      orderBy: { createdAt: 'desc' },
    }),
    loadProjectState(session.visitorId),
  ]);

  return chats.map((chat) => ({
    ...chat,
    projectId: state.chatAssignments[chat.id] ?? null,
  }));
}

export async function getWorkspaceState() {
  const session = await getSession();
  if (!session) {
    return {
      chats: [] as Array<{
        id: string;
        title: string;
        createdAt: Date;
        projectId: string | null;
      }>,
      projects: [] as Array<{
        id: string;
        name: string;
        instructions: string;
        createdAt: Date;
      }>,
    };
  }

  const [chatResult, stateResult] = await Promise.allSettled([
    prisma.chat.findMany({
      where: { visitorId: session.visitorId },
      orderBy: { createdAt: 'desc' },
    }),
    loadProjectState(session.visitorId),
  ]);

  if (chatResult.status === 'rejected') {
    console.error(`Failed to load chats for visitor ${session.visitorId}:`, chatResult.reason);
  }

  if (stateResult.status === 'rejected') {
    console.error(`Failed to load project assignments for visitor ${session.visitorId}:`, stateResult.reason);
  }

  const chats = chatResult.status === 'fulfilled' ? chatResult.value : [];
  const state =
    stateResult.status === 'fulfilled'
      ? stateResult.value
      : { projects: [], chatAssignments: {} as Record<string, string | null> };

  return {
    chats: chats.map((chat) => ({
      ...chat,
      projectId: state.chatAssignments[chat.id] ?? null,
    })),
    projects: state.projects.map((project) => ({
      ...project,
      instructions: project.instructions ?? '',
      createdAt: new Date(project.createdAt),
    })),
  };
}

export async function searchChats(query: string): Promise<ChatSearchResult[]> {
  const session = await getSession();
  if (!session) return [];

  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return [];
  }

  const [chats, state] = await Promise.all([
    prisma.chat.findMany({
      where: {
        visitorId: session.visitorId,
        OR: [
          {
            title: {
              contains: normalizedQuery,
              mode: 'insensitive',
            },
          },
          {
            messages: {
              some: {
                content: {
                  contains: normalizedQuery,
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
              contains: normalizedQuery,
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

  return chats.map((chat) => ({
    id: chat.id,
    title: chat.title,
    createdAt: chat.createdAt,
    projectId: state.chatAssignments[chat.id] ?? null,
    matchSnippet: chat.messages[0]?.content ?? null,
  }));
}

export async function getProjects() {
  const session = await getSession();
  if (!session) return [];

  const state = await loadProjectState(session.visitorId);
  return state.projects.map((project) => ({
    ...project,
    instructions: project.instructions ?? '',
    createdAt: new Date(project.createdAt),
  }));
}

export async function getChatDetails(id: string) {
  const session = await getSession();
  if (!session) return null;

  const [chatResult, stateResult] = await Promise.allSettled([
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

  if (chatResult.status === 'rejected') {
    console.error(`Failed to load chat ${id} for visitor ${session.visitorId}:`, chatResult.reason);
    return null;
  }

  const chat = chatResult.value;
  const state =
    stateResult.status === 'fulfilled'
      ? stateResult.value
      : { projects: [], chatAssignments: {} as Record<string, string | null> };

  if (!chat) {
    return null;
  }

  const projectId = state.chatAssignments[id] ?? null;
  const project = projectId ? state.projects.find((item) => item.id === projectId) ?? null : null;

  return {
    ...chat,
    projectId,
    project: project
      ? {
          id: project.id,
          name: project.name,
          instructions: project.instructions ?? '',
        }
      : null,
  };
}

export async function createChat(modelProvider: string, modelName: string, title?: string, projectId?: string | null) {
  const session = await getSession();
  if (!session) throw new Error('Unauthorized');

  const chat = await prisma.chat.create({
    data: {
      visitorId: session.visitorId,
      modelProvider,
      modelName,
      title: title || 'New Chat',
    },
  });

  if (projectId) {
    const state = await loadProjectState(session.visitorId);
    state.chatAssignments[chat.id] = projectId;
    await saveProjectState(session.visitorId, state);
  }

  revalidatePath('/');
  return {
    ...chat,
    projectId: projectId || null,
  };
}

export async function renameChat(id: string, title: string) {
  const session = await getSession();
  if (!session) throw new Error('Unauthorized');

  await prisma.chat.update({
    where: {
      id,
      visitorId: session.visitorId
    },
    data: { title }
  });

  revalidatePath('/');
}

export async function deleteChat(id: string) {
  const session = await getSession();
  if (!session) throw new Error('Unauthorized');

  await deleteChatAttachments(id, session.visitorId);

  await prisma.chat.delete({
    where: {
      id,
      visitorId: session.visitorId
    }
  });

  const state = await loadProjectState(session.visitorId);
  delete state.chatAssignments[id];
  await saveProjectState(session.visitorId, state);

  revalidatePath('/');
}

export async function createProject(name: string) {
  const session = await getSession();
  if (!session) throw new Error('Unauthorized');

  const state = await loadProjectState(session.visitorId);
  const project = {
    id: crypto.randomUUID(),
    name: name.trim(),
    instructions: '',
    createdAt: new Date().toISOString(),
  };
  state.projects.push(project);
  await saveProjectState(session.visitorId, state);

  revalidatePath('/');
  return {
    ...project,
    createdAt: new Date(project.createdAt),
  };
}

export async function updateProject(projectId: string, updates: { name?: string; instructions?: string }) {
  const session = await getSession();
  if (!session) throw new Error('Unauthorized');

  const state = await loadProjectState(session.visitorId);
  state.projects = state.projects.map((project) =>
    project.id === projectId
      ? {
          ...project,
          ...(typeof updates.name === 'string' ? { name: updates.name.trim() || project.name } : {}),
          ...(typeof updates.instructions === 'string' ? { instructions: updates.instructions.trim() } : {}),
        }
      : project
  );

  await saveProjectState(session.visitorId, state);
  revalidatePath('/');
}

export async function deleteProject(projectId: string) {
  const session = await getSession();
  if (!session) throw new Error('Unauthorized');

  const state = await loadProjectState(session.visitorId);
  state.projects = state.projects.filter((project) => project.id !== projectId);

  for (const [chatId, assignedProjectId] of Object.entries(state.chatAssignments)) {
    if (assignedProjectId === projectId) {
      state.chatAssignments[chatId] = null;
    }
  }

  await saveProjectState(session.visitorId, state);
  revalidatePath('/');
}

export async function moveChatToProject(chatId: string, projectId: string | null) {
  const session = await getSession();
  if (!session) throw new Error('Unauthorized');

  const state = await loadProjectState(session.visitorId);
  state.chatAssignments[chatId] = projectId;
  await saveProjectState(session.visitorId, state);

  revalidatePath('/');
}
