import { spawn, type ChildProcess } from 'node:child_process';
import { createConnection } from 'node:net';
import type { Env } from '../config/env.js';
import { logger } from '../log/logger.js';

const DEFAULT_LOCAL_PORT = 13306;
const READY_TIMEOUT_MS = 20_000;

export function buildSshArgs(env: Env, localPort: number): string[] {
  return [
    '-N',
    '-o', 'ExitOnForwardFailure=yes',
    '-o', 'StrictHostKeyChecking=yes',
    '-o', `UserKnownHostsFile=${env.sshKnownHostsFile}`,
    '-o', 'ConnectTimeout=20',
    '-o', 'ServerAliveInterval=30',
    '-o', 'ServerAliveCountMax=3',
    '-L', `127.0.0.1:${localPort}:${env.legacyDbHost}:${env.legacyDbPort}`,
    `${env.sshBoxUser}@${env.sshBoxHost}`,
  ];
}

function probe(port: number): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.setTimeout(1_000);
    socket.once('connect', () => { socket.destroy(); resolvePromise(true); });
    socket.once('error', () => { socket.destroy(); resolvePromise(false); });
    socket.once('timeout', () => { socket.destroy(); resolvePromise(false); });
  });
}

export class Tunnel {
  private constructor(
    readonly localPort: number,
    private readonly child: ChildProcess,
  ) {}

  static async open(env: Env, localPort = DEFAULT_LOCAL_PORT): Promise<Tunnel> {
    const child = spawn('ssh', buildSshArgs(env, localPort), { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) {
        throw new Error(`ssh tunnel exited with code ${child.exitCode}: ${stderr.trim()}`);
      }
      if (await probe(localPort)) {
        logger.info('ssh tunnel up', { localPort });
        return new Tunnel(localPort, child);
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    child.kill('SIGTERM');
    throw new Error(
      `ssh tunnel did not accept connections on 127.0.0.1:${localPort} within ${READY_TIMEOUT_MS}ms: ${stderr.trim()}`,
    );
  }

  async close(): Promise<void> {
    if (this.child.exitCode === null) this.child.kill('SIGTERM');
    logger.info('ssh tunnel closed', { localPort: this.localPort });
  }
}
