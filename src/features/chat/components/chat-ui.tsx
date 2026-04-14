'use client';

import { useChat } from '@ai-sdk/react';
import { TextStreamChatTransport } from 'ai';
import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Check,
  ChevronsUpDown,
  Copy,
  CornerUpLeft,
  Download,
  FileText,
  Info,
  Loader2,
  Paperclip,
  RefreshCcw,
  Send,
  StopCircle,
  X,
} from 'lucide-react';
import { useUploadThing } from '@/features/files/client/uploadthing';
import { ChatMessage } from '@/features/chat/types';
import {
  DEFAULT_CHAT_TARGET,
  getSelectableModel,
  parseChatTarget,
  PROFILE_PRIORITY,
  PROFILE_OPTIONS,
  SELECTABLE_MODEL_OPTIONS,
} from '@/lib/llm/catalog';

type ChatUIProps = {
  chatId: string | null;
  activeProjectId: string | null;
  initialMessages: ChatMessage[];
  onCreateChat: (
    modelProvider?: string,
    modelName?: string,
    title?: string,
    projectId?: string | null,
    mode?: 'reuse-empty' | 'force-new'
  ) => Promise<string>;
  onRefreshChat: (chatId: string | null) => Promise<void>;
  onExportChat: (chatId: string, format: 'markdown' | 'pdf') => Promise<void>;
  exportingFormat: 'markdown' | 'pdf' | null;
};

type PendingSubmission = {
  chatId: string;
  messageText: string;
  body: Record<string, string>;
};

type PendingAttachment = {
  localId: string;
  id: string | null;
  filename: string;
  mimeType: string;
  size: number;
  status: 'uploading' | 'finalizing' | 'available' | 'evicted' | 'failed';
  progress: number;
  error: string | null;
  file: File | null;
};

type ReplyTarget = {
  messageId: string;
  role: 'user' | 'assistant';
  excerpt: string;
};

type SelectionToolbarState = {
  text: string;
  messageId: string;
  role: 'user' | 'assistant';
  top: number;
  left: number;
};

type SelectionPromptTarget = {
  text: string;
  messageId: string;
  role: 'user' | 'assistant';
};

function getMessageText(message: ChatMessage): string {
  return message.parts
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('');
}

function formatBytes(bytes: number) {
  if (bytes <= 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

function formatAnsweredModel(model: string | null | undefined) {
  if (!model) return 'Unknown model';

  const separatorIndex = model.indexOf(':');
  if (separatorIndex === -1) {
    return model;
  }

  const providerId = model.slice(0, separatorIndex);
  const modelId = model.slice(separatorIndex + 1);
  const option = getSelectableModel(providerId, modelId);
  return option ? `${option.label} (${providerId})` : `${modelId} (${providerId})`;
}

function parseAnsweredModel(model: string | null | undefined) {
  if (!model) return null;

  const separatorIndex = model.indexOf(':');
  if (separatorIndex === -1) {
    return null;
  }

  return {
    providerId: model.slice(0, separatorIndex),
    model: model.slice(separatorIndex + 1),
  };
}

function getAttachmentStatusLabel(attachment: PendingAttachment) {
  switch (attachment.status) {
    case 'uploading':
      return `Uploading ${attachment.progress}%`;
    case 'finalizing':
      return 'Reading and indexing file...';
    case 'available':
      return 'Ready for chat';
    case 'evicted':
      return 'Stored, but already rotated out';
    case 'failed':
      return attachment.error ?? 'Upload failed';
    default:
      return 'Preparing file';
  }
}

function isReadyAttachment(attachment: PendingAttachment): attachment is PendingAttachment & { id: string } {
  return Boolean(attachment.id) && (attachment.status === 'available' || attachment.status === 'evicted');
}

function buildSelectionContext(text: string, instruction: string) {
  return `${instruction}\n\nSelected text:\n"""\n${text.trim()}\n"""`;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage: string) {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(errorMessage));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  });
}

export function ChatUI({
  chatId,
  activeProjectId,
  initialMessages,
  onCreateChat,
  onRefreshChat,
  onExportChat,
  exportingFormat,
}: ChatUIProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const selectionToolbarRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeUploadLocalIdRef = useRef<string | null>(null);
  const lastSyncedChatIdRef = useRef<string | null>(chatId);
  const shouldStickToBottomRef = useRef(true);
  const requestedScrollBehaviorRef = useRef<ScrollBehavior | null>('auto');
  const lastRenderStateRef = useRef({
    chatId,
    messageCount: initialMessages.length,
    attachmentCount: 0,
  });

  const [selectedTarget, setSelectedTarget] = useState(() => {
    if (typeof window === 'undefined') {
      return DEFAULT_CHAT_TARGET;
    }

    const savedTarget = window.localStorage.getItem('cheap-chat-target');
    if (savedTarget) {
      return savedTarget;
    }

    const savedProfile = window.localStorage.getItem('cheap-chat-profile');
    return savedProfile ? `profile:${savedProfile}` : DEFAULT_CHAT_TARGET;
  });
  const [inputValue, setInputValue] = useState('');
  const [currentChatId, setCurrentChatId] = useState(chatId);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [pendingSubmission, setPendingSubmission] = useState<PendingSubmission | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [activeInfoMessageId, setActiveInfoMessageId] = useState<string | null>(null);
  const [replyTarget, setReplyTarget] = useState<ReplyTarget | null>(null);
  const [selectionToolbar, setSelectionToolbar] = useState<SelectionToolbarState | null>(null);
  const [selectionPromptTarget, setSelectionPromptTarget] = useState<SelectionPromptTarget | null>(null);
  const [isCreatingChat, setIsCreatingChat] = useState(false);
  const [isTargetMenuOpen, setIsTargetMenuOpen] = useState(false);
  const [showSelectionInfo, setShowSelectionInfo] = useState(false);

  useEffect(() => {
    setCurrentChatId(chatId);
  }, [chatId]);

  const resolvedChatId = chatId ?? currentChatId;

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [chatId]);

  const chatTarget = useMemo(() => parseChatTarget(selectedTarget), [selectedTarget]);
  const selectableGroups = Array.from(new Set(SELECTABLE_MODEL_OPTIONS.map((option) => option.group)));
  const selectedModelOption =
    chatTarget.kind === 'model' ? getSelectableModel(chatTarget.providerId, chatTarget.model) : undefined;
  const selectedProfileOption =
    chatTarget.kind === 'profile' ? PROFILE_OPTIONS.find((option) => option.value === chatTarget.profile) : undefined;
  const currentTargetLabel =
    chatTarget.kind === 'profile' ? selectedProfileOption?.label ?? 'Smart routing' : selectedModelOption?.label ?? chatTarget.model;
  const currentTargetDescription =
    chatTarget.kind === 'profile'
      ? ''
      : selectedModelOption?.description ?? 'Direct model selection';
  const smartProfileModels =
    chatTarget.kind === 'profile'
      ? PROFILE_PRIORITY[chatTarget.profile].map((candidate) => getSelectableModel(candidate.providerId, candidate.model))
          .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
      : [];
  const readyAttachments = useMemo(() => pendingAttachments.filter(isReadyAttachment), [pendingAttachments]);
  const hasBlockingAttachmentUploads = pendingAttachments.some(
    (attachment) => attachment.status === 'uploading' || attachment.status === 'finalizing'
  );
  const hasFailedAttachments = pendingAttachments.some((attachment) => attachment.status === 'failed');

  useEffect(() => {
    if (chatTarget.kind === 'profile') {
      localStorage.setItem('cheap-chat-profile', chatTarget.profile);
    }
    localStorage.setItem('cheap-chat-target', selectedTarget);
  }, [chatTarget, selectedTarget]);

  const transport = useMemo(() => {
    const body: Record<string, string | null> = { chatId: resolvedChatId };

    if (chatTarget.kind === 'model') {
      body.modelProvider = chatTarget.providerId;
      body.modelName = chatTarget.model;
    } else {
      body.profile = chatTarget.profile;
    }

    return new TextStreamChatTransport({
      api: '/api/chat',
      body,
    });
  }, [chatTarget, resolvedChatId]);

  const { messages, status, error, sendMessage, setMessages, stop } = useChat<ChatMessage>({
    id: resolvedChatId || 'draft-chat',
    transport,
    messages: initialMessages,
    onError: (err) => {
      console.error('Chat error:', err);
    },
    onFinish: async () => {
      if (resolvedChatId) {
        await onRefreshChat(resolvedChatId);
      }
    },
  });

  const hasPendingLocalTurn = pendingSubmission !== null || status === 'submitted' || status === 'streaming';

  useEffect(() => {
    const didSwitchChats = lastSyncedChatIdRef.current !== chatId;
    lastSyncedChatIdRef.current = chatId;

    if (didSwitchChats) {
      if (!hasPendingLocalTurn || initialMessages.length > 0) {
        setMessages(initialMessages);
      }
      return;
    }

    if (initialMessages.length > 0 || !hasPendingLocalTurn) {
      setMessages(initialMessages);
    }
  }, [chatId, hasPendingLocalTurn, initialMessages, setMessages]);

  const isLoading = status === 'streaming' || status === 'submitted';
  const syncStickToBottom = useCallback(() => {
    const container = scrollRef.current;
    if (!container) {
      return;
    }

    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    shouldStickToBottomRef.current = distanceFromBottom <= 120;
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior) => {
    const container = scrollRef.current;
    if (!container) {
      return;
    }

    container.scrollTo({
      top: container.scrollHeight,
      behavior,
    });
  }, []);
  const { startUpload, isUploading: uploadingFiles } = useUploadThing('chatAttachment', {
    uploadProgressGranularity: 'fine',
    onUploadBegin: () => {
      const localId = activeUploadLocalIdRef.current;
      if (!localId) return;

      setPendingAttachments((prev) =>
        prev.map((attachment) =>
          attachment.localId === localId
            ? {
                ...attachment,
                status: 'uploading',
                progress: 1,
                error: null,
              }
            : attachment
        )
      );
    },
    onUploadProgress: (progress) => {
      const localId = activeUploadLocalIdRef.current;
      if (!localId) return;

      setPendingAttachments((prev) =>
        prev.map((attachment) => {
          if (attachment.localId !== localId) {
            return attachment;
          }

          return {
            ...attachment,
            status: progress >= 100 ? 'finalizing' : 'uploading',
            progress: Math.max(progress, attachment.progress),
            error: null,
          };
        })
      );
    },
    onUploadError: (uploadError) => {
      const localId = activeUploadLocalIdRef.current;
      if (!localId) return;

      setPendingAttachments((prev) =>
        prev.map((attachment) =>
          attachment.localId === localId
            ? {
                ...attachment,
                status: 'failed',
                progress: 0,
                error: uploadError.message || 'Failed to upload file',
              }
            : attachment
        )
      );
    },
  });

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) {
      return;
    }

    syncStickToBottom();

    const handleScroll = () => {
      syncStickToBottom();
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', handleScroll);
    };
  }, [syncStickToBottom]);

  useEffect(() => {
    requestedScrollBehaviorRef.current = 'auto';
    shouldStickToBottomRef.current = true;
    setSelectionToolbar(null);
    setSelectionPromptTarget(null);
    setReplyTarget(null);
  }, [resolvedChatId]);

  useEffect(() => {
    const previous = lastRenderStateRef.current;
    const requestedBehavior = requestedScrollBehaviorRef.current;
    const didSwitchChats = previous.chatId !== resolvedChatId;
    const messageCountChanged = previous.messageCount !== messages.length;
    const attachmentCountChanged = previous.attachmentCount !== pendingAttachments.length;
    const shouldFollowStreaming = status === 'streaming' && shouldStickToBottomRef.current;

    if (didSwitchChats && messages.length > 0) {
      scrollToBottom(requestedBehavior ?? 'auto');
    } else if (requestedBehavior) {
      scrollToBottom(requestedBehavior);
    } else if ((messageCountChanged || attachmentCountChanged || shouldFollowStreaming) && shouldStickToBottomRef.current) {
      scrollToBottom(messageCountChanged ? 'smooth' : 'auto');
    }

    requestedScrollBehaviorRef.current = null;
    lastRenderStateRef.current = {
      chatId: resolvedChatId,
      messageCount: messages.length,
      attachmentCount: pendingAttachments.length,
    };
  }, [messages.length, pendingAttachments.length, resolvedChatId, scrollToBottom, status]);

  useEffect(() => {
    if (!pendingSubmission || resolvedChatId !== pendingSubmission.chatId) {
      return;
    }

    sendMessage({ text: pendingSubmission.messageText }, { body: pendingSubmission.body });
    setPendingSubmission(null);
  }, [pendingSubmission, resolvedChatId, sendMessage]);

  const copyToClipboard = async (value: string, key: string) => {
    await navigator.clipboard.writeText(value);
    setCopiedKey(key);
    window.setTimeout(() => {
      setCopiedKey((current) => (current === key ? null : current));
    }, 1500);
  };

  const buildRequestBody = useCallback(
    (
      targetChatId: string | null,
      options?: {
        attachmentIds?: string[];
        replyToMessageId?: string | null;
        bodyOverrides?: Record<string, string>;
      }
    ) => {
      const body: Record<string, string> = { chatId: targetChatId || '' };

      if (chatTarget.kind === 'model') {
        body.modelProvider = chatTarget.providerId;
        body.modelName = chatTarget.model;
      } else {
        body.profile = chatTarget.profile;
      }

      if (options?.attachmentIds && options.attachmentIds.length > 0) {
        body.attachmentIds = JSON.stringify(options.attachmentIds);
      }

      if (options?.replyToMessageId) {
        body.replyToMessageId = options.replyToMessageId;
      }

      if (options?.bodyOverrides) {
        Object.assign(body, options.bodyOverrides);
      }

      return body;
    },
    [chatTarget]
  );

  const submitPrompt = async (
    messageText: string,
    options?: {
      bodyOverrides?: Record<string, string>;
      attachmentIds?: string[];
      replyToMessageId?: string | null;
      forceNewChat?: boolean;
      projectId?: string | null;
    }
  ) => {
    if (!messageText.trim() && (!options?.attachmentIds || options.attachmentIds.length === 0)) return;

    requestedScrollBehaviorRef.current = 'smooth';
    shouldStickToBottomRef.current = true;

    const attachmentIds = options?.attachmentIds ?? readyAttachments.map((attachment) => attachment.id);
    const replyToMessageId = options?.replyToMessageId ?? replyTarget?.messageId ?? null;
    const shouldCreateNewChat = options?.forceNewChat || !currentChatId;
    const modelProvider = chatTarget.kind === 'model' ? chatTarget.providerId : 'routed';
    const modelName = chatTarget.kind === 'model' ? chatTarget.model : chatTarget.profile;

    if (shouldCreateNewChat) {
      setIsCreatingChat(true);
      const nextChatId = await onCreateChat(
        modelProvider,
        modelName,
        'New Chat',
        options?.projectId ?? activeProjectId ?? null,
        options?.forceNewChat ? 'force-new' : 'reuse-empty'
      );
      setIsCreatingChat(false);
      setCurrentChatId(nextChatId);

      const body = buildRequestBody(nextChatId, {
        attachmentIds,
        replyToMessageId,
        bodyOverrides: options?.bodyOverrides,
      });

      setPendingSubmission({
        chatId: nextChatId,
        messageText,
        body,
      });
      setInputValue('');
      setPendingAttachments([]);
      setReplyTarget(null);
      setSelectionPromptTarget(null);
      return;
    }

    const body = buildRequestBody(currentChatId, {
      attachmentIds,
      replyToMessageId,
      bodyOverrides: options?.bodyOverrides,
    });

    sendMessage({ text: messageText }, { body });
    setInputValue('');
    setPendingAttachments([]);
    setReplyTarget(null);
    setSelectionPromptTarget(null);
  };

  const createBranchedChat = async (sourceText: string, source: 'message' | 'selection') => {
    setSelectionToolbar(null);
    const branchMessage = buildSelectionContext(
      sourceText.slice(0, 5000),
      source === 'selection'
        ? 'Start a fresh branch from this selected text in the conversation. Continue the work from here.'
        : 'Start a fresh branch from this message in the conversation. Continue the work from here.'
    );

    await submitPrompt(branchMessage, {
      forceNewChat: true,
      projectId: activeProjectId,
    });
  };

  const customSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (hasBlockingAttachmentUploads || (!inputValue.trim() && readyAttachments.length === 0 && !selectionPromptTarget)) return;

    const baseMessageText =
      inputValue.trim() ||
      (selectionPromptTarget ? 'Help me with this selected text.' : readyAttachments.length > 0 ? 'Please analyze the attached files.' : '');
    const messageText = selectionPromptTarget
      ? `${buildSelectionContext(selectionPromptTarget.text, 'Use this selected text from the current chat as context.')}\n\nQuestion:\n${baseMessageText}`
      : baseMessageText;

    await submitPrompt(messageText);
  };

  const startReplyToMessage = (message: ChatMessage) => {
    const excerpt = getMessageText(message).replace(/\s+/g, ' ').trim().slice(0, 160);
    setReplyTarget({
      messageId: message.id,
      role: message.role as 'user' | 'assistant',
      excerpt,
    });
    setSelectionPromptTarget(null);
    textareaRef.current?.focus();
  };

  const openSelectionPrompt = () => {
    if (!selectionToolbar) {
      return;
    }

    setSelectionPromptTarget({
      text: selectionToolbar.text,
      messageId: selectionToolbar.messageId,
      role: selectionToolbar.role,
    });
    setSelectionToolbar(null);
    setReplyTarget(null);
    textareaRef.current?.focus();
  };

  useEffect(() => {
    const updateSelectionToolbar = () => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
        return;
      }

      const selectedText = selection.toString().replace(/\s+/g, ' ').trim();
      if (!selectedText) {
        return;
      }

      const range = selection.getRangeAt(0);
      const commonNode =
        range.commonAncestorContainer.nodeType === Node.TEXT_NODE
          ? range.commonAncestorContainer.parentElement
          : (range.commonAncestorContainer as Element | null);
      const messageElement = commonNode instanceof Element ? (commonNode.closest('[data-message-id]') as HTMLElement | null) : null;
      const container = scrollRef.current;

      if (!container || !messageElement || !container.contains(messageElement)) {
        setSelectionToolbar(null);
        return;
      }

      const rect = range.getBoundingClientRect();

      if (rect.width === 0 && rect.height === 0) {
        return;
      }

      const rawTop = rect.top - 56;
      const rawLeft = rect.left + rect.width / 2;
      const safeLeft = Math.min(Math.max(rawLeft, 88), Math.max(window.innerWidth - 88, 88));
      const role = messageElement.dataset.messageRole === 'assistant' ? 'assistant' : 'user';

      setSelectionToolbar({
        text: selectedText.slice(0, 5000),
        messageId: messageElement.dataset.messageId ?? '',
        role,
        top: Math.max(rawTop, 12),
        left: safeLeft,
      });
    };

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (selectionToolbarRef.current?.contains(target)) {
        return;
      }

      setSelectionToolbar(null);
    };

    const handleViewportChange = () => {
      updateSelectionToolbar();
    };

    document.addEventListener('selectionchange', updateSelectionToolbar);
    document.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('resize', handleViewportChange);
    const container = scrollRef.current;
    container?.addEventListener('scroll', handleViewportChange, { passive: true });

    return () => {
      document.removeEventListener('selectionchange', updateSelectionToolbar);
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('resize', handleViewportChange);
      container?.removeEventListener('scroll', handleViewportChange);
    };
  }, [messages.length]);

  const retryWithCurrentModel = async (assistantMessageIndex: number) => {
    for (let index = assistantMessageIndex - 1; index >= 0; index -= 1) {
      const candidate = messages[index];
      if (candidate.role === 'user') {
        const text = getMessageText(candidate);
        if (text.trim()) {
          await submitPrompt(text, {
            bodyOverrides: { retryOfMessageId: messages[assistantMessageIndex].id },
          });
        }
        return;
      }
    }
  };

  const retryWithAlternativeSmartModel = async (assistantMessageIndex: number) => {
    if (chatTarget.kind !== 'profile') {
      await retryWithCurrentModel(assistantMessageIndex);
      return;
    }

    const answeredModel = parseAnsweredModel(messages[assistantMessageIndex].metadata?.model);
    const alternativeCandidates = PROFILE_PRIORITY[chatTarget.profile].filter((candidate) => {
      if (!answeredModel) {
        return true;
      }

      return !(candidate.providerId === answeredModel.providerId && candidate.model === answeredModel.model);
    });

    const randomCandidate =
      alternativeCandidates.length > 0
        ? alternativeCandidates[Math.floor(Math.random() * alternativeCandidates.length)]
        : null;

    for (let index = assistantMessageIndex - 1; index >= 0; index -= 1) {
      const candidate = messages[index];
      if (candidate.role !== 'user') {
        continue;
      }

      const text = getMessageText(candidate);
      if (!text.trim()) {
        return;
      }

      if (randomCandidate) {
        await submitPrompt(text, {
          bodyOverrides: {
            retryOfMessageId: messages[assistantMessageIndex].id,
            modelProvider: randomCandidate.providerId,
            modelName: randomCandidate.model,
          },
        });
        return;
      }

      await retryWithCurrentModel(assistantMessageIndex);
      return;
    }
  };

  const updateAttachment = (localId: string, updater: (attachment: PendingAttachment) => PendingAttachment) => {
    setPendingAttachments((prev) =>
      prev.map((attachment) => (attachment.localId === localId ? updater(attachment) : attachment))
    );
  };

  const uploadAttachment = async (attachment: PendingAttachment, attempt = 0): Promise<void> => {
    if (!attachment.file) {
      updateAttachment(attachment.localId, (current) => ({
        ...current,
        status: 'failed',
        progress: 0,
        error: 'The original file is no longer available for retry.',
      }));
      return;
    }

    activeUploadLocalIdRef.current = attachment.localId;
    updateAttachment(attachment.localId, (current) => ({
      ...current,
      status: 'uploading',
      progress: 0,
      error: null,
    }));

    try {
      const uploaded = await withTimeout(
        startUpload([attachment.file], {
          chatId: resolvedChatId ?? null,
        }),
        120000,
        'The upload took too long. Please retry the file.'
      );

      const file = uploaded?.[0];
      if (!file) {
        throw new Error('Upload did not return a file result.');
      }

      updateAttachment(attachment.localId, (current) => ({
        ...current,
        id: file.serverData.attachmentId,
        filename: file.serverData.filename,
        mimeType: file.serverData.mimeType,
        size: file.serverData.size,
        status: file.serverData.status,
        progress: 100,
        error: null,
      }));
    } catch (uploadError) {
      const message = uploadError instanceof Error ? uploadError.message : 'Failed to upload file';
      if (attempt < 1) {
        await uploadAttachment(attachment, attempt + 1);
        return;
      }

      updateAttachment(attachment.localId, (current) => ({
        ...current,
        status: 'failed',
        progress: 0,
        error: message,
      }));
    } finally {
      if (activeUploadLocalIdRef.current === attachment.localId) {
        activeUploadLocalIdRef.current = null;
      }
    }
  };

  const handleFileUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;

    const nextAttachments: PendingAttachment[] = Array.from(e.target.files).map((file) => ({
      localId: crypto.randomUUID(),
      id: null,
      filename: file.name,
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
      status: 'uploading',
      progress: 0,
      error: null,
      file,
    }));

    setPendingAttachments((prev) => [...prev, ...nextAttachments]);

    for (const attachment of nextAttachments) {
      await uploadAttachment(attachment);
    }

    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const retryAttachment = async (localId: string) => {
    const attachment = pendingAttachments.find((item) => item.localId === localId);
    if (!attachment) {
      return;
    }

    await uploadAttachment(attachment);
  };

  const removeAttachment = (localId: string) => {
    setPendingAttachments((prev) => prev.filter((attachment) => attachment.localId !== localId));
  };

  return (
    <div className="mx-auto flex h-full min-h-0 min-w-0 w-full max-w-5xl flex-col bg-white dark:bg-zinc-950">
      <div className="sticky top-0 z-10 border-b border-zinc-100 bg-white/90 pb-3 pl-[4.5rem] pr-4 pt-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90 sm:px-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsTargetMenuOpen((current) => !current)}
                className="group flex min-w-0 flex-1 items-center justify-between rounded-2xl border border-zinc-200 bg-gradient-to-b from-white to-zinc-50 px-4 py-3 text-left shadow-sm transition-all hover:border-zinc-300 hover:shadow-md dark:border-zinc-700 dark:from-zinc-900 dark:to-zinc-950 dark:hover:border-zinc-600"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">{currentTargetLabel}</p>
                  {currentTargetDescription ? (
                    <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{currentTargetDescription}</p>
                  ) : null}
                </div>
                <ChevronsUpDown className="ml-3 h-4 w-4 shrink-0 text-zinc-400 transition-colors group-hover:text-zinc-700 dark:group-hover:text-zinc-200" />
              </button>
              <button
                type="button"
                onClick={() => setShowSelectionInfo((current) => !current)}
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-zinc-200 bg-white text-zinc-600 shadow-sm transition-colors hover:bg-zinc-50 hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                title="Selected model details"
              >
                <Info className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!resolvedChatId || exportingFormat !== null}
              onClick={() => resolvedChatId && void onExportChat(resolvedChatId, 'markdown')}
              className="inline-flex h-11 items-center gap-2 rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 shadow-sm transition-colors hover:bg-zinc-50 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              title={resolvedChatId ? 'Download this conversation as Markdown' : 'Start or open a chat to export it'}
            >
              {exportingFormat === 'markdown' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
              Markdown
            </button>
            <button
              type="button"
              disabled={!resolvedChatId || exportingFormat !== null}
              onClick={() => resolvedChatId && void onExportChat(resolvedChatId, 'pdf')}
              className="inline-flex h-11 items-center gap-2 rounded-2xl border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 shadow-sm transition-colors hover:bg-zinc-50 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              title={resolvedChatId ? 'Download this conversation as PDF' : 'Start or open a chat to export it'}
            >
              {exportingFormat === 'pdf' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              PDF
            </button>
          </div>
        </div>
      </div>

      {isTargetMenuOpen && (
        <div
          className="fixed inset-0 z-30 flex items-end justify-center bg-black/20 px-4 pb-[calc(var(--safe-bottom)+1rem)] pt-[calc(var(--safe-top)+1rem)] backdrop-blur-[2px] animate-in fade-in duration-200 sm:items-start sm:py-20"
          onClick={() => setIsTargetMenuOpen(false)}
        >
          <div
            className="w-full max-w-2xl max-h-[min(88dvh,42rem)] overflow-hidden rounded-[1.75rem] border border-zinc-200 bg-white/95 shadow-2xl shadow-zinc-900/10 backdrop-blur-xl animate-in zoom-in-95 slide-in-from-top-2 duration-200 dark:border-zinc-700 dark:bg-zinc-950/95 dark:shadow-black/50 sm:rounded-[2rem]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-zinc-100 px-5 py-4 dark:border-zinc-800">
              <div>
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Choose a model target</p>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                  Smart routing stays automatic, while direct models lock this chat to one exact free model.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsTargetMenuOpen(false)}
                className="rounded-2xl border border-zinc-200 p-2 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="max-h-[calc(min(88dvh,42rem)-5.5rem)] overflow-y-auto p-3">
              <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-400">Smart Routing</div>
              <p className="px-3 pb-2 text-xs text-zinc-500 dark:text-zinc-400">
                CheapChat automatically picks from the best available free routes below.
              </p>
              <div className="space-y-1">
                {PROFILE_OPTIONS.map((option) => {
                  const value = `profile:${option.value}`;
                  const active = selectedTarget === value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => {
                        setSelectedTarget(value);
                        setIsTargetMenuOpen(false);
                      }}
                      className={`flex w-full items-center justify-between rounded-2xl px-3 py-3 text-left transition-colors ${
                        active
                          ? 'bg-zinc-950 text-white dark:bg-white dark:text-black'
                          : 'hover:bg-zinc-100 dark:hover:bg-zinc-900'
                      }`}
                    >
                      <div>
                        <p className="text-sm font-semibold">{option.label}</p>
                      </div>
                      {active && <Check className="h-4 w-4" />}
                    </button>
                  );
                })}
              </div>

              {selectableGroups.map((group) => (
                <div key={group} className="mt-3">
                  <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-400">{group}</div>
                  <div className="space-y-1">
                    {SELECTABLE_MODEL_OPTIONS.filter((option) => option.group === group).map((option) => {
                      const value = `${option.providerId}|${option.model}`;
                      const active = selectedTarget === value;

                      return (
                        <button
                          key={value}
                          type="button"
                          onClick={() => {
                            setSelectedTarget(value);
                            setIsTargetMenuOpen(false);
                          }}
                          className={`flex w-full items-center justify-between rounded-2xl px-3 py-3 text-left transition-colors ${
                            active
                              ? 'bg-zinc-950 text-white dark:bg-white dark:text-black'
                              : 'hover:bg-zinc-100 dark:hover:bg-zinc-900'
                          }`}
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold">{option.label}</p>
                            <p className={`truncate text-xs ${active ? 'text-white/70 dark:text-black/60' : 'text-zinc-500 dark:text-zinc-400'}`}>
                              {option.description}
                            </p>
                          </div>
                          {active && <Check className="h-4 w-4 shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {showSelectionInfo && (
        <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/35 px-4 pb-[calc(var(--safe-bottom)+1rem)] pt-[calc(var(--safe-top)+1rem)] backdrop-blur-sm animate-in fade-in duration-200 sm:items-start sm:py-20" onClick={() => setShowSelectionInfo(false)}>
          <div
            className="w-full max-w-2xl max-h-[88dvh] overflow-y-auto rounded-[1.75rem] border border-zinc-200 bg-white p-4 shadow-2xl animate-in zoom-in-95 slide-in-from-top-2 duration-200 dark:border-zinc-700 dark:bg-zinc-950 sm:rounded-3xl sm:p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  {chatTarget.kind === 'profile'
                    ? PROFILE_OPTIONS.find((option) => option.value === chatTarget.profile)?.label ?? 'Smart routing'
                    : selectedModelOption?.label ?? chatTarget.model}
                </p>
                <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                  {chatTarget.kind === 'profile'
                    ? 'CheapChat chooses the best available provider for this chat and keeps failover automatic.'
                    : selectedModelOption?.description ?? 'Direct model selection'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowSelectionInfo(false)}
                className="rounded-xl border border-zinc-200 p-2 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {chatTarget.kind === 'profile' ? (
                <div className="sm:col-span-3">
                  <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Can Choose From</p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {smartProfileModels.map((model) => (
                        <div key={`${model.providerId}-${model.model}`} className="rounded-xl border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950">
                          <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{model.label}</p>
                          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{model.group}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Best For</p>
                    <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-200">
                      {selectedModelOption?.bestFor ?? 'General prompting'}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Context</p>
                    <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-200">
                      {selectedModelOption?.contextWindow ?? 'Provider did not publish a numeric limit'}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Max Output</p>
                    <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-200">
                      {selectedModelOption?.maxOutputTokens ?? 'Provider did not publish a numeric limit'}
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <div ref={scrollRef} className="relative min-h-0 min-w-0 flex-1 overflow-y-auto p-4 sm:p-6">
        {selectionToolbar && (
          <div
            ref={selectionToolbarRef}
            className="pointer-events-none fixed z-40"
            style={{
              top: selectionToolbar.top,
              left: selectionToolbar.left,
              transform: 'translate(-50%, 0)',
            }}
          >
            <div
              className="pointer-events-auto flex items-center gap-2 rounded-full border border-zinc-200 bg-white/95 px-2 py-2 shadow-lg shadow-zinc-900/10 backdrop-blur dark:border-zinc-700 dark:bg-zinc-950/95"
              onMouseDown={(event) => event.preventDefault()}
            >
              <button
                type="button"
                onClick={openSelectionPrompt}
                className="rounded-full bg-black px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
              >
                Ask CheapChat
              </button>
            </div>
          </div>
        )}

        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center space-y-4 px-4 text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-zinc-100 shadow-sm dark:bg-zinc-900">
              <span className="text-3xl" role="img" aria-label="terminal">
                {'\u{1F4BB}'}
              </span>
            </div>
            <div className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-zinc-400">CheapChat</p>
              <h2 className="text-xl font-medium tracking-tight">How can I help you today?</h2>
            </div>
            <p className="max-w-sm text-sm text-zinc-500">
              Ask follow-up questions, keep working in the same chat, and attach documents so the conversation stays
              grounded in your files.
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center space-y-6">
            {messages.map((message, idx) => {
              const textContent = getMessageText(message);
              if (!textContent) return null;

                const attachmentPreviews = message.metadata?.attachments ?? [];
                const modelInfo = message.metadata?.model;
                const answeredModel = parseAnsweredModel(modelInfo);
                const hasAlternativeSmartModel =
                  chatTarget.kind === 'profile' &&
                  PROFILE_PRIORITY[chatTarget.profile].some(
                    (candidate) =>
                      !answeredModel ||
                      candidate.providerId !== answeredModel.providerId ||
                      candidate.model !== answeredModel.model
                  );
                const answeredModelLabel = modelInfo
                  ? formatAnsweredModel(modelInfo)
                  : chatTarget.kind === 'model'
                  ? `${selectedModelOption?.label ?? chatTarget.model} (direct selection)`
                  : 'Smart routing saved the answer, but the exact provider label is still syncing.';

              return (
                <div key={message.id || idx} className={`flex w-full ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    data-message-id={message.id}
                    data-message-role={message.role}
                    className={`relative w-full max-w-full break-words rounded-2xl border px-4 py-4 text-[15px] leading-relaxed shadow-sm sm:max-w-[92%] sm:px-5 lg:max-w-3xl ${
                      message.role === 'user'
                        ? 'rounded-tr-sm border-transparent bg-black text-white dark:bg-zinc-100 dark:text-black'
                        : 'rounded-tl-sm border-zinc-200 bg-[#fefefe] text-black dark:border-zinc-800 dark:bg-[#1a1a1a] dark:text-zinc-100'
                    }`}
                  >
                    {message.role === 'assistant' && (
                        <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => void retryWithCurrentModel(idx)}
                            className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white/80 px-2 py-1 text-[11px] font-medium text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900/80 dark:text-zinc-300 dark:hover:bg-zinc-800"
                            title="Try again with the current model choice"
                          >
                            <RefreshCcw className="h-3 w-3" />
                            Retry
                          </button>
                          {hasAlternativeSmartModel && (
                            <button
                              type="button"
                              onClick={() => void retryWithAlternativeSmartModel(idx)}
                              className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white/80 px-2 py-1 text-[11px] font-medium text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900/80 dark:text-zinc-300 dark:hover:bg-zinc-800"
                              title="Retry with another model from the same smart category"
                            >
                              <RefreshCcw className="h-3 w-3" />
                              Other Model
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => copyToClipboard(textContent, `message-${message.id}`)}
                          className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white/80 px-2 py-1 text-[11px] font-medium text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900/80 dark:text-zinc-300 dark:hover:bg-zinc-800"
                          title="Copy exact answer"
                        >
                          {copiedKey === `message-${message.id}` ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                          Copy
                        </button>
                        <button
                          type="button"
                          onClick={() => setActiveInfoMessageId((current) => (current === message.id ? null : message.id))}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-zinc-200 bg-white/80 text-zinc-600 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900/80 dark:text-zinc-300 dark:hover:bg-zinc-800"
                          title="Answered model"
                        >
                          <Info className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}

                    {message.role !== 'system' && (
                      <div className="mb-3 flex flex-wrap justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => startReplyToMessage(message)}
                          className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-white/70 px-2 py-1 text-[11px] font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                        >
                          <CornerUpLeft className="h-3 w-3" />
                          Reply
                        </button>
                        <button
                          type="button"
                          onClick={() => void createBranchedChat(textContent, 'message')}
                          className="inline-flex items-center rounded-full border border-zinc-200 bg-white/70 px-2 py-1 text-[11px] font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900/70 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                        >
                          Branch
                        </button>
                      </div>
                    )}

                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        p({ children }) {
                          return <p className="mb-4 last:mb-0">{children}</p>;
                        },
                        pre({ children }) {
                          return (
                            <pre className="my-4 overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-950 p-4 font-mono text-sm text-white">
                              {children}
                            </pre>
                          );
                        },
                        code({ className, children, ...props }) {
                          const match = /language-(\w+)/.exec(className || '');
                          const isInline = !match;
                          const rawCode = String(children).replace(/\n$/, '');
                          const copyKey = `code-${message.id}-${rawCode}`;

                          if (isInline) {
                            return (
                              <code
                                className="rounded-md bg-zinc-200/40 px-1.5 py-0.5 font-mono text-[13px] text-red-500 dark:bg-black/30 dark:text-pink-400"
                                {...props}
                              >
                                {children}
                              </code>
                            );
                          }

                          return (
                            <div className="my-4 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 font-mono text-sm text-white">
                              <div className="flex items-center justify-between bg-zinc-800/70 px-4 py-2 text-xs text-zinc-300">
                                <span>{match[1]}</span>
                                <button
                                  type="button"
                                  onClick={() => copyToClipboard(rawCode, copyKey)}
                                  className="inline-flex items-center gap-1 rounded-full border border-zinc-700 px-2 py-1 text-[11px] transition-colors hover:bg-zinc-700"
                                >
                                  {copiedKey === copyKey ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                                  Copy
                                </button>
                              </div>
                              <pre className="overflow-x-auto p-4">
                                <code className={className} {...props}>
                                  {children}
                                </code>
                              </pre>
                            </div>
                          );
                        },
                      }}
                    >
                      {textContent}
                    </ReactMarkdown>

                    {attachmentPreviews.length > 0 && (
                      <div className="mt-4 flex flex-wrap gap-2">
                        {attachmentPreviews.map((attachment, attachmentIndex) => (
                          <div
                            key={`${attachment.filename}-${attachmentIndex}`}
                            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs ${
                              message.role === 'user'
                                ? 'border-white/20 bg-white/10 text-white dark:border-black/20 dark:bg-black/10 dark:text-black'
                                : 'border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200'
                            }`}
                          >
                            <FileText className="h-3.5 w-3.5" />
                            <span className="max-w-[140px] truncate sm:max-w-[180px]">{attachment.filename}</span>
                            <span className="opacity-70">{formatBytes(attachment.size)}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {message.role === 'assistant' && activeInfoMessageId === message.id && (
                      <div className="mt-4 rounded-2xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
                        Answered by {answeredModelLabel}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {isLoading && messages.length > 0 && messages[messages.length - 1].role === 'user' && (
              <div className="mt-4 flex w-full justify-start">
                <div className="flex w-16 items-center justify-center gap-2 rounded-2xl rounded-tl-sm bg-zinc-100 p-3 dark:bg-zinc-900">
                  <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.3s]" />
                  <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.15s]" />
                  <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400" />
                </div>
              </div>
            )}

            {error && (
              <div className="mt-4 flex flex-col items-center space-y-2 rounded-2xl border border-red-100 bg-red-50 p-4 text-sm text-red-600 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">
                <p className="text-center font-medium">{error.message}</p>
                <button
                  onClick={() => sendMessage()}
                  className="mt-2 flex items-center gap-1.5 rounded-lg bg-red-100 px-3 py-1.5 text-xs font-semibold transition-transform active:scale-95 hover:underline dark:bg-red-900/50"
                >
                  <RefreshCcw className="h-3.5 w-3.5" /> Retry
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="shrink-0 bg-gradient-to-t from-white via-white px-4 pb-[calc(var(--safe-bottom)+1rem)] pt-4 dark:from-zinc-950 dark:via-zinc-950 sm:px-6 sm:pb-6">
        <div className="relative mx-auto w-full max-w-4xl">
          {selectionToolbar && !selectionPromptTarget && (
            <div className="mb-3 flex items-start justify-between gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Selected Text</p>
                <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-zinc-600 dark:text-zinc-300">{selectionToolbar.text}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectionToolbar(null)}
                className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {replyTarget && (
            <div className="mb-3 flex items-start justify-between gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                  Replying to {replyTarget.role === 'assistant' ? 'assistant' : 'message'}
                </p>
                <p className="mt-1 truncate text-zinc-600 dark:text-zinc-300">{replyTarget.excerpt}</p>
              </div>
              <button
                type="button"
                onClick={() => setReplyTarget(null)}
                className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {selectionPromptTarget && (
            <div className="mb-3 flex items-start justify-between gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-900">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Ask CheapChat About Selection</p>
                <p className="mt-1 truncate text-zinc-600 dark:text-zinc-300">{selectionPromptTarget.text}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectionPromptTarget(null)}
                className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {pendingAttachments.length > 0 && (
            <div className="mb-3 space-y-2 rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-950">
              <div className="flex flex-wrap gap-2">
                {pendingAttachments.map((file) => (
                  <div
                    key={file.localId}
                    className="w-full min-w-0 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-xs text-zinc-700 shadow-sm transition-all dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 sm:min-w-[220px] sm:flex-1"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <FileText className="h-3.5 w-3.5 text-blue-500" />
                          <span className="truncate font-medium">{file.filename}</span>
                        </div>
                        <p className="mt-1 text-[11px] text-zinc-400">{formatBytes(file.size)}</p>
                      </div>
                      <div className="flex items-center gap-1">
                        {file.status === 'failed' && file.file ? (
                          <button
                            type="button"
                            onClick={() => void retryAttachment(file.localId)}
                            className="rounded-full p-1.5 text-zinc-500 transition-colors hover:bg-zinc-200 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                            title="Retry upload"
                          >
                            <RefreshCcw className="h-3.5 w-3.5" />
                          </button>
                        ) : file.status === 'uploading' || file.status === 'finalizing' ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-zinc-400" />
                        ) : null}
                        <button
                          type="button"
                          disabled={file.status === 'uploading' || file.status === 'finalizing'}
                          onClick={() => removeAttachment(file.localId)}
                          className="rounded-full p-1.5 text-red-500 transition-colors hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-red-950/40"
                          title="Remove file"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                      <div
                        className={`h-full rounded-full transition-all ${
                          file.status === 'failed'
                            ? 'bg-red-500'
                            : file.status === 'evicted'
                              ? 'bg-amber-500'
                              : 'bg-emerald-500'
                        }`}
                        style={{
                          width: `${
                            file.status === 'failed'
                              ? 100
                              : Math.max(file.progress, file.status === 'available' || file.status === 'evicted' ? 100 : 6)
                          }%`,
                        }}
                      />
                    </div>

                    <div className="mt-2 flex items-center justify-between gap-2 text-[11px]">
                      <span
                        className={
                          file.status === 'failed'
                            ? 'text-red-600 dark:text-red-400'
                            : file.status === 'evicted'
                              ? 'text-amber-600 dark:text-amber-400'
                              : 'text-zinc-500 dark:text-zinc-400'
                        }
                      >
                        {getAttachmentStatusLabel(file)}
                      </span>
                      {(file.status === 'uploading' || file.status === 'finalizing') && (
                        <span className="tabular-nums text-zinc-400">{file.progress}%</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {hasBlockingAttachmentUploads && (
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  Files upload before sending, so you can see progress and wait until they are ready.
                </p>
              )}

              {hasFailedAttachments && (
                <p className="text-[11px] text-red-600 dark:text-red-400">
                  Some files failed. Retry them or remove them before sending if you need them included in the prompt.
                </p>
              )}
            </div>
          )}

          <form
            onSubmit={customSubmit}
            className="relative flex min-h-[64px] items-end overflow-hidden rounded-3xl border border-zinc-300 bg-white py-2.5 pl-3 pr-2.5 shadow-md shadow-zinc-200/50 transition-all ring-black focus-within:ring-2 dark:border-zinc-700 dark:bg-zinc-900 dark:shadow-none dark:ring-white"
          >
            <div className="flex h-full flex-col self-end pb-1.5">
              <button
                type="button"
                disabled={uploadingFiles}
                onClick={() => fileInputRef.current?.click()}
                className="rounded-full p-2 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-black disabled:opacity-50 dark:hover:bg-zinc-800 dark:hover:text-white"
                title="Attach file"
              >
                {uploadingFiles ? <Loader2 className="h-5 w-5 animate-spin" /> : <Paperclip className="h-5 w-5" />}
              </button>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileUpload}
                className="hidden"
                multiple
                accept="image/*,.pdf,.txt,.md,.csv,.xlsx,.xls,.docx,.json"
              />
            </div>

            <textarea
              ref={textareaRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  if ((inputValue.trim() || readyAttachments.length > 0 || selectionPromptTarget) && !isCreatingChat && !hasBlockingAttachmentUploads) {
                    void customSubmit();
                  }
                }
              }}
              placeholder="Message CheapChat..."
              className="max-h-[240px] min-h-[48px] flex-1 resize-none overflow-y-auto border-none bg-transparent px-3 py-2.5 text-[15px] leading-relaxed placeholder:text-zinc-400 focus:outline-none focus:ring-0 placeholder:select-none dark:text-zinc-100"
              rows={1}
              spellCheck={false}
            />

            <div className="flex h-full items-end self-end pb-1.5">
              {isLoading ? (
                <button
                  type="button"
                  onClick={() => stop()}
                  className="rounded-full bg-zinc-900 p-2.5 text-white shadow-sm transition-colors hover:bg-zinc-800 active:scale-95 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
                >
                  <StopCircle className="h-4 w-4" />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={isCreatingChat || hasBlockingAttachmentUploads || (!inputValue.trim() && readyAttachments.length === 0 && !selectionPromptTarget)}
                  className="rounded-full bg-black p-2.5 text-white shadow-sm transition-colors hover:bg-zinc-800 disabled:opacity-30 disabled:hover:bg-black active:scale-95 dark:bg-white dark:text-black dark:hover:bg-zinc-200 dark:disabled:hover:bg-white"
                >
                  <Send className="h-4 w-4" />
                </button>
              )}
            </div>
          </form>
          <div className="mt-3 px-1 text-[10px] leading-relaxed text-zinc-500 dark:text-zinc-400">
            <p>AI can be wrong; free models may store or train on submitted data.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
