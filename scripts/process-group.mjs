import { spawn, spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { openSync, closeSync } from 'node:fs';
import net from 'node:net';
export async function assertPortsAvailable(ports) {
  for (const port of ports)
    await new Promise((resolve, reject) => {
      const server = net.createServer();
      server.once('error', () =>
        reject(
          new Error(`Port ${port} is already in use; stop its owner before starting MotorOS.`),
        ),
      );
      server.listen(port, '127.0.0.1', () => server.close(resolve));
    });
}
/** Owns only spawned processes; a failed child stops its siblings. */
export class ProcessGroup extends EventEmitter {
  children = [];
  stopping = false;
  failure = null;
  start(command, args, env, label, logPath) {
    if (this.failure || this.stopping) throw this.failure || new Error('Process group stopped');
    const fd = logPath ? openSync(logPath, 'a') : null;
    const child = spawn(command, args, {
      env,
      detached: process.platform !== 'win32',
      stdio: fd === null ? 'ignore' : ['ignore', fd, fd],
    });
    if (fd !== null) closeSync(fd);
    this.children.push(child);
    const fail = (message) => {
      if (this.stopping) return;
      this.failure = new Error(`${label}: ${message}`);
      this.stop();
      this.emit('failure', this.failure);
    };
    child.once('error', (error) => fail(error.message));
    child.once('exit', (code, signal) =>
      fail(`exited unexpectedly (${signal || code}). Check its log.`),
    );
    return child;
  }
  async waitHttp(child, url) {
    for (let i = 0; i < 90; i++) {
      if (this.failure) throw this.failure;
      if (this.stopping || child.exitCode !== null || child.signalCode !== null)
        throw new Error('Service stopped before readiness');
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(2500) });
        if (response.ok) {
          if (this.failure) throw this.failure;
          return;
        }
      } catch (error) {
        if (this.failure) throw this.failure;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error(`Readiness timed out: ${url}`);
  }
  stop() {
    if (this.stopping) return;
    this.stopping = true;
    for (const child of this.children) {
      if (!child.pid) continue;
      if (process.platform === 'win32')
        spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      else {
        try {
          process.kill(-child.pid, 'SIGTERM');
        } catch {
          child.kill();
        }
      }
    }
  }
}
export function handleSignals(group) {
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, () => {
      group.stop();
      process.exit(0);
    });
  group.on('failure', (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
