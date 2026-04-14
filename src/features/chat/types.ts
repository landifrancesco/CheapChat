import { UIMessage } from 'ai';

export type ChatAttachmentPreview = {
  filename: string;
  mimeType: string;
  size: number;
};

export type ChatMessageMetadata = {
  model?: string | null;
  attachments?: ChatAttachmentPreview[];
};

export type ChatMessage = UIMessage<ChatMessageMetadata>;
