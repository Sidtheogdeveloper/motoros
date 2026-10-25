import test from 'node:test';
import assert from 'node:assert/strict';
import { identitySmtp } from '../../scripts/identity-smtp.mjs';

test('default identity transport remains local and unauthenticated', () => {
  const smtp = identitySmtp({ SMTP_PASSWORD: 'unrelated' });
  assert.equal(smtp.host, 'mailpit');
  assert.equal(smtp.auth, 'false');
  assert.equal(smtp.password, undefined);
});
test('Gmail requires encrypted authenticated submission and matching sender', () => {
  const smtp = identitySmtp({
    IDENTITY_SMTP_PROVIDER: 'gmail',
    IDENTITY_SMTP_USERNAME: 'sender@gmail.com',
    IDENTITY_SMTP_PASSWORD: 'abcd efgh ijkl mnop',
  });
  assert.equal(smtp.host, 'smtp.gmail.com');
  assert.equal(smtp.port, '587');
  assert.equal(smtp.starttls, 'true');
  assert.equal(smtp.auth, 'true');
  assert.equal(smtp.from, smtp.user);
  assert.equal(smtp.password.length, 16);
});
test('invalid credentials and provider cannot silently fall back or leak values', () => {
  for (const values of [
    { IDENTITY_SMTP_PROVIDER: 'other' },
    { IDENTITY_SMTP_PROVIDER: 'gmail', IDENTITY_SMTP_USERNAME: 'sender@evil.test' },
    {
      IDENTITY_SMTP_PROVIDER: 'gmail',
      IDENTITY_SMTP_USERNAME: 'sender@gmail.com',
      IDENTITY_SMTP_PASSWORD: 'secret-invalid-value',
    },
  ])
    assert.throws(
      () => identitySmtp(values),
      (error) =>
        !error.message.includes('secret-invalid-value') &&
        !error.message.includes('sender@evil.test'),
    );
});
