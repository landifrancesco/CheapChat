# CheapChat Refactor Log

This file tracks the structural cleanup performed on 2026-04-02 so the project can be reverted manually if needed.

## File Moves

- `src/components/chat-ui.tsx` -> `src/features/chat/components/chat-ui.tsx`
- `src/components/sidebar.tsx` -> `src/features/chat/components/sidebar.tsx`
- `src/actions/chat.ts` -> `src/features/chat/server/actions.ts`
- `src/components/settings-modal.tsx` -> `src/features/settings/components/settings-modal.tsx`
- `src/components/limits-modal.tsx` -> `src/features/settings/components/limits-modal.tsx`
- `src/actions/settings.ts` -> `src/features/settings/server/actions.ts`
- `src/actions/upload.ts` -> `src/features/files/server/upload.ts`
- `src/components/theme-provider.tsx` -> `src/components/providers/theme-provider.tsx`

## Behavioral Changes In The Same Refactor

- Replaced `DefaultChatTransport` with `TextStreamChatTransport` so the chat client matches the plain-text `/api/chat` response shape.
- Removed the first-send remount issue by stopping the forced `key` reset on the chat view.
- Added explicit blank chat creation from the sidebar button.
- Updated chat metadata on send so stored chat model/provider stay aligned with the active selection.
- Added missing Cerebras and Mistral entries to the limits modal.
- Added project grouping with create/move support persisted via `AppConfig` encryption instead of a Prisma migration, because Prisma client regeneration was blocked in this sandbox.
- Reworked the chat layout to use a true flex column with a scrollable message pane so long conversations remain readable on smaller screens.
- Switched attachment uploads from a Server Action body upload to UploadThing direct uploads with an encrypted token stored in settings.
- Added UploadThing quota reporting plus automatic oldest-file eviction when storage approaches the plan limit.
- Changed chat attachment handling so files are resolved from a server-side registry per chat, and evicted files are reported back to the model as unavailable instead of being silently hallucinated from stale text.

## Quick Undo Strategy

1. Move each file back to its original path.
2. Restore the older import paths shown in the app and router files.
3. If needed, revert the chat transport from `TextStreamChatTransport` back to the previous transport in the chat UI.
