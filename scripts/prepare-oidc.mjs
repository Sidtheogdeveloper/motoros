import { mkdirSync, writeFileSync } from 'node:fs';
import { loadEnv } from './env.mjs';
import { identitySmtp } from './identity-smtp.mjs';
const env = loadEnv();
mkdirSync('.runtime/keycloak', { recursive: true });
const audience = {
  name: 'motoros-api-audience',
  protocol: 'openid-connect',
  protocolMapper: 'oidc-audience-mapper',
  config: {
    'included.custom.audience': 'motoros-api',
    'access.token.claim': 'true',
    'id.token.claim': 'false',
  },
};
const scope = (name) => ({
  name,
  protocol: 'openid-connect',
  attributes: { 'include.in.token.scope': 'true' },
  protocolMappers: [audience],
});
const clients = [
  {
    clientId: 'motoros-bff',
    secret: env.OIDC_CLIENT_SECRET,
    publicClient: false,
    standardFlowEnabled: true,
    directAccessGrantsEnabled: false,
    redirectUris: [
      'http://127.0.0.1:3000/api/auth/callback',
      // Administrative action emails finish at login, outside an OIDC transaction.
      'http://127.0.0.1:3000/login',
    ],
    webOrigins: ['http://127.0.0.1:3000'],
    attributes: {
      'pkce.code.challenge.method': 'S256',
      'post.logout.redirect.uris': 'http://127.0.0.1:3000/login',
    },
    defaultClientScopes: ['openid', 'profile', 'email', 'motoros.api'],
  },
];
for (const [name, secret] of [
  ['customer', env.CUSTOMER_CLIENT_SECRET],
  ['workorder', env.WORKORDER_CLIENT_SECRET],
  ['booking', env.BOOKING_CLIENT_SECRET],
  ['inventory', env.INVENTORY_CLIENT_SECRET],
  ['billing', env.BILLING_CLIENT_SECRET],
  ['notification', env.NOTIFICATION_CLIENT_SECRET],
  ['analytics', env.ANALYTICS_CLIENT_SECRET],
])
  clients.push({
    clientId: 'motoros-' + name,
    secret,
    publicClient: false,
    standardFlowEnabled: false,
    directAccessGrantsEnabled: false,
    serviceAccountsEnabled: true,
    defaultClientScopes: ['motoros.internal'],
  });
const realm = {
  realm: 'motoros',
  enabled: true,
  requiredCredentials: ['password'],
  registrationAllowed: true,
  registrationEmailAsUsername: true,
  loginWithEmailAllowed: true,
  duplicateEmailsAllowed: false,
  verifyEmail: true,
  resetPasswordAllowed: true,
  rememberMe: false,
  accessTokenLifespan: 300,
  ssoSessionIdleTimeout: 1800,
  ssoSessionMaxLifespan: 28800,
  revokeRefreshToken: true,
  refreshTokenMaxReuse: 0,
  sslRequired: 'external',
  passwordPolicy: 'length(12) and digits(1) and lowerCase(1) and upperCase(1)',
  bruteForceProtected: true,
  failureFactor: 5,
  waitIncrementSeconds: 30,
  smtpServer: identitySmtp(env),
  clientScopes: [scope('motoros.api'), scope('motoros.internal')],
  clients,
};
writeFileSync('.runtime/keycloak/motoros-realm.json', JSON.stringify(realm, null, 2), {
  mode: 0o600,
});
console.log('Prepared local Keycloak realm; client secrets remain in ignored runtime files.');
