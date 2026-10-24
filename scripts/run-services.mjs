import { mkdirSync } from 'node:fs';
import { localEnv, serviceEnv, java } from './runtime.mjs';
import { ProcessGroup, assertPortsAvailable, handleSignals } from './process-group.mjs';
const env = localEnv();
mkdirSync('.runtime/logs', { recursive: true });
const group = new ProcessGroup();
handleSignals(group);
try {
  await assertPortsAvailable([8081, 8082, 8083,8084,8085,8086]);
  const services = ['tenant', 'customer', 'workorder','booking','inventory','billing'].map((name, index) => ({
    port: 8081 + index,
    child: group.start(
      java(env),
      ['-jar', `services/${name}-service/target/${name}-service-0.1.0-SNAPSHOT.jar`],
      serviceEnv(env, name, index),
      name,
      `.runtime/logs/${name}.log`,
    ),
  }));
  await Promise.all(
    services.map(({ child, port }) =>
      group.waitHttp(child, `http://127.0.0.1:${port}/actuator/health`),
    ),
  );
  console.log('MotorOS OIDC backend services ready.');
} catch (error) {
  console.error(error.message);
  group.stop();
  process.exitCode = 1;
}
