import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OpportunityStore, FileProvider, importNotes, collect, screen, exportCsv, buildReport } from '@huntingrin/xhs-opportunity-kit';

const dir = await mkdtemp(join(tmpdir(), 'xhs-example-'));
const store = new OpportunityStore(join(dir, 'example.sqlite'));
try {
  const document = JSON.parse(await readFile(new URL('./notes.json', import.meta.url), 'utf8'));
  const run = await collect(store, new FileProvider(importNotes(document), 1), { keywords: ['远程剪辑'], maxPagesPerKeyword: 3 });
  let first = store.list()[0];
  first = store.review(first.key, { decision: 'priority', reason: '合成示例正文明确需要远程剪辑，接受 AI，单价和量清楚。',
    reviewer: 'synthetic-example', evidenceIds: [first.evidence[0].id], demandType: 'buyer', workMode: 'remote',
    rate: { min: 15, max: 15, unit: 'per_item', volume: '400 条/月' }, riskFlags: [], aiAcceptance: 'accepted', budget: 6000 });
  const screening = store.list().map(o => screen(o, { requireRemote: true, minBudget: 500 }));
  const report = buildReport(store.list(), { criteria: { requireRemote: true }, scope: '合成示例数据' });
  console.log(JSON.stringify({ run, screening, csv: exportCsv(store.list(), 'zh'), report: { summary: report.summary, htmlLength: report.html.length } }, null, 2));
} finally { store.close(); await rm(dir, { recursive: true, force: true }); }
