import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import * as oidc from 'openid-client';
import { provider, origin, redis, hash, unseal, createSession } from '@/lib/session';
export async function GET(req: NextRequest) {
  try {
    const jar = await cookies();
    const id = jar.get('motoros-login')?.value;
    if (!id) throw new Error('Login transaction missing');
    const encrypted = await (await redis()).getDel('login:' + hash(id));
    jar.delete('motoros-login');
    if (!encrypted) throw new Error('Login transaction expired');
    const tx = unseal<{ state: string; nonce: string; verifier: string; returnTo: string }>(
      encrypted,
    );
    const c = await provider();
    const tokens = await oidc.authorizationCodeGrant(
      c,
      new URL(req.nextUrl.pathname + req.nextUrl.search, origin),
      {
        pkceCodeVerifier: tx.verifier,
        expectedState: tx.state,
        expectedNonce: tx.nonce,
        idTokenExpected: true,
      },
    );
    const info = await oidc.fetchUserInfo(c, tokens.access_token, tokens.claims()!.sub);
    if (info.email_verified !== true) return NextResponse.redirect(origin + '/verify-email');
    await createSession(tokens);
    return NextResponse.redirect(origin + tx.returnTo);
  } catch {
    return NextResponse.redirect(origin + '/login?error=login-failed');
  }
}
