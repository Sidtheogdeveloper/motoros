import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import './prepare-oidc.mjs';
import { loadEnv } from './env.mjs';
const env = { ...process.env, ...loadEnv() };
function run(args) {
  const r = spawnSync('docker', args, { env, stdio: 'inherit' });
  if (r.status !== 0) {
    const diagnostic = spawnSync(
      'docker',
      [
        'compose',
        'logs',
        '--no-color',
        '--tail',
        '60',
        'postgres',
        'keycloak',
        'redis',
        'mailpit',
        'storage',
        'localstack',
      ],
      { env, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 },
    );
    let text = diagnostic.stdout || '';
    for (const [key, value] of Object.entries(env))
      if (/(?:PASSWORD|SECRET|KEY|TOKEN)/.test(key) && value?.length >= 8)
        text = text.replaceAll(value, '[REDACTED]');
    const errors = text
      .split('\n')
      .filter((line) => /ERROR|FATAL|Permission denied|Caused by:/i.test(line))
      .slice(-20);
    if (errors.length) console.error(errors.join('\n'));
    throw new Error('Local infrastructure startup failed; review redacted component errors above');
  }
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
// Feed the checked-in script directly: an updated Windows bind mount can retain a stale file handle.
const reliability = spawnSync('docker', ['compose', 'exec', '-T', 'postgres', 'sh', '-s'], {
  env,
  input: readFileSync('infrastructure/docker/reliability-db.sh'),
  stdio: ['pipe', 'inherit', 'inherit'],
});
if (reliability.status !== 0) throw new Error('Reliability schema initialization failed');
run(['compose', 'up', '-d', '--wait', 'redis', 'mailpit', 'keycloak', 'storage', 'localstack']);

// A running Keycloak pool can retain closed connections after a PostgreSQL container replacement.
if (previousPostgres && currentPostgres && previousPostgres !== currentPostgres) {
  run(['compose', 'restart', 'keycloak']);
  run(['compose', 'up', '-d', '--wait', 'keycloak']);
}
run(['compose', 'ps']);
await import('./configure-oidc.mjs');
