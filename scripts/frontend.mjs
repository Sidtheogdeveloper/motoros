import { mkdirSync } from 'node:fs';
import { localEnv, frontendEnv } from './runtime.mjs';
import { ProcessGroup, assertPortsAvailable, handleSignals } from './process-group.mjs';
const env = frontendEnv(localEnv());
const group = new ProcessGroup();
handleSignals(group);
mkdirSync('.runtime/logs', { recursive: true });
try {
  await assertPortsAvailable([3000]);
  const child = group.start(
    process.execPath,
    [
      'node_modules/next/dist/bin/next',
      process.argv.includes('--production') ? 'start' : 'dev',
      'apps/workshop-dashboard',
      '--hostname',
      '127.0.0.1',
    ],
    env,
    'frontend',
    '.runtime/logs/frontend.log',
  );
  await group.waitHttp(child, 'http://127.0.0.1:3000/login');
  console.log('MotorOS ready at http://127.0.0.1:3000');
} catch (e) {
  console.error(e.message);
  group.stop();
  process.exitCode = 1;
}
