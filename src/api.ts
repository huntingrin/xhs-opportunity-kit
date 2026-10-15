import { z } from 'zod';
import { OpportunityStore } from './store.js';
import { importNotes } from './importer.js';
import { collect, collectSchema, screen, filterSchema } from './workflows.js';
import { createProvider, providerConfigSchema, type OpportunityProvider } from './providers.js';
import { stageSchema, reviewSchema, KitError } from './model.js';
import { exportCsv, exportJson } from './exporter.js';

export const listSchema = z.object({
  stage: stageSchema.optional(), decision: z.enum(['priority', 'pending', 'excluded', 'unreviewed']).optional(),
  query: z.string().optional(), limit: z.number().int().min(1).max(10000).default(100), offset: z.number().int().min(0).default(0),
}).strict();
export const commandSchemas = {
  import: z.object({ document: z.unknown() }).strict(),
  list: listSchema,
  show: z.object({ key: z.string().min(1) }).strict(),
  review: z.object({ key: z.string().min(1), review: reviewSchema }).strict(),
  stage: z.object({ key: z.string().min(1), stage: stageSchema, reason: z.string().min(1) }).strict(),
  screen: z.object({ criteria: filterSchema.default({}), selection: listSchema.default({}) }).strict(),
  export: z.object({ format: z.enum(['json', 'csv']).default('json'), selection: listSchema.default({}) }).strict(),
  collect: z.object({ options: collectSchema, provider: providerConfigSchema.optional() }).strict(),
  run: z.object({ id: z.string().min(1) }).strict(),
  doctor: z.object({}).strict(),
};
export type Command = keyof typeof commandSchemas;
/** Shared implementation for CLI and MCP; SDK users can also call the typed primitives directly. */
export async function execute(store: OpportunityStore, command: Command, input: unknown, provider?: OpportunityProvider): Promise<unknown> {
  switch (command) {
    case 'import': return store.ingest(importNotes(commandSchemas.import.parse(input).document));
    case 'list': { const p = listSchema.parse(input); return { items: store.list(p), totalInDatabase: store.count(), limit: p.limit, offset: p.offset }; }
    case 'show': { const p = commandSchemas.show.parse(input); const item = store.get(p.key); if (!item) throw new KitError('NOT_FOUND', 'Opportunity not found.'); return { item, events: store.events(p.key) }; }
    case 'review': { const p = commandSchemas.review.parse(input); return store.review(p.key, p.review); }
    case 'stage': { const p = commandSchemas.stage.parse(input); return store.transition(p.key, p.stage, p.reason); }
    case 'screen': { const p = commandSchemas.screen.parse(input); return { items: store.list(p.selection).map(o => screen(o, p.criteria)), selection: p.selection }; }
    case 'export': { const p = commandSchemas.export.parse(input); const rows = store.list(p.selection); return { format: p.format, count: rows.length, selection: p.selection, data: p.format === 'csv' ? exportCsv(rows) : exportJson(rows) }; }
    case 'collect': {
      const p = commandSchemas.collect.parse(input);
      if (!provider && !p.provider) throw new KitError('PROVIDER_REQUIRED', 'Configure a provider or import data supplied by your agent.');
      const owned = !provider;
      const active = provider ?? await createProvider(p.provider!);
      try { return await collect(store, active, p.options); }
      finally { if (owned) await active.close?.(); }
    }
    case 'run': { const p = commandSchemas.run.parse(input); const run = store.getRun(p.id); if (!run) throw new KitError('NOT_FOUND', 'Run not found.'); return run; }
    case 'doctor': commandSchemas.doctor.parse(input); return { version: '0.1.0', node: process.version, storage: 'sqlite', records: store.count(), providerConfigured: !!provider,
      capabilities: ['import', 'collect', 'review', 'screen', 'export', 'stage'], sendsMessages: false, startsScheduler: false };
    default: throw new KitError('UNKNOWN_COMMAND', 'Unknown command.');
  }
}
