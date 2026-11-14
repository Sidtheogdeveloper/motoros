import { NextRequest, NextResponse } from 'next/server';
import { readLimitedBody, RequestBodyError } from '@/lib/limited-body';
import { destroy, issuer, origin, requireSession, SessionMissing } from '@/lib/session';

const uuid = '[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}';
const conversation = new RegExp('^copilot/conversations/' + uuid + '$', 'i');
const action = new RegExp('^copilot/conversations/' + uuid + '/(?:archive|feedback)$', 'i');
const draft = new RegExp('^estimates/drafts/' + uuid + '$', 'i');
const applyDraft = new RegExp('^estimates/drafts/' + uuid + '/apply$', 'i');
const messageDraft = new RegExp('^communications/drafts/' + uuid + '$', 'i');
const messageAction = new RegExp('^communications/drafts/' + uuid + '/(?:approve|send)$', 'i');
const document = new RegExp('^documents/' + uuid + '$', 'i');

async function forward(request: NextRequest, context: { params: Promise<{ segments: string[] }> }) {
  const { segments } = await context.params;
  const path = segments.join('/');
  const method = request.method;
  const allowed =
    (method === 'GET' &&
      ([
        'documents',
        'copilot/conversations',
        'analytics/query-history',
        'communications/drafts',
      ].includes(path) ||
        conversation.test(path) ||
        draft.test(path))) ||
    (method === 'POST' &&
      ([
        'documents',
        'copilot/chat',
        'estimates/draft',
        'analytics/query',
        'communications/draft',
      ].includes(path) ||
        action.test(path) ||
        applyDraft.test(path) ||
        messageAction.test(path))) ||
    (method === 'PATCH' && messageDraft.test(path)) ||
    (method === 'DELETE' && document.test(path));
  if (!allowed) return NextResponse.json({ title: 'Unknown AI route' }, { status: 404 });
  if (method !== 'GET' && request.headers.get('origin') !== origin)
    return NextResponse.json({ title: 'Invalid request origin' }, { status: 403 });

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
    const key = process.env.AI_BFF_KEY;
    if (!key || key.length < 32) throw new Error('AI gateway unconfigured');
    const url = new URL(
      '/api/ai/' + path,
      process.env.AI_ORCHESTRATOR_URL || 'http://127.0.0.1:8089',
    );
    url.search = request.nextUrl.search;
    const identity = new TextEncoder().encode(JSON.stringify([issuer, session.subject]));
    const actor = Buffer.from(await crypto.subtle.digest('SHA-256', identity)).toString('hex');
    const body =
      method === 'POST' || method === 'PATCH'
        ? await readLimitedBody(request.body, path === 'documents' ? 1_410_000 : 8192)
        : undefined;
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: 'Bearer ' + session.accessToken,
        'Content-Type': 'application/json',
        'X-MotorOS-Tenant': session.activeTenant,
        'X-MotorOS-AI-Key': key,
        'X-MotorOS-Actor': actor,
      },
      body,
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(58000),
    });
    if (response.status === 401) await destroy();
    return NextResponse.json(await response.json(), {
      status: response.status,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    if (error instanceof RequestBodyError)
      return NextResponse.json({ title: error.message }, { status: error.status });
    const expired = error instanceof SessionMissing;
    return NextResponse.json(
      { title: expired ? 'Session expired' : 'MotorOS Intelligence is temporarily unavailable.' },
      { status: expired ? 401 : 503 },
    );
  }
}

export { forward as GET, forward as POST, forward as PATCH, forward as DELETE };
