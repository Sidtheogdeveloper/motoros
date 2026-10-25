import { admin } from './oidc-admin.mjs';

const email = process.argv[2];
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
  throw new Error('Usage: node scripts/send-account-setup.mjs your-own-address@example.com');
const users = await admin('motoros/users?exact=true&email=' + encodeURIComponent(email));
if (users.length !== 1 || !users[0].enabled)
  throw new Error('Expected one enabled, existing account');
const actions = users[0].requiredActions.filter((action) =>
  ['VERIFY_EMAIL', 'UPDATE_PASSWORD'].includes(action),
);
if (!actions.length) {
  console.log('Account setup is already complete. Sign in at http://127.0.0.1:3000/login');
} else {
  // Callback requires a browser-held state/nonce/PKCE transaction; email actions do not have one.
  const query = new URLSearchParams({
    client_id: 'motoros-bff',
    redirect_uri: 'http://127.0.0.1:3000/login',
    lifespan: '1800',
  });
  await admin(`motoros/users/${users[0].id}/execute-actions-email?${query}`, 'PUT', actions);
  console.log('Account setup email submitted. Complete it within 30 minutes, then sign in.');
}
