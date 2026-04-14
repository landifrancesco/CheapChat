import { prisma } from '@/lib/prisma';
import { loadProjectState } from '@/features/chat/server/project-state';
import { SETTINGS_PROVIDER_IDS } from '@/features/settings/server/provider-config';
import { readProviderConfig } from '@/features/settings/server/store';

type ExportAttachment = {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  createdAt: string;
  extractedText: string | null;
};

type ExportMessage = {
  id: string;
  role: string;
  content: string;
  model: string | null;
  createdAt: string;
  attachments: ExportAttachment[];
};

export type ExportProject = {
  id: string;
  name: string;
  instructions: string;
  createdAt: string;
};

export type ExportChat = {
  id: string;
  title: string;
  modelProvider: string;
  modelName: string;
  createdAt: string;
  updatedAt: string;
  projectId: string | null;
  project: ExportProject | null;
  messages: ExportMessage[];
};

export type WorkspaceExportPayload = {
  format: 'cheapchat-workspace-export';
  version: 1;
  exportedAt: string;
  visitorId: string;
  providerConfigs: Record<string, { apiKey: string; enabled: boolean } | null>;
  projects: ExportProject[];
  chats: ExportChat[];
};

type PdfTextItem = {
  kind: 'text';
  text: string;
  font: 'regular' | 'bold' | 'mono';
  size: number;
  indent?: number;
  tone?: 'body' | 'muted';
  align?: 'left' | 'center';
};

type PdfSpacerItem = {
  kind: 'spacer';
  height: number;
};

type PdfDividerItem = {
  kind: 'divider';
};

type PdfItem = PdfTextItem | PdfSpacerItem | PdfDividerItem;

function formatDisplayDate(value: Date | string) {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(typeof value === 'string' ? new Date(value) : value);
}

function formatBytes(bytes: number) {
  if (bytes <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const amount = bytes / 1024 ** exponent;
  return `${amount.toFixed(amount >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}

export function slugifyFilename(value: string, fallback: string) {
  const normalized = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();

  return normalized || fallback;
}

function mapProject(project: {
  id: string;
  name: string;
  instructions?: string;
  createdAt: string;
}): ExportProject {
  return {
    id: project.id,
    name: project.name,
    instructions: project.instructions ?? '',
    createdAt: project.createdAt,
  };
}

function mapMessage(message: {
  id: string;
  role: string;
  content: string;
  model: string | null;
  createdAt: Date;
  attachments: Array<{
    id: string;
    filename: string;
    mimeType: string;
    size: number;
    createdAt: Date;
    extractedText: string | null;
  }>;
}): ExportMessage {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    model: message.model,
    createdAt: message.createdAt.toISOString(),
    attachments: message.attachments.map((attachment) => ({
      id: attachment.id,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      size: attachment.size,
      createdAt: attachment.createdAt.toISOString(),
      extractedText: attachment.extractedText,
    })),
  };
}

function mapChat(
  chat: {
    id: string;
    title: string;
    modelProvider: string;
    modelName: string;
    createdAt: Date;
    updatedAt: Date;
    messages: Array<{
      id: string;
      role: string;
      content: string;
      model: string | null;
      createdAt: Date;
      attachments: Array<{
        id: string;
        filename: string;
        mimeType: string;
        size: number;
        createdAt: Date;
        extractedText: string | null;
      }>;
    }>;
  },
  projectsById: Map<string, ExportProject>,
  projectId: string | null
): ExportChat {
  return {
    id: chat.id,
    title: chat.title,
    modelProvider: chat.modelProvider,
    modelName: chat.modelName,
    createdAt: chat.createdAt.toISOString(),
    updatedAt: chat.updatedAt.toISOString(),
    projectId,
    project: projectId ? projectsById.get(projectId) ?? null : null,
    messages: chat.messages.map(mapMessage),
  };
}

export async function loadWorkspaceExport(visitorId: string): Promise<WorkspaceExportPayload> {
  const [projectState, chats, providerEntries] = await Promise.all([
    loadProjectState(visitorId),
    prisma.chat.findMany({
      where: { visitorId },
      orderBy: { createdAt: 'asc' },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          include: {
            attachments: {
              orderBy: { createdAt: 'asc' },
            },
          },
        },
      },
    }),
    Promise.all(
      SETTINGS_PROVIDER_IDS.map(async (provider) => [provider, await readProviderConfig(provider)] as const)
    ),
  ]);

  const projects = projectState.projects.map(mapProject);
  const projectsById = new Map(projects.map((project) => [project.id, project]));

  return {
    format: 'cheapchat-workspace-export',
    version: 1,
    exportedAt: new Date().toISOString(),
    visitorId,
    providerConfigs: Object.fromEntries(
      providerEntries.map(([provider, config]) => [
        provider,
        config
          ? {
              apiKey: config.apiKey,
              enabled: config.enabled,
            }
          : null,
      ])
    ),
    projects,
    chats: chats.map((chat) => mapChat(chat, projectsById, projectState.chatAssignments[chat.id] ?? null)),
  };
}

export async function loadChatExport(chatId: string, visitorId: string): Promise<ExportChat | null> {
  const [projectState, chat] = await Promise.all([
    loadProjectState(visitorId),
    prisma.chat.findFirst({
      where: {
        id: chatId,
        visitorId,
      },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          include: {
            attachments: {
              orderBy: { createdAt: 'asc' },
            },
          },
        },
      },
    }),
  ]);

  if (!chat) {
    return null;
  }

  const projects = projectState.projects.map(mapProject);
  const projectsById = new Map(projects.map((project) => [project.id, project]));
  return mapChat(chat, projectsById, projectState.chatAssignments[chat.id] ?? null);
}

export function buildWorkspaceExportJson(payload: WorkspaceExportPayload) {
  return JSON.stringify(payload, null, 2);
}

export function buildChatMarkdown(chat: ExportChat) {
  const lines: string[] = [
    `# ${chat.title}`,
    '',
    `- Chat ID: ${chat.id}`,
    `- Created At: ${chat.createdAt}`,
    `- Updated At: ${chat.updatedAt}`,
    `- Model Target: ${chat.modelProvider} / ${chat.modelName}`,
    `- Project: ${chat.project ? chat.project.name : 'None'}`,
  ];

  if (chat.project?.instructions) {
    lines.push(`- Project Instructions: ${chat.project.instructions.replace(/\r?\n/g, ' ')}`);
  }

  lines.push('', '## Conversation');

  for (const message of chat.messages) {
    lines.push('', `### ${message.role.toUpperCase()}`, '', `- Message ID: ${message.id}`, `- Timestamp: ${message.createdAt}`);

    if (message.model) {
      lines.push(`- Model: ${message.model}`);
    }

    if (message.attachments.length > 0) {
      lines.push('- Attachments:');
      for (const attachment of message.attachments) {
        lines.push(`  - ${attachment.filename} (${attachment.mimeType}, ${formatBytes(attachment.size)})`);
      }
    }

    lines.push('', message.content || '_No text content._');
  }

  lines.push('');
  return lines.join('\n');
}

function normalizePdfText(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/[^\x20-\x7E\n]/g, '?');
}

function escapePdfText(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function wrapText(value: string, maxChars: number) {
  const normalized = normalizePdfText(value).replace(/\r\n/g, '\n');
  const rawLines = normalized.split('\n');
  const wrapped: string[] = [];

  for (const rawLine of rawLines) {
    const line = rawLine.replace(/\t/g, '  ');
    if (!line.trim()) {
      wrapped.push('');
      continue;
    }

    const words = line.split(/\s+/);
    let current = '';

    for (const word of words) {
      if (!word) {
        continue;
      }

      if (word.length > maxChars) {
        if (current) {
          wrapped.push(current);
          current = '';
        }

        for (let index = 0; index < word.length; index += maxChars) {
          wrapped.push(word.slice(index, index + maxChars));
        }
        continue;
      }

      const next = current ? `${current} ${word}` : word;
      if (next.length > maxChars) {
        wrapped.push(current);
        current = word;
      } else {
        current = next;
      }
    }

    if (current) {
      wrapped.push(current);
    }
  }

  return wrapped;
}

function pushWrappedParagraph(
  target: PdfItem[],
  text: string,
  font: PdfTextItem['font'],
  size: number,
  maxChars: number,
  options?: Pick<PdfTextItem, 'indent' | 'tone' | 'align'>
) {
  const wrapped = wrapText(text, maxChars);
  if (wrapped.length === 0) {
    target.push({ kind: 'spacer', height: size * 0.8 });
    return;
  }

  for (const line of wrapped) {
    target.push({ kind: 'text', text: line, font, size, ...options });
  }
}

function stripInlineMarkdown(value: string) {
  return value
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt: string) => (alt ? `Image: ${alt}` : 'Image'))
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/<[^>]+>/g, '')
    .trim();
}

function buildPdfBodyItems(markdown: string) {
  const items: PdfItem[] = [];
  const sourceLines = markdown.replace(/\r\n/g, '\n').split('\n');
  let inCodeBlock = false;
  let codeLines: string[] = [];

  const flushCodeBlock = () => {
    if (codeLines.length === 0) {
      return;
    }

    items.push({ kind: 'text', text: 'Code', font: 'bold', size: 10, tone: 'muted' });
    for (const codeLine of codeLines) {
      pushWrappedParagraph(items, codeLine || ' ', 'mono', 9, 78, { indent: 16 });
    }
    items.push({ kind: 'spacer', height: 8 });
    codeLines = [];
  };

  for (const rawLine of sourceLines) {
    const trimmed = rawLine.trim();

    if (/^```/.test(trimmed)) {
      if (inCodeBlock) {
        flushCodeBlock();
      }
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(rawLine.replace(/\t/g, '  '));
      continue;
    }

    if (!trimmed) {
      items.push({ kind: 'spacer', height: 7 });
      continue;
    }

    if (/^---+$/.test(trimmed) || /^\*\*\*+$/.test(trimmed)) {
      items.push({ kind: 'divider' });
      items.push({ kind: 'spacer', height: 6 });
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      pushWrappedParagraph(items, stripInlineMarkdown(headingMatch[2]), 'bold', level <= 2 ? 12 : 11, 84);
      items.push({ kind: 'spacer', height: 4 });
      continue;
    }

    const quoteMatch = trimmed.match(/^>\s?(.*)$/);
    if (quoteMatch) {
      pushWrappedParagraph(items, `Note: ${stripInlineMarkdown(quoteMatch[1])}`, 'regular', 10, 80, {
        indent: 14,
        tone: 'muted',
      });
      continue;
    }

    const taskMatch = trimmed.match(/^[-*+]\s+\[( |x|X)\]\s+(.*)$/);
    if (taskMatch) {
      const prefix = taskMatch[1].toLowerCase() === 'x' ? 'Done' : 'Todo';
      pushWrappedParagraph(items, `${prefix}: ${stripInlineMarkdown(taskMatch[2])}`, 'regular', 10, 80, {
        indent: 12,
      });
      continue;
    }

    const orderedMatch = trimmed.match(/^(\d+)\.\s+(.*)$/);
    if (orderedMatch) {
      pushWrappedParagraph(items, `${orderedMatch[1]}) ${stripInlineMarkdown(orderedMatch[2])}`, 'regular', 10, 80, {
        indent: 12,
      });
      continue;
    }

    const unorderedMatch = trimmed.match(/^[-*+]\s+(.*)$/);
    if (unorderedMatch) {
      pushWrappedParagraph(items, `Item: ${stripInlineMarkdown(unorderedMatch[1])}`, 'regular', 10, 80, {
        indent: 12,
      });
      continue;
    }

    pushWrappedParagraph(items, stripInlineMarkdown(trimmed), 'regular', 10, 84);
  }

  if (inCodeBlock) {
    flushCodeBlock();
  }

  return items;
}

function buildChatPdfItems(chat: ExportChat) {
  const items: PdfItem[] = [];
  items.push({ kind: 'text', text: 'CheapChat Conversation Export', font: 'bold', size: 10, tone: 'muted', align: 'center' });
  items.push({ kind: 'spacer', height: 8 });
  items.push({ kind: 'text', text: chat.title, font: 'bold', size: 20, align: 'center' });
  items.push({ kind: 'spacer', height: 16 });

  const metadata = [
    `Conversation ID: ${chat.id}`,
    `Created: ${formatDisplayDate(chat.createdAt)}`,
    `Updated: ${formatDisplayDate(chat.updatedAt)}`,
    `Model target: ${chat.modelProvider} / ${chat.modelName}`,
    `Project: ${chat.project ? chat.project.name : 'None'}`,
  ];

  for (const line of metadata) {
    items.push({ kind: 'text', text: line, font: 'regular', size: 10, tone: 'muted' });
  }

  if (chat.project?.instructions) {
    items.push({ kind: 'spacer', height: 8 });
    items.push({ kind: 'text', text: 'Project Instructions', font: 'bold', size: 11 });
    pushWrappedParagraph(items, stripInlineMarkdown(chat.project.instructions), 'regular', 10, 84);
  }

  items.push({ kind: 'spacer', height: 14 });
  items.push({ kind: 'divider' });
  items.push({ kind: 'spacer', height: 12 });

  for (const [index, message] of chat.messages.entries()) {
    items.push({ kind: 'text', text: message.role === 'assistant' ? 'Assistant' : message.role === 'user' ? 'You' : 'System', font: 'bold', size: 13 });
    items.push({ kind: 'text', text: formatDisplayDate(message.createdAt), font: 'regular', size: 9, tone: 'muted' });

    if (message.model) {
      items.push({ kind: 'text', text: `Answered by ${message.model}`, font: 'regular', size: 9, tone: 'muted' });
    }

    if (message.attachments.length > 0) {
      items.push({ kind: 'spacer', height: 4 });
      for (const attachment of message.attachments) {
        pushWrappedParagraph(
          items,
          `Attachment: ${attachment.filename} (${attachment.mimeType}, ${formatBytes(attachment.size)})`,
          'regular',
          9,
          78,
          { indent: 12, tone: 'muted' }
        );
      }
    }

    items.push({ kind: 'spacer', height: 8 });
    items.push(...buildPdfBodyItems(message.content || 'No text content'));

    if (index < chat.messages.length - 1) {
      items.push({ kind: 'spacer', height: 10 });
      items.push({ kind: 'divider' });
      items.push({ kind: 'spacer', height: 10 });
    }
  }

  return items;
}

function buildPdfDocument(items: PdfItem[]) {
  const pageWidth = 612;
  const pageHeight = 792;
  const marginX = 52;
  const topY = 748;
  const bottomY = 52;

  const pages: string[] = [];
  let content: string[] = [];
  let currentY = topY;

  const flushPage = () => {
    if (content.length === 0) {
      content.push('BT /F1 11 Tf 52 748 Td () Tj ET');
    }
    pages.push(content.join('\n'));
    content = [];
    currentY = topY;
  };

  for (const item of items) {
    if (item.kind === 'spacer') {
      currentY -= item.height;
      continue;
    }

    if (item.kind === 'divider') {
      if (currentY - 16 < bottomY) {
        flushPage();
      }
      content.push(`0.82 G 1 w ${marginX} ${currentY} m ${pageWidth - marginX} ${currentY} l S`);
      currentY -= 14;
      continue;
    }

    const indent = item.indent ?? 0;
    const maxChars = Math.max(28, Math.floor((pageWidth - marginX * 2 - indent) / (item.font === 'mono' ? 6.2 : 5.4)));
    const wrapped = wrapText(item.text, maxChars);
    const fontName = item.font === 'bold' ? 'F2' : item.font === 'mono' ? 'F3' : 'F1';
    const lineHeight = item.size + 5;
    const colorCommand = item.tone === 'muted' ? '0.38 g' : '0 g';

    for (const line of wrapped) {
      if (currentY - lineHeight < bottomY) {
        flushPage();
      }

      const approximateWidth = line.length * (item.font === 'mono' ? item.size * 0.56 : item.size * 0.5);
      const x =
        item.align === 'center'
          ? Math.max(marginX, (pageWidth - approximateWidth) / 2)
          : marginX + indent;
      content.push(`BT ${colorCommand} /${fontName} ${item.size} Tf ${x.toFixed(2)} ${currentY} Td (${escapePdfText(line)}) Tj ET`);
      currentY -= lineHeight;
    }
  }

  flushPage();

  let nextId = 6;
  const pageObjectIds: number[] = [];
  const contentObjectIds: number[] = [];

  for (let index = 0; index < pages.length; index += 1) {
    contentObjectIds.push(nextId);
    nextId += 1;
    pageObjectIds.push(nextId);
    nextId += 1;
  }

  const objects = new Map<number, string>();
  objects.set(1, '<< /Type /Catalog /Pages 2 0 R >>');
  objects.set(2, `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageObjectIds.length} >>`);
  objects.set(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  objects.set(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  objects.set(5, '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>');

  for (let index = 0; index < pages.length; index += 1) {
    const contentId = contentObjectIds[index];
    const pageId = pageObjectIds[index];
    const footer = `BT 0.45 g /F1 9 Tf ${(pageWidth / 2 - 24).toFixed(2)} 26 Td (${escapePdfText(`Page ${index + 1} of ${pages.length}`)}) Tj ET`;
    const stream = `${pages[index]}\n${footer}`;
    const length = Buffer.byteLength(stream, 'utf8');

    objects.set(contentId, `<< /Length ${length} >>\nstream\n${stream}\nendstream`);
    objects.set(
      pageId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents ${contentId} 0 R >>`
    );
  }

  const totalObjects = nextId - 1;
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];

  for (let id = 1; id <= totalObjects; id += 1) {
    offsets[id] = Buffer.byteLength(pdf, 'utf8');
    pdf += `${id} 0 obj\n${objects.get(id)}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${totalObjects + 1}\n`;
  pdf += '0000000000 65535 f \n';

  for (let id = 1; id <= totalObjects; id += 1) {
    pdf += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  }

  pdf += `trailer\n<< /Size ${totalObjects + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, 'utf8');
}

export function buildChatPdf(chat: ExportChat) {
  return buildPdfDocument(buildChatPdfItems(chat));
}
