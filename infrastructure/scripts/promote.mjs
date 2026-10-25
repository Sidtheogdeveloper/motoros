import { config, authorize, run, aws, save, names } from './cloud.mjs';
import { readFileSync } from 'node:fs';
const c = config(process.argv[2]),
  m = JSON.parse(readFileSync(process.argv[3]));
if (
  c.environment !== 'production' ||
  m.environment !== 'staging' ||
  m.stagingSmokePassed !== true ||
  !m.verifiedAt
)
  throw new Error('Promotion requires a verified staging release');
authorize(c);
const result = {
  ...m,
  environment: 'production',
  stagingImages: m.images,
  images: {},
  stagingSourceRun: process.env.SOURCE_RUN_ID,
  promotedAt: new Date().toISOString(),
};
for (const name of names) {
  const source = m.images[name];
  if (!/@sha256:[a-f0-9]{64}$/.test(source)) throw new Error('Source digest missing');
  const destination = `${c.account_id}.dkr.ecr.${c.region}.amazonaws.com/motoros-production/${name}`;
  run('crane', ['copy', source, `${destination}:${m.sourceSha}`], { stdio: 'inherit' });
  const digest = aws(
    'ecr',
    'describe-images',
    { repositoryName: `motoros-production/${name}`, imageIds: [{ imageTag: m.sourceSha }] },
    c,
  ).imageDetails[0].imageDigest;
  if (digest !== source.split('@')[1]) throw new Error(`Promotion changed content digest: ${name}`);
  result.images[name] = `${destination}@${digest}`;
}
save(process.argv[4], result);
