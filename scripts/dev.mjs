import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { localEnv, serviceEnv, frontendEnv, java } from './runtime.mjs';
import { ProcessGroup, assertPortsAvailable, handleSignals } from './process-group.mjs';
const env = localEnv();
mkdirSync('.runtime/logs', { recursive: true });
const group = new ProcessGroup();
handleSignals(group);
function run(command, args) {
  const r = spawnSync(command, args, { env, stdio: 'inherit' });
  if (r.status !== 0) throw new Error('Startup prerequisite failed');
}
try {
  await assertPortsAvailable([3000, 8081, 8082, 8083, 8084, 8085, 8086, 8087, 8088]);
  run(process.execPath, ['scripts/infra.mjs']);
  if (process.platform === 'win32')
    run('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      'scripts/maven.ps1',
      'verify',
    ]);
  else run('mvn', ['verify']);
  run(process.execPath, ['scripts/prepare-storage.mjs']);
  const services = [
    'tenant',
    'customer',
    'workorder',
    'booking',
    'inventory',
    'billing',
    'notification',
    'analytics',
  ].map((name, index) => ({
    port: 8081 + index,
    child: group.start(
      java(env),
      ['-jar', `services/${name}-service/target/${name}-service-0.1.0-SNAPSHOT.jar`],
      serviceEnv(env, name, index),
      name,
      `.runtime/logs/${name}.log`,
    ),
  }));
  await Promise.all(
    services.map(({ child, port }) =>
      group.waitHttp(child, `http://127.0.0.1:${port}/actuator/health`),
    ),
  );
  const child = group.start(
    process.execPath,
    [
      'node_modules/next/dist/bin/next',
      'dev',
      'apps/workshop-dashboard',
      '--hostname',
      '127.0.0.1',
    ],
    frontendEnv(env),
    'frontend',
    '.runtime/logs/frontend.log',
  );
  await group.waitHttp(child, 'http://127.0.0.1:3000/login');
  console.log(
    'MotorOS ready at http://127.0.0.1:3000 â€” provider http://127.0.0.1:8180, mail http://127.0.0.1:8025.',
  );
} catch (error) {
  console.error(error.message);
  group.stop();
  process.exitCode = 1;
}
