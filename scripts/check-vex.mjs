import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
if (Date.now() > Date.parse('2026-11-25T00:00:00Z'))
  throw new Error(
    'The Milestone 7 Spring applicability review has expired; reassess before publication',
  );
function walk(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap((x) =>
    x.isDirectory() && x.name !== 'target'
      ? walk(join(path, x.name))
      : x.name.endsWith('.java')
        ? [join(path, x.name)]
        : [],
  );
}
for (const path of [...walk('services'), ...walk('packages')]) {
  if (path.includes('src\\test') || path.includes('src/test')) continue;
  if (
    /XsltView|SseEmitter|ResponseBodyEmitter|ModelAndView|text\/event-stream|@Controller\b/.test(
      readFileSync(path, 'utf8'),
    )
  )
    throw new Error(`MVC/SSE applicability changed: ${path}; remove or reassess the VEX statement`);
}
console.log(
  'Spring applicability review is current and required vulnerable view/SSE paths remain absent.',
);
