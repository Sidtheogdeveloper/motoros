import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { Client } from 'pg';
import { java } from '../../scripts/runtime.mjs';
import { names, save } from '../../infrastructure/scripts/cloud.mjs';
const services = names.filter((n) => n !== 'api-bff'),
  container = 'motoros-m7-migrations-' + Date.now();
const password = randomBytes(32).toString('hex'),
  env = { ...process.env, POSTGRES_PASSWORD: password };
function docker(args) {
  const p = spawnSync('docker', args, { env, encoding: 'utf8' });
  if (p.status !== 0) throw new Error('Migration test infrastructure operation failed');
  return p.stdout.trim();
}
let admin;
try {
  docker([
    'run',
    '-d',
    '--name',
    container,
    '-e',
    'POSTGRES_PASSWORD',
    '-e',
    'POSTGRES_USER=operator',
    '-e',
    'POSTGRES_DB=motoros',
    '-p',
    '127.0.0.1::5432',
    'postgres:17.6-alpine',
  ]);
  const port = Number(docker(['port', container, '5432/tcp']).split(':').at(-1));
  const base = { host: '127.0.0.1', port, database: 'motoros' };
  for (let i = 0; i < 90; i++) {
    try {
      admin = new Client({ ...base, user: 'operator', password });
      await admin.connect();
      break;
    } catch {
      await admin?.end();
      admin = null;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  assert.ok(admin, 'Temporary PostgreSQL must start');
  const credentials = {};
  for (const n of services) {
    const migration = randomBytes(24).toString('hex'),
      runtime = randomBytes(24).toString('hex');
    credentials[n] = { migration, runtime };
    await admin.query(
      `CREATE ROLE ${n}_migrator LOGIN PASSWORD '${migration}';CREATE ROLE ${n}_app LOGIN PASSWORD '${runtime}';CREATE SCHEMA ${n} AUTHORIZATION ${n}_migrator;REVOKE ALL ON SCHEMA ${n} FROM PUBLIC;GRANT USAGE ON SCHEMA ${n} TO ${n}_app;ALTER DEFAULT PRIVILEGES FOR ROLE ${n}_migrator IN SCHEMA ${n} GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO ${n}_app;ALTER DEFAULT PRIVILEGES FOR ROLE ${n}_migrator IN SCHEMA ${n} GRANT USAGE,SELECT,UPDATE ON SEQUENCES TO ${n}_app;ALTER DEFAULT PRIVILEGES FOR ROLE ${n}_migrator IN SCHEMA ${n} REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;ALTER DEFAULT PRIVILEGES FOR ROLE ${n}_migrator IN SCHEMA ${n} GRANT EXECUTE ON FUNCTIONS TO ${n}_app;`,
    );
  }
  let migrations = 0,
    denials = 0;
  for (const n of services) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const p = spawnSync(
        java(process.env),
        ['-jar', `services/${n}-service/target/${n}-service-0.1.0-SNAPSHOT.jar`],
        {
          encoding: 'utf8',
          timeout: 90000,
          env: {
            PATH: process.env.PATH,
            JAVA_HOME: process.env.JAVA_HOME,
            DATABASE_URL: `jdbc:postgresql://127.0.0.1:${port}/motoros`,
            DATABASE_USER: n + '_migrator',
            DATABASE_PASSWORD: credentials[n].migration,
            MOTOROS_MIGRATE_ONLY: 'true',
          },
        },
      );
      assert.equal(
        p.status,
        0,
        `${n} migration-only process must succeed (attempt ${attempt + 1})`,
      );
      assert.doesNotMatch(
        p.stdout + p.stderr,
        /Started Application|Tomcat started|Netty started/,
        'Migration must not start HTTP or schedulers',
      );
    }
    const validate = () =>
      spawnSync(
        java(process.env),
        ['-jar', `services/${n}-service/target/${n}-service-0.1.0-SNAPSHOT.jar`],
        {
          encoding: 'utf8',
          timeout: 90000,
          env: {
            PATH: process.env.PATH,
            JAVA_HOME: process.env.JAVA_HOME,
            DATABASE_URL: `jdbc:postgresql://127.0.0.1:${port}/motoros`,
            DATABASE_USER: n + '_app',
            DATABASE_PASSWORD: credentials[n].runtime,
            MOTOROS_VALIDATE_ONLY: 'true',
          },
        },
      );
    const validated = validate();
    assert.equal(validated.status, 0, n + ' runtime credentials validate owned migrations');
    assert.doesNotMatch(validated.stdout + validated.stderr, /Started Application|Tomcat started/);
    // Older application binaries must accept a successfully applied future migration.
    await admin.query(
      `insert into ${n}.flyway_schema_history(installed_rank,version,description,type,script,checksum,installed_by,execution_time,success) select coalesce(max(installed_rank),0)+1,'9999','rolling compatibility test','SQL','V9999__synthetic_future.sql',1,'test',0,true from ${n}.flyway_schema_history`,
    );
    assert.equal(
      validate().status,
      0,
      n + ' permits future schema versions during rolling deployment',
    );
    await admin.query(`delete from ${n}.flyway_schema_history where version='9999'`);
    await admin.query(
      `update ${n}.flyway_schema_history set checksum=checksum+1 where installed_rank=(select min(installed_rank) from ${n}.flyway_schema_history where checksum is not null)`,
    );
    assert.notEqual(
      validate().status,
      0,
      n + ' rejects mismatched migration checksums before HTTP startup',
    );
    await admin.query(
      `update ${n}.flyway_schema_history set checksum=checksum-1 where installed_rank=(select min(installed_rank) from ${n}.flyway_schema_history where checksum is not null)`,
    );
    const runtime = new Client({ ...base, user: n + '_app', password: credentials[n].runtime });
    await runtime.connect();
    const tables = (
      await admin.query(
        'SELECT tablename FROM pg_tables WHERE schemaname=$1 AND tablename<>$2 ORDER BY tablename',
        [n, 'flyway_schema_history'],
      )
    ).rows;
    await runtime.query(`select count(*) from ${n}.${tables[0].tablename}`);
    for (const query of [
      `create table ${n}.forbidden(id int)`,
      `update ${n}.flyway_schema_history set success=success`,
    ]) {
      await assert.rejects(runtime.query(query), { code: '42501' });
      denials++;
    }
    for (const other of services.filter((x) => x !== n)) {
      await assert.rejects(runtime.query(`select count(*) from ${other}.flyway_schema_history`), {
        code: '42501',
      });
      denials++;
    }
    migrations += Number(
      (
        await admin.query(
          `select count(*) from ${n}.flyway_schema_history where success and type='SQL'`,
        )
      ).rows[0].count,
    );
    await runtime.end();
  }
  save('.runtime/m7-migration-results.json', {
    passed: true,
    services: 8,
    migrations,
    runs: 16,
    runtimeValidationRuns: 24,
    privilegeDenials: denials,
    verifiedAt: new Date().toISOString(),
  });
  console.log(
    `PASS: ${migrations} migrations, 16 migration-only and 24 runtime-validation runs, ${denials} privilege denials; no application context started.`,
  );
} finally {
  await admin?.end();
  docker(['rm', '-f', container]);
}
