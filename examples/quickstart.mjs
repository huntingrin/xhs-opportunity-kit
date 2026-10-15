import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OpportunityStore, FileProvider, importNotes, collect, screen, exportCsv } from '@huntingrin/xhs-opportunity-kit';

const dir = await mkdtemp(join(tmpdir(), 'xhs-example-'));
const store = new OpportunityStore(join(dir, 'example.sqlite'));
try {
  const document = JSON.parse(await readFile(new URL('./notes.json', import.meta.url), 'utf8'));
  const run = await collect(store, new FileProvider(importNotes(document), 1), { keywords: ['剪辑'], maxPagesPerKeyword: 3 });
  let first = store.list()[0];
  first = store.review(first.key, { decision: 'priority', reason: '合成示例正文明确需要剪辑、接受 AI、预算 800 元。',
    reviewer: 'synthetic-example', evidenceIds: [first.evidence[0].id], demandType: 'buyer', aiAcceptance: 'accepted', budget: 800 });
  console.log(JSON.stringify({ run, screening: store.list().map(o => screen(o, { requireAiAccepted: true, minBudget: 500 })), csv: exportCsv(store.list()) }, null, 2));
} finally { store.close(); await rm(dir, { recursive: true, force: true }); }
