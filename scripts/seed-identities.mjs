import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import pg from 'pg';
import { loadEnv } from './env.mjs';
import { admin } from './oidc-admin.mjs';
const env = loadEnv();
if (process.env.MOTOROS_DEV_FIXTURES !== '1')
  throw new Error('Set MOTOROS_DEV_FIXTURES=1 to create development identities.');
if (!existsSync('.runtime/fixture-logins.json')) {
  await import('./fresh-fixtures.mjs');
  process.exit(0);
}
const db = new pg.Client({
  host: '127.0.0.1',
  port: 55432,
  database: 'motoros',
  user: 'postgres',
  password: env.POSTGRES_PASSWORD,
});
await db.connect();
export async function identity(email, name, password) {
  let [user] = await admin('motoros/users?exact=true&email=' + encodeURIComponent(email));
  if (!user) {
    await admin('motoros/users', 'POST', {
      username: email,
      email,
      emailVerified: true,
      enabled: true,
      firstName: name,
      lastName: 'Fixture',
      credentials: [{ type: 'password', value: password, temporary: false }],
    });
    [user] = await admin('motoros/users?exact=true&email=' + encodeURIComponent(email));
  } else
    await admin(`motoros/users/${user.id}/reset-password`, 'PUT', {
      type: 'password',
      value: password,
      temporary: false,
    });
  return user.id;
}
try {
  const fixtures = JSON.parse(readFileSync('.runtime/fixture-logins.json', 'utf8'));
  const accounts = [];
  for (const [index, old] of fixtures.entries()) {
    if (!old.email.endsWith('@example.test'))
      throw new Error('Only explicit synthetic fixture records may be migrated');
    const synthetic = await db.query(
      "select 1 from tenant.platform_users u join tenant.tenant_memberships m on m.user_id=u.id join tenant.tenants t on t.id=m.tenant_id where u.email=$1 and t.name like '%[fixture]%'",
      [old.email],
    );
    if (!synthetic.rowCount)
      throw new Error('Only database-confirmed synthetic workshops may be mapped');
    const password = 'Fixture-' + randomBytes(18).toString('base64url') + 'aA1!';
    const subject = await identity(
      old.email,
      index === 0 ? 'Apex Owner' : 'Torque Owner',
      password,
    );
    let migrated = await db.query(
      "update tenant.platform_users set issuer=$1,subject=$2,email_verified=true,status='ACTIVE',updated_at=now() where email=$3 and issuer='urn:motoros:legacy' and status='MIGRATION_REQUIRED' returning id",
      ['http://127.0.0.1:8180/realms/motoros', subject, old.email],
    );
    if (migrated.rows.length)
      await db.query(
        "update tenant.tenant_memberships set status='ACTIVE' where user_id=$1 and status='MIGRATION_REQUIRED'",
        [migrated.rows[0].id],
      );
    const found = await db.query(
      'select id from tenant.platform_users where issuer=$1 and subject=$2',
      ['http://127.0.0.1:8180/realms/motoros', subject],
    );
    if (!found.rowCount) throw new Error('Fixture identity mapping not found');
    accounts.push({ ...old, password, subject, userId: found.rows[0].id });
  }
  const owner = accounts[0];
  let extra = await db.query("select id from tenant.tenants where name='Apex Fleet [fixture]'");
  if (!extra.rowCount) {
    const id = randomUUID();
    await db.query('begin');
    try {
      await db.query(
        "insert into tenant.tenants(id,name,created_at,business_email) values($1,'Apex Fleet [fixture]',now(),$2)",
        [id, owner.email],
      );
      await db.query(
        "insert into tenant.branches(id,tenant_id,name,city,created_at,branch_code) values($1,$2,'Fleet Central','Chennai',now(),'FLEET')",
        [randomUUID(), id],
      );
      await db.query(
        "insert into tenant.tenant_memberships(id,tenant_id,user_id,role,scope,status) values($1,$2,$3,'BRAND_OWNER','TENANT','ACTIVE')",
        [randomUUID(), id, owner.userId],
      );
      await db.query('commit');
    } catch (error) {
      await db.query('rollback');
      throw error;
    }
    extra = { rows: [{ id }] };
  }
  owner.extraTenantId = extra.rows[0].id;
  mkdirSync('.runtime', { recursive: true });
  writeFileSync('.runtime/m2-fixtures.json', JSON.stringify(accounts, null, 2), { mode: 0o600 });
  console.log(
    'Mapped two synthetic legacy owners to verified provider identities and prepared a second brand for the first owner. Development credentials are in ignored .runtime/m2-fixtures.json.',
  );
} finally {
  await db.end();
}
