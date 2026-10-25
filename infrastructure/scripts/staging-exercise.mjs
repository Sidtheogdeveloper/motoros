import { config, authorize, deployment, validateDeployment, aws, run, save } from './cloud.mjs';
const [operation, configPath, deploymentPath, evidencePath, argument] = process.argv.slice(2);
const c = config(configPath),
  d = validateDeployment(deployment(deploymentPath), c);
if (c.environment !== 'staging' || process.env.MOTOROS_STAGING_EXERCISE !== operation)
  throw new Error('Separately approved staging exercise required; production is forbidden');
authorize(c);
const startedAt = new Date().toISOString();
if (operation === 'restore') {
  if (!/^motoros-staging-restore-[a-z0-9-]{1,28}$/.test(argument || ''))
    throw new Error('An exact NEW staging restore identifier is required');
  const source = aws(
    'rds',
    'describe-db-instances',
    { DBInstanceIdentifier: d.database_identifier },
    c,
  ).DBInstances[0];
  if (
    source.PubliclyAccessible ||
    !source.StorageEncrypted ||
    !source.DBInstanceIdentifier.startsWith('motoros-staging')
  )
    throw new Error('Source must be private encrypted staging');
  // A separately reviewed recovery role must allow this operation; normal app/deploy roles do not.
  const result = aws(
    'rds',
    'restore-db-instance-to-point-in-time',
    {
      SourceDBInstanceIdentifier: source.DBInstanceIdentifier,
      TargetDBInstanceIdentifier: argument,
      UseLatestRestorableTime: true,
      DBInstanceClass: source.DBInstanceClass,
      DBSubnetGroupName: source.DBSubnetGroup.DBSubnetGroupName,
      VpcSecurityGroupIds: source.VpcSecurityGroups.map((s) => s.VpcSecurityGroupId),
      PubliclyAccessible: false,
      MultiAZ: false,
      DeletionProtection: true,
      EnableCloudwatchLogsExports: ['postgresql'],
      Tags: [
        { Key: 'Project', Value: 'MotorOS' },
        { Key: 'Environment', Value: 'staging' },
        { Key: 'Purpose', Value: 'restore-exercise' },
      ],
    },
    c,
  ).DBInstance;
  save(evidencePath, {
    operation,
    startedAt,
    source: source.DBInstanceIdentifier,
    target: result.DBInstanceIdentifier,
    restorePoint: source.LatestRestorableTime,
    status: 'RESTORING_UNVERIFIED',
    nextStep:
      'Wait for available; execute private TLS schema, grants and tenant-isolation verification before measuring RPO/RTO. Never repoint live staging or delete the target automatically.',
  });
  console.log(
    'Isolated restore requested. Data verification and measured recovery evidence are still required.',
  );
} else if (operation === 'bad-image') {
  const service = d.services['api-bff'];
  const baseline = aws('ecs', 'describe-services', { cluster: d.cluster, services: [service] }, c)
    .services[0];
  if (
    !baseline?.desiredCount ||
    baseline.runningCount !== baseline.desiredCount ||
    baseline.deployments.length !== 1 ||
    baseline.deployments[0].rolloutState !== 'COMPLETED' ||
    !baseline.deploymentConfiguration.deploymentCircuitBreaker?.rollback
  )
    throw new Error('Known healthy staging BFF and circuit-breaker rollback required');
  const task = aws(
    'ecs',
    'describe-task-definition',
    { taskDefinition: baseline.taskDefinition },
    c,
  ).taskDefinition;
  const allowed = [
    'family',
    'taskRoleArn',
    'executionRoleArn',
    'networkMode',
    'containerDefinitions',
    'volumes',
    'requiresCompatibilities',
    'cpu',
    'memory',
    'runtimePlatform',
    'ephemeralStorage',
  ];
  const request = Object.fromEntries(
    allowed.filter((k) => task[k] !== undefined).map((k) => [k, task[k]]),
  );
  const app = request.containerDefinitions.find((x) => x.name === 'api-bff');
  if (!/@sha256:[a-f0-9]{64}$/.test(app.image))
    throw new Error('Baseline must use an immutable reviewed digest');
  app.entryPoint = ['node', '-e'];
  app.command = ['process.exit(42)'];
  const failedTask = aws('ecs', 'register-task-definition', request, c).taskDefinition
    .taskDefinitionArn;
  save(evidencePath, {
    operation,
    startedAt,
    previousHealthyTask: baseline.taskDefinition,
    failedTask,
    status: 'EXERCISE_RUNNING',
  });
  aws('ecs', 'update-service', { cluster: d.cluster, service, taskDefinition: failedTask }, c);
  // ECS waiter may fail while rollback is progressing; final authoritative state decides success.
  try {
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
  } catch {}
  const final = aws('ecs', 'describe-services', { cluster: d.cluster, services: [service] }, c)
    .services[0];
  const restored = final.deployments.find((x) => x.status === 'PRIMARY');
  const passed =
    restored?.taskDefinition === baseline.taskDefinition &&
    restored.rolloutState === 'COMPLETED' &&
    final.runningCount === final.desiredCount;
  save(evidencePath, {
    operation,
    startedAt,
    finishedAt: new Date().toISOString(),
    previousHealthyTask: baseline.taskDefinition,
    failedTask,
    observedPrimary: restored?.taskDefinition,
    passed,
  });
  if (!passed)
    throw new Error(
      'Rollback not verified; inspect and recover staging using the recorded prior revision',
    );
  console.log(
    'Controlled failing-image rollback verified. Run staging smoke before closing the exercise.',
  );
} else throw new Error('Supported exercises: restore or bad-image');
