import { spawnSync } from 'node:child_process';
import './prepare-oidc.mjs';
import { loadEnv } from './env.mjs';
const env = { ...process.env, ...loadEnv() };
function run(args) {
  const r = spawnSync('docker', args, { env, stdio: 'inherit' });
  if (r.status !== 0) throw new Error('Local infrastructure startup failed');
}
const previousPostgres = spawnSync('docker', ['compose', 'ps', '-q', 'postgres'], {
  env,
  encoding: 'utf8',
}).stdout?.trim();
run(['compose', 'up', '-d', '--wait', 'postgres']);
const currentPostgres = spawnSync('docker', ['compose', 'ps', '-q', 'postgres'], {
  env,
  encoding: 'utf8',
}).stdout?.trim();
run(['compose', 'exec', '-T', 'postgres', 'sh', '/docker-entrypoint-initdb.d/02-keycloak.sh']);
run(['compose', 'exec', '-T', 'postgres', 'sh', '/docker-entrypoint-initdb.d/03-booking.sh']);
run(['compose', 'exec', '-T', 'postgres', 'sh', '/docker-entrypoint-initdb.d/04-commercial.sh']);
run(['compose', 'up', '-d', '--wait', 'redis', 'mailpit', 'keycloak', 'storage']);

// A running Keycloak pool can retain closed connections after a PostgreSQL container replacement.
if (previousPostgres && currentPostgres && previousPostgres !== currentPostgres) {
  run(['compose', 'restart', 'keycloak']);
  run(['compose', 'up', '-d', '--wait', 'keycloak']);
}
run(['compose', 'ps']);
await import('./configure-oidc.mjs');
