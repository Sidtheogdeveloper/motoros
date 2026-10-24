import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fixtures, signIn, sessionData } from '../tests/helpers/oidc.mjs';
const browser = await chromium.launch();
try {
  const context = await browser.newContext();
  await signIn(await context.newPage(), fixtures[0]);
  const { accessToken } = await sessionData(context);
  mkdirSync('packages/api-contracts/openapi', { recursive: true });
  for (const [name, port] of [
    ['tenant', 8081],
    ['customer', 8082],
    ['workorder', 8083],
    ['booking', 8084],
    ['inventory', 8085],
    ['billing', 8086],
  ]) {
    const r = await fetch(`http://127.0.0.1:${port}/v3/api-docs`, {
      headers: { Authorization: 'Bearer ' + accessToken },
    });
    if (!r.ok) throw new Error(name + ' OpenAPI export failed');
    const contract = await r.json();
    contract.info = {
      ...contract.info,
      title: 'MotorOS ' + name + ' Service',
      version: '0.5.0',
      description:
        'Milestone 5 authenticated REST contract. Tenant and branch authority are independently verified by the backend. Commercial decimal quantities and monetary values use exact decimal strings.',
    };
    // Binding accepts an absent header to return a consistent domain error; the public operation requires it.
    for (const item of Object.values(contract.paths))
      for (const operation of Object.values(item))
        if (operation && Array.isArray(operation.parameters))
          for (const parameter of operation.parameters)
            if (parameter.name === 'Idempotency-Key') {
              parameter.required = true;
              parameter.description =
                'Required stable key for unchanged retries. Reusing a key with different input returns 409.';
              parameter.schema = { type: 'string', pattern: '^[A-Za-z0-9_-]{16,100}$' };
            }
    if(name!=='tenant')for(const [path,item]of Object.entries(contract.paths))if(path.startsWith('/api/internal/'))for(const operation of Object.values(item)){if(!operation||typeof operation!=='object')continue;operation.parameters||=[];for(const [header,schema,description]of [['X-MotorOS-Tenant',{type:'string',format:'uuid'},'Selected tenant; live authority is independently verified'],['X-User-Token',{type:'string'},'Original user JWT. Accepted only with a trusted service bearer and internal scope']])if(!operation.parameters.some(p=>p.name===header))operation.parameters.push({name:header,in:'header',required:true,schema,description});}
    writeFileSync(
      `packages/api-contracts/openapi/${name}.json`,
      JSON.stringify(contract, null, 2) + '\n',
    );
    console.log('Exported ' + name + ' API contract');
  }
} finally {
  await browser.close();
}
