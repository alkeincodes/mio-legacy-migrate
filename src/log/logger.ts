import { createRedactor } from './redact.js';

let redact = createRedactor([]);

function emit(level: 'info' | 'warn' | 'error', msg: string, fields?: Record<string, unknown>): void {
  const line = fields
    ? `${msg} ${JSON.stringify(fields)}`
    : msg;
  const text = redact(`[${new Date().toISOString()}] ${level.toUpperCase()} ${line}`);
  if (level === 'error') process.stderr.write(`${text}\n`);
  else process.stdout.write(`${text}\n`);
}

export const logger = {
  setSecrets(secrets: string[]): void {
    redact = createRedactor(secrets);
  },
  info: (msg: string, fields?: Record<string, unknown>) => emit('info', msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => emit('warn', msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => emit('error', msg, fields),
};
