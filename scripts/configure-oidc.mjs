import { readFileSync } from 'node:fs';
import { admin } from './oidc-admin.mjs';
const realm = JSON.parse(readFileSync('.runtime/keycloak/motoros-realm.json', 'utf8'));
const mapper = (name, property, claim, type = 'String') => ({
  name,
  protocol: 'openid-connect',
  protocolMapper: 'oidc-usermodel-property-mapper',
  config: {
    'user.attribute': property,
    'claim.name': claim,
    'jsonType.label': type,
    'id.token.claim': 'true',
    'access.token.claim': 'true',
    'userinfo.token.claim': 'true',
  },
});
realm.clientScopes.push(
  {
    name: 'email',
    protocol: 'openid-connect',
    attributes: { 'include.in.token.scope': 'true' },
    protocolMappers: [
      mapper('email', 'email', 'email'),
      mapper('email verified', 'emailVerified', 'email_verified', 'boolean'),
    ],
  },
  {
    name: 'profile',
    protocol: 'openid-connect',
    attributes: { 'include.in.token.scope': 'true' },
    protocolMappers: [
      {
        name: 'full name',
        protocol: 'openid-connect',
        protocolMapper: 'oidc-full-name-mapper',
        config: {
          'id.token.claim': 'true',
          'access.token.claim': 'true',
          'userinfo.token.claim': 'true',
        },
      },
      mapper('username', 'username', 'preferred_username'),
    ],
  },
);
const masterScopes = await admin('master/client-scopes');
const basic = masterScopes.find((s) => s.name === 'basic');
if (!basic) throw new Error('Provider basic subject scope is unavailable');
const basicMappers = await admin(`master/client-scopes/${basic.id}/protocol-mappers/models`);
realm.clientScopes.push({
  name: 'basic',
  protocol: 'openid-connect',
  attributes: basic.attributes,
  protocolMappers: basicMappers.map(({ id, ...mapper }) => mapper),
});
for (const client of realm.clients) client.defaultClientScopes.push('basic');
const current = await admin('motoros');
const changes = {};
for (const key of [
  'requiredCredentials',
  'registrationAllowed',
  'registrationEmailAsUsername',
  'verifyEmail',
  'resetPasswordAllowed',
  'bruteForceProtected',
  'passwordPolicy',
  'smtpServer',
  'accessTokenLifespan',
  'ssoSessionMaxLifespan',
  'ssoSessionIdleTimeout',
  'revokeRefreshToken',
  'refreshTokenMaxReuse',
])
  changes[key] = realm[key];
await admin('motoros', 'PUT', { ...current, ...changes });
let scopes = await admin('motoros/client-scopes');
for (const desired of realm.clientScopes) {
  let found = scopes.find((s) => s.name === desired.name);
  if (!found) {
    await admin('motoros/client-scopes', 'POST', {
      name: desired.name,
      protocol: desired.protocol,
      attributes: desired.attributes,
    });
    scopes = await admin('motoros/client-scopes');
    found = scopes.find((s) => s.name === desired.name);
  }
  const existing = await admin(`motoros/client-scopes/${found.id}/protocol-mappers/models`);
  for (const item of desired.protocolMappers || []) {
    const old = existing.find((m) => m.name === item.name);
    await admin(
      `motoros/client-scopes/${found.id}/protocol-mappers/models${old ? '/' + old.id : ''}`,
      old ? 'PUT' : 'POST',
      { ...item, ...(old ? { id: old.id } : {}) },
    );
  }
}
for (const desired of realm.clients) {
  let [client] = await admin('motoros/clients?clientId=' + encodeURIComponent(desired.clientId));
  if(!client){await admin('motoros/clients','POST',desired);[client]=await admin('motoros/clients?clientId='+encodeURIComponent(desired.clientId));}
  await admin('motoros/clients/' + client.id, 'PUT', { ...client, ...desired });
  for (const name of desired.defaultClientScopes) {
    const scope = scopes.find((s) => s.name === name);
    if (scope) await admin(`motoros/clients/${client.id}/default-client-scopes/${scope.id}`, 'PUT');
  }
}
console.log('Local OIDC profile/email mappings and strict PKCE clients configured.');
