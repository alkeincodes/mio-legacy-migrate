/**
 * One progress line for a long loop that otherwise logs nothing, so a
 * multi-minute step (pinning thousands of S3 objects) is visibly alive.
 * On a terminal it redraws in place; piped to a file it prints a whole
 * line at every 10% step and at the end.
 */
export interface ProgressLine {
  tick(done: number, total: number): void;
  done(): void;
}

interface ProgressIo {
  write: (s: string) => void;
  isTTY: boolean;
  now: () => number;
}

const INDENT = '      ';

export function progressLine(label: string, io?: Partial<ProgressIo>): ProgressLine {
  const write = io?.write ?? ((s: string) => { process.stdout.write(s); });
  const isTTY = io?.isTTY ?? Boolean(process.stdout.isTTY);
  const now = io?.now ?? Date.now;
  let lastDrawn = 0;
  let lastStep = -1;
  let drewAnything = false;

  const text = (done: number, total: number): string =>
    `${INDENT}${label}: ${done}/${total} (${total === 0 ? 100 : Math.floor((done / total) * 100)}%)`;

  return {
    tick(done, total) {
      if (isTTY) {
        // Cap the redraw rate so a fast loop does not spend its time painting.
        const t = now();
        if (done < total && t - lastDrawn < 100) return;
        lastDrawn = t;
        write(`\r${text(done, total)}`);
        drewAnything = true;
        return;
      }
      const step = total === 0 ? 10 : Math.floor((done * 10) / total);
      if (step === lastStep && done < total) return;
      lastStep = step;
      if (step === 0 && done < total) return;
      write(`${text(done, total)}\n`);
    },
    done() {
      if (isTTY && drewAnything) write('\n');
    },
  };
}
