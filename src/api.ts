import { z } from 'zod';
import { OpportunityStore } from './store.js';
import { importNotes } from './importer.js';
import { collect, collectSchema, screen, summarizeScreen, filterSchema } from './workflows.js';
import { createProvider, providerConfigSchema, type OpportunityProvider } from './providers.js';
import { stageSchema, reviewSchema, KitError } from './model.js';
import { exportCsv, exportJson } from './exporter.js';
import { buildReport, createDemoReport } from './report.js';

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
  export: z.object({ format: z.enum(['json', 'csv']).default('json'),
    header: z.enum(['en', 'zh']).default('en'), selection: listSchema.default({}) }).strict(),
  report: z.object({ title: z.string().max(200).optional(), scope: z.string().max(500).optional(),
    criteria: filterSchema.default({}), selection: listSchema.default({}), locale: z.enum(['zh', 'en']).default('zh') }).strict(),
  demo: z.object({}).strict(),
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
    case 'show': {
      const p = commandSchemas.show.parse(input); const item = store.get(p.key);
      if (!item) throw new KitError('NOT_FOUND', 'Opportunity not found.');
      const quotes = item.evidence.slice(0, 10).map(e => ({ id: e.id, kind: e.kind,
        text: e.text.slice(0, 1000), observedAt: e.observedAt, ...(e.reference ? { reference: e.reference } : {}) }));
      return { item, events: store.events(p.key), quotes };
    }
    case 'review': { const p = commandSchemas.review.parse(input); return store.review(p.key, p.review); }
    case 'stage': { const p = commandSchemas.stage.parse(input); return store.transition(p.key, p.stage, p.reason); }
    case 'screen': {
      const p = commandSchemas.screen.parse(input);
      const items = store.list(p.selection).map(o => screen(o, p.criteria));
      return { items, summary: summarizeScreen(items), criteria: p.criteria, selection: p.selection };
    }
    case 'export': {
      const p = commandSchemas.export.parse(input); const rows = store.list(p.selection);
      return { format: p.format, header: p.header, count: rows.length, selection: p.selection,
        data: p.format === 'csv' ? exportCsv(rows, p.header) : exportJson(rows) };
    }
    case 'collect': {
      const p = commandSchemas.collect.parse(input);
      if (!provider && !p.provider) throw new KitError('PROVIDER_REQUIRED', 'Configure a provider or import data supplied by your agent.');
      const owned = !provider;
      const active = provider ?? await createProvider(p.provider!);
      try { return await collect(store, active, p.options); }
      finally { if (owned) await active.close?.(); }
    }
    case 'report': {
      const p = commandSchemas.report.parse(input); const rows = store.list(p.selection);
      const report = buildReport(rows, { title: p.title, scope: p.scope, criteria: p.criteria, locale: p.locale });
      return { format: 'html', count: rows.length, selection: p.selection, criteria: p.criteria,
        summary: report.summary, data: report.html };
    }
    case 'demo': {
      commandSchemas.demo.parse(input); const demo = createDemoReport();
      return { format: 'html', demo: true, count: demo.count, criteria: demo.criteria,
        summary: demo.summary, data: demo.html };
    }
    case 'run': { const p = commandSchemas.run.parse(input); const run = store.getRun(p.id); if (!run) throw new KitError('NOT_FOUND', 'Run not found.'); return run; }
    case 'doctor': {
      commandSchemas.doctor.parse(input); const records = store.count(); const providerConfigured = !!provider;
      return { version: '0.1.0', node: process.version, storage: 'sqlite', records, providerConfigured,
        capabilities: ['import', 'collect', 'review', 'screen', 'export', 'stage', 'report', 'demo'],
        sendsMessages: false, startsScheduler: false,
        checks: [
          { id: 'storage', status: 'ok', detail: `SQLite ready; ${records} record(s).` },
          { id: 'provider', status: providerConfigured ? 'ok' : 'attention',
            detail: providerConfigured ? 'Configured; platform login is not verified.' : 'Not configured; import, review and export still work. Live collect needs a provider.' },
          { id: 'runtime', status: 'ok', detail: `Node ${process.version}.` },
          { id: 'outbound', status: 'info', detail: 'No messaging or scheduler.' },
        ],
        summary: `${records} local record(s). ${providerConfigured ? 'Provider configured' : 'Provider not configured'}. No messaging or scheduler.` };
    }
    default: throw new KitError('UNKNOWN_COMMAND', 'Unknown command.');
  }
}
