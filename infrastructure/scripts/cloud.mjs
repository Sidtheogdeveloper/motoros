#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const names = [
  'tenant',
  'customer',
  'workorder',
  'booking',
  'inventory',
  'billing',
  'notification',
  'analytics',
  'api-bff',
];
export function run(command, args, options = {}) {
  const p = spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  });
  if (p.error || p.status !== 0)
    throw new Error(
      `${command} failed (${p.status ?? 'unavailable'}); inspect restricted operator logs`,
    );
  return p.stdout?.trim() || '';
}
export function aws(service, operation, params = {}, config = {}) {
  const privateInput = Object.hasOwn(params, 'SecretString');
  if (privateInput && process.platform === 'win32')
    throw new Error('Secret initialization is restricted to the private Linux operator task');
  return JSON.parse(
    run(
      'aws',
      [
        service,
        operation,
        '--region',
        config.region || 'ap-south-1',
        '--cli-input-json',
        privateInput ? 'file:///dev/stdin' : JSON.stringify(params),
        '--output',
        'json',
        '--no-cli-pager',
      ],
      privateInput ? { input: JSON.stringify(params) } : {},
    ) || '{}',
  );
}
export function config(path) {
  const c = JSON.parse(readFileSync(path, 'utf8'));
  if (
    !['staging', 'production'].includes(c.environment) ||
    c.region !== 'ap-south-1' ||
    !/^\d{12}$/.test(c.account_id) ||
    !/^https:\/\/[a-z0-9.-]+$/.test(c.app_origin) ||
    !c.owner ||
    !c.cost_center ||
    !(c.monthly_budget > 0) ||
    !c.alert_email?.includes('@')
  )
    throw new Error('Incomplete approved environment configuration');
  return c;
}
export function authorize(c) {
  if (process.env.MOTOROS_DEPLOY_AUTHORIZATION !== c.environment)
    throw new Error(`Explicit ${c.environment} workflow authorization required`);
  const id = aws('sts', 'get-caller-identity', {}, c);
  if (id.Account !== c.account_id || !id.Arn.includes(':assumed-role/'))
    throw new Error('A short-lived non-root role in the selected account is required');
  return id;
}
export function deployment(path) {
  const value = JSON.parse(readFileSync(path, 'utf8'));
  return value.deployment?.value || value;
}
export function validateDeployment(d, c) {
  const prefix = `motoros-${c.environment}`;
  if (d.cluster !== prefix) throw new Error('Deployment metadata belongs to another environment');
  for (const arn of [
    ...Object.values(d.task_definitions || {}),
    ...Object.values(d.migration_tasks || {}),
  ])
    if (!arn.startsWith(`arn:aws:ecs:${c.region}:${c.account_id}:task-definition/${prefix}-`))
      throw new Error('Task definition outside selected account/environment');
  for (const arn of [
    ...Object.values(d.runtime_secret_arns || {}),
    ...Object.values(d.migration_secret_arns || {}),
  ])
    if (!arn.startsWith(`arn:aws:secretsmanager:${c.region}:${c.account_id}:secret:${prefix}/`))
      throw new Error('Secret reference outside selected account/environment');
  return d;
}
export function manifest(path, c) {
  const m = JSON.parse(readFileSync(path, 'utf8'));
  if (
    !/^[a-f0-9]{40}$/.test(m.sourceSha) ||
    m.environment !== c.environment ||
    names.some(
      (n) =>
        !m.images?.[n]?.startsWith(
          `${c.account_id}.dkr.ecr.${c.region}.amazonaws.com/motoros-${c.environment}/${n}@sha256:`,
        ) || !/@sha256:[a-f0-9]{64}$/.test(m.images[n]),
    )
  )
    throw new Error('Release requires all nine target-account immutable digests');
  return m;
}
export function save(path, value) {
  mkdirSync(dirname(resolve(path)), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
}
async function main() {
  const [action, ...args] = process.argv.slice(2);
  if (action === 'validate') {
    const tf = process.env.TERRAFORM || 'terraform';
    for (const path of [
      'bootstrap',
      'cognito',
      'messaging',
      'environments/staging',
      'environments/production',
    ]) {
      const base = `infrastructure/terraform/${path}`;
      for (const command of [
        ['fmt', '-check'],
        ['init', '-backend=false', '-lockfile=readonly'],
        ['validate'],
      ])
        run(tf, [`-chdir=${base}`, ...command], { stdio: 'inherit' });
    }
    run(process.execPath, ['--test', 'tests/unit/infrastructure.test.mjs'], { stdio: 'inherit' });
    return;
  }
  if (action === 'build') {
    const sha = run('git', ['rev-parse', 'HEAD']);
    for (const name of names)
      run(
        'docker',
        [
          'build',
          '-f',
          `infrastructure/docker/${name === 'api-bff' ? 'frontend' : 'service'}.Dockerfile`,
          ...(name === 'api-bff' ? [] : ['--build-arg', `SERVICE=${name}`]),
          '-t',
          `motoros/${name}:${sha}`,
          '.',
        ],
        { stdio: 'inherit' },
      );
    return;
  }
  const c = config(args[0]);
  if (action === 'preflight') {
    const id = aws('sts', 'get-caller-identity', {}, c);
    if (id.Account !== c.account_id || !id.Arn.includes(':assumed-role/'))
      throw new Error('Configure a short-lived deployment role; root/user credentials are refused');
    const cert = aws(
      'acm',
      'describe-certificate',
      { CertificateArn: c.certificate_arn },
      c,
    ).Certificate;
    if (
      cert.Status !== 'ISSUED' ||
      !cert.SubjectAlternativeNames.some((d) => d === new URL(c.app_origin).hostname)
    )
      throw new Error('Exact staging hostname must have an issued ACM certificate');
    const sender = aws('sesv2', 'get-email-identity', { EmailIdentity: c.mail_identity }, c);
    if (!sender.VerifiedForSendingStatus) throw new Error('SES sender identity is not verified');
    const versions = aws(
      'rds',
      'describe-db-engine-versions',
      { Engine: 'postgres', EngineVersion: c.postgres_version },
      c,
    );
    if (!versions.DBEngineVersions?.length)
      throw new Error('PostgreSQL version is not supported in the selected region');
    console.log('Read-only preflight passed; this does not authorize deployment.');
    return;
  }
  if (action === 'plan') {
    const tf = process.env.TERRAFORM || 'terraform';
    run(
      tf,
      [
        `-chdir=infrastructure/terraform/environments/${c.environment}`,
        'plan',
        `-var-file=${resolve(args[0])}`,
        `-out=${resolve(args[1])}`,
      ],
      { stdio: 'inherit' },
    );
    console.log('Plan SHA256: ' + createHash('sha256').update(readFileSync(args[1])).digest('hex'));
    return;
  }
  authorize(c);
  if (action === 'apply') {
    const hash = createHash('sha256').update(readFileSync(args[1])).digest('hex');
    if (hash !== process.env.MOTOROS_APPROVED_PLAN_SHA256)
      throw new Error('The exact reviewed plan hash is required');
    run(
      process.env.TERRAFORM || 'terraform',
      [`-chdir=infrastructure/terraform/environments/${c.environment}`, 'apply', resolve(args[1])],
      { stdio: 'inherit' },
    );
    return;
  }
  const d = validateDeployment(deployment(args[1]), c);
  if (action === 'prepare-release') {
    const release = manifest(args[2], c),
      prepared = structuredClone(d);
    for (const name of names) {
      for (const kind of ['task_definitions', ...(name === 'api-bff' ? [] : ['migration_tasks'])]) {
        const current = aws(
          'ecs',
          'describe-task-definition',
          { taskDefinition: d[kind][name] },
          c,
        ).taskDefinition;
        const allowed = [
          'family',
          'taskRoleArn',
          'executionRoleArn',
          'networkMode',
          'containerDefinitions',
          'volumes',
          'placementConstraints',
          'requiresCompatibilities',
          'cpu',
          'memory',
          'runtimePlatform',
          'ephemeralStorage',
        ];
        const request = Object.fromEntries(
          allowed.filter((k) => current[k] !== undefined).map((k) => [k, current[k]]),
        );
        request.containerDefinitions.find((x) => x.name === name).image = release.images[name];
        request.tags = [
          { key: 'Project', value: 'MotorOS' },
          { key: 'Environment', value: c.environment },
          { key: 'SourceSHA', value: release.sourceSha },
        ];
        prepared[kind][name] = aws(
          'ecs',
          'register-task-definition',
          request,
          c,
        ).taskDefinition.taskDefinitionArn;
      }
    }
    save(args[3], prepared);
    return;
  }
  if (action === 'initialize') {
    if (!d.initialize_task)
      throw new Error('Reviewed operator image and SES secret references are required');
    const started = aws(
      'ecs',
      'run-task',
      {
        cluster: d.cluster,
        taskDefinition: d.initialize_task,
        launchType: 'FARGATE',
        networkConfiguration: {
          awsvpcConfiguration: {
            subnets: d.app_subnet_ids,
            securityGroups: [d.app_security_group],
            assignPublicIp: 'DISABLED',
          },
        },
      },
      c,
    );
    if (started.failures?.length || started.tasks?.length !== 1)
      throw new Error('Initialization task failed to launch');
    const task = started.tasks[0].taskArn;
    run('aws', [
      'ecs',
      'wait',
      'tasks-stopped',
      '--cluster',
      d.cluster,
      '--tasks',
      task,
      '--region',
      c.region,
    ]);
    if (
      aws(
        'ecs',
        'describe-tasks',
        { cluster: d.cluster, tasks: [task] },
        c,
      ).tasks[0].containers.some((x) => x.exitCode !== 0)
    )
      throw new Error('Runtime initialization failed');
    return;
  }
  if (action === 'inspect') {
    const live = aws(
      'ecs',
      'describe-services',
      { cluster: d.cluster, services: Object.values(d.services) },
      c,
    );
    save(args[2], {
      checkedAt: new Date().toISOString(),
      services: live.services?.map((s) => ({
        name: s.serviceName,
        running: s.runningCount,
        desired: s.desiredCount,
        deployments: s.deployments,
        events: s.events.slice(0, 10),
      })),
      failures: live.failures,
    });
    return;
  }
  if (action === 'migrate') {
    const result = {
      environment: c.environment,
      startedAt: new Date().toISOString(),
      services: {},
    };
    for (const name of names.filter((n) => n !== 'api-bff')) {
      const started = aws(
        'ecs',
        'run-task',
        {
          cluster: d.cluster,
          taskDefinition: d.migration_tasks[name],
          launchType: 'FARGATE',
          networkConfiguration: {
            awsvpcConfiguration: {
              subnets: d.app_subnet_ids,
              securityGroups: [d.app_security_group],
              assignPublicIp: 'DISABLED',
            },
          },
        },
        c,
      );
      if (started.failures?.length || started.tasks?.length !== 1)
        throw new Error(`Migration task launch failed: ${name}`);
      const task = started.tasks[0].taskArn;
      run('aws', [
        'ecs',
        'wait',
        'tasks-stopped',
        '--cluster',
        d.cluster,
        '--tasks',
        task,
        '--region',
        c.region,
      ]);
      const status = aws('ecs', 'describe-tasks', { cluster: d.cluster, tasks: [task] }, c)
        .tasks[0];
      if (status.containers.some((x) => x.exitCode !== 0))
        throw new Error(`Migration failed: ${name}; rollout stopped`);
      result.services[name] = {
        task,
        taskDefinition: status.taskDefinitionArn,
        exitCode: 0,
        completedAt: new Date().toISOString(),
      };
      save(args[2], result);
    }
    return;
  }
  if (action === 'deploy') {
    const release = manifest(args[2], c);
    const migrations = JSON.parse(readFileSync(args[3], 'utf8'));
    if (names.filter((n) => n !== 'api-bff').some((n) => migrations.services?.[n]?.exitCode !== 0))
      throw new Error('All eight migrations must succeed before rollout');
    const previous = aws(
      'ecs',
      'describe-services',
      { cluster: d.cluster, services: Object.values(d.services) },
      c,
    );
    release.previousHealthy =
      previous.services.length === 9 &&
      previous.services.every(
        (s) =>
          s.desiredCount > 0 &&
          s.runningCount >= s.desiredCount &&
          s.deployments.every((x) => x.rolloutState === 'COMPLETED'),
      );
    release.previousTasks = release.previousHealthy
      ? Object.fromEntries(previous.services.map((s) => [s.serviceName, s.taskDefinition]))
      : {};
    save(args[2], release);
    for (const name of names) {
      const definition = aws(
        'ecs',
        'describe-task-definition',
        { taskDefinition: d.task_definitions[name] },
        c,
      ).taskDefinition;
      if (
        definition.containerDefinitions.find((x) => x.name === name)?.image !== release.images[name]
      )
        throw new Error(`Task digest differs from reviewed manifest: ${name}`);
      if (
        name !== 'api-bff' &&
        migrations.services[name].taskDefinition !== d.migration_tasks[name]
      )
        throw new Error('Migration evidence belongs to another task revision');
      aws(
        'ecs',
        'update-service',
        {
          cluster: d.cluster,
          service: d.services[name],
          taskDefinition: d.task_definitions[name],
          desiredCount: c.environment === 'production' ? 2 : 1,
        },
        c,
      );
      run('aws', [
        'ecs',
        'wait',
        'services-stable',
        '--cluster',
        d.cluster,
        '--services',
        d.services[name],
        '--region',
        c.region,
      ]);
      const settled = aws(
        'ecs',
        'describe-services',
        { cluster: d.cluster, services: [d.services[name]] },
        c,
      ).services[0];
      if (
        settled.taskDefinition !== d.task_definitions[name] ||
        settled.runningCount < settled.desiredCount ||
        !settled.deployments.some(
          (x) =>
            x.status === 'PRIMARY' &&
            x.taskDefinition === d.task_definitions[name] &&
            x.rolloutState === 'COMPLETED',
        )
      )
        throw new Error(
          `Rollout failed or circuit breaker reverted ${name}; do not report release success`,
        );
    }
    release.deployedAt = new Date().toISOString();
    save(args[2], release);
    return;
  }
  if (action === 'rollback') {
    const release = manifest(args[2], c);
    if (!release.stagingSmokePassed && c.environment === 'production')
      throw new Error('Production rollback requires staging-tested release evidence');
    if (
      release.previousHealthy !== true ||
      !release.previousTasks ||
      Object.keys(release.previousTasks).length !== 9
    )
      throw new Error(
        'Known-good previous task definitions are required; initial deployment has no rollback target',
      );
    for (const [service, task] of Object.entries(release.previousTasks)) {
      if (
        !task.startsWith(
          `arn:aws:ecs:${c.region}:${c.account_id}:task-definition/motoros-${c.environment}-`,
        )
      )
        throw new Error('Rollback task outside environment');
      aws('ecs', 'update-service', { cluster: d.cluster, service, taskDefinition: task }, c);
      run('aws', [
        'ecs',
        'wait',
        'services-stable',
        '--cluster',
        d.cluster,
        '--services',
        service,
        '--region',
        c.region,
      ]);
    }
    return;
  }
  if (action === 'publish-operator') {
    const sha = run('git', ['rev-parse', 'HEAD']);
    if (run('git', ['status', '--porcelain']))
      throw new Error('Publishing requires a clean verified commit');
    const repo = `${c.account_id}.dkr.ecr.${c.region}.amazonaws.com/motoros-${c.environment}/operator`;
    if (d.operator_repository !== repo) throw new Error('Operator repository outside environment');
    const local = `motoros/operator:${sha}`;
    run('docker', ['build', '-f', 'infrastructure/docker/operator.Dockerfile', '-t', local, '.'], {
      stdio: 'inherit',
    });
    run('trivy', ['image', '--exit-code', '1', '--severity', 'HIGH,CRITICAL', local], {
      stdio: 'inherit',
    });
    const password = run('aws', ['ecr', 'get-login-password', '--region', c.region]);
    run(
      'docker',
      [
        'login',
        '--username',
        'AWS',
        '--password-stdin',
        `${c.account_id}.dkr.ecr.${c.region}.amazonaws.com`,
      ],
      { input: password },
    );
    run('docker', ['tag', local, `${repo}:${sha}`]);
    run('docker', ['push', `${repo}:${sha}`], { stdio: 'inherit' });
    const image = aws(
      'ecr',
      'describe-images',
      { repositoryName: `motoros-${c.environment}/operator`, imageIds: [{ imageTag: sha }] },
      c,
    ).imageDetails[0];
    save(args[2], {
      sourceSha: sha,
      environment: c.environment,
      operatorImage: `${repo}@${image.imageDigest}`,
    });
    return;
  }
  if (action === 'publish') {
    const sha = run('git', ['rev-parse', 'HEAD']);
    if (run('git', ['status', '--porcelain']))
      throw new Error('Publishing requires a clean verified commit');
    const login = run('aws', ['ecr', 'get-login-password', '--region', c.region]);
    run(
      'docker',
      [
        'login',
        '--username',
        'AWS',
        '--password-stdin',
        `${c.account_id}.dkr.ecr.${c.region}.amazonaws.com`,
      ],
      { input: login },
    );
    const release = {
      sourceSha: sha,
      environment: c.environment,
      images: {},
      createdAt: new Date().toISOString(),
    };
    for (const name of names) {
      const local = `motoros/${name}:${sha}`,
        repo = `${c.account_id}.dkr.ecr.${c.region}.amazonaws.com/motoros-${c.environment}/${name}`;
      run(process.execPath, ['scripts/check-vex.mjs'], { stdio: 'inherit' });
      run(
        'trivy',
        [
          'image',
          '--vex',
          'docs/deployment/motoros.openvex.json',
          '--exit-code',
          '1',
          '--severity',
          'HIGH,CRITICAL',
          local,
        ],
        { stdio: 'inherit' },
      );
      run('docker', ['tag', local, `${repo}:${sha}`]);
      run('docker', ['push', `${repo}:${sha}`], { stdio: 'inherit' });
      const image = aws(
        'ecr',
        'describe-images',
        { repositoryName: `motoros-${c.environment}/${name}`, imageIds: [{ imageTag: sha }] },
        c,
      ).imageDetails[0];
      release.images[name] = `${repo}@${image.imageDigest}`;
    }
    save(args[2], release);
    return;
  }
  throw new Error('Unknown operation');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
