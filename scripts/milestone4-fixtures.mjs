import { existsSync, readFileSync } from 'node:fs';
if (process.env.MOTOROS_DEV_FIXTURES !== '1')
  throw new Error('Set MOTOROS_DEV_FIXTURES=1 for synthetic workshop fixtures');
if (
  existsSync('.runtime/m4-fixtures.json') &&
  JSON.parse(readFileSync('.runtime/m4-fixtures.json')).lastAcceptance
)
  console.log('Existing Milestone 4 invited staff and acceptance fixtures retained.');
else await import('../tests/integration/milestone4.mjs');
