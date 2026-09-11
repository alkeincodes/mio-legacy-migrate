export const SETTLE_WINDOW_MS = 60_000;
export const SETTLE_POLL_MS = 30_000;
export const SETTLE_ATTEMPTS = 3;

export type ListByMarker = (marker: string) => Promise<string[]>;

/** Thrown by a call whose outcome is unknown: timeout, lost response, killed process. */
export class UncertainOutcome extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UncertainOutcome';
  }
}

export class NeedsHumanResolution extends Error {
  constructor(message: string, readonly marker: string, readonly candidates: string[]) {
    super(message);
    this.name = 'NeedsHumanResolution';
  }
}

const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * After an uncertain create the server may still land the write at any later
 * time, and no client-side wait proves otherwise. So: settle, poll, then hand
 * the decision to a human whatever the count.
 */
export async function settleAndList(opts: {
  marker: string;
  list: ListByMarker;
  sleep?: (ms: number) => Promise<void>;
}): Promise<string[]> {
  const sleep = opts.sleep ?? realSleep;
  await sleep(SETTLE_WINDOW_MS);
  let seen: string[] = [];
  for (let attempt = 0; attempt < SETTLE_ATTEMPTS; attempt += 1) {
    if (attempt > 0) await sleep(SETTLE_POLL_MS);
    seen = await opts.list(opts.marker);
    if (seen.length > 0) return seen;
  }
  return seen;
}

export async function adoptOrCreate(opts: {
  marker: string;
  list: ListByMarker;
  create: () => Promise<string>;
  onIntent: () => void;
  onAdopted: (id: string) => void;
  onCreated: (id: string) => void;
  sleep?: (ms: number) => Promise<void>;
}): Promise<string> {
  opts.onIntent();

  const existing = await opts.list(opts.marker);
  if (existing.length === 1) {
    const id = existing[0] as string;
    opts.onAdopted(id);
    return id;
  }
  if (existing.length > 1) {
    throw new NeedsHumanResolution(
      `marker ${opts.marker} matches ${existing.length} targets (${existing.join(', ')}). Run: ledger resolve ${opts.marker} --adopt <id>`,
      opts.marker,
      existing,
    );
  }

  try {
    const id = await opts.create();
    opts.onCreated(id);
    return id;
  } catch (error) {
    if (!(error instanceof UncertainOutcome)) throw error;
    const candidates = await settleAndList({ marker: opts.marker, list: opts.list, sleep: opts.sleep });
    throw new NeedsHumanResolution(
      `the create for marker ${opts.marker} had an uncertain outcome (${error.message}). After the settle window ${candidates.length} target(s) carry it: ${candidates.join(', ') || 'none'}. Apply will not recreate on its own. Run: ledger resolve ${opts.marker} --adopt <id>, or --confirm-absent if you are certain nothing was created.`,
      opts.marker,
      candidates,
    );
  }
}
