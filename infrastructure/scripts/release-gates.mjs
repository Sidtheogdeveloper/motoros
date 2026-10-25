import { config, manifest, run, save } from './cloud.mjs';
const c = config(process.argv[2]);
const release = manifest(process.argv[3], c);
if (c.environment === 'production') {
  const protection = JSON.parse(
    run('gh', ['api', `repos/${process.env.GITHUB_REPOSITORY}/environments/production`]),
  );
  if (
    !protection.protection_rules?.some(
      (r) => r.type === 'required_reviewers' && r.reviewers?.length,
    )
  )
    throw new Error('Production environment must have required reviewers');
  if (release.stagingSmokePassed !== true || !release.stagingSourceRun || !release.promotedAt)
    throw new Error(
      'Production requires protected staging evidence and digest-preserving promotion',
    );
}
if (process.env.SOURCE_RUN_ID) {
  const source = JSON.parse(
    run('gh', [
      'api',
      `repos/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.SOURCE_RUN_ID}`,
    ]),
  );
  if (
    source.conclusion !== 'success' ||
    source.event !== 'workflow_dispatch' ||
    source.head_repository?.full_name !== process.env.GITHUB_REPOSITORY ||
    source.head_branch !== 'main'
  )
    throw new Error(
      'Release artifacts must come from a successful authorized main-branch workflow',
    );
}
console.log('Release evidence gates passed.');
