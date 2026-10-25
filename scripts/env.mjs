import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync, readFileSync } from 'node:fs';
export function loadEnv() {
  const values = existsSync('.env')
    ? Object.fromEntries(
        readFileSync('.env', 'utf8')
          .split(/\r?\n/)
          .filter((l) => l && !l.startsWith('#') && l.includes('='))
          .map((l) => {
            const i = l.indexOf('=');
            return [l.slice(0, i), l.slice(i + 1)];
          }),
      )
    : {};
  let changed = false;
  // Keep private import files readable by the same non-root UID inside Keycloak on Linux.
  const hostUid = process.getuid?.();
  const localUid = hostUid > 0 ? String(hostUid) : '1000';
  if (values.LOCAL_UID !== localUid) {
    values.LOCAL_UID = localUid;
    changed = true;
  }

  for (const name of [
    'S3_LOCAL_ACCESS_KEY',
    'S3_LOCAL_SECRET_KEY',
    'POSTGRES_PASSWORD',
    'TENANT_PASSWORD',
    'CUSTOMER_PASSWORD',
    'WORKORDER_PASSWORD',
    'BOOKING_PASSWORD',
    'INVENTORY_PASSWORD',
    'BILLING_PASSWORD',
    'NOTIFICATION_PASSWORD',
    'ANALYTICS_PASSWORD',
    'NOTIFICATION_CLIENT_SECRET',
    'ANALYTICS_CLIENT_SECRET',
    'NOTIFICATION_ENCRYPTION_KEY',
    'INVENTORY_CLIENT_SECRET',
    'BILLING_CLIENT_SECRET',
    'BOOKING_CLIENT_SECRET',
    'KEYCLOAK_DB_PASSWORD',
    'KEYCLOAK_ADMIN_PASSWORD',
    'OIDC_CLIENT_SECRET',
    'CUSTOMER_CLIENT_SECRET',
    'WORKORDER_CLIENT_SECRET',
    'REDIS_PASSWORD',
    'SESSION_ENCRYPTION_KEY',
    'INVITATION_ENCRYPTION_KEY',
  ])
    if (!values[name]) {
      values[name] = randomBytes(32).toString('hex');
      changed = true;
    }
  if (changed) {
    writeFileSync(
      '.env',
      Object.entries(values)
        .map(([k, v]) => k + '=' + v)
        .join('\n') + '\n',
      { mode: 0o600 },
    );
    console.log('Updated ignored local development configuration; existing secrets preserved.');
  }
  return values;
}
if (process.argv[1]?.endsWith('env.mjs')) loadEnv();
