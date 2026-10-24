import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import * as oidc from 'openid-client';
import { provider, origin, callback, redis, seal, hash, secure } from '@/lib/session';
import { randomBytes } from 'node:crypto';
export async function GET(req: NextRequest) {
  try {
    const c = await provider();
    const id = randomBytes(32).toString('base64url');
    const state = oidc.randomState(),
      nonce = oidc.randomNonce(),
      verifier = oidc.randomPKCECodeVerifier();
    let returnTo = req.nextUrl.searchParams.get('returnTo') || '/';
    if (!returnTo.startsWith('/') || returnTo.startsWith('//') || returnTo.includes('\\'))
      returnTo = '/';
    await (
      await redis()
    ).set('login:' + hash(id), seal({ state, nonce, verifier, returnTo }), { EX: 300 });
    (await cookies()).set('motoros-login', id, {
      httpOnly: true,
      secure: secure(),
      sameSite: 'lax',
      path: '/',
      maxAge: 300,
    });
    const url = oidc.buildAuthorizationUrl(c, {
      redirect_uri: callback,
      scope: process.env.OIDC_SCOPES || 'openid profile email motoros.api',
      code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
      code_challenge_method: 'S256',
      state,
      nonce,
    });
    if (req.nextUrl.searchParams.get('flow') === 'register') {
      if (process.env.OIDC_PROVIDER === 'cognito') url.pathname = '/signup';
      else url.pathname = url.pathname.replace(/\/auth$/, '/registrations');
    }
    return NextResponse.redirect(url);
  } catch {
    return NextResponse.redirect(origin + '/login?error=identity-unavailable');
  }
}
