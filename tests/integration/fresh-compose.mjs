import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { loadEnv } from '../../scripts/env.mjs';
import { serviceEnv } from '../../scripts/runtime.mjs';
import { ProcessGroup } from '../../scripts/process-group.mjs';
const env = { ...process.env, ...loadEnv() };
const project = 'motoros-review-' + Date.now();
assert.match(project, /^motoros-review-\d+$/);
const override = '.runtime/review-compose.yml';
mkdirSync('.runtime/logs', { recursive: true });
writeFileSync(override, 'services:\n  postgres:\n    ports: !override ["127.0.0.1::5432"]\n');
const base = ['compose', '-p', project, '-f', 'docker-compose.yml', '-f', override];
function docker(args) {
  const r = spawnSync('docker', args, { env, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  if (r.status !== 0)
    throw new Error((r.stderr || r.error?.message || 'Docker command failed').slice(-1500));
  return r.stdout.trim();
}
async function port() {
  return await new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const p = server.address().port;
      server.close(() => resolve(p));
    });
  });
}
const group = new ProcessGroup();
const failures = [];
group.on('failure', (e) => failures.push(e.message));
let created = false;
try {
  created = true;
  docker([...base, 'up', '-d', '--wait', 'postgres']);
  const databasePort = Number(
    docker([...base, 'port', 'postgres', '5432'])
      .split(':')
      .at(-1),
  );
  const java = env.JAVA_HOME
    ? path.join(env.JAVA_HOME, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
    : 'java';
  const customerPort = await port();
  for (const service of [
    'tenant',
    'customer',
    'workorder',
    'booking',
    'inventory',
    'billing',
    'notification',
    'analytics',
  ]) {
    const httpPort = service === 'customer' ? customerPort : await port();
    const child = group.start(
      java,
      ['-jar', `services/${service}-service/target/${service}-service-0.1.0-SNAPSHOT.jar`],
      {
        ...serviceEnv(
          env,
          service,
          [
            'tenant',
            'customer',
            'workorder',
            'booking',
            'inventory',
            'billing',
            'notification',
            'analytics',
          ].indexOf(service),
        ),
        MESSAGING_ENABLED: 'true',
        MESSAGING_BOOTSTRAP: 'false',
        MOTOROS_EVENTS_PUBLISH_ENABLED: 'false',
        MOTOROS_EVENTS_CONSUME_ENABLED: 'false',
        MOTOROS_ANALYTICS_RECONCILE_ENABLED: 'false',
        MAIL_ENABLED: 'false',
        // This schema-only harness starts PostgreSQL, not SMTP. Real mail health stays enabled in the full stack.
        MANAGEMENT_HEALTH_MAIL_ENABLED: 'false',
        PORT: String(httpPort),
        DATABASE_URL: `jdbc:postgresql://127.0.0.1:${databasePort}/motoros`,
        DATABASE_USER: service + '_app',
        DATABASE_PASSWORD: env[service.toUpperCase() + '_PASSWORD'],
        CUSTOMER_URL: `http://127.0.0.1:${customerPort}`,
      },
      'fresh ' + service,
      `.runtime/logs/fresh-${service}.log`,
    );
    await group.waitHttp(child, `http://127.0.0.1:${httpPort}/actuator/health`);
    console.log(`Ready: fresh ${service} schema and database health`);
  }
  const sql =
    "SELECT nspname || ':' || pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname IN ('tenant','customer','workorder','booking','inventory','billing') ORDER BY nspname; SELECT 'tenant:' || count(*) FROM tenant.flyway_schema_history WHERE success AND version='1'; SELECT 'tenant-v2:' || count(*) FROM tenant.flyway_schema_history WHERE success AND version='2'; SELECT 'tenant-v3:' || count(*) FROM tenant.flyway_schema_history WHERE success AND version='3'; SELECT 'customer-v2:' || count(*) FROM customer.flyway_schema_history WHERE success AND version='2'; SELECT 'customer:' || count(*) FROM customer.flyway_schema_history WHERE success AND version='1'; SELECT 'customer-v3:' || count(*) FROM customer.flyway_schema_history WHERE success AND version='3'; SELECT 'workorder-v2:' || count(*) FROM workorder.flyway_schema_history WHERE success AND version='2'; SELECT 'workorder:' || count(*) FROM workorder.flyway_schema_history WHERE success AND version='1'; SELECT r.rolname || ':' || n.nspname || ':' || has_schema_privilege(r.rolname,n.oid,'USAGE') FROM pg_roles r CROSS JOIN pg_namespace n WHERE r.rolname IN ('tenant_app','customer_app','workorder_app','booking_app','inventory_app','billing_app') AND n.nspname IN ('tenant','customer','workorder','booking','inventory','billing') ORDER BY r.rolname,n.nspname;";
  const extendedSql =
    sql +
    " SELECT 'tenant-v4:' || count(*) FROM tenant.flyway_schema_history WHERE success AND version='4'; SELECT 'customer-v4:' || count(*) FROM customer.flyway_schema_history WHERE success AND version='4'; SELECT 'workorder-v3:' || count(*) FROM workorder.flyway_schema_history WHERE success AND version='3'; SELECT 'booking-v1:' || count(*) FROM booking.flyway_schema_history WHERE success AND version='1';";
  const finalSql =
    extendedSql +
    " SELECT 'workorder-v4:' || count(*) FROM workorder.flyway_schema_history WHERE success AND version='4'; SELECT 'booking-v2:' || count(*) FROM booking.flyway_schema_history WHERE success AND version='2';";
  let output = docker([
    ...base,
    'exec',
    '-T',
    'postgres',
    'psql',
    '-U',
    'postgres',
    '-d',
    'motoros',
    '-t',
    '-A',
    '-c',
    finalSql +
      " SELECT 'workorder-v8:' || count(*) FROM workorder.flyway_schema_history WHERE success AND version='8'; SELECT 'workorder-v7:' || count(*) FROM workorder.flyway_schema_history WHERE success AND version='7'; SELECT 'billing-v2:' || count(*) FROM billing.flyway_schema_history WHERE success AND version='2'; SELECT 'workorder-v6:' || count(*) FROM workorder.flyway_schema_history WHERE success AND version='6'; SELECT 'inventory-v2:' || count(*) FROM inventory.flyway_schema_history WHERE success AND version='2'; SELECT 'tenant-v5:' || count(*) FROM tenant.flyway_schema_history WHERE success AND version='5'; SELECT 'workorder-v5:' || count(*) FROM workorder.flyway_schema_history WHERE success AND version='5'; SELECT 'inventory-v1:' || count(*) FROM inventory.flyway_schema_history WHERE success AND version='1'; SELECT 'billing-v1:' || count(*) FROM billing.flyway_schema_history WHERE success AND version='1';",
  ]);
  const allServices = [
    'tenant',
    'customer',
    'workorder',
    'booking',
    'inventory',
    'billing',
    'notification',
    'analytics',
  ];
  let migrationCount = 0;
  let extraSql =
    "select nspname||':'||pg_get_userbyid(nspowner) from pg_namespace where nspname in ('notification','analytics');";
  const schemaNames = allServices.map((n) => "'" + n + "'").join(','),
    roleNames = allServices.map((n) => "'" + n + "_app'").join(',');
  extraSql += ` select r.rolname||':'||n.nspname||':'||has_schema_privilege(r.rolname,n.oid,'USAGE') from pg_roles r cross join pg_namespace n where r.rolname in (${roleNames}) and n.nspname in (${schemaNames});`;
  for (const service of allServices)
    for (const file of readdirSync(`services/${service}-service/src/main/resources/db/migration`)) {
      const match = file.match(/^V([0-9]+)__/);
      if (match) {
        migrationCount++;
        extraSql += ` select '${service}-v${match[1]}:'||count(*) from ${service}.flyway_schema_history where success and version='${match[1]}';`;
      }
    }
  output +=
    '\n' +
    docker([
      ...base,
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      'postgres',
      '-d',
      'motoros',
      '-t',
      '-A',
      '-c',
      extraSql,
    ]);
  for (const service of allServices)
    for (const file of readdirSync(`services/${service}-service/src/main/resources/db/migration`)) {
      const match = file.match(/^V([0-9]+)__/);
      if (match) assert.ok(output.includes(`${service}-v${match[1]}:1`));
    }
  for (const service of allServices) assert.ok(output.includes(`${service}:${service}_app`));
  assert.ok(
    output.includes('tenant:1') && output.includes('customer:1') && output.includes('workorder:1'),
  );
  assert.ok(
    output.includes('tenant-v2:1') &&
      output.includes('tenant-v3:1') &&
      output.includes('customer-v2:1') &&
      output.includes('customer-v3:1') &&
      output.includes('workorder-v2:1'),
  );
  for (const a of allServices)
    for (const b of allServices)
      assert.ok(output.includes(`${a}_app:${b}:${a === b ? 'true' : 'false'}`));
  for (const tag of [
    'tenant-v4:1',
    'customer-v4:1',
    'workorder-v3:1',
    'booking-v1:1',
    'workorder-v4:1',
    'booking-v2:1',
    'workorder-v8:1',
    'workorder-v7:1',
    'billing-v2:1',
    'workorder-v6:1',
    'inventory-v2:1',
    'tenant-v5:1',
    'workorder-v5:1',
    'inventory-v1:1',
    'billing-v1:1',
  ])
    assert.ok(output.includes(tag));
  assert.deepEqual(failures, []);
  console.log(output);
  writeFileSync(
    '.runtime/review-infrastructure-results.json',
    JSON.stringify(
      {
        project,
        freshVolume: true,
        serviceOwnedSchemas: true,
        flywayMigrations: migrationCount,
        crossSchemaDenials: 56,
        healthEndpoints: 8,
        passed: true,
      },
      null,
      2,
    ),
  );
  console.log(
    `PASS: fresh Compose initialization, ${migrationCount} service-owned Flyway migrations, eight health endpoints and 56 privilege denials.`,
  );
} finally {
  group.stop();
  if (created) docker([...base, 'down', '--volumes', '--remove-orphans']);
}
