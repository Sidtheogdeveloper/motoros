#!/usr/bin/env node
// Runs only inside the private operator task. Never print credentials or command stderr.
import { randomBytes } from 'node:crypto';
import { aws, run, names } from './cloud.mjs';
const c = JSON.parse(process.env.MOTOROS_CONFIG || '{}');
const d = JSON.parse(process.env.MOTOROS_DEPLOYMENT || '{}');
if (process.env.MOTOROS_INITIALIZE_AUTHORIZATION !== c.environment)
  throw new Error('Explicit initialization authorization required');
const live = aws('ecs', 'list-services', { cluster: d.cluster }, c);
if (live.serviceArns?.length) {
  const services = aws(
    'ecs',
    'describe-services',
    { cluster: d.cluster, services: live.serviceArns },
    c,
  ).services;
  if (services.some((s) => s.runningCount > 0 || s.desiredCount > 0))
    throw new Error('Initialization requires every application service stopped');
}
const quote = (s) => "'" + String(s).replaceAll("'", "''") + "'";
function sql(text) {
  return run('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A'], {
    input: text,
    env: {
      ...process.env,
      PGHOST: d.database_host,
      PGPORT: '5432',
      PGDATABASE: 'motoros',
      PGUSER: process.env.DB_OPERATOR_USER,
      PGPASSWORD: process.env.DB_OPERATOR_PASSWORD,
      PGSSLMODE: 'verify-full',
      PGSSLROOTCERT: '/app/rds-ca.pem',
    },
  });
}
const pending = [];
for (const n of names) {
  const meta = aws('secretsmanager', 'describe-secret', { SecretId: d.runtime_secret_arns[n] }, c);
  if (Object.values(meta.VersionIdsToStages || {}).some((s) => s.includes('AWSCURRENT'))) continue;
  const secret = {};
  if (n === 'api-bff') secret.SESSION_ENCRYPTION_KEY = randomBytes(32).toString('hex');
  else {
    const runtime = randomBytes(32).toString('hex'),
      migration = randomBytes(32).toString('hex');
    secret.DATABASE_PASSWORD = runtime;
    sql(`BEGIN; SELECT format('CREATE ROLE %I LOGIN', ${quote(n + '_migrator')}) WHERE NOT EXISTS(SELECT FROM pg_roles WHERE rolname=${quote(n + '_migrator')}) \\gexec
SELECT format('CREATE ROLE %I LOGIN', ${quote(n + '_app')}) WHERE NOT EXISTS(SELECT FROM pg_roles WHERE rolname=${quote(n + '_app')}) \\gexec
ALTER ROLE ${n}_migrator PASSWORD ${quote(migration)};
ALTER ROLE ${n}_app PASSWORD ${quote(runtime)};
CREATE SCHEMA IF NOT EXISTS ${n} AUTHORIZATION ${n}_migrator;
REVOKE ALL ON SCHEMA ${n} FROM PUBLIC;
GRANT USAGE ON SCHEMA ${n} TO ${n}_app;
ALTER DEFAULT PRIVILEGES FOR ROLE ${n}_migrator IN SCHEMA ${n} GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO ${n}_app;
ALTER DEFAULT PRIVILEGES FOR ROLE ${n}_migrator IN SCHEMA ${n} GRANT USAGE,SELECT,UPDATE ON SEQUENCES TO ${n}_app;
ALTER DEFAULT PRIVILEGES FOR ROLE ${n}_migrator IN SCHEMA ${n} REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE ${n}_migrator IN SCHEMA ${n} GRANT EXECUTE ON FUNCTIONS TO ${n}_app;
COMMIT;`);
    aws(
      'secretsmanager',
      'put-secret-value',
      {
        SecretId: d.migration_secret_arns[n],
        SecretString: JSON.stringify({ DATABASE_PASSWORD: migration }),
      },
      c,
    );
  }
  if (n !== 'tenant') {
    const client = aws(
      'cognito-idp',
      'describe-user-pool-client',
      { UserPoolId: d.cognito_pool_id, ClientId: d.cognito_clients[n] },
      c,
    ).UserPoolClient;
    if (!client.ClientSecret) throw new Error('Confidential client secret missing');
    secret[n === 'api-bff' ? 'OIDC_CLIENT_SECRET' : 'SERVICE_CLIENT_SECRET'] = client.ClientSecret;
  }
  if (['tenant', 'billing', 'notification'].includes(n)) {
    if (!process.env.SMTP_USERNAME || !process.env.SMTP_PASSWORD)
      throw new Error('Verified SES SMTP credentials must be injected into the operator task');
    secret.SMTP_USERNAME = process.env.SMTP_USERNAME;
    secret.SMTP_PASSWORD = process.env.SMTP_PASSWORD;
    secret[n === 'notification' ? 'NOTIFICATION_ENCRYPTION_KEY' : 'INVITATION_ENCRYPTION_KEY'] =
      randomBytes(32).toString('hex');
  }
  pending.push([n, secret]);
}
for (const [n, secret] of pending)
  aws(
    'secretsmanager',
    'put-secret-value',
    { SecretId: d.runtime_secret_arns[n], SecretString: JSON.stringify(secret) },
    c,
  );
console.log('Runtime initialization completed; no secret values emitted.');
