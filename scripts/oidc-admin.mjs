import { loadEnv } from './env.mjs';
export const identityUrl = process.env.KEYCLOAK_ADMIN_URL || 'http://127.0.0.1:8180';
let bearer;
let expires = 0;
export async function admin(path, method = 'GET', body) {
  if (new URL(identityUrl).hostname !== '127.0.0.1')
    throw new Error('Development identity tools are restricted to loopback');
  if (!bearer || Date.now() > expires) {
    const form = new URLSearchParams({
      grant_type: 'password',
      client_id: 'admin-cli',
      username: 'motoros-local-admin',
      password: loadEnv().KEYCLOAK_ADMIN_PASSWORD,
    });
    const r = await fetch(identityUrl + '/realms/master/protocol/openid-connect/token', {
      method: 'POST',
      body: form,
    });
    if (!r.ok) throw new Error('Local identity administrator authentication failed');
    const tokens = await r.json();
    bearer = tokens.access_token;
    expires = Date.now() + 30000;
  }
  const r = await fetch(identityUrl + '/admin/realms/' + path, {
    method,
    headers: { Authorization: 'Bearer ' + bearer, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Local identity administration failed (${r.status})`);
  const text = await r.text();
  return text ? JSON.parse(text) : null;
}
