import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { KitError, publicError, timestamp, type Opportunity } from './model.js';
import { OpportunityStore } from './store.js';
import { type OpportunityProvider } from './providers.js';

export const collectSchema = z.object({
  keywords: z.array(z.string().trim().min(1).max(200)).min(1).max(20),
  maxPagesPerKeyword: z.number().int().min(1).max(20).default(1),
  maxDetails: z.number().int().min(0).max(100).default(0),
  timeoutMs: z.number().int().min(100).max(180000).default(30000),
  filters: z.record(z.string()).optional(),
}).strict();
export interface CollectionRun {
  id: string; provider: string; startedAt: string; finishedAt?: string;
  status: 'running' | 'complete' | 'partial' | 'failed'; keywords: string[];
  pages: number; observations: number; keys: string[]; detailReads: number;
  errors: { keyword?: string; id?: string; code: string; message: string }[];
  warnings: string[];
}
async function bounded<T>(fn: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> {
  const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new KitError('TIMEOUT', 'Provider operation exceeded its time budget.')); }, timeoutMs);
  });
  try { return await Promise.race([fn(controller.signal), timeout]); }
  finally { clearTimeout(timer!); }
}
export async function collect(store: OpportunityStore, provider: OpportunityProvider, input: z.input<typeof collectSchema>): Promise<CollectionRun> {
  const options = collectSchema.parse(input);
  const run: CollectionRun = { id: randomUUID(), provider: provider.name, startedAt: new Date().toISOString(),
    status: 'running', keywords: [...new Set(options.keywords)], pages: 0, observations: 0,
    keys: [], detailReads: 0, errors: [], warnings: [] };
  store.saveRun(run);
  const ids = new Set<string>(); let partial = false;
  for (const keyword of run.keywords) {
    let cursor: string | undefined; const cursors = new Set<string>(); let exhausted = false;
    for (let pageNumber = 0; pageNumber < options.maxPagesPerKeyword; pageNumber++) {
      try {
        const page = await bounded(signal => provider.search({ keyword, cursor, filters: options.filters, signal }), options.timeoutMs);
        const result = store.ingest(page.notes);
        run.pages++; run.observations += page.notes.length;
        for (const key of result.keys) ids.add(key);
        run.keys = [...ids]; run.warnings.push(...(page.warnings ?? []));
        exhausted = page.complete && !page.nextCursor;
        store.saveRun(run);
        if (!page.nextCursor) { if (!exhausted) partial = true; break; }
        if (cursors.has(page.nextCursor)) throw new KitError('CURSOR_LOOP', 'Provider repeated a pagination cursor.');
        cursors.add(page.nextCursor); cursor = page.nextCursor;
      } catch (error) { run.errors.push({ keyword, ...publicError(error) }); partial = true; break; }
    }
    if (!exhausted) { partial = true; run.warnings.push('SEARCH_INCOMPLETE'); }
  }
  if (options.maxDetails && !provider.detail) run.warnings.push('DETAIL_UNSUPPORTED');
  if (provider.detail) {
    for (const key of run.keys.slice(0, options.maxDetails)) {
      const id = store.get(key)!.note.id;
      try {
        const note = await bounded(signal => provider.detail!(id, signal), options.timeoutMs);
        if (note.id !== id) throw new KitError('PROVIDER_ID_MISMATCH', 'Detail returned a different note ID.');
        store.ingest([note]); run.detailReads++;
      } catch (error) { run.errors.push({ id, ...publicError(error) }); partial = true; }
      store.saveRun(run);
    }
  }
  if (options.maxDetails && !provider.detail) partial = true;
  run.status = run.pages === 0 && run.errors.length ? 'failed' : partial ? 'partial' : 'complete';
  run.warnings = [...new Set(run.warnings)]; run.finishedAt = new Date().toISOString(); store.saveRun(run);
  return run;
}

export const filterSchema = z.object({
  query: z.string().optional(), publishedFrom: timestamp.optional(), publishedTo: timestamp.optional(),
  requireAiAccepted: z.boolean().default(false), minBudget: z.number().nonnegative().optional(),
  currency: z.string().length(3).default('CNY'), excludeSellers: z.boolean().default(true),
}).strict().refine(v => !v.publishedFrom || !v.publishedTo || Date.parse(v.publishedFrom) <= Date.parse(v.publishedTo), 'Date range is reversed.');
export function screen(opportunity: Opportunity, criteria: z.input<typeof filterSchema>): { key: string; result: 'match' | 'pending' | 'excluded'; reasons: string[] } {
  const c = filterSchema.parse(criteria); const reasons: string[] = []; let excluded = false;
  const o = opportunity; const review = o.reviewStale ? null : o.review;
  if (o.reviewStale) reasons.push('REVIEW_STALE');
  if (review?.decision === 'excluded' || o.stage === 'closed') { excluded = true; reasons.push('EXCLUDED_OR_CLOSED'); }
  if (c.query && !`${o.note.title}\n${o.note.body}`.toLocaleLowerCase().includes(c.query.toLocaleLowerCase())) { excluded = true; reasons.push('QUERY_MISMATCH'); }
  if (c.publishedFrom || c.publishedTo) {
    if (!o.note.publishedAt) reasons.push('DATE_UNKNOWN');
    else if ((c.publishedFrom && Date.parse(o.note.publishedAt) < Date.parse(c.publishedFrom)) ||
      (c.publishedTo && Date.parse(o.note.publishedAt) > Date.parse(c.publishedTo))) { excluded = true; reasons.push('OUTSIDE_DATE_RANGE'); }
  }
  if (c.excludeSellers && review?.demandType === 'seller') { excluded = true; reasons.push('SELLER'); }
  else if (!review || review.demandType === 'unknown') reasons.push('DEMAND_UNVERIFIED');
  if (c.requireAiAccepted) {
    if (review?.aiAcceptance === 'rejected') { excluded = true; reasons.push('AI_REJECTED'); }
    else if (review?.aiAcceptance !== 'accepted') reasons.push('AI_ACCEPTANCE_UNKNOWN');
  }
  if (c.minBudget !== undefined) {
    if (review?.budget == null) reasons.push('BUDGET_UNKNOWN');
    else if (review.currency !== c.currency) reasons.push('CURRENCY_MISMATCH');
    else if (review.budget < c.minBudget) { excluded = true; reasons.push('BUDGET_TOO_LOW'); }
  }
  if (review?.decision === 'pending') reasons.push('REVIEW_PENDING');
  return { key: o.key, result: excluded ? 'excluded' : reasons.length ? 'pending' : 'match', reasons };
}
