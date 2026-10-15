import { z } from 'zod';
import { KitError, noteSchema, parseNote, type Note } from './model.js';

export function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function str(value: unknown): string { return typeof value === 'string' ? value : ''; }
export function date(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  const time = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}
/** Allowlist fields; raw responses, access tokens and signed URLs never enter the normalized record. */
export function normalizeFeed(raw: unknown, observedAt: string): Note {
  const root = object(raw); const data = object(root.data);
  const note = Object.keys(object(data.note)).length ? object(data.note)
    : Object.keys(object(root.noteCard)).length ? object(root.noteCard)
    : Object.keys(object(root.note)).length ? object(root.note) : root;
  const id = str(note.noteId) || str(root.id) || str(root.feed_id);
  const detail = typeof note.desc === 'string';
  const comments = object(data.comments ?? root.comments);
  const evidence: z.infer<typeof noteSchema>['evidence'] = [];
  const addComments = (items: unknown[], depth = 0): void => {
    if (depth > 3) return;
    for (const value of items.slice(0, 100)) {
      const c = object(value); const text = str(c.content);
      if (text) evidence.push({ kind: 'comment', text: text.slice(0, 20000), observedAt,
        ...(str(c.id) ? { reference: str(c.id).slice(0, 256) } : {}) });
      if (Array.isArray(c.subComments)) addComments(c.subComments, depth + 1);
    }
  };
  if (Array.isArray(comments.list)) addComments(comments.list);
  return parseNote({ id, title: str(note.title) || str(note.displayTitle), body: str(note.desc),
    author: str(object(note.user).nickname), publishedAt: date(note.time), observedAt,
    detailLevel: detail ? 'detail' : 'search',
    // Top-level pagination does not prove all nested replies were read.
    commentsComplete: false, evidence: evidence.slice(0, 999) });
}

/** Supported: normalized array/{notes}, historical lead-delivery, or collected {searches,details}. */
export function importNotes(document: unknown, now = new Date().toISOString()): Note[] {
  if (Array.isArray(document)) return document.map(parseNote);
  const d = object(document);
  if (Array.isArray(d.notes)) return d.notes.map(parseNote);
  if (d.schemaVersion === 1 && Array.isArray(d.opportunities)) {
    // Portable content import, not a database restore: stages and current judgments are not replayed.
    return d.opportunities.map(value => {
      const o = object(value); const n = noteSchema.parse(o.note); const r = object(o.review);
      if (typeof r.reason === 'string' && r.reason) n.evidence.push({ kind: 'historical_review',
        text: `${String(r.decision)}: ${r.reason}`.slice(0, 20000), observedAt: date(r.reviewedAt) ?? n.observedAt });
      return parseNote(n);
    });
  }
  if (Array.isArray(d.leads) || Array.isArray(d.excluded)) {
    const rows = [...(Array.isArray(d.leads) ? d.leads : []), ...(Array.isArray(d.excluded) ? d.excluded : [])];
    return rows.map(raw => {
      const r = object(raw); const observedAt = date(r.verified_at) ?? now;
      const historicalText = [str(r.status), str(r.reason), str(r.ai_acceptance), str(r.confirm)].filter(Boolean).join('\n');
      return parseNote({ id: r.id, title: str(r.title), body: str(r.summary), author: str(r.author),
        observedAt, publishedAt: date(r.time) ?? date(r.date), detailLevel: 'import', commentsComplete: false,
        evidence: historicalText ? [{ kind: 'historical_review', text: historicalText, observedAt }] : [] });
    });
  }
  if (Array.isArray(d.searches) || Array.isArray(d.details)) {
    const nowSeen = date(d.checked_at) ?? now;
    const result: Note[] = [];
    for (const search of Array.isArray(d.searches) ? d.searches : []) {
      const feeds = object(search).feeds;
      if (!Array.isArray(feeds)) throw new KitError('IMPORT_SHAPE', 'Each historical search must contain a feeds array.');
      for (const f of feeds) {
        if (isFeed(f)) result.push(normalizeFeed(f, nowSeen));
      }
    }
    for (const detail of Array.isArray(d.details) ? d.details : []) result.push(normalizeFeed(detail, nowSeen));
    return result;
  }
  throw new KitError('IMPORT_SHAPE', 'Expected a normalized array, {notes}, {leads,excluded} or {searches,details}.');
}
export function isFeed(raw: unknown): boolean {
  const r = object(raw);
  return r.modelType !== 'hot_query' && r.modelType !== 'query' &&
    (!!r.noteCard || !!r.note || !!object(r.data).note || typeof r.title === 'string');
}
