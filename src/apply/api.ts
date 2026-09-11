import type { Profile } from '../config/profile.js';
import { Budget, type BudgetOp } from './budget.js';
import { UncertainOutcome } from './inflight.js';
import { logger } from '../log/logger.js';

const REQUEST_TIMEOUT_MS = 60_000;

export class StaleRevisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StaleRevisionError';
  }
}

export class PreconditionRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PreconditionRequiredError';
  }
}

export class RateLimitedError extends Error {
  constructor(message: string, readonly retryAt: Date) {
    super(message);
    this.name = 'RateLimitedError';
  }
}

export interface ApiOptions {
  profile: Profile;
  apiKey: string;
  budget: Budget;
  fetchImpl?: typeof fetch;
}

interface JsonApiList<T> {
  data: T[];
  links?: { next?: string };
}

export class ApiClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: ApiOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      Authorization: `Bearer ${this.opts.apiKey}`,
      // Achievements and segments 415 on anything else (require_jsonapi_content_type).
      'Content-Type': 'application/vnd.api+json',
      Accept: 'application/vnd.api+json, application/json',
      ...extra,
    };
  }

  private async send(
    method: string,
    path: string,
    body: unknown,
    extraHeaders: Record<string, string>,
    op: BudgetOp | undefined,
    mutating: boolean,
  ): Promise<{ body: unknown; etag: string | null }> {
    const url = path.startsWith('http') ? path : `${this.opts.profile.apiBase.replace(/\/$/, '')}${path}`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: this.headers(extraHeaders),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (mutating) {
        throw new UncertainOutcome(`${method} ${path} did not return a response: ${message}`);
      }
      throw new Error(`${method} ${path} failed: ${message}`);
    }

    if (response.status === 429) {
      const header = response.headers.get('Retry-After');
      const seconds = header && Number.isFinite(Number(header)) ? Number(header) : 600;
      const retryAt = new Date(Date.now() + seconds * 1000);
      if (op) this.opts.budget.exhaustUntil(op, retryAt);
      throw new RateLimitedError(`${method} ${path} was rate limited until ${retryAt.toISOString()}`, retryAt);
    }
    if (response.status === 428) {
      throw new PreconditionRequiredError(`${method} ${path} requires an If-Match header`);
    }
    if (response.status === 409) {
      throw new StaleRevisionError(
        `${method} ${path} returned 409: the target moved since the revision token was read`,
      );
    }
    if (!response.ok) {
      throw new Error(`${method} ${path} returned ${response.status}: ${(await response.text()).slice(0, 500)}`);
    }
    if (op) this.opts.budget.record(op);

    const etag = response.headers.get('ETag');
    const text = await response.text();
    return {
      body: text.length === 0 ? null : (JSON.parse(text) as unknown),
      etag: etag ? etag.replace(/^W\//, '').replace(/^"|"$/g, '') : null,
    };
  }

  async get<T>(path: string): Promise<{ body: T; etag: string | null }> {
    const result = await this.send('GET', path, undefined, {}, undefined, false);
    return { body: result.body as T, etag: result.etag };
  }

  async post<T>(
    path: string,
    body: unknown,
    op?: BudgetOp,
    opts: { ifMatch?: string } = {},
  ): Promise<T> {
    if (op) this.opts.budget.assertCanSpend(op, 1);
    const headers: Record<string, string> = opts.ifMatch ? { 'If-Match': opts.ifMatch } : {};
    return (await this.send('POST', path, body, headers, op, true)).body as T;
  }

  async patch<T>(
    path: string,
    body: unknown,
    opts: { ifMatch?: string; op?: BudgetOp } = {},
  ): Promise<T> {
    if (opts.op) this.opts.budget.assertCanSpend(opts.op, 1);
    const headers: Record<string, string> = opts.ifMatch ? { 'If-Match': opts.ifMatch } : {};
    return (await this.send('PATCH', path, body, headers, opts.op, true)).body as T;
  }

  async put<T>(
    path: string,
    body: unknown,
    opts: { ifMatch?: string; op?: BudgetOp } = {},
  ): Promise<{ body: T; etag: string | null }> {
    if (opts.op) this.opts.budget.assertCanSpend(opts.op, 1);
    const headers: Record<string, string> = opts.ifMatch ? { 'If-Match': opts.ifMatch } : {};
    const result = await this.send('PUT', path, body, headers, opts.op, true);
    return { body: result.body as T, etag: result.etag };
  }

  async delete(path: string): Promise<void> {
    await this.send('DELETE', path, undefined, {}, undefined, true);
  }

  /**
   * Pages a collection to the end. No list endpoint this tool uses has a filter
   * or search parameter, so a marker lookup must read every page and filter
   * client-side.
   */
  async *listAll<T>(path: string): AsyncGenerator<T> {
    let next: string | undefined = `${path}${path.includes('?') ? '&' : '?'}page[size]=100`;
    let pages = 0;
    while (next) {
      const { body }: { body: JsonApiList<T> } = await this.get<JsonApiList<T>>(next);
      for (const row of body.data ?? []) yield row;
      // The backend builds links.next on the bare /api/ twin; use the /api/v1/ spelling.
      next = body.links?.next?.replace(/^\/api\/(?!v1\/)/, '/api/v1/');
      pages += 1;
      if (pages > 1_000) throw new Error(`listAll(${path}) exceeded 1000 pages; refusing to loop`);
    }
    logger.info('listed a collection', { path, pages });
  }
}
