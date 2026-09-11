import { describe, expect, it } from 'vitest';
import { buildSshArgs } from '../../src/extract/tunnel.js';
import type { Env } from '../../src/config/env.js';

const env = {
  legacyDbHost: 'replica.rds.amazonaws.com',
  legacyDbPort: 3306,
  sshBoxHost: 'box.membership.io',
  sshBoxUser: 'ubuntu',
  sshKnownHostsFile: '/home/me/.ssh/known_hosts_mio',
} as Env;

describe('buildSshArgs', () => {
  it('forwards to the replica and binds the local end to loopback only', () => {
    const args = buildSshArgs(env, 13306);
    expect(args).toContain('-L');
    expect(args).toContain('127.0.0.1:13306:replica.rds.amazonaws.com:3306');
  });

  it('pins the host key and refuses to add an unknown one', () => {
    const args = buildSshArgs(env, 13306);
    expect(args).toContain('-o');
    expect(args).toContain('StrictHostKeyChecking=yes');
    expect(args).toContain('UserKnownHostsFile=/home/me/.ssh/known_hosts_mio');
  });

  it('runs with no remote command and no tty, and keeps the channel alive', () => {
    const args = buildSshArgs(env, 13306);
    expect(args).toContain('-N');
    expect(args).toContain('ServerAliveInterval=30');
    expect(args[args.length - 1]).toBe('ubuntu@box.membership.io');
  });
});
