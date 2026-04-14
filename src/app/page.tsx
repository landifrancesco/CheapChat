'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Sidebar } from '@/features/chat/components/sidebar';
import { ChatUI } from '@/features/chat/components/chat-ui';
import { LimitsModal } from '@/features/settings/components/limits-modal';
import { SettingsModal } from '@/features/settings/components/settings-modal';
import { ChatMessage } from '@/features/chat/types';
import { AlertCircle, Loader2, RefreshCw } from 'lucide-react';

const INITIAL_LOAD_TIMEOUT_MS = 30000;
type ChatExportFormat = 'markdown' | 'pdf';

async function readJsonResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let errorMessage = `Request failed with status ${response.status}`;

    try {
      const payload = await response.json();
      if (payload && typeof payload.error === 'string') {
        errorMessage = payload.error;
      }
    } catch {
      // Ignore JSON parse errors and keep the fallback status message.
    }

    throw new Error(errorMessage);
  }

  return (await response.json()) as T;
}

function getFilenameFromDisposition(header: string | null) {
  if (!header) {
    return null;
  }

  const utf8Match = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1]);
  }

  const plainMatch = header.match(/filename="?([^"]+)"?/i);
  return plainMatch?.[1] ?? null;
}

async function downloadResponseFile(response: Response, fallbackFilename: string) {
  if (!response.ok) {
    await readJsonResponse(response);
    return;
  }

  const blob = await response.blob();
  const downloadUrl = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = downloadUrl;
  anchor.download = getFilenameFromDisposition(response.headers.get('content-disposition')) ?? fallbackFilename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(downloadUrl);
}

export default function AppShell() {
  const [chats, setChats] = useState<{ id: string; title: string; createdAt: string; projectId: string | null }[]>([]);
  const [projects, setProjects] = useState<{ id: string; name: string; instructions: string; createdAt: string }[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [activeChatMessages, setActiveChatMessages] = useState<ChatMessage[]>([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isLimitsOpen, setIsLimitsOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);
  const [exportingFormat, setExportingFormat] = useState<ChatExportFormat | null>(null);
  const [isExportingWorkspace, setIsExportingWorkspace] = useState(false);
  const createChatPromiseRef = useRef<Promise<string> | null>(null);

  const loadChats = useCallback(async () => {
    let didSoftTimeout = false;
    const slowLoadTimer = window.setTimeout(() => {
      didSoftTimeout = true;
      setLoading(false);
      setLoadError(
        'CheapChat is still waking up your workspace. Vercel cold starts or a sleepy database can take a bit longer, so the app will keep retrying in the background.'
      );
    }, INITIAL_LOAD_TIMEOUT_MS);

    try {
      const response = await fetch('/api/workspace', {
        method: 'GET',
        cache: 'no-store',
        credentials: 'same-origin',
      });

      if (!response.ok) {
        throw new Error(`Workspace API failed with status ${response.status}`);
      }

      const workspace = (await response.json()) as {
        chats: Array<{ id: string; title: string; createdAt: string; projectId: string | null }>;
        projects: Array<{ id: string; name: string; instructions?: string; createdAt: string }>;
      };
      const list = workspace.chats;
      const projectList = workspace.projects;

      const mapped = list.map((c) => ({
        id: c.id,
        title: c.title,
        createdAt: c.createdAt,
        projectId: c.projectId ?? null,
      }));
      const mappedProjects = projectList.map((project) => ({
        id: project.id,
        name: project.name,
        instructions: project.instructions ?? '',
        createdAt: project.createdAt,
      }));

      setChats(mapped);
      setProjects(mappedProjects);
      setActiveChatId((current) => (current && !mapped.some((chat) => chat.id === current) ? null : current));
      setLoadError(null);
    } catch (error) {
      console.error('Failed to load CheapChat shell data', error);
      setChats([]);
      setProjects([]);
      setActiveChatId(null);
      setActiveChatMessages([]);
      setLoadError(
        'CheapChat could not load your workspace yet. Check the Vercel function logs and database connection, then retry.'
      );
    } finally {
      window.clearTimeout(slowLoadTimer);
      if (!didSoftTimeout) {
        setLoading(false);
      }
    }
  }, []);

  const loadChatMessages = useCallback(async (id: string | null) => {
    if (!id) {
      setActiveChatMessages([]);
      return;
    }

    try {
      const response = await fetch(`/api/chats/${id}`, {
        method: 'GET',
        cache: 'no-store',
        credentials: 'same-origin',
      });
      const chatDetails = await readJsonResponse<{
        messages: Array<{
          id: string;
          role: string;
          content: string;
          model?: string | null;
          attachments?: Array<{ filename: string; mimeType: string; size: number }>;
        }>;
      }>(response);
      if (chatDetails && chatDetails.messages) {
        const mappedMsg: ChatMessage[] = chatDetails.messages.map((m: {
          id: string;
          role: string;
          content: string;
          model?: string | null;
          attachments?: Array<{ filename: string; mimeType: string; size: number }>;
        }) => ({
          id: m.id,
          role: m.role as 'user' | 'assistant' | 'system',
          metadata: {
            model: m.model ?? null,
            attachments: (m.attachments ?? []).map((attachment) => ({
              filename: attachment.filename,
              mimeType: attachment.mimeType,
              size: attachment.size,
            })),
          },
          parts: [{ type: 'text' as const, text: m.content }],
        }));
        setActiveChatMessages(mappedMsg);
        return;
      }

      setActiveChatMessages([]);
      setActiveChatId((current) => (current === id ? null : current));
    } catch (error) {
      console.error(`Failed to load chat ${id}`, error);
      setActiveChatMessages([]);
      setLoadError('This chat could not load right now. Retry in a moment.');
    }
  }, []);

  useEffect(() => {
    void loadChats();
  }, [loadChats]);

  useEffect(() => {
    void loadChatMessages(activeChatId);
  }, [activeChatId, loadChatMessages]);

  const refreshChatState = useCallback(async (id: string | null) => {
    await Promise.allSettled([loadChats(), loadChatMessages(id)]);
  }, [loadChatMessages, loadChats]);

  const handleRetryLoad = useCallback(async () => {
    setIsRetrying(true);
    try {
      await refreshChatState(activeChatId);
    } finally {
      setIsRetrying(false);
    }
  }, [activeChatId, refreshChatState]);

  useEffect(() => {
    if (!loadError || isRetrying || chats.length > 0 || projects.length > 0) {
      return;
    }

    const retryTimer = window.setTimeout(() => {
      void handleRetryLoad();
    }, 4000);

    return () => {
      window.clearTimeout(retryTimer);
    };
  }, [chats.length, handleRetryLoad, isRetrying, loadError, projects.length]);

  useEffect(() => {
    const syncState = () => {
      void refreshChatState(activeChatId);
    };

    const intervalId = window.setInterval(syncState, 8000);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        syncState();
      }
    };

    window.addEventListener('focus', syncState);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', syncState);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [activeChatId, refreshChatState]);

  const handleSelectChat = (id: string | null) => {
    setActiveChatId(id);
  };

  const handleCreateChat = async (
    modelProvider = 'routed',
    modelName = 'FAST',
    title = 'New Chat',
    projectId: string | null = null,
    mode: 'reuse-empty' | 'force-new' = 'reuse-empty'
  ) => {
    if (mode === 'reuse-empty' && activeChatId) {
      const activeChat = chats.find((chat) => chat.id === activeChatId);
      if (activeChat && activeChat.title === 'New Chat' && activeChatMessages.length === 0) {
        return activeChatId;
      }
    }

    if (createChatPromiseRef.current) {
      return createChatPromiseRef.current;
    }

    const createPromise = (async () => {
      const response = await fetch('/api/chats', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          modelProvider,
          modelName,
          title,
          projectId,
        }),
      });
      const chat = await readJsonResponse<{
        id: string;
        title: string;
        createdAt: string;
        projectId: string | null;
      }>(response);
      setChats((prev) => {
        const next = prev.filter((item) => item.id !== chat.id);
        return [{ id: chat.id, title: chat.title, createdAt: chat.createdAt, projectId: chat.projectId ?? null }, ...next];
      });
      setActiveChatId(chat.id);
      setActiveChatMessages([]);
      return chat.id;
    })();

    createChatPromiseRef.current = createPromise;

    try {
      return await createPromise;
    } finally {
      if (createChatPromiseRef.current === createPromise) {
        createChatPromiseRef.current = null;
      }
    }
  };

  const handleNewChat = async () => {
    await handleCreateChat('routed', 'FAST', 'New Chat', null, 'force-new');
  };

  const handleNewProjectChat = async (projectId: string) => {
    await handleCreateChat('routed', 'FAST', 'New Chat', projectId, 'force-new');
  };

  const handleDeleteChat = async (id: string) => {
    const response = await fetch(`/api/chats/${id}`, {
      method: 'DELETE',
      credentials: 'same-origin',
    });
    await readJsonResponse<{ ok: true }>(response);
    setChats(c => c.filter(ch => ch.id !== id));
    if (activeChatId === id) {
      setActiveChatId(null);
      setActiveChatMessages([]);
    }
    await loadChats();
  };

  const handleRenameChat = async (id: string, newTitle: string) => {
    const response = await fetch(`/api/chats/${id}`, {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title: newTitle }),
    });
    await readJsonResponse<{ ok: true }>(response);
    setChats(c => c.map(ch => ch.id === id ? { ...ch, title: newTitle } : ch));
  };

  const handleCreateProject = async (name: string) => {
    const response = await fetch('/api/projects', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name }),
    });
    const project = await readJsonResponse<{
      id: string;
      name: string;
      instructions: string;
      createdAt: string;
    }>(response);
    setProjects((prev) => [...prev, { id: project.id, name: project.name, instructions: project.instructions ?? '', createdAt: project.createdAt }]);
    return project.id;
  };

  const handleUpdateProject = async (projectId: string, updates: { name?: string; instructions?: string }) => {
    const response = await fetch(`/api/projects/${projectId}`, {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updates),
    });
    await readJsonResponse<{ ok: true }>(response);
    setProjects((prev) =>
      prev.map((project) =>
        project.id === projectId
          ? {
              ...project,
              ...(typeof updates.name === 'string' ? { name: updates.name } : {}),
              ...(typeof updates.instructions === 'string' ? { instructions: updates.instructions } : {}),
            }
          : project
      )
    );
  };

  const handleDeleteProject = async (projectId: string) => {
    const response = await fetch(`/api/projects/${projectId}`, {
      method: 'DELETE',
      credentials: 'same-origin',
    });
    await readJsonResponse<{ ok: true }>(response);
    setProjects((prev) => prev.filter((project) => project.id !== projectId));
    setChats((prev) => prev.map((chat) => (chat.projectId === projectId ? { ...chat, projectId: null } : chat)));
  };

  const handleMoveChatToProject = async (chatId: string, projectId: string | null) => {
    const response = await fetch(`/api/chats/${chatId}/project`, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ projectId }),
    });
    await readJsonResponse<{ ok: true }>(response);
    setChats((prev) => prev.map((chat) => (chat.id === chatId ? { ...chat, projectId } : chat)));
  };

  const handleSearchChats = async (query: string) => {
    const response = await fetch(`/api/chats/search?q=${encodeURIComponent(query)}`, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
    });
    const results = await readJsonResponse<
      Array<{
        id: string;
        title: string;
        createdAt: string;
        projectId: string | null;
        matchSnippet: string | null;
      }>
    >(response);

    return results.map((result) => ({
      ...result,
      createdAt: new Date(result.createdAt),
    }));
  };

  const handleExportAllData = async () => {
    setIsExportingWorkspace(true);
    try {
      const response = await fetch('/api/export', {
        method: 'GET',
        cache: 'no-store',
        credentials: 'same-origin',
      });
      await downloadResponseFile(response, 'cheapchat-export.json');
    } catch (error) {
      console.error('Failed to export CheapChat workspace', error);
      setLoadError('CheapChat could not export the workspace right now. Retry in a moment.');
    } finally {
      setIsExportingWorkspace(false);
    }
  };

  const handleExportChat = async (chatId: string, format: ChatExportFormat) => {
    setExportingFormat(format);
    try {
      const response = await fetch(`/api/chats/${chatId}/export?format=${format}`, {
        method: 'GET',
        cache: 'no-store',
        credentials: 'same-origin',
      });
      await downloadResponseFile(response, `chat-export.${format === 'pdf' ? 'pdf' : 'md'}`);
    } catch (error) {
      console.error(`Failed to export chat ${chatId} as ${format}`, error);
      setLoadError(`This chat could not be exported as ${format.toUpperCase()} right now. Retry in a moment.`);
    } finally {
      setExportingFormat(null);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-zinc-50 text-zinc-600 dark:bg-black dark:text-zinc-300">
        <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
        <p className="text-sm">Loading chats and waking up the database…</p>
      </div>
    );
  }

  return (
    <div className="flex h-dvh min-h-dvh min-w-0 w-full overflow-hidden bg-white font-sans pb-safe dark:bg-black">
      <Sidebar 
        chats={chats}
        projects={projects}
        activeChatId={activeChatId}
        onSelectChat={handleSelectChat}
        onNewChat={handleNewChat}
        onNewProjectChat={handleNewProjectChat}
        onCreateProject={handleCreateProject}
        onUpdateProject={handleUpdateProject}
        onDeleteProject={handleDeleteProject}
        onMoveChatToProject={handleMoveChatToProject}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenLimits={() => setIsLimitsOpen(true)}
        onDeleteChat={handleDeleteChat}
        onRenameChat={handleRenameChat}
        onSearchChats={handleSearchChats}
        onExportAllData={handleExportAllData}
        isExportingAllData={isExportingWorkspace}
      />
      
      <main className="relative flex min-h-0 min-w-0 flex-1">
        {loadError ? (
          <div className="absolute inset-x-3 top-3 z-20 flex flex-col items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50/95 px-4 py-3 text-sm text-amber-900 shadow-lg backdrop-blur dark:border-amber-500/30 dark:bg-amber-950/85 dark:text-amber-100 sm:flex-row">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0 flex-1">
              <p>{loadError}</p>
            </div>
            <button
              type="button"
              onClick={() => void handleRetryLoad()}
              disabled={isRetrying}
              className="inline-flex shrink-0 items-center gap-2 rounded-full border border-amber-300 bg-white/80 px-3 py-1.5 text-xs font-medium text-amber-900 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-70 dark:border-amber-400/40 dark:bg-black/30 dark:text-amber-100 dark:hover:bg-black/40"
            >
              {isRetrying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Retry
            </button>
          </div>
        ) : null}
        <ChatUI
          chatId={activeChatId}
          activeProjectId={activeChatId ? chats.find((chat) => chat.id === activeChatId)?.projectId ?? null : null}
          initialMessages={activeChatId ? activeChatMessages : []}
          onCreateChat={handleCreateChat}
          onRefreshChat={refreshChatState}
          onExportChat={handleExportChat}
          exportingFormat={exportingFormat}
        />
      </main>

      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
      <LimitsModal isOpen={isLimitsOpen} onClose={() => setIsLimitsOpen(false)} />
    </div>
  );
}
