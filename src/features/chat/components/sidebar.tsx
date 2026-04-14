'use client';

import { useEffect, useState } from 'react';
import {
  Activity,
  AlignLeft,
  Check,
  Download,
  Edit2,
  FolderOpen,
  FolderPlus,
  FolderTree,
  MoreHorizontal,
  PencilLine,
  LogOut,
  MessageSquare,
  Plus,
  Search,
  Settings,
  Trash2,
  X as CloseX,
} from 'lucide-react';

type ChatItem = {
  id: string;
  title: string;
  createdAt: string;
  projectId: string | null;
};

type SearchResult = {
  id: string;
  title: string;
  createdAt: Date;
  projectId: string | null;
  matchSnippet: string | null;
};

type ProjectItem = {
  id: string;
  name: string;
  instructions: string;
  createdAt: string;
};

function trimSnippet(snippet: string | null) {
  if (!snippet) return '';
  return snippet.replace(/\s+/g, ' ').trim().slice(0, 110);
}

export function Sidebar({
  chats,
  projects,
  activeChatId,
  onSelectChat,
  onNewChat,
  onNewProjectChat,
  onCreateProject,
  onUpdateProject,
  onDeleteProject,
  onMoveChatToProject,
  onOpenSettings,
  onOpenLimits,
  onDeleteChat,
  onRenameChat,
  onSearchChats,
  onExportAllData,
  isExportingAllData,
}: {
  chats: ChatItem[];
  projects: ProjectItem[];
  activeChatId: string | null;
  onSelectChat: (id: string | null) => void;
  onNewChat: () => Promise<void>;
  onNewProjectChat: (projectId: string) => Promise<void>;
  onCreateProject: (name: string) => Promise<string>;
  onUpdateProject: (projectId: string, updates: { name?: string; instructions?: string }) => Promise<void>;
  onDeleteProject: (projectId: string) => Promise<void>;
  onMoveChatToProject: (chatId: string, projectId: string | null) => Promise<void>;
  onOpenSettings: () => void;
  onOpenLimits: () => void;
  onDeleteChat: (id: string) => void | Promise<void>;
  onRenameChat: (id: string, newTitle: string) => void;
  onSearchChats: (query: string) => Promise<SearchResult[]>;
  onExportAllData: () => Promise<void>;
  isExportingAllData: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [projectPickerChatId, setProjectPickerChatId] = useState<string | null>(null);
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [projectDraftName, setProjectDraftName] = useState('');
  const [projectDraftInstructions, setProjectDraftInstructions] = useState('');
  const [isUtilityMenuOpen, setIsUtilityMenuOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function runSearch() {
      const query = searchQuery.trim();
      if (!query) {
        setSearchResults([]);
        return;
      }

      setSearching(true);
      try {
        const results = await onSearchChats(query);
        if (!cancelled) {
          setSearchResults(results);
        }
      } finally {
        if (!cancelled) {
          setSearching(false);
        }
      }
    }

    void runSearch();

    return () => {
      cancelled = true;
    };
  }, [searchQuery, onSearchChats]);

  const startEditing = (e: React.MouseEvent, chat: ChatItem) => {
    e.stopPropagation();
    setEditingId(chat.id);
    setEditTitle(chat.title);
    setProjectPickerChatId(null);
  };

  const saveRename = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    if (editingId && editTitle.trim()) {
      onRenameChat(editingId, editTitle.trim());
    }
    setEditingId(null);
  };

  const cancelRename = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(null);
  };

  const handleCreateProject = async () => {
    const normalizedName = projectName.trim();
    if (!normalizedName) return;

    await onCreateProject(normalizedName);
    setProjectName('');
    setIsCreatingProject(false);
  };

  const startProjectEditing = (project: ProjectItem) => {
    setEditingProjectId(project.id);
    setProjectDraftName(project.name);
    setProjectDraftInstructions(project.instructions ?? '');
  };

  const saveProject = async (projectId: string) => {
    await onUpdateProject(projectId, {
      name: projectDraftName.trim(),
      instructions: projectDraftInstructions.trim(),
    });
    setEditingProjectId(null);
  };

  const requestDeleteProject = async (project: ProjectItem) => {
    const confirmed = window.confirm(
      `Delete project "${project.name}"?\n\nChats inside it will stay available, but they will be moved out of the project.`
    );

    if (!confirmed) {
      return;
    }

    await onDeleteProject(project.id);
    if (editingProjectId === project.id) {
      setEditingProjectId(null);
    }
  };

  const toggleProjectPicker = (e: React.MouseEvent, chatId: string) => {
    e.stopPropagation();
    setProjectPickerChatId((current) => (current === chatId ? null : chatId));
  };

  const applyProjectMove = async (chatId: string, projectId: string | null) => {
    await onMoveChatToProject(chatId, projectId);
    setProjectPickerChatId(null);
  };

  const requestDeleteChat = async (e: React.MouseEvent, chat: ChatItem) => {
    e.stopPropagation();
    const confirmed = window.confirm(
      `Delete "${chat.title}"?\n\nThis permanently removes the chat, its messages, its saved attachments, and matching UploadThing files.`
    );

    if (!confirmed) {
      return;
    }

    await onDeleteChat(chat.id);
  };

  const renderProjectMenu = (chat: ChatItem) => (
    <div
      className="absolute left-3 right-3 top-12 z-20 rounded-2xl border border-zinc-200 bg-white p-2 shadow-xl shadow-zinc-200/70 dark:border-zinc-700 dark:bg-zinc-950 dark:shadow-black/40 sm:left-auto sm:right-3 sm:w-56"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="px-2 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-400">
        Move To Project
      </div>
      <button
        type="button"
        onClick={() => void applyProjectMove(chat.id, null)}
        className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-zinc-600 transition-colors hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
      >
        <FolderOpen className="h-4 w-4" />
        No Project
      </button>
      {projects.length === 0 ? (
        <div className="px-3 py-2 text-xs text-zinc-400">Create a project first.</div>
      ) : (
        projects.map((project) => (
          <button
            key={project.id}
            type="button"
            onClick={() => void applyProjectMove(chat.id, project.id)}
            className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-zinc-700 transition-colors hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-900"
          >
            <FolderTree className="h-4 w-4" />
            <span className="truncate">{project.name}</span>
          </button>
        ))
      )}
    </div>
  );

  const renderChatRow = (chat: ChatItem, snippet?: string | null) => (
    <div
      key={chat.id}
      className={`group relative rounded-2xl border p-3 text-sm transition-all ${
        activeChatId === chat.id
          ? 'border-zinc-300/60 bg-white shadow-sm shadow-zinc-200/50 dark:border-zinc-700 dark:bg-zinc-900'
          : 'border-transparent hover:border-zinc-200 hover:bg-white/70 dark:hover:border-zinc-800 dark:hover:bg-zinc-900/70'
      }`}
      onClick={() => {
        if (editingId !== chat.id) {
          onSelectChat(chat.id);
          setProjectPickerChatId(null);
          setIsOpen(false);
        }
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-start gap-3 overflow-hidden text-zinc-700 dark:text-zinc-300">
          <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" />
          <div className="min-w-0 flex-1">
            {editingId === chat.id ? (
              <input
                autoFocus
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveRename(e);
                  if (e.key === 'Escape') setEditingId(null);
                }}
                onClick={(e) => e.stopPropagation()}
                className="w-full rounded-xl border border-zinc-200 bg-white px-2 py-1 text-sm outline-none ring-0 transition-colors focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-950"
              />
            ) : (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectChat(chat.id);
                  setProjectPickerChatId(null);
                  setIsOpen(false);
                }}
                title={chat.title}
                className="block w-full cursor-pointer truncate pr-2 text-left font-medium text-zinc-800 transition-colors group-hover:text-black hover:underline dark:text-zinc-100 dark:group-hover:text-white"
              >
                {chat.title}
              </button>
            )}
            {snippet && <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-zinc-500">{trimSnippet(snippet)}</p>}
          </div>
        </div>

        <div className="ml-2 flex shrink-0 items-center gap-1 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100">
          {editingId === chat.id ? (
            <>
              <button onClick={saveRename} className="rounded-lg p-1.5 text-green-600 hover:bg-green-50 dark:hover:bg-green-950/30">
                <Check className="h-3.5 w-3.5" />
              </button>
              <button onClick={cancelRename} className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800">
                <CloseX className="h-3.5 w-3.5" />
              </button>
            </>
          ) : (
            <>
              <button
                onClick={(e) => toggleProjectPicker(e, chat.id)}
                className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-amber-500 dark:hover:bg-zinc-800"
                title="Move to project"
              >
                <FolderTree className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={(e) => startEditing(e, chat)}
                className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-blue-500 dark:hover:bg-zinc-800"
                title="Rename chat"
              >
                <Edit2 className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={(e) => void requestDeleteChat(e, chat)}
                className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-red-500 dark:hover:bg-zinc-800"
                title="Delete chat"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>
      </div>

      {projectPickerChatId === chat.id && renderProjectMenu(chat)}
    </div>
  );

  const ungroupedChats = chats.filter((chat) => !chat.projectId);
  const isSearching = searchQuery.trim().length > 0;

  return (
    <>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed left-4 top-[calc(var(--safe-top)+1rem)] z-40 rounded-xl border border-zinc-200 bg-white p-2 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 md:hidden"
        aria-label={isOpen ? 'Close sidebar' : 'Open sidebar'}
      >
        {isOpen ? <CloseX className="h-5 w-5" /> : <AlignLeft className="h-5 w-5" />}
      </button>

      {isOpen && <div className="fixed inset-0 z-30 bg-black/30 md:hidden" onClick={() => setIsOpen(false)} />}

      <div
        className={`fixed inset-y-0 left-0 z-30 flex h-full w-[min(20rem,calc(100vw-1rem))] max-w-[300px] flex-col border-r border-zinc-200/70 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.98),_rgba(244,244,245,0.96))] px-safe pt-[calc(var(--safe-top)+3.75rem)] backdrop-blur-xl transition-transform duration-300 ease-in-out dark:border-zinc-800 dark:bg-[radial-gradient(circle_at_top,_rgba(24,24,27,0.98),_rgba(10,10,10,0.98))] md:relative md:w-[300px] md:max-w-none md:translate-x-0 md:px-0 md:pt-0 ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="px-4 pb-3 pt-4">
          <button
            type="button"
            onClick={() => {
              onSelectChat(null);
              setProjectPickerChatId(null);
              setIsOpen(false);
            }}
            className="w-full rounded-3xl border border-zinc-200/70 bg-white/80 px-4 py-4 text-left shadow-sm transition-colors hover:bg-white dark:border-zinc-800 dark:bg-zinc-900/70 dark:hover:bg-zinc-900"
          >
            <div className="flex items-center gap-3">
              <span role="img" aria-label="terminal" className="text-lg">
                {'\u{1F4BB}'}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-bold tracking-tight text-zinc-900 dark:text-zinc-100">CheapChat</p>
                <p className="text-xs text-zinc-500">Smart routing, direct models, organized chats</p>
              </div>
            </div>
          </button>
        </div>

        <div className="px-4 pb-3">
          <button
            onClick={() => {
              void onNewChat();
              setProjectPickerChatId(null);
              setIsOpen(false);
            }}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-zinc-950 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-zinc-900/15 transition-all hover:translate-y-[-1px] hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
          >
            <Plus className="h-4 w-4" />
            New Chat
          </button>
          <button
            onClick={() => setIsCreatingProject((current) => !current)}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-2xl border border-zinc-200 bg-white/80 px-4 py-3 text-sm font-medium text-zinc-700 transition-all hover:bg-white dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-200 dark:hover:bg-zinc-900"
          >
            <FolderPlus className="h-4 w-4" />
            {isCreatingProject ? 'Close Project Form' : 'New Project'}
          </button>
          {isCreatingProject && (
            <div className="mt-2 rounded-2xl border border-zinc-200 bg-white/85 p-3 dark:border-zinc-700 dark:bg-zinc-900/80">
              <input
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    void handleCreateProject();
                  }
                }}
                placeholder="Project name"
                className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              />
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => void handleCreateProject()}
                  className="flex-1 rounded-xl bg-zinc-950 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
                >
                  Create
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsCreatingProject(false);
                    setProjectName('');
                  }}
                  className="rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="px-4 pb-3">
          <div className="flex items-center gap-2 rounded-2xl border border-zinc-200 bg-white/70 px-3 py-2.5 dark:border-zinc-800 dark:bg-zinc-900/70">
            <Search className="h-4 w-4 text-zinc-400" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search chats and topics..."
              className="w-full bg-transparent text-sm outline-none placeholder:text-zinc-400"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
              >
                <CloseX className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-3 pb-4">
          {isSearching ? (
            <div className="space-y-2">
              <div className="px-3 py-2 text-[11px] uppercase tracking-[0.2em] text-zinc-400">Search Results</div>
              {searching && <div className="px-3 text-xs text-zinc-400">Searching...</div>}
              {!searching && searchResults.length === 0 && (
                <div className="px-3 text-xs text-zinc-400">No chats matched this title or topic yet.</div>
              )}
              {searchResults.map((chat) =>
                renderChatRow(
                  {
                    id: chat.id,
                    title: chat.title,
                    createdAt: chat.createdAt.toISOString(),
                    projectId: chat.projectId,
                  },
                  chat.matchSnippet
                )
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {projects.map((project) => {
                const projectChats = chats.filter((chat) => chat.projectId === project.id);

                return (
                  <div key={project.id}>
                    <div className="mb-2 rounded-2xl border border-zinc-200/80 bg-white/70 p-3 dark:border-zinc-800 dark:bg-zinc-900/70">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-[11px] uppercase tracking-[0.2em] text-zinc-400">{project.name}</div>
                          <p className="mt-1 text-xs text-zinc-400">
                            {projectChats.length} {projectChats.length === 1 ? 'chat' : 'chats'}
                          </p>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => void onNewProjectChat(project.id)}
                            className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                            title="New chat in project"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => startProjectEditing(project)}
                            className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-blue-500 dark:hover:bg-zinc-800"
                            title="Edit project"
                          >
                            <PencilLine className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void requestDeleteProject(project)}
                            className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-red-500 dark:hover:bg-zinc-800"
                            title="Delete project"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>

                      {editingProjectId === project.id && (
                        <div className="mt-3 space-y-2">
                          <input
                            value={projectDraftName}
                            onChange={(e) => setProjectDraftName(e.target.value)}
                            placeholder="Project name"
                            className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                          />
                          <textarea
                            value={projectDraftInstructions}
                            onChange={(e) => setProjectDraftInstructions(e.target.value)}
                            placeholder="Shared instructions for all chats in this project"
                            className="min-h-[96px] w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm outline-none transition-colors focus:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                          />
                          {!projectDraftInstructions.trim() && (
                            <p className="text-xs text-zinc-400">No shared instructions yet.</p>
                          )}
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => void saveProject(project.id)}
                              className="flex-1 rounded-xl bg-zinc-950 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingProjectId(null)}
                              className="rounded-xl border border-zinc-200 px-3 py-2 text-sm text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                    {projectChats.length > 0 ? (
                      <div className="space-y-2">{projectChats.map((chat) => renderChatRow(chat))}</div>
                    ) : (
                      <div className="rounded-2xl border border-dashed border-zinc-200 px-3 py-3 text-xs text-zinc-400 dark:border-zinc-800">
                        No chats in this project yet.
                      </div>
                    )}
                  </div>
                );
              })}

              {ungroupedChats.length > 0 && (
                <div>
                  <div className="px-3 py-2 text-[11px] uppercase tracking-[0.2em] text-zinc-400">Chats</div>
                  <div className="space-y-2">{ungroupedChats.map((chat) => renderChatRow(chat))}</div>
                </div>
              )}

              {chats.length === 0 && projects.length === 0 && (
                <div className="mt-8 px-4 text-center text-xs text-zinc-400">
                  Your conversations and projects will appear here once the first prompt lands.
                </div>
              )}
            </div>
          )}
        </div>

        <div className="border-t border-zinc-200 p-3 pb-[calc(var(--safe-bottom)+0.75rem)] dark:border-zinc-800 md:pb-3">
          <div className="relative">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsUtilityMenuOpen((current) => !current)}
                className="flex min-w-0 flex-1 items-center justify-between rounded-2xl p-3 text-sm font-medium text-zinc-600 transition-colors hover:bg-white/80 dark:text-zinc-300 dark:hover:bg-zinc-900/80"
              >
                <span className="flex items-center gap-3">
                  <MoreHorizontal className="h-4 w-4" />
                  Controls
                </span>
                <CloseX className={`h-4 w-4 transition-transform ${isUtilityMenuOpen ? 'rotate-45' : 'rotate-0'}`} />
              </button>
              <form action="/api/auth/logout" method="post">
                <button
                  type="submit"
                  className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-zinc-200 bg-white/80 text-zinc-500 transition-colors hover:bg-white hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-300 dark:hover:bg-zinc-900 dark:hover:text-white"
                  title="Log out"
                  aria-label="Log out"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </form>
            </div>
            {isUtilityMenuOpen && (
              <div className="absolute bottom-14 left-0 right-0 rounded-2xl border border-zinc-200 bg-white p-2 shadow-xl shadow-zinc-200/70 dark:border-zinc-700 dark:bg-zinc-950 dark:shadow-black/40">
                <button
                  onClick={() => void onExportAllData()}
                  disabled={isExportingAllData}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60 dark:text-zinc-300 dark:hover:bg-zinc-900"
                >
                  {isExportingAllData ? <Activity className="h-4 w-4 animate-pulse" /> : <Download className="h-4 w-4" />}
                  Export All Data
                </button>
                <button
                  onClick={onOpenLimits}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
                >
                  <Activity className="h-4 w-4" />
                  Usage & Limits
                </button>
                <button
                  onClick={onOpenSettings}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900"
                >
                  <Settings className="h-4 w-4" />
                  Settings
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
