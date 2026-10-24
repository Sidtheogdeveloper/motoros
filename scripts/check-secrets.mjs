import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
const files = [
  ...new Set(
    execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
      encoding: 'utf8',
    })
      .split('\0')
      .filter(Boolean),
  ),
];
const known = existsSync('.env')
  ? readFileSync('.env', 'utf8')
      .split(/\r?\n/)
      .filter((s) => s.includes('='))
      .map((s) => s.slice(s.indexOf('=') + 1))
      .filter((s) => s.length > 20)
  : [];
const patterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /\bsk-proj-[A-Za-z0-9_-]{30,}/,
];
for (const source of [
  '.runtime/fixture-logins.json',
  '.runtime/m2-fixtures.json',
  '.runtime/m3-fixtures.json',
  '.runtime/m4-fixtures.json',
  '.runtime/m5-fixtures.json',
])
  if (existsSync(source)) {
    const parsed = JSON.parse(readFileSync(source, 'utf8'));
    for (const fixture of Array.isArray(parsed) ? parsed : Object.values(parsed)) {
      if (typeof fixture.password === 'string' && fixture.password.length > 20)
        known.push(fixture.password);
    }
  }
const findings = [];
for (const file of files) {
  const data = readFileSync(file).toString('utf8');
  if (known.some((value) => data.includes(value)))
    findings.push({ file, reason: 'generated local secret present' });
  if (patterns.some((pattern) => pattern.test(data)))
    findings.push({ file, reason: 'credential pattern' });
}
const commitCount = Number(
  execFileSync('git', ['rev-list', '--all', '--count'], { encoding: 'utf8' }).trim() || 0,
);
const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);
for (const file of [
  '.env',
  '.env.production',
  'apps/workshop-dashboard/.env.local',
  '.runtime/fixture-logins.json',
  '.runtime/m2-fixtures.json',
  '.runtime/m3-fixtures.json',
  '.runtime/m4-fixtures.json',
  '.runtime/m5-fixtures.json',
  '.runtime/keycloak/motoros-realm.json',
]) {
  const r = execFileSync('git', ['check-ignore', file], { encoding: 'utf8' });
  assert.ok(r.trim());
  assert.ok(!tracked.includes(file));
}
const result = {
  sourceFilesScanned: files.length,
  trackedFiles: tracked.length,
  commitCount,
  generatedSecretValuesChecked: known.length,
  findings,
  historyScan:
    commitCount === 0
      ? 'No commits exist; committed secret check is vacuous'
      : 'History scanner required separately',
};
mkdirSync('.runtime', { recursive: true });
writeFileSync('.runtime/review-secrets-results.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
assert.equal(findings.length, 0, 'Source contains credential candidates');
