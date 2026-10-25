import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  config,
  manifest,
  names,
  authorize,
  validateDeployment,
} from '../../infrastructure/scripts/cloud.mjs';
const directory = mkdtempSync(join(tmpdir(), 'motoros-infra-test-'));
const fixture = {
  environment: 'staging',
  region: 'ap-south-1',
  account_id: '000000000001',
  app_origin: 'https://staging.example.test',
  owner: 'test',
  cost_center: 'test',
  monthly_budget: 1,
  alert_email: 'alerts@example.test',
};
function file(name, value) {
  const path = join(directory, name);
  writeFileSync(path, JSON.stringify(value));
  return path;
}
test('deployment configuration rejects missing domain, budget and unknown environments', () => {
  for (const change of [
    { app_origin: '' },
    { app_origin: 'http://staging.example.test' },
    { monthly_budget: 0 },
    { environment: 'local' },
    { account_id: 'root' },
  ])
    assert.throws(() => config(file('invalid.json', { ...fixture, ...change })));
  assert.equal(config(file('valid.json', fixture)).environment, 'staging');
});
test('cloud mutations fail before making AWS calls without explicit authorization', () => {
  const previous = process.env.MOTOROS_DEPLOY_AUTHORIZATION;
  delete process.env.MOTOROS_DEPLOY_AUTHORIZATION;
  try {
    assert.throws(() => authorize(fixture), /authorization/);
  } finally {
    if (previous) process.env.MOTOROS_DEPLOY_AUTHORIZATION = previous;
  }
});
test('staging authorization cannot be paired with production deployment metadata', () => {
  assert.throws(
    () => validateDeployment({ cluster: 'motoros-production' }, fixture),
    /another environment/,
  );
  assert.throws(
    () =>
      validateDeployment(
        {
          cluster: 'motoros-staging',
          runtime_secret_arns: {
            tenant:
              'arn:aws:secretsmanager:ap-south-1:000000000001:secret:motoros-production/tenant/runtime-test',
          },
        },
        fixture,
      ),
    /Secret reference/,
  );
  assert.equal(
    validateDeployment({ cluster: 'motoros-staging' }, fixture).cluster,
    'motoros-staging',
  );
});
test('manifest validates every service and rejects mutable or foreign-account images', () => {
  const value = {
    sourceSha: 'a'.repeat(40),
    environment: 'staging',
    images: Object.fromEntries(
      names.map((n) => [
        n,
        `000000000001.dkr.ecr.ap-south-1.amazonaws.com/motoros-staging/${n}@sha256:${'b'.repeat(64)}`,
      ]),
    ),
  };
  assert.equal(Object.keys(manifest(file('valid-release.json', value), fixture).images).length, 9);
  assert.throws(() =>
    manifest(
      file('bad-release.json', { ...value, images: { ...value.images, tenant: 'image:latest' } }),
      fixture,
    ),
  );
  assert.throws(() => manifest(file('missing-release.json', { ...value, images: {} }), fixture));
});
test('Terraform keeps services stopped until the migration/deployment coordinator runs', () => {
  const d = JSON.parse(
    readFileSync('infrastructure/terraform/modules/environment/main.tfmodel.json'),
  );
  assert.equal(d.resource.aws_ecs_service.app.desired_count, 0);
  assert.deepEqual(d.resource.aws_ecs_service.app.lifecycle.ignore_changes, [
    'desired_count',
    'task_definition',
  ]);
  assert.equal(d.resource.aws_ecs_service.app.network_configuration[0].assign_public_ip, false);
  assert.equal(
    d.resource.aws_ecs_task_definition.app.container_definitions,
    '${jsonencode(local.containers[each.key])}',
  );
});
