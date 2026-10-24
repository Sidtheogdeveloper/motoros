import { NextRequest, NextResponse } from 'next/server';
import * as oidc from 'openid-client';
import { session, destroy, origin, provider } from '@/lib/session';
export async function POST(req: NextRequest) {
  if (req.headers.get('origin') !== origin)
    return NextResponse.json({ title: 'Invalid request origin' }, { status: 403 });
  try {
    const s = await session();
    await destroy();
    let logoutUrl = origin + '/login';
    if (s) {
      if (process.env.OIDC_PROVIDER === 'cognito') {
        const url = new URL(process.env.OIDC_LOGOUT_URL!);
        url.searchParams.set('client_id', process.env.OIDC_CLIENT_ID!);
        url.searchParams.set('logout_uri', origin + '/login');
        logoutUrl = url.toString();
      } else {
        logoutUrl = oidc
          .buildEndSessionUrl(await provider(), {
            client_id: process.env.OIDC_CLIENT_ID || 'motoros-bff',
            post_logout_redirect_uri: origin + '/login',
            ...(s.idToken ? { id_token_hint: s.idToken } : {}),
          })
          .toString();
      }
    }
    return NextResponse.json({ ok: true, logoutUrl }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ title: 'Logout unavailable. Please retry.' }, { status: 503 });
  }
}
