import 'server-only';
import { cookies } from 'next/headers';
import { randomBytes, createHash, createCipheriv, createDecipheriv } from 'node:crypto';
import { createClient } from 'redis';
import * as oidc from 'openid-client';
export const origin = process.env.APP_ORIGIN || 'http://127.0.0.1:3000';
export const issuer = process.env.OIDC_ISSUER || 'http://127.0.0.1:8180/realms/motoros';
export const callback = origin + '/api/auth/callback';
const cookieName = 'motoros-session';
type RedisClient = ReturnType<typeof createClient>;
const globalRedis = globalThis as typeof globalThis & { motorosRedis?: Promise<RedisClient> };
export async function redis() {
  if (!globalRedis.motorosRedis) {
    globalRedis.motorosRedis = (async () => {
      const c = createClient({
        url:
          process.env.REDIS_URL ||
          `redis://:${encodeURIComponent(process.env.REDIS_PASSWORD || '')}@127.0.0.1:16379`,
        socket: { connectTimeout: 3000, reconnectStrategy: false },
      });
      c.on('error', () => {
        globalRedis.motorosRedis = undefined;
      });
      await c.connect();
      return c as RedisClient;
    })();
    globalRedis.motorosRedis.catch(() => {
      globalRedis.motorosRedis = undefined;
    });
  }
  return globalRedis.motorosRedis;
}
function key() {
  const text = process.env.SESSION_ENCRYPTION_KEY || '';
  if (!/^[a-fA-F0-9]{64}$/.test(text)) throw new Error('Session encryption is not configured');
  return Buffer.from(text, 'hex');
}
export function seal(value: unknown) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), nonce);
  return Buffer.concat([
    nonce,
    cipher.update(JSON.stringify(value), 'utf8'),
    cipher.final(),
    cipher.getAuthTag(),
  ]).toString('base64url');
}
export function unseal<T>(encoded: string): T {
  const value = Buffer.from(encoded, 'base64url');
  const c = createDecipheriv('aes-256-gcm', key(), value.subarray(0, 12));
  c.setAuthTag(value.subarray(-16));
  return JSON.parse(Buffer.concat([c.update(value.subarray(12, -16)), c.final()]).toString()) as T;
}
export const hash = (id: string) => createHash('sha256').update(id).digest('hex');
export const secure = () =>
  process.env.COOKIE_SECURE === 'true' ||
  (process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== 'false');
let configuration: Promise<oidc.Configuration> | undefined;
export function provider() {
  if (!configuration) {
    configuration = (async () => {
      const url = new URL(issuer);
      const local =
        url.protocol === 'http:' &&
        url.hostname === '127.0.0.1' &&
        process.env.OIDC_ALLOW_INSECURE_LOCAL === 'true';
      if (url.protocol !== 'https:' && !local)
        throw new Error('OIDC requires HTTPS except explicitly configured loopback development');
      const secret = process.env.OIDC_CLIENT_SECRET;
      if (!secret) throw new Error('OIDC client secret missing');
      const c = await oidc.discovery(
        url,
        process.env.OIDC_CLIENT_ID || 'motoros-bff',
        { token_endpoint_auth_method: 'client_secret_basic' },
        oidc.ClientSecretBasic(secret),
        { execute: local ? [oidc.allowInsecureRequests] : [], timeout: 10 },
      );
      oidc.enableNonRepudiationChecks(c);
      return c;
    })();
    configuration.catch(() => {
      configuration = undefined;
    });
  }
  return configuration;
}
export type AppSession = {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  accessExpiresAt: number;
  expiresAt: number;
  subject: string;
  activeTenant?: string;
};
export class SessionMissing extends Error {}
export async function save(id: string, value: AppSession) {
  const ttl = Math.floor((value.expiresAt - Date.now()) / 1000);
  if (ttl <= 0) throw new SessionMissing('Session expired');
  await (await redis()).set('session:' + hash(id), seal(value), { EX: ttl });
}
export async function createSession(
  tokens: oidc.TokenEndpointResponse & oidc.TokenEndpointResponseHelpers,
) {
  const claims = tokens.claims();
  if (!claims?.sub) throw new Error('Verified identity required');
  const id = randomBytes(32).toString('base64url');
  const value: AppSession = {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    idToken: tokens.id_token,
    accessExpiresAt: Date.now() + Number(tokens.expires_in || 300) * 1000,
    expiresAt: Date.now() + 8 * 3600000,
    subject: claims.sub,
  };
  await save(id, value);
  (await cookies()).set(cookieName, id, {
    httpOnly: true,
    secure: secure(),
    sameSite: 'lax',
    path: '/',
    maxAge: 8 * 3600,
  });
  return value;
}
export async function session() {
  const id = (await cookies()).get(cookieName)?.value;
  if (!id || !/^[A-Za-z0-9_-]{43}$/.test(id)) return null;
  const r = await redis();
  let encoded = await r.get('session:' + hash(id));
  if (!encoded) return null;
  let value: AppSession;
  try {
    value = unseal<AppSession>(encoded);
  } catch {
    await r.del('session:' + hash(id));
    return null;
  }
  if (value.expiresAt <= Date.now()) return null;
  if (value.accessExpiresAt > Date.now() + 30000) return { id, ...value };
  if (!value.refreshToken) {
    await r.del('session:' + hash(id));
    return null;
  }
  const lock = 'refresh:' + hash(id);
  const owner = randomBytes(16).toString('hex');
  if (!(await r.set(lock, owner, { NX: true, EX: 15 }))) {
    for (let i = 0; i < 60; i++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      encoded = await r.get('session:' + hash(id));
      if (!encoded) return null;
      const fresh = unseal<AppSession>(encoded);
      if (fresh.accessExpiresAt > Date.now() + 30000) return { id, ...fresh };
    }
    throw new Error('Session refresh is busy; retry');
  }
  try {
    encoded = await r.get('session:' + hash(id));
    if (!encoded) return null;
    value = unseal<AppSession>(encoded);
    if (value.accessExpiresAt <= Date.now() + 30000) {
      const tokens = await oidc.refreshTokenGrant(await provider(), value.refreshToken!);
      value = {
        ...value,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || value.refreshToken,
        idToken: tokens.id_token || value.idToken,
        accessExpiresAt: Date.now() + Number(tokens.expires_in || 300) * 1000,
      };
      const updated = await patchSession(id, {
        accessToken: value.accessToken,
        refreshToken: value.refreshToken,
        idToken: value.idToken,
        accessExpiresAt: value.accessExpiresAt,
      });
      if (!updated) return null;
      value = updated;
    }
    return { id, ...value };
  } catch {
    await r.del('session:' + hash(id));
    return null;
  } finally {
    await r.eval(
      "if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end",
      { keys: [lock], arguments: [owner] },
    );
  }
}
export async function requireSession() {
  const s = await session();
  if (!s) throw new SessionMissing('Sign in required');
  return s;
}
export async function destroy() {
  const id = (await cookies()).get(cookieName)?.value;
  if (id) await (await redis()).del('session:' + hash(id));
  (await cookies()).delete(cookieName);
}
async function patchSession(id: string, patch: Partial<AppSession>) {
  const r = await redis();
  const storage = 'session:' + hash(id);
  for (let attempt = 0; attempt < 5; attempt++) {
    const current = await r.get(storage);
    if (!current) return null;
    const value = { ...unseal<AppSession>(current), ...patch };
    const ttl = Math.floor((value.expiresAt - Date.now()) / 1000);
    if (ttl <= 0) return null;
    const changed = await r.eval(
      "if redis.call('get',KEYS[1])==ARGV[1] then redis.call('set',KEYS[1],ARGV[2],'EX',ARGV[3]);return 1 else return 0 end",
      { keys: [storage], arguments: [current, seal(value), String(ttl)] },
    );
    if (changed === 1) return value;
  }
  throw new Error('Session changed concurrently; retry');
}
export async function selectedTenant(value: AppSession & { id: string }, tenant: string) {
  if (!(await patchSession(value.id, { activeTenant: tenant })))
    throw new SessionMissing('Session expired');
}
export async function backend(
  path: string,
  s: AppSession,
  options: RequestInit = {},
  tenant = s.activeTenant,
) {
  const headers = new Headers(options.headers);
  headers.set('Authorization', 'Bearer ' + s.accessToken);
  headers.set('Content-Type', 'application/json');
  headers.set('X-Correlation-ID', randomBytes(16).toString('hex'));
  if (tenant) headers.set('X-MotorOS-Tenant', tenant);
  return fetch((process.env.TENANT_URL || 'http://127.0.0.1:8081') + '/api/' + path, {
    ...options,
    headers,
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(10000),
  });
}
