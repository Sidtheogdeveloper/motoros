import { NextRequest, NextResponse } from 'next/server';
import { readLimitedBody, RequestBodyError } from '@/lib/limited-body';
import { requireSession, SessionMissing, origin, destroy } from '@/lib/session';
export const dynamic = 'force-dynamic';
const endpoints: Record<string, string> = {
  inventory: process.env.INVENTORY_URL || 'http://127.0.0.1:8085',
  billing: process.env.BILLING_URL || 'http://127.0.0.1:8086',
  tenant: process.env.TENANT_URL || 'http://127.0.0.1:8081',
  customer: process.env.CUSTOMER_URL || 'http://127.0.0.1:8082',
  booking: process.env.BOOKING_URL || 'http://127.0.0.1:8084',
  workorder: process.env.WORKORDER_URL || 'http://127.0.0.1:8083',
};
async function proxy(req: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const [service, ...segments] = path;
  if (
    !Object.hasOwn(endpoints, service) ||
    !segments.length ||
    segments.some((p) => p === '..' || p.includes('/') || p.includes('\\'))
  )
    return NextResponse.json({ title: 'Unknown API route' }, { status: 404 });
  if (req.method !== 'GET' && req.headers.get('origin') !== origin)
    return NextResponse.json({ title: 'Invalid request origin' }, { status: 403 });
  try {
    if (Number(req.headers.get('content-length') || 0) > 16384)
      throw new RequestBodyError(413, 'Request too large');
    const s = await requireSession();
    const unscoped =
      service === 'tenant' &&
      ((segments.length === 1 && segments[0] === 'tenants') ||
        segments[0] === 'auth' ||
        (segments[0] === 'invitations' && segments[1] === 'accept') ||
        (segments[0] === 'me' && segments[1] === 'memberships') ||
        segments[0] === 'platform');
    if (!unscoped && req.headers.get('X-MotorOS-Expected-Tenant') !== s.activeTenant)
      return NextResponse.json(
        {
          title: 'Workshop context changed. Reload your workspace.',
          code: 'TENANT_CONTEXT_CHANGED',
        },
        { status: 409 },
      );
    const body = req.method === 'GET' ? undefined : await readLimitedBody(req.body);
    const response = await fetch(
      endpoints[service] +
        '/api/' +
        segments.map(encodeURIComponent).join('/') +
        req.nextUrl.search,
      {
        method: req.method,
        headers: {
          Authorization: 'Bearer ' + s.accessToken,
          'Content-Type': 'application/json',
          'X-Correlation-ID': crypto.randomUUID(),
        ...(req.headers.get('Idempotency-Key')?{'Idempotency-Key':req.headers.get('Idempotency-Key')!}:{}),
          ...(s.activeTenant ? { 'X-MotorOS-Tenant': s.activeTenant } : {}),
        },
        body,
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
      },
    );
    const data = await response.json();
    if (response.status === 401) await destroy();
    return NextResponse.json(data, {
      status: response.status,
      headers: {
        'Cache-Control': 'no-store',
        'X-Correlation-ID': response.headers.get('X-Correlation-ID') || '',
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        title:
          error instanceof RequestBodyError
            ? error.message
            : error instanceof SessionMissing
              ? 'Session expired'
              : 'Workshop service unavailable',
      },
      {
        status:
          error instanceof RequestBodyError
            ? error.status
            : error instanceof SessionMissing
              ? 401
              : 503,
      },
    );
  }
}
export { proxy as GET, proxy as POST, proxy as PATCH, proxy as PUT };
