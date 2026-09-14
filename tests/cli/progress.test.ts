import { describe, expect, it } from 'vitest';
import { progressLine } from '../../src/cli/progress.js';

function capture(isTTY: boolean) {
  const out: string[] = [];
  const line = progressLine('pinning S3 manifest', { write: (s) => { out.push(s); }, isTTY, now: (() => { let t = 0; return () => (t += 100); })() });
  return { out, line };
}

describe('progressLine', () => {
  it('redraws one line in place on a terminal and ends it with a newline', () => {
    const { out, line } = capture(true);
    line.tick(1, 4);
    line.tick(2, 4);
    line.done();
    expect(out[0]).toBe('\r      pinning S3 manifest: 1/4 (25%)');
    expect(out[1]).toBe('\r      pinning S3 manifest: 2/4 (50%)');
    expect(out[out.length - 1]).toBe('\n');
  });

  it('prints whole lines at 10% steps when stdout is not a terminal, so logs stay readable', () => {
    const { out, line } = capture(false);
    for (let i = 1; i <= 40; i += 1) line.tick(i, 40);
    line.done();
    expect(out.filter((s) => s.startsWith('      pinning')).length).toBe(10);
    expect(out[0]).toBe('      pinning S3 manifest: 4/40 (10%)\n');
    expect(out[out.length - 1]).toBe('      pinning S3 manifest: 40/40 (100%)\n');
  });

  it('always prints the final tick so a total under ten still shows something', () => {
    const { out, line } = capture(false);
    line.tick(1, 3); line.tick(2, 3); line.tick(3, 3);
    line.done();
    expect(out[out.length - 1]).toBe('      pinning S3 manifest: 3/3 (100%)\n');
  });
});
