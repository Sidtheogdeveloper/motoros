import { NextResponse } from 'next/server';
import { session } from '@/lib/session';
export async function GET() {
  try {
    const s = await session();
    return NextResponse.json(
      {
        authenticated: !!s,
        expiresAt: s?.expiresAt || null,
        activeTenant: s?.activeTenant || null,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return NextResponse.json({ title: 'Session store unavailable' }, { status: 503 });
  }
}
