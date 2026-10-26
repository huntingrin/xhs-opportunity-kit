import { createHash } from 'node:crypto';
import { z } from 'zod';

export class KitError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = 'KitError'; }
}
export const timestamp = z.string().datetime({ offset: true });
export const idSchema = z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/);
export const stageSchema = z.enum(['discovered', 'contacted', 'requirements_review', 'accepted', 'delivered', 'closed']);
export const decisionSchema = z.enum(['priority', 'pending', 'excluded']);
export const workModeSchema = z.enum(['remote', 'hybrid', 'onsite', 'unknown']);
export const demandTypeSchema = z.enum(['buyer', 'agency', 'recruiter', 'seller', 'unknown']);
export const rateUnitSchema = z.enum(['per_item', 'per_minute', 'per_hour', 'per_day', 'per_month', 'per_project', 'unknown']);
export const riskFlagSchema = z.enum(['deposit', 'training_fee', 'unpaid_trial', 'unclear_rate',
  'unrealistic_volume', 'off_platform_payment', 'account_access', 'stale_post', 'agency_cut', 'other']);
export const rateSchema = z.object({
  min: z.number().nonnegative().finite(),
  max: z.number().nonnegative().finite().nullable().default(null),
  unit: rateUnitSchema.default('unknown'),
  volume: z.string().max(200).default(''),
}).strict().refine(v => v.max == null || v.max >= v.min, 'Rate max must be at least min.');
export const evidenceSchema = z.object({
  kind: z.enum(['note', 'comment', 'image_text', 'profile', 'historical_review']),
  text: z.string().min(1).max(20000),
  observedAt: timestamp,
  reference: z.string().max(256).optional(),
}).strict();
export const noteSchema = z.object({
  id: idSchema,
  title: z.string().max(2000).default(''),
  body: z.string().max(100000).default(''),
  author: z.string().max(500).default(''),
  publishedAt: timestamp.nullable().default(null),
  observedAt: timestamp,
  detailLevel: z.enum(['search', 'detail', 'import']).default('import'),
  commentsComplete: z.boolean().default(false),
  evidence: z.array(evidenceSchema).max(1000).default([]),
}).strict();
export type NoteInput = z.input<typeof noteSchema>;
export type Note = z.output<typeof noteSchema>;
export type Evidence = z.infer<typeof evidenceSchema> & { id: string };
export type Stage = z.infer<typeof stageSchema>;
export const reviewSchema = z.object({
  decision: decisionSchema,
  reason: z.string().min(1).max(10000),
  evidenceIds: z.array(z.string().min(1)).min(1).max(1000),
  reviewer: z.string().min(1).max(200),
  aiAcceptance: z.enum(['accepted', 'rejected', 'unknown']).default('unknown'),
  demandType: demandTypeSchema.default('unknown'),
  workMode: workModeSchema.default('unknown'),
  rate: rateSchema.nullable().default(null),
  riskFlags: z.array(riskFlagSchema).max(20).default([]),
  budget: z.number().nonnegative().finite().nullable().default(null),
  currency: z.string().length(3).default('CNY'),
}).strict();
export type ReviewInput = z.input<typeof reviewSchema>;
export type Review = z.output<typeof reviewSchema> & { reviewedAt: string; snapshotHash: string };
export type WorkMode = z.infer<typeof workModeSchema>;
export type DemandType = z.infer<typeof demandTypeSchema>;
export type Rate = z.infer<typeof rateSchema>;
export type RiskFlag = z.infer<typeof riskFlagSchema>;
export interface Opportunity {
  key: string; url: string; note: Note; evidence: Evidence[];
  firstSeenAt: string; lastSeenAt: string; snapshotHash: string;
  stage: Stage; review: Review | null; reviewStale: boolean;
}
export function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
export function noteKey(id: string): string { return `xiaohongshu:${idSchema.parse(id)}`; }
export function noteUrl(id: string): string { return `https://www.xiaohongshu.com/explore/${idSchema.parse(id)}`; }
export function parseNote(input: unknown): Note {
  const note = noteSchema.parse(input);
  // Image-only search cards may have no readable title/body. Preserve their identity
  // so detail/OCR can enrich them later; an empty evidence set cannot be reviewed.
  if (note.body && !note.evidence.some(e => e.kind === 'note' && e.text === note.body.slice(0, 20000))) {
    note.evidence.push({ kind: 'note', text: note.body.slice(0, 20000), observedAt: note.observedAt });
  } else if (!note.body && note.title && !note.evidence.length) {
    note.evidence.push({ kind: 'note', text: note.title, observedAt: note.observedAt });
  }
  return note;
}
export function evidenceId(noteId: string, e: z.infer<typeof evidenceSchema>): string {
  return digest([noteId, e.kind, e.reference ?? '', e.text]);
}
export function snapshotHash(note: Note): string {
  return digest([note.title, note.body, note.author, note.publishedAt, note.detailLevel,
    note.commentsComplete, note.evidence.map(e => evidenceId(note.id, e)).sort()]);
}
export function publicError(error: unknown): { code: string; message: string } {
  if (error instanceof KitError) return { code: error.code, message: error.message };
  if (error instanceof z.ZodError) return {
    code: 'VALIDATION_ERROR', message: error.issues.map(i => `${i.path.join('.') || 'input'}: ${i.message}`).join('; '),
  };
  return { code: 'INTERNAL_ERROR', message: 'Operation failed. Check paths, permissions, configuration and runtime compatibility.' };
}
