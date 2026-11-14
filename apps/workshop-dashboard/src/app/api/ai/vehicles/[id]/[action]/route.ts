import { NextRequest, NextResponse } from 'next/server';
import { destroy, issuer, origin, requireSession, SessionMissing } from '@/lib/session';

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

async function history(
  request: NextRequest,
  context: { params: Promise<{ id: string; action: string }> },
) {
  const { id, action } = await context.params;
  const allowed =
    request.method === 'POST' ? ['history-summary', 'history-feedback'] : ['history-summaries'];
  if (!allowed.includes(action) || !uuid.test(id))
    return NextResponse.json({ title: 'Unknown AI route' }, { status: 404 });
  if (request.method === 'POST' && request.headers.get('origin') !== origin)
    return NextResponse.json({ title: 'Invalid request origin' }, { status: 403 });
  const branch = request.nextUrl.searchParams.get('branchId');
  if (!branch || !uuid.test(branch))
    return NextResponse.json({ title: 'Select an authorized branch' }, { status: 400 });

  try {
    const session = await requireSession();
    if (
      !session.activeTenant ||
      session.activeTenant !== request.headers.get('X-MotorOS-Expected-Tenant')
    )
      return NextResponse.json(
        {
          title: 'Workshop context changed. Reload your workspace.',
          code: 'TENANT_CONTEXT_CHANGED',
        },
        { status: 409 },
      );
    const base = process.env.AI_ORCHESTRATOR_URL || 'http://127.0.0.1:8089';
    const key = process.env.AI_BFF_KEY;
    if (!key || key.length < 32) throw new Error('AI gateway unconfigured');
    const url = new URL(`/api/ai/vehicles/${id}/${action}`, base);
    url.searchParams.set('branchId', branch);
    if (action === 'history-feedback') {
      const summaryId = request.nextUrl.searchParams.get('summaryId');
      const helpful = request.nextUrl.searchParams.get('helpful');
      if (
        !summaryId ||
        !/^[0-9a-f]{64}$/.test(summaryId) ||
        !['true', 'false'].includes(helpful || '')
      )
        return NextResponse.json({ title: 'Invalid summary feedback' }, { status: 400 });
      url.searchParams.set('summaryId', summaryId);
      url.searchParams.set('helpful', helpful!);
    }
    const identity = new TextEncoder().encode(JSON.stringify([issuer, session.subject]));
    const digest = await crypto.subtle.digest('SHA-256', identity);
    const actor = Buffer.from(digest).toString('hex');
    const response = await fetch(url, {
      method: request.method,
      headers: {
        Authorization: 'Bearer ' + session.accessToken,
        'X-MotorOS-Tenant': session.activeTenant,
        'X-MotorOS-AI-Key': key,
        'X-MotorOS-Actor': actor,
      },
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(45000),
    });
    if (response.status === 401) await destroy();
    return NextResponse.json(await response.json(), {
      status: response.status,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const expired = error instanceof SessionMissing;
    return NextResponse.json(
      {
        title: expired
          ? 'Session expired'
          : 'Intelligence unavailable. The service timeline is still accessible.',
      },
      { status: expired ? 401 : 503 },
    );
  }
}

export { history as GET, history as POST };
