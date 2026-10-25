import { NextRequest, NextResponse } from 'next/server';
export function proxy(request: NextRequest) {
  if (
    process.env.MOTOROS_CLOUD === 'true' &&
    (/^\/(?:actuator|api\/(?:internal|automation))(?:\/|$)/.test(request.nextUrl.pathname) ||
      /^\/api\/backend\/[^/]+\/(?:internal|automation|actuator)(?:\/|$)/.test(
        request.nextUrl.pathname,
      ))
  )
    return new NextResponse(null, { status: 404 });
  if (
    process.env.MOTOROS_CLOUD === 'true' &&
    /^\/api\/backend\/[^/]+\/platform(?:\/|$)/.test(request.nextUrl.pathname) &&
    process.env.MOTOROS_PRIVATE_ADMIN !== 'true'
  )
    return new NextResponse(null, { status: 404 });
  const correlationId = crypto.randomUUID();
  const forwarded = new Headers(request.headers);
  forwarded.set('X-Correlation-ID', correlationId);
  const response = NextResponse.next({ request: { headers: forwarded } });
  response.headers.set('X-Correlation-ID', correlationId);
  if (process.env.MOTOROS_CLOUD === 'true') {
    const parts = request.nextUrl.pathname.split('/');
    const pages = new Set([
      'login',
      'jobs',
      'appointments',
      'vehicles',
      'customers',
      'inventory',
      'estimates',
      'invoices',
      'notifications',
      'reporting',
      'health',
    ]);
    const route =
      parts[1] === 'api'
        ? parts[2] === 'auth'
          ? 'auth'
          : 'backend'
        : pages.has(parts[1])
          ? parts[1]
          : 'other';
    console.info(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        severity: 'INFO',
        service: 'api-bff',
        environment: process.env.MOTOROS_ENVIRONMENT,
        correlationId,
        requestId: correlationId,
        event: 'request_received',
        method: request.method,
        route,
      }),
    );
  }
  const upload = new URL(process.env.S3_UPLOAD_ORIGIN || 'http://127.0.0.1:8333').origin;
  if (process.env.MOTOROS_CLOUD === 'true' && !upload.startsWith('https://'))
    throw new Error('HTTPS upload origin required');
  const scripts =
    process.env.NODE_ENV === 'development'
      ? "'self' 'unsafe-inline' 'unsafe-eval'"
      : "'self' 'unsafe-inline'";
  response.headers.set(
    'Content-Security-Policy',
    `default-src 'self'; script-src ${scripts}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ${upload}; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`,
  );
  if (process.env.MOTOROS_CLOUD === 'true')
    response.headers.set('Strict-Transport-Security', 'max-age=31536000');
  return response;
}
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
