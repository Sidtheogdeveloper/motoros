import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readLimitedBody } from '../../apps/workshop-dashboard/src/lib/limited-body.ts';
test('reads small UTF-8 bodies across byte boundaries', async () => {
  const bytes = new TextEncoder().encode('Hello 世界');
  let offset = 0;
  const stream = new ReadableStream({
    pull(c) {
      if (offset === bytes.length) c.close();
      else c.enqueue(bytes.slice(offset, ++offset));
    },
  });
  assert.equal(await readLimitedBody(stream), 'Hello 世界');
});
test('cancels oversized chunked bodies before buffering the rest', async () => {
  let cancelled = false;
  let chunks = 0;
  const stream = new ReadableStream({
    pull(c) {
      chunks++;
      c.enqueue(new Uint8Array(5000));
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(readLimitedBody(stream), (e) => e.status === 413);
  assert.ok(cancelled);
  assert.ok(chunks <= 5);
});
test('rejects malformed UTF-8 and accepts absent bodies', async () => {
  const stream = new ReadableStream({
    start(c) {
      c.enqueue(new Uint8Array([255]));
      c.close();
    },
  });
  await assert.rejects(readLimitedBody(stream), (e) => e.status === 400);
  assert.equal(await readLimitedBody(null), '');
});
