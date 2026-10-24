import { spawnSync } from 'node:child_process';
import { java, localEnv } from './runtime.mjs';
const env = localEnv();
const r = spawnSync(
  java(env),
  [
    '-Dloader.main=com.motoros.customer.LocalStorageSetup',
    '-cp',
    'services/customer-service/target/customer-service-0.1.0-SNAPSHOT.jar',
    'org.springframework.boot.loader.launch.PropertiesLauncher',
  ],
  { env, stdio: 'inherit' },
);
if (r.status !== 0)
  throw new Error(
    'Build Customer Service before configuring local object storage (mvn package -DskipTests)',
  );
