import { NextResponse } from 'next/server';
import { buildWorkspaceExportJson, loadWorkspaceExport } from '@/features/chat/server/export';
import { getSessionFromRequest } from '@/lib/session';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const session = await getSessionFromRequest(request);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await loadWorkspaceExport(session.visitorId);
    const filename = `cheapchat-export-${new Date().toISOString().slice(0, 10)}.json`;

    return new Response(buildWorkspaceExportJson(payload), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('Failed to export workspace:', error);
    return NextResponse.json({ error: 'Failed to export workspace.' }, { status: 500 });
  }
}
