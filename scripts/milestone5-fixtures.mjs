if(process.env.MOTOROS_DEV_FIXTURES!=='1')throw new Error('Set MOTOROS_DEV_FIXTURES=1 to create synthetic local commercial fixtures.');
await import('../tests/integration/milestone5.mjs');
