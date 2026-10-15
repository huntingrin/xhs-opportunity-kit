import { type Opportunity } from './model.js';

function csvCell(value: unknown): string {
  let text = value == null ? '' : String(value);
  // Quote CSV syntax and neutralize spreadsheet formula prefixes, including leading whitespace.
  if (/^[\s\uFEFF]*[=+@-]/u.test(text) || /^[\t\r\n]/u.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
export function exportCsv(rows: Opportunity[]): string {
  const header = ['key', 'title', 'url', 'published_at', 'observed_at', 'stage', 'decision', 'review_stale', 'reason', 'ai_acceptance', 'budget', 'currency'];
  return [header, ...rows.map(o => [o.key, o.note.title, o.url, o.note.publishedAt, o.lastSeenAt,
    o.stage, o.review?.decision ?? 'unreviewed', o.reviewStale, o.review?.reason,
    o.review?.aiAcceptance ?? 'unknown', o.review?.budget, o.review?.currency])]
    .map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
export function exportJson(rows: Opportunity[]): string {
  return JSON.stringify({ schemaVersion: 1, exportedAt: new Date().toISOString(), opportunities: rows }, null, 2) + '\n';
}
