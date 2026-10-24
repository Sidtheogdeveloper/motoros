import { loadEnv } from './env.mjs';
import path from 'node:path';
export function localEnv() {
  return {
    S3_ENDPOINT: 'http://127.0.0.1:8333',
    ...process.env,
    ...loadEnv(),
    OIDC_ALLOW_INSECURE_LOCAL: process.env.OIDC_ALLOW_INSECURE_LOCAL || 'true',
    COOKIE_SECURE: process.env.COOKIE_SECURE || 'false',
  };
}
export function serviceEnv(env, name, index) {
  const allowed = [];
  if (['customer', 'workorder', 'billing'].includes(name))
    allowed.push(
      'S3_LOCAL_ACCESS_KEY',
      'S3_LOCAL_SECRET_KEY',
      'AWS_ACCESS_KEY_ID',
      'AWS_SECRET_ACCESS_KEY',
      'AWS_SESSION_TOKEN',
    );
  if (['tenant', 'billing'].includes(name))
    allowed.push('INVITATION_ENCRYPTION_KEY', 'SMTP_PASSWORD');
  return {
    ...scopedEnv(env, allowed),
    PORT: String(8081 + index),
    DATABASE_USER: name + '_app',
    DATABASE_PASSWORD: env[name.toUpperCase() + '_PASSWORD'],
    SERVICE_CLIENT_ID: name === 'tenant' ? '' : 'motoros-' + name,
    SERVICE_CLIENT_SECRET: name === 'tenant' ? '' : env[name.toUpperCase() + '_CLIENT_SECRET'],
    SPRING_PROFILES_ACTIVE: 'local',
    MOTOROS_DEVELOPMENT_APPROVAL: 'true',
    MAIL_ENABLED: ['tenant', 'billing'].includes(name) ? 'true' : 'false',
  };
}
// Operator commands need the full local bundle; application processes do not.
function scopedEnv(env, allowed) {
  return Object.fromEntries(
    Object.entries(env).filter(
      ([key]) =>
        !/(?:PASSWORD|SECRET|SECRET_KEY|ENCRYPTION_KEY|ACCESS_KEY|ACCESS_KEY_ID|SESSION_TOKEN)$/.test(
          key,
        ) || allowed.includes(key),
    ),
  );
}
export function frontendEnv(env) {
  return scopedEnv(env, ['OIDC_CLIENT_SECRET', 'REDIS_PASSWORD', 'SESSION_ENCRYPTION_KEY']);
}
export function java(env) {
  return env.JAVA_HOME
    ? path.join(env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
    : 'java';
}
