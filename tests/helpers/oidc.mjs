import { readFileSync, existsSync } from 'node:fs';
import { randomBytes, createHash, createCipheriv, createDecipheriv } from 'node:crypto';
import { createClient } from 'redis';
import { admin } from '../../scripts/oidc-admin.mjs';
import { loadEnv } from '../../scripts/env.mjs';
export const fixtures = existsSync('.runtime/m2-fixtures.json')
  ? JSON.parse(readFileSync('.runtime/m2-fixtures.json', 'utf8'))
  : [];
export const origin = 'http://127.0.0.1:3000';
export async function createIdentity(prefix) {
  const email = `${prefix}-${randomBytes(6).toString('hex')}@example.test`;
  const password = 'Fixture-' + randomBytes(18).toString('base64url') + 'aA1!';
  await admin('motoros/users', 'POST', {
    username: email,
    email,
    emailVerified: true,
    enabled: true,
    firstName: prefix,
    lastName: 'Fixture',
    credentials: [{ type: 'password', value: password, temporary: false }],
  });
  const [user] = await admin('motoros/users?exact=true&email=' + encodeURIComponent(email));
  return { email, password, subject: user.id };
}
export async function signIn(page, user) {
  await page.goto(origin + '/login');
  await page.getByRole('link', { name: 'Sign in securely' }).click();
  await page.locator('input[name="username"]').fill(user.email);
  await page.locator('input[name="password"]').fill(user.password);
  const restored = page.waitForResponse((r) => r.url().endsWith('/api/auth/me'));
  await page.locator('#kc-login').click();
  await page.waitForURL(origin + '/');
  await restored;
}
export async function select(context, tenantId) {
  const r = await context.request.post(origin + '/api/context', {
    headers: { Origin: origin },
    data: { tenantId },
  });
  if (!r.ok()) throw new Error(`Brand selection failed (${r.status()})`);
  return r.json();
}
export async function call(context, path, { method = 'GET', data, tenant, key=crypto.randomUUID() } = {}) {
  return context.request.fetch(origin + '/api/backend/' + path, {
    method,
    headers: { Origin: origin, 'Idempotency-Key':key, ...(tenant ? { 'X-MotorOS-Expected-Tenant': tenant } : {}) },
    data,
  });
}
export async function mail(email, subject = 'invitation', exclude) {
  for (let i = 0; i < 300; i++) {
    const index = await fetch('http://127.0.0.1:8025/api/v1/search?query='+encodeURIComponent('to:'+email)+'&limit=100').then((r) =>
      r.json(),
    );
    const message = index.messages.find(
      (m) =>
        m.ID !== exclude &&
        m.Subject.toLowerCase().includes(subject.toLowerCase()) &&
        m.To.some((to) => to.Address.toLowerCase() === email.toLowerCase()),
    );
    if (message) {
      const full = await fetch('http://127.0.0.1:8025/api/v1/message/' + message.ID).then((r) =>
        r.json(),
      );
      return full;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('Expected local email was not delivered');
}
export async function invitationMail(email, exclude) {
  const message = await mail(email, 'invitation', exclude);
  const match = (message.Text || '').match(
    /http:\/\/127\.0\.0\.1:3000\/invitations\/accept\?token=([A-Za-z0-9_-]+)/,
  );
  if (!match) throw new Error('Invitation link missing from local mail');
  return { id: message.ID, url: match[0], token: match[1] };
}
const hash = (id) => createHash('sha256').update(id).digest('hex');
export async function sessionData(context, patch) {
  const cookies = await context.cookies();
  const id = cookies.find((c) => c.name === 'motoros-session')?.value;
  if (!id) throw new Error('Test session missing');
  const env = loadEnv();
  const client = createClient({ url: `redis://:${env.REDIS_PASSWORD}@127.0.0.1:16379` });
  await client.connect();
  try {
    const encoded = Buffer.from(await client.get('session:' + hash(id)), 'base64url');
    const decipher = createDecipheriv(
      'aes-256-gcm',
      Buffer.from(env.SESSION_ENCRYPTION_KEY, 'hex'),
      encoded.subarray(0, 12),
    );
    decipher.setAuthTag(encoded.subarray(-16));
    let value = JSON.parse(
      Buffer.concat([decipher.update(encoded.subarray(12, -16)), decipher.final()]),
    );
    if (patch) {
      value = { ...value, ...patch };
      const nonce = randomBytes(12),
        cipher = createCipheriv(
          'aes-256-gcm',
          Buffer.from(env.SESSION_ENCRYPTION_KEY, 'hex'),
          nonce,
        );
      const body = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
      await client.set(
        'session:' + hash(id),
        Buffer.concat([nonce, body, cipher.getAuthTag()]).toString('base64url'),
        { EX: Math.floor((value.expiresAt - Date.now()) / 1000) },
      );
    }
    return { id, ...value };
  } finally {
    await client.quit();
  }
}
export async function machineToken(name = 'workorder') {
  const env = loadEnv();
  const body = new URLSearchParams({ grant_type: 'client_credentials', scope: 'motoros.internal' });
  const r = await fetch('http://127.0.0.1:8180/realms/motoros/protocol/openid-connect/token', {
    method: 'POST',
    headers: {
      Authorization:
        'Basic ' +
        Buffer.from(`motoros-${name}:${env[name.toUpperCase() + '_CLIENT_SECRET']}`).toString(
          'base64',
        ),
    },
    body,
  });
  if (!r.ok) throw new Error('Service credential grant failed');
  return (await r.json()).access_token;
}
