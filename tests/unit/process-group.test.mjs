import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { once } from 'node:events';
import { ProcessGroup, assertPortsAvailable } from '../../scripts/process-group.mjs';
test('occupied ports fail before application startup', async () => {
  const held = net.createServer();
  held.listen(0, '127.0.0.1');
  await once(held, 'listening');
  try {
    await assert.rejects(assertPortsAvailable([held.address().port]), /already in use/);
  } finally {
    held.close();
  }
});
test('failed child terminates owned siblings and readiness fails', async () => {
  const group = new ProcessGroup();
  const sibling = group.start(
    process.execPath,
    ['-e', 'setInterval(()=>{},1000)'],
    process.env,
    'sibling',
  );
  const exited = once(sibling, 'exit');
  const failed = once(group, 'failure');
  const bad = group.start(
    process.execPath,
    ['-e', 'process.exit(7)'],
    process.env,
    'failure fixture',
  );
  try {
    const [error] = await failed;
    assert.match(error.message, /exited unexpectedly/);
    await exited;
    await assert.rejects(group.waitHttp(bad, 'http://127.0.0.1:1'), /exited unexpectedly/);
  } finally {
    group.stop();
  }
});
