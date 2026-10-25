import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { SignatureV4 } from '@smithy/signature-v4';
import { Sha256 } from '@aws-crypto/sha256-js';

export function cacheCredentials() {
  const region = process.env.AWS_REGION || 'ap-south-1';
  const cache = process.env.REDIS_IAM_CACHE;
  const username = process.env.REDIS_USER;
  if (!cache || !username) throw new Error('Cache IAM identity is required');
  const signer = new SignatureV4({
    service: 'elasticache',
    region,
    credentials: fromNodeProviderChain(),
    sha256: Sha256,
  });
  async function credentials() {
    const signed = await signer.presign(
      {
        method: 'GET',
        protocol: 'https:',
        hostname: cache!,
        path: '/',
        headers: { host: cache! },
        query: { Action: 'connect', User: username! },
      },
      { expiresIn: 900 },
    );
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(signed.query || {})) {
      if (typeof value === 'string') query.set(key, value);
      else if (Array.isArray(value)) value.forEach((v) => query.append(key, v));
    }
    return { username, password: `${cache}/?${query}` };
  }
  return {
    type: 'streaming-credentials-provider' as const,
    async subscribe(listener: {
      onNext: (value: { username?: string; password?: string }) => void;
      onError: (error: Error) => void;
    }): Promise<[{ username?: string; password?: string }, { dispose: () => void }]> {
      const initial = await credentials();
      const timer = setInterval(() => {
        credentials()
          .then(listener.onNext)
          .catch(() => listener.onError(new Error('Cache credential renewal failed')));
      }, 600000);
      timer.unref();
      return [initial, { dispose: () => clearInterval(timer) }];
    },
    onReAuthenticationError() {
      /* Redis reports the connection error and sessions fail closed. */
    },
  };
}

export function cacheConnection() {
  if (process.env.MOTOROS_CLOUD === 'true') {
    const host = process.env.REDIS_HOST || '';
    if (!/^[a-z0-9][a-z0-9.-]*$/.test(host))
      throw new Error('Valid private cache hostname required');
    return { url: `rediss://${host}:6379`, credentialsProvider: cacheCredentials() };
  }
  return {
    url:
      process.env.REDIS_URL ||
      `redis://:${encodeURIComponent(process.env.REDIS_PASSWORD || '')}@127.0.0.1:16379`,
  };
}
