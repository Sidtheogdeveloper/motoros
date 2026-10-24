import { NextRequest, NextResponse } from 'next/server';
import { origin, requireSession, SessionMissing, selectedTenant, backend } from '@/lib/session';
import { readLimitedBody } from '@/lib/limited-body';
export async function POST(req: NextRequest) {
  if (req.headers.get('origin') !== origin)
    return NextResponse.json({ title: 'Invalid request origin' }, { status: 403 });
  try {
    const s = await requireSession();
    const input = JSON.parse(await readLimitedBody(req.body));
    if (typeof input.tenantId !== 'string' || !/^[a-fA-F0-9-]{36}$/.test(input.tenantId))
      return NextResponse.json({ title: 'Invalid brand selection' }, { status: 400 });
    const response = await backend('me/permissions', s, {}, input.tenantId);
    if (!response.ok) return NextResponse.json(await response.json(), { status: response.status });
    await selectedTenant(s, input.tenantId);
    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json(
      { title: error instanceof SessionMissing ? 'Session expired' : 'Unable to switch brand' },
      { status: error instanceof SessionMissing ? 401 : 400 },
    );
  }
}
