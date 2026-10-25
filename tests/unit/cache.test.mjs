import test from 'node:test';
import assert from 'node:assert/strict';
import { cacheConnection } from '../../apps/workshop-dashboard/src/lib/cache-credentials.ts';
test('cloud sessions require TLS and signed short-lived cache credentials; local Redis remains separate', async () => {
  const before = { ...process.env };
  let dispose;
  try {
    process.env.MOTOROS_CLOUD = 'true';
    process.env.REDIS_HOST = 'private-cache.example.test';
    process.env.REDIS_IAM_CACHE = 'motoros-staging-sessions';
    process.env.REDIS_USER = 'motoros-staging-bff';
    process.env.AWS_REGION = 'ap-south-1';
    process.env.AWS_ACCESS_KEY_ID = 'synthetic-access-key';
    process.env.AWS_SECRET_ACCESS_KEY = 'synthetic-signing-secret';
    delete process.env.AWS_SESSION_TOKEN;
    const connection = cacheConnection();
    assert.equal(connection.url, 'rediss://private-cache.example.test:6379');
    const [credentials, subscription] = await connection.credentialsProvider.subscribe({
      onNext() {},
      onError() {
        assert.fail('Unexpected renewal error');
      },
    });
    dispose = subscription.dispose;
    assert.equal(credentials.username, 'motoros-staging-bff');
    const signed = new URL('https://' + credentials.password);
    assert.equal(signed.searchParams.get('Action'), 'connect');
    assert.equal(signed.searchParams.get('User'), credentials.username);
    assert.equal(signed.searchParams.get('X-Amz-Expires'), '900');
    assert.match(
      signed.searchParams.get('X-Amz-Credential'),
      /ap-south-1\/elasticache\/aws4_request$/,
    );
    assert.match(signed.searchParams.get('X-Amz-Signature'), /^[a-f0-9]{64}$/);
    process.env.REDIS_HOST = 'https://public-cache.example.test/?credential=unsafe';
    assert.throws(cacheConnection, /hostname/);
    process.env.REDIS_HOST = 'private-cache.example.test';
    delete process.env.REDIS_USER;
    assert.throws(cacheConnection, /IAM identity/);
    process.env.MOTOROS_CLOUD = 'false';
    process.env.REDIS_URL = 'redis://127.0.0.1:16379';
    assert.deepEqual(cacheConnection(), { url: 'redis://127.0.0.1:16379' });
  } finally {
    dispose?.();
    for (const name of Object.keys(process.env)) if (!(name in before)) delete process.env[name];
    Object.assign(process.env, before);
  }
});
