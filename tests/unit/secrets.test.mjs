import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
test('release-artifact secret gate rejects provider tokens without printing their values', () => {
  mkdirSync('.runtime', { recursive: true });
  const path = '.runtime/m7-secret-gate-synthetic-' + process.pid + '.json';
  const token = 'ghp_' + 'z'.repeat(36);
  try {
    writeFileSync(path, JSON.stringify({ synthetic: true, credential: token }));
    const result = spawnSync(process.execPath, ['scripts/check-secrets.mjs'], {
      encoding: 'utf8',
      env: { ...process.env, MOTOROS_RELEASE_ARTIFACTS: path },
    });
    assert.notEqual(result.status, 0);
    assert.ok(result.stdout.includes('credential pattern'));
    assert.ok(!result.stdout.includes(token));
    assert.ok(!result.stderr.includes(token));
  } finally {
    unlinkSync(path);
  }
});
