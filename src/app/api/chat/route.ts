import { UIMessage } from 'ai';
import { prisma } from '@/lib/prisma';
import { getSessionFromRequest } from '@/lib/session';
import { callRoutedLLM } from '@/lib/llm/router';
import { isSelectableFreeModel } from '@/lib/llm/catalog';
import { LLMProfile, Message } from '@/lib/llm/types';
import { assignAttachmentsToChat, getChatAttachments, syncAttachmentsToMessage } from '@/features/files/server/attachments';
import { getProjectContextForChat } from '@/features/chat/server/project-state';
import { readProviderConfig } from '@/features/settings/server/store';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Helper: extract text content from a UIMessage
function getTextFromUIMessage(msg: UIMessage): string {
  if (!msg.parts) return '';
  return msg.parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map(p => p.text)
    .join('');
}

function parseAttachmentIds(rawAttachmentIds: unknown) {
  if (Array.isArray(rawAttachmentIds)) {
    return rawAttachmentIds.filter((value): value is string => typeof value === 'string');
  }

  if (typeof rawAttachmentIds === 'string' && rawAttachmentIds.trim()) {
    try {
      const parsed = JSON.parse(rawAttachmentIds);
      return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
    } catch {
      return [];
    }
  }

  return [];
}

function buildAttachmentSystemPrompt(chatAttachments: Awaited<ReturnType<typeof getChatAttachments>>) {
  if (chatAttachments.length === 0) {
    return '';
  }

  const available = chatAttachments.filter((attachment) => attachment.status === 'available' && attachment.extractedText);
  const missing = chatAttachments.filter((attachment) => attachment.status !== 'available');
  const sections: string[] = [];
  let remainingChars = 60000;

  if (available.length > 0) {
    const fileSections = available
      .map((attachment) => {
        const excerpt = attachment.extractedText!.slice(0, Math.min(attachment.extractedText!.length, 18000, remainingChars));
        remainingChars = Math.max(remainingChars - excerpt.length, 0);
        const truncated = attachment.extractedText!.length > excerpt.length ? '\n[Content truncated for prompt budget]' : '';
        return `File: ${attachment.filename}\nStatus: available\nExtracted content:\n${excerpt}${truncated}`;
      })
      .filter(Boolean);

    if (fileSections.length > 0) {
      sections.push(`Available files in this chat:\n\n${fileSections.join('\n\n---\n\n')}`);
    }
  }

  if (missing.length > 0) {
    sections.push(
      `Files no longer available in storage:\n${missing
        .map(
          (attachment) =>
            `- ${attachment.filename} was removed from UploadThing during quota cleanup. If the user asks about it, say the file is no longer available and ask for a re-upload.`
        )
        .join('\n')}`
    );
  }

  return sections.length > 0
    ? `You are helping inside CheapChat with attachment-aware context.\n\n${sections.join('\n\n')}`
    : '';
}

function buildProjectSystemPrompt(projectContext: Awaited<ReturnType<typeof getProjectContextForChat>>) {
  if (!projectContext) {
    return '';
  }

  const sections: string[] = [`This chat belongs to the project "${projectContext.name}".`];

  if (projectContext.instructions.trim()) {
    sections.push(`Project instructions:\n${projectContext.instructions.trim().slice(0, 4000)}`);
  }

  if (projectContext.relatedChats.length > 0) {
    sections.push(
      `Related chats in this project:\n${projectContext.relatedChats
        .map((chat) => `- ${chat.title}${chat.excerpt ? `: ${chat.excerpt.replace(/\s+/g, ' ').slice(0, 220)}` : ''}`)
        .join('\n')}`
    );
  }

  return sections.join('\n\n');
}

function sanitizeGeneratedTitle(input: string) {
  return input
    .replace(/<[^>]+>/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_~>#-]/g, ' ')
    .replace(/[|[\]{}()]/g, ' ')
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/^title\s*:\s*/i, '')
    .replace(/^[A-Za-z]+\s*[:|-]\s*/g, '')
    .replace(/\b(markdown|html|title)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

function buildTitleFallback(userPrompt: string, assistantResponse: string) {
  const source = `${userPrompt} ${assistantResponse}`.trim();
  if (!source) {
    return null;
  }

  return source
    .replace(/<[^>]+>/g, ' ')
    .replace(/[`*_~>#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 5)
    .join(' ')
    .slice(0, 50)
    .trim();
}

async function tryGenerateChatTitleFromExchange(userPrompt: string, assistantResponse: string) {
  const cleanedUserPrompt = userPrompt.trim();
  const cleanedAssistantResponse = assistantResponse.trim();
  if (!cleanedUserPrompt) {
    return null;
  }

  const preferredGemini = await readProviderConfig('google');
  const directGemini =
    preferredGemini && preferredGemini.enabled && preferredGemini.apiKey
      ? { providerId: 'google', model: 'gemini-2.5-flash' }
      : undefined;

  const titleMessages: Message[] = [
    {
      role: 'system',
      content:
        'You create short chat titles. Return only one natural title in plain text, 2 to 5 words, no quotes, no markdown, no emojis, no labels, and no trailing punctuation.',
    },
    {
      role: 'user',
      content: `User request:\n${cleanedUserPrompt}\n\nAssistant response summary:\n${cleanedAssistantResponse.slice(0, 500) || 'No assistant response yet.'}`,
    },
  ];

  try {
    const titleResponse = await Promise.race([
      callRoutedLLM('FAST', titleMessages, {
        directModel: directGemini,
        maxTokens: 18,
        temperature: 0.1,
      }),
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error('Title generation timed out'));
        }, 1500);
      }),
    ]);

    const cleaned = sanitizeGeneratedTitle(titleResponse.text);
    return cleaned || buildTitleFallback(cleanedUserPrompt, cleanedAssistantResponse);
  } catch (error) {
    console.warn('Automatic chat naming failed:', error);
    return buildTitleFallback(cleanedUserPrompt, cleanedAssistantResponse);
  }
}

export async function POST(req: Request) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return new Response('Unauthorized', { status: 401 });

    const body = await req.json();
    const messages: UIMessage[] = body.messages || [];
    const chatId: string = body.chatId;
    const attachmentIds = parseAttachmentIds(body.attachmentIds);
    const replyToMessageId = typeof body.replyToMessageId === 'string' ? body.replyToMessageId : null;
    
    // Support either a direct profile or a profile inferred from selection
    let profile: LLMProfile = 'FAST';
    if (body.profile) {
      profile = body.profile;
    } else if (body.modelName?.startsWith('@profile/')) {
      profile = body.modelName.replace('@profile/', '').toUpperCase() as LLMProfile;
    }

    const lastMessage = messages[messages.length - 1];
    const lastMessageText = getTextFromUIMessage(lastMessage);
    let createdUserMessageId: string | null = null;
    let existingChatTitle: string | null = null;

    if (chatId && attachmentIds.length > 0) {
      await assignAttachmentsToChat(attachmentIds, chatId, session.visitorId);
    }

    // Save User Message to DB
    if (chatId && lastMessage && lastMessage.role === 'user') {
      const createdUserMessage = await prisma.message.create({
        data: {
          chatId,
          role: 'user',
          content: lastMessageText,
        }
      });
      createdUserMessageId = createdUserMessage.id;
    }

    if (createdUserMessageId && attachmentIds.length > 0) {
      await syncAttachmentsToMessage(createdUserMessageId, attachmentIds, session.visitorId);
    }

    const coreMessages: Message[] = messages.map(m => ({
      role: m.role as 'user' | 'assistant' | 'system',
      content: getTextFromUIMessage(m),
    }));
    const attachmentPrompt = chatId ? buildAttachmentSystemPrompt(await getChatAttachments(chatId, session.visitorId)) : '';
    let projectPrompt = '';
    if (chatId) {
      try {
        projectPrompt = buildProjectSystemPrompt(await getProjectContextForChat(chatId, session.visitorId));
      } catch (error) {
        console.error(`Failed to load project context for chat ${chatId}:`, error);
      }
    }
    const replyTargetMessage =
      replyToMessageId
        ? messages.find((message) => message.id === replyToMessageId) ??
          (chatId
            ? await prisma.message.findFirst({
                where: {
                  id: replyToMessageId,
                  chatId,
                },
              })
            : null)
        : null;
    const replyPrompt =
      replyTargetMessage
        ? `The user is replying to an earlier ${replyTargetMessage.role} message. Keep that specific message in mind while answering.\n\nReferenced message:\n${'parts' in replyTargetMessage ? getTextFromUIMessage(replyTargetMessage as UIMessage) : replyTargetMessage.content}`
        : '';
    const llmMessages: Message[] = [
      ...(projectPrompt ? [{ role: 'system' as const, content: projectPrompt }] : []),
      ...(attachmentPrompt ? [{ role: 'system' as const, content: attachmentPrompt }] : []),
      ...(replyPrompt ? [{ role: 'system' as const, content: replyPrompt }] : []),
      ...coreMessages,
    ];

    const directModelSelection =
      body.modelProvider && body.modelName
        ? {
            providerId: body.modelProvider as string,
            model: body.modelName as string,
          }
        : undefined;

    if (
      directModelSelection &&
      !isSelectableFreeModel(directModelSelection.providerId, directModelSelection.model)
    ) {
      return new Response(JSON.stringify({ error: 'Selected model is not allowed.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const chatModelProvider = directModelSelection ? directModelSelection.providerId : 'routed';
    const chatModelName = directModelSelection ? directModelSelection.model : profile;

    if (chatId) {
      const existingChat = await prisma.chat.findUnique({
        where: {
          id: chatId,
          visitorId: session.visitorId,
        },
        select: { title: true },
      });
      existingChatTitle = existingChat?.title ?? null;

      await prisma.chat.update({
        where: {
          id: chatId,
          visitorId: session.visitorId,
        },
        data: {
          modelProvider: chatModelProvider,
          modelName: chatModelName,
        },
      });
    }

    const response = await callRoutedLLM(profile, llmMessages, {
      directModel: directModelSelection,
    });

    // Save Assistant Message to DB
    if (chatId) {
      await prisma.message.create({
        data: {
          chatId,
          role: 'assistant',
          content: response.text,
          model: `${response.providerId}:${response.model}`
        }
      });

      if (existingChatTitle === 'New Chat' && lastMessageText.trim()) {
        const generatedTitle = await tryGenerateChatTitleFromExchange(lastMessageText, response.text);
        if (generatedTitle) {
          await prisma.chat.update({
            where: {
              id: chatId,
              visitorId: session.visitorId,
            },
            data: {
              title: generatedTitle,
            },
          });
        }
      }
    }

    return new Response(response.text, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
      },
    });

  } catch (error: unknown) {
    console.error('Chat API Fatal Error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Internal Server Error' }), { 
      status: 500, 
      headers: { 'Content-Type': 'application/json' } 
    });
  }
}
