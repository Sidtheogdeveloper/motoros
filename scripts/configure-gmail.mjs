import { readFileSync, writeFileSync } from 'node:fs';
import { loadEnv } from './env.mjs';
import { admin } from './oidc-admin.mjs';
import { identitySmtp } from './identity-smtp.mjs';

try {
  const settings = {
    IDENTITY_SMTP_PROVIDER: 'gmail',
    IDENTITY_SMTP_USERNAME: process.env.MOTOROS_SETUP_GMAIL_ADDRESS,
    IDENTITY_SMTP_PASSWORD: process.env.MOTOROS_SETUP_GMAIL_PASSWORD?.replace(/\s/g, ''),
  };
  const smtp = identitySmtp(settings);
  loadEnv();
  const original = readFileSync('.env', 'utf8');
  const realm = await admin('motoros');
  // Persist before activation so the next normal startup preserves this provider.
  const lines = original
    .split(/\r?\n/)
    .filter((line) => !/^IDENTITY_SMTP_(PROVIDER|USERNAME|PASSWORD)=/.test(line));
  const next = lines.filter(Boolean).concat(Object.entries(settings).map(([k, v]) => `${k}=${v}`));
  writeFileSync('.env', next.join('\n') + '\n', { mode: 0o600 });
  try {
    await admin('motoros', 'PUT', { ...realm, smtpServer: smtp });
  } catch {
    writeFileSync('.env', original, { mode: 0o600 });
    // The HTTP outcome may be ambiguous; attempt to restore the previous provider too.
    try {
      await admin('motoros', 'PUT', realm);
    } catch {
      throw new Error(
        'Setup failed; verify the identity email settings before registering accounts.',
      );
    }
    throw new Error('Identity provider update failed; previous configuration restored.');
  }
  console.log('Gmail configured for identity emails only. Delivery has not yet been tested.');
  console.log('Use registration or resend verification to test delivery to your own account.');
} catch (error) {
  // Never print server responses or credential values.
  console.error(
    error.message?.startsWith('A ') ||
      error.message?.startsWith('Setup failed') ||
      error.message?.startsWith('Identity provider update failed')
      ? error.message
      : 'Gmail setup failed. Check the local identity service and input; no credentials are displayed.',
  );
  process.exitCode = 1;
}
