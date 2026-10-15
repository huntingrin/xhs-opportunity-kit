import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { KitError, type Note, type NoteInput, type Opportunity, type ReviewInput, type Stage,
  evidenceId, noteKey, noteUrl, parseNote, reviewSchema, snapshotHash, stageSchema } from './model.js';

export class OpportunityStore {
  private db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const existed = path === ':memory:' || existsSync(path);
    this.db = new DatabaseSync(path);
    if (!existed && process.platform !== 'win32') chmodSync(path, 0o600);
    this.db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;');
    const version = Number((this.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
    if (version > 1) { this.db.close(); throw new KitError('SCHEMA_VERSION', 'Database was created by a newer SDK.'); }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS opportunities(key TEXT PRIMARY KEY, document TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, document TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY, opportunity_key TEXT NOT NULL,
        document TEXT NOT NULL, FOREIGN KEY(opportunity_key) REFERENCES opportunities(key));
      PRAGMA user_version=1;
    `);
  }
  close(): void { this.db.close(); }
  private transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  private save(value: Opportunity): void {
    this.db.prepare('INSERT INTO opportunities VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET document=excluded.document')
      .run(value.key, JSON.stringify(value));
  }
  get(key: string): Opportunity | null {
    const row = this.db.prepare('SELECT document FROM opportunities WHERE key=?').get(key) as { document: string } | undefined;
    return row ? JSON.parse(row.document) as Opportunity : null;
  }
  list(filters: { stage?: Stage; decision?: string; query?: string; limit?: number; offset?: number } = {}): Opportunity[] {
    const { limit = 100, offset = 0 } = filters;
    if (!Number.isInteger(limit) || limit < 1 || limit > 10000 || !Number.isInteger(offset) || offset < 0)
      throw new KitError('INVALID_PAGINATION', 'limit must be 1..10000 and offset must be nonnegative.');
    if (filters.stage) stageSchema.parse(filters.stage);
    const rows = this.db.prepare('SELECT document FROM opportunities ORDER BY key').all() as { document: string }[];
    return rows.map(r => JSON.parse(r.document) as Opportunity).filter(o =>
      (!filters.stage || o.stage === filters.stage) &&
      (!filters.decision || (o.review?.decision ?? 'unreviewed') === filters.decision) &&
      (!filters.query || `${o.note.title}\n${o.note.body}`.toLocaleLowerCase().includes(filters.query.toLocaleLowerCase()))
    ).slice(offset, offset + limit);
  }
  count(): number { return Number((this.db.prepare('SELECT count(*) AS n FROM opportunities').get() as { n: number }).n); }
  ingest(inputs: NoteInput[]): { inserted: number; updated: number; unchanged: number; keys: string[] } {
    const notes = inputs.map(parseNote); // Validate every item before any mutation.
    return this.transaction(() => {
      const result = { inserted: 0, updated: 0, unchanged: 0, keys: [] as string[] };
      for (const incoming of notes) {
        const key = noteKey(incoming.id); const old = this.get(key);
        const rank = { search: 0, import: 1, detail: 2 };
        // Older observations and search cards must not erase detailed content or reviews.
        const useIncoming = !old || (Date.parse(incoming.observedAt) >= Date.parse(old.note.observedAt)
          && rank[incoming.detailLevel] >= rank[old.note.detailLevel]);
        const note: Note = useIncoming ? incoming : old!.note;
        const hash = snapshotHash(note);
        const evidence = new Map((old?.evidence ?? []).map(e => [e.id, e]));
        for (const e of incoming.evidence) {
          const id = evidenceId(incoming.id, e);
          if (!evidence.has(id)) evidence.set(id, { ...e, id });
        }
        const value: Opportunity = {
          key, url: noteUrl(note.id), note, evidence: [...evidence.values()], snapshotHash: hash,
          firstSeenAt: old && Date.parse(old.firstSeenAt) < Date.parse(incoming.observedAt) ? old.firstSeenAt : incoming.observedAt,
          lastSeenAt: old && Date.parse(old.lastSeenAt) > Date.parse(incoming.observedAt) ? old.lastSeenAt : incoming.observedAt,
          stage: old?.stage ?? 'discovered', review: old?.review ?? null,
          reviewStale: !!old?.review && old.review.snapshotHash !== hash,
        };
        if (!old) result.inserted++;
        else if (hash !== old.snapshotHash || evidence.size !== old.evidence.length) result.updated++;
        else result.unchanged++;
        this.save(value); result.keys.push(key);
      }
      result.keys = [...new Set(result.keys)];
      return result;
    });
  }
  review(key: string, input: ReviewInput): Opportunity {
    const review = reviewSchema.parse(input);
    return this.transaction(() => {
      const o = this.require(key);
      if (review.evidenceIds.some(id => !o.evidence.some(e => e.id === id)))
        throw new KitError('UNKNOWN_EVIDENCE', 'Every review evidence ID must belong to this opportunity.');
      o.review = { ...review, reviewedAt: new Date().toISOString(), snapshotHash: o.snapshotHash };
      o.reviewStale = false; this.save(o); this.event(key, { type: 'review', review: o.review }); return o;
    });
  }
  transition(key: string, stage: Stage, reason: string): Opportunity {
    stageSchema.parse(stage);
    if (typeof reason !== 'string' || !reason.trim() || reason.length > 10000)
      throw new KitError('REASON_REQUIRED', 'A nonempty reason up to 10000 characters is required.');
    return this.transaction(() => {
      const o = this.require(key);
      if (o.stage === stage) return o;
      const next: Record<Stage, Stage[]> = {
        discovered: ['contacted', 'closed'], contacted: ['requirements_review', 'closed'],
        requirements_review: ['accepted', 'contacted', 'closed'], accepted: ['delivered', 'closed'],
        delivered: ['requirements_review', 'closed'], closed: ['discovered'],
      };
      if (!next[o.stage].includes(stage)) throw new KitError('INVALID_TRANSITION', `Cannot move from ${o.stage} to ${stage}.`);
      const from = o.stage; o.stage = stage; this.save(o); this.event(key, { type: 'transition', from, to: stage, reason }); return o;
    });
  }
  private require(key: string): Opportunity {
    const o = this.get(key); if (!o) throw new KitError('NOT_FOUND', 'Opportunity not found.'); return o;
  }
  private event(key: string, details: object): void {
    const id = randomUUID(); this.db.prepare('INSERT INTO events VALUES (?, ?, ?)')
      .run(id, key, JSON.stringify({ id, at: new Date().toISOString(), ...details }));
  }
  events(key: string): object[] {
    return (this.db.prepare('SELECT document FROM events WHERE opportunity_key=? ORDER BY rowid').all(key) as { document: string }[])
      .map(r => JSON.parse(r.document));
  }
  saveRun(run: { id: string }): void {
    this.db.prepare('INSERT INTO runs VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET document=excluded.document').run(run.id, JSON.stringify(run));
  }
  getRun(id: string): unknown {
    const row = this.db.prepare('SELECT document FROM runs WHERE id=?').get(id) as { document: string } | undefined;
    return row ? JSON.parse(row.document) : null;
  }
}
