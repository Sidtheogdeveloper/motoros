const ports = process.argv.slice(2).map(Number);
for (const port of ports) {
  let ready = false;
  for (let attempt = 0; attempt < 90; attempt++) {
    try {
      const response = await fetch(
        `http://127.0.0.1:${port}${port === 3000 ? '/login' : '/actuator/health'}`,
        { signal: AbortSignal.timeout(2000) },
      );
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!ready) throw new Error(`Service ${port} did not become healthy`);
  console.log(`Ready: ${port}`);
}
