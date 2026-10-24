import { NextResponse } from 'next/server';
import { requireSession, SessionMissing, backend } from '@/lib/session';
export async function GET() {
  try {
    const s = await requireSession();
    const response = await backend('auth/me', s);
    const data = await response.json();
    if (!response.ok) return NextResponse.json(data, { status: response.status });
    let context = null;
    if (s.activeTenant) {
      const decision = await backend('me/permissions', s);
      if (decision.ok) context = await decision.json();
    }
    return NextResponse.json(
      { ...data, activeTenant: s.activeTenant || null, context, expiresAt: s.expiresAt },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        title: error instanceof SessionMissing ? 'Session expired' : 'Session service unavailable',
      },
      { status: error instanceof SessionMissing ? 401 : 503 },
    );
  }
}
