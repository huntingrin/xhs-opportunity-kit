import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OpportunityStore, importNotes, parseNote, normalizeFeed, collect, FileProvider, McpProvider,
  unwrapMcp, screen, summarizeScreen, exportCsv, buildReport, execute } from '../dist/index.js';

const at = '2026-10-01T10:00:00.000Z';
const note = (id = 'demo1', overrides = {}) => ({ id, title: '剪辑需求', body: '需要剪辑，预算 800 元。接受 AI 辅助。', observedAt: at, ...overrides });
function storeFor(t) { const s = new OpportunityStore(':memory:'); t.after(() => s.close()); return s; }
function reviewFor(o, overrides = {}) { return { decision: 'priority', reason: '原帖明确需要制作且接受 AI',
  reviewer: 'test-agent', evidenceIds: [o.evidence[0].id], demandType: 'buyer', workMode: 'remote',
  aiAcceptance: 'accepted', budget: 800, ...overrides }; }

test('ingestion is idempotent, preserves evidence and canonicalizes URLs', t => {
  const s = storeFor(t); assert.equal(s.ingest([note()]).inserted, 1);
  assert.equal(s.ingest([note()]).unchanged, 1); assert.equal(s.count(), 1);
  const o = s.get('xiaohongshu:demo1'); assert.equal(o.evidence.length, 1);
  assert.equal(o.url, 'https://www.xiaohongshu.com/explore/demo1');
});
test('an invalid batch makes no writes', t => {
  const s = storeFor(t); assert.throws(() => s.ingest([note(), { id: '../invalid', observedAt: at }])); assert.equal(s.count(), 0);
});
test('image-only cards retain identity for enrichment without inventing evidence', t => {
  const s = storeFor(t); const n = normalizeFeed({ id: 'image1', noteCard: { displayTitle: '' } }, at);
  s.ingest([n]); const o = s.get('xiaohongshu:image1'); assert.equal(o.evidence.length, 0);
  assert.equal(screen(o, {}).result, 'pending');
  assert.throws(() => s.review(o.key, { decision: 'priority', reason: 'unsupported', reviewer: 'test', evidenceIds: [] }));
});
test('detailed note and review survive a later shallow search', t => {
  const s = storeFor(t); s.ingest([note('demo1', { detailLevel: 'detail' })]);
  const o = s.get('xiaohongshu:demo1'); s.review(o.key, reviewFor(o));
  s.ingest([note('demo1', { title: 'short', body: '', detailLevel: 'search', observedAt: '2026-10-02T00:00:00Z' })]);
  assert.equal(s.get(o.key).note.body, o.note.body); assert.equal(s.get(o.key).reviewStale, false);
});
test('changed content marks prior judgment stale; explicit re-review clears it', t => {
  const s = storeFor(t); s.ingest([note()]); let o = s.get('xiaohongshu:demo1'); s.review(o.key, reviewFor(o));
  s.ingest([note('demo1', { body: '已招满', observedAt: '2026-10-02T00:00:00Z' })]); o = s.get(o.key);
  assert.equal(o.reviewStale, true); assert.equal(screen(o, {}).result, 'pending');
  assert.equal(s.review(o.key, reviewFor(o, { decision: 'excluded', reason: '新正文已结束' })).reviewStale, false);
});
test('older observations cannot roll back newer content', t => {
  const s = storeFor(t); s.ingest([note('demo1', { body: '新正文', observedAt: '2026-10-03T00:00:00Z' })]); s.ingest([note()]);
  assert.equal(s.get('xiaohongshu:demo1').note.body, '新正文');
});
test('reviews must reference evidence on the same opportunity', t => {
  const s = storeFor(t); s.ingest([note()]); const o = s.get('xiaohongshu:demo1');
  assert.throws(() => s.review(o.key, reviewFor(o, { evidenceIds: ['made-up'] })), /belong/);
  assert.equal(s.get(o.key).review, null); assert.equal(s.events(o.key).length, 0);
});
test('stage transitions are audited, idempotent and enforce ordering', t => {
  const s = storeFor(t); s.ingest([note()]); const key = 'xiaohongshu:demo1';
  assert.throws(() => s.transition(key, 'delivered', 'incorrect'), /Cannot move/);
  s.transition(key, 'contacted', 'Existing external contact was verified');
  s.transition(key, 'contacted', 'same'); assert.equal(s.events(key).length, 1);
  s.ingest([note()]); assert.equal(s.get(key).stage, 'contacted');
});
test('records and audit events survive closing and reopening SQLite', t => {
  const dir = mkdtempSync(join(tmpdir(), 'xhs-store-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'state.sqlite'); const a = new OpportunityStore(path); a.ingest([note()]);
  a.transition('xiaohongshu:demo1', 'closed', 'No longer available'); a.close();
  const b = new OpportunityStore(path); assert.equal(b.get('xiaohongshu:demo1').stage, 'closed'); assert.equal(b.events('xiaohongshu:demo1').length, 1); b.close();
});
test('historical lead import keeps old judgments as evidence, not current facts', t => {
  const s = storeFor(t); const rows = importNotes({ leads: [{ id: 'legacy1', title: '旧线索', summary: '旧摘要', status: '优先询单', ai_acceptance: '接受',
    date: '2026-09-01', verified_at: at, url: 'https://example.invalid/?token=secret', userId: 'private' }], excluded: [] });
  s.ingest(rows); const o = s.get('xiaohongshu:legacy1'); assert.equal(o.review, null);
  assert.ok(o.evidence.some(e => e.kind === 'historical_review')); assert.ok(!JSON.stringify(o).includes('secret'));
  assert.equal(screen(o, { requireAiAccepted: true }).result, 'pending');
});
test('MCP normalization strips transport tokens and retains comment provenance', () => {
  const n = normalizeFeed({ feed_id: 'demo1', xsecToken: 'SECRET', data: { note: { noteId: 'demo1', title: '需求', desc: '正文', time: Date.parse(at), user: { nickname: '示例' } },
    comments: { hasMore: false, list: [{ id: 'c1', content: '仍有效', subComments: [{ id: 'c2', content: '收到' }] }] } } }, at);
  assert.equal(n.evidence.filter(e => e.kind === 'comment').length, 2); assert.equal(n.commentsComplete, false);
  assert.ok(!JSON.stringify(n).includes('SECRET'));
});
test('unknown values remain pending and fresh evidence-backed decisions can match', t => {
  const s = storeFor(t); s.ingest([note()]); let o = s.get('xiaohongshu:demo1');
  assert.equal(screen(o, { requireAiAccepted: true, minBudget: 500 }).result, 'pending');
  o = s.review(o.key, reviewFor(o)); assert.equal(screen(o, { requireAiAccepted: true, minBudget: 500 }).result, 'match');
  assert.equal(screen(o, { minBudget: 900 }).result, 'excluded'); assert.equal(screen(o, { minBudget: 100, currency: 'USD' }).result, 'pending');
});
test('invalid date ranges are rejected; missing dates are not assumed recent', t => {
  const s = storeFor(t); s.ingest([note()]); const o = s.get('xiaohongshu:demo1');
  assert.throws(() => screen(o, { publishedFrom: '2026-10-10T00:00:00Z', publishedTo: at }));
  assert.ok(screen(o, { publishedFrom: at }).reasons.includes('DATE_UNKNOWN'));
});
test('CSV neutralizes formula prefixes and quotes multiline content', t => {
  const s = storeFor(t); s.ingest([note('demo1', { title: ' \t=HYPERLINK("bad")\nnext' })]);
  const csv = exportCsv(s.list()); assert.ok(csv.includes('"\' \t=HYPERLINK(""bad"")\nnext"'));
});
test('collect persists multi-page results, deduplicates across keywords and records completion', async t => {
  const s = storeFor(t); const p = new FileProvider([parseNote(note('one')), parseNote(note('two'))], 1);
  const run = await collect(s, p, { keywords: ['剪辑', '需求'], maxPagesPerKeyword: 3 });
  assert.equal(run.status, 'complete'); assert.equal(run.pages, 4); assert.equal(run.keys.length, 2);
  assert.equal(s.getRun(run.id).status, 'complete'); assert.equal(s.count(), 2);
});
test('a page budget is partial, not complete', async t => {
  const s = storeFor(t); const p = new FileProvider([parseNote(note('one')), parseNote(note('two'))], 1);
  const run = await collect(s, p, { keywords: ['剪辑'], maxPagesPerKeyword: 1 }); assert.equal(run.status, 'partial'); assert.equal(s.count(), 1);
});
test('one search failure preserves other successful pages and does not expose upstream secrets', async t => {
  const s = storeFor(t); const p = { name: 'test', async search({ keyword }) {
    if (keyword === 'fail') throw new Error('SECRET_TOKEN'); return { notes: [parseNote(note())], complete: true };
  } };
  const run = await collect(s, p, { keywords: ['fail', 'good'] }); assert.equal(run.status, 'partial'); assert.equal(s.count(), 1);
  assert.ok(!JSON.stringify(run).includes('SECRET_TOKEN'));
});
test('provider timeout is bounded and recorded as failed', async t => {
  const s = storeFor(t); const run = await collect(s, { name: 'stalled', search: () => new Promise(() => {}) }, { keywords: ['test'], timeoutMs: 100 });
  assert.equal(run.status, 'failed'); assert.equal(run.errors[0].code, 'TIMEOUT');
});
test('repeating pagination cursor stops with a recoverable partial run', async t => {
  const s = storeFor(t); const run = await collect(s, { name: 'loop', async search() { return { notes: [], complete: false, nextCursor: 'same' }; } },
    { keywords: ['test'], maxPagesPerKeyword: 5 }); assert.equal(run.pages, 2); assert.equal(run.errors[0].code, 'CURSOR_LOOP');
});
test('MCP adapter understands tool envelopes and keeps detail tokens only in memory', async t => {
  const s = storeFor(t); const calls = [];
  const p = new McpProvider(async (name, args) => {
    calls.push({ name, args });
    const value = name === 'search_feeds' ? { feeds: [{ id: 'demo1', modelType: 'note', xsecToken: 'PRIVATE_TOKEN', noteCard: { displayTitle: '剪辑' } }] }
      : { data: { note: { noteId: 'demo1', title: '剪辑', desc: '完整正文' }, comments: { list: [], hasMore: false } } };
    return { content: [{ type: 'text', text: JSON.stringify(value) }] };
  });
  const run = await collect(s, p, { keywords: ['剪辑'], maxDetails: 1 });
  assert.equal(run.status, 'partial'); assert.equal(run.detailReads, 1); assert.equal(calls[1].args.xsec_token, 'PRIVATE_TOKEN');
  assert.ok(!JSON.stringify(s.list()).includes('PRIVATE_TOKEN')); await p.close();
  await assert.rejects(() => p.detail('demo1', new AbortController().signal), /fresh search/);
});
test('MCP malformed or error results are never treated as empty successful search', async () => {
  assert.throws(() => unwrapMcp({ isError: true, content: [{ type: 'text', text: 'secret' }] }), /failure/);
  const p = new McpProvider(async () => ({ content: [{ type: 'text', text: 'login required' }] }));
  await assert.rejects(() => p.search({ keyword: 'x', signal: new AbortController().signal }), /structured JSON/);
});
test('empty completed search is a successful run with zero opportunities', async t => {
  const s = storeFor(t); const run = await collect(s, new FileProvider([]), { keywords: ['none'] });
  assert.equal(run.status, 'complete'); assert.equal(run.observations, 0);
});
test('query dispatch rejects unknown arguments and bounds pagination', async t => {
  const s = storeFor(t); await assert.rejects(() => execute(s, 'list', { limit: -1 }));
  await assert.rejects(() => execute(s, 'stage', { key: 'x', stage: 'closed', reason: 'done', send: true }));
  assert.equal((await execute(s, 'doctor', {})).sendsMessages, false);
});
test('remote screening separates confirmed, hybrid, onsite and unknown work', t => {
  const s = storeFor(t); const modes = { demoR: 'remote', demoH: 'hybrid', demoO: 'onsite', demoU: 'unknown' };
  for (const [id, mode] of Object.entries(modes)) {
    s.ingest([note(id)]); const o = s.get(`xiaohongshu:${id}`); s.review(o.key, reviewFor(o, { workMode: mode }));
  }
  const items = s.list().map(o => screen(o, { requireRemote: true }));
  const byKey = Object.fromEntries(items.map(item => [item.key, item]));
  assert.equal(byKey['xiaohongshu:demoR'].result, 'match');
  assert.equal(byKey['xiaohongshu:demoH'].result, 'pending');
  assert.ok(byKey['xiaohongshu:demoH'].reasons.includes('HYBRID'));
  assert.equal(byKey['xiaohongshu:demoO'].result, 'excluded');
  assert.ok(byKey['xiaohongshu:demoO'].reasons.includes('ONSITE'));
  assert.equal(byKey['xiaohongshu:demoU'].result, 'pending');
  assert.ok(byKey['xiaohongshu:demoU'].reasons.includes('REMOTE_UNVERIFIED'));
  const summary = summarizeScreen(items);
  assert.equal(summary.match, 1); assert.equal(summary.pending, 2); assert.equal(summary.excluded, 1);
  assert.equal(summary.workModes.remote, 1); assert.equal(summary.workModes.onsite, 1);
  assert.equal(summary.reasons.ONSITE, 1);
});
test('old reviews without work mode remain pending under a remote requirement', t => {
  const s = storeFor(t); s.ingest([note()]); const o = s.get('xiaohongshu:demo1');
  const old = { ...o, review: { decision: 'priority', reason: 'old review', evidenceIds: [o.evidence[0].id],
    reviewer: 'old-agent', demandType: 'buyer', aiAcceptance: 'accepted', budget: 800, currency: 'CNY' } };
  const result = screen(old, { requireRemote: true });
  assert.equal(result.workMode, 'unknown'); assert.equal(result.result, 'pending');
  assert.ok(result.reasons.includes('REMOTE_UNVERIFIED'));
});
test('rate, demand type and risk flags are recorded and can be screened', t => {
  const s = storeFor(t); s.ingest([note()]); let o = s.get('xiaohongshu:demo1');
  o = s.review(o.key, reviewFor(o, { demandType: 'agency', budget: 1500,
    rate: { min: 15, max: 25, unit: 'per_item', volume: '2 条/天' }, riskFlags: ['agency_cut'] }));
  assert.equal(o.review.rate.unit, 'per_item'); assert.equal(o.review.rate.max, 25);
  const risk = screen(o, { excludeRiskFlags: ['agency_cut'] });
  assert.equal(risk.result, 'excluded'); assert.ok(risk.reasons.includes('RISK_FLAG'));
  const intermediary = screen(o, { excludeIntermediaries: true });
  assert.equal(intermediary.result, 'excluded'); assert.ok(intermediary.reasons.includes('INTERMEDIARY'));
  assert.equal(screen(o, {}).result, 'match');
  const range = screen(o, { minRate: 20, rateUnit: 'per_item' });
  assert.equal(range.result, 'pending'); assert.ok(range.reasons.includes('RATE_RANGE'));
  const low = screen(o, { minRate: 30, rateUnit: 'per_item' });
  assert.equal(low.result, 'excluded'); assert.ok(low.reasons.includes('RATE_TOO_LOW'));
  assert.equal(screen(o, { minRate: 10, rateUnit: 'per_item' }).result, 'match');
  assert.ok(screen(o, { minRate: 10, rateUnit: 'per_month' }).reasons.includes('RATE_UNIT_MISMATCH'));
  assert.throws(() => screen(o, { minRate: 10 }));
  const bare = storeFor(t); bare.ingest([note('bare')]); const bareOpp = bare.get('xiaohongshu:bare');
  const bareReviewed = bare.review(bareOpp.key, reviewFor(bareOpp, { rate: null }));
  assert.ok(screen(bareReviewed, { minRate: 10, rateUnit: 'per_item' }).reasons.includes('RATE_UNKNOWN'));
  const fixed = storeFor(t); fixed.ingest([note('fixed')]); const fixedOpp = fixed.get('xiaohongshu:fixed');
  const fixedReviewed = fixed.review(fixedOpp.key, reviewFor(fixedOpp, { rate: { min: 15, max: 15, unit: 'per_item' } }));
  assert.equal(screen(fixedReviewed, { minRate: 20, rateUnit: 'per_item' }).result, 'excluded');
  const open = storeFor(t); open.ingest([note('open')]); const openOpp = open.get('xiaohongshu:open');
  const openReviewed = open.review(openOpp.key, reviewFor(openOpp, { rate: { min: 15, unit: 'per_item' } }));
  assert.equal(screen(openReviewed, { minRate: 20, rateUnit: 'per_item' }).result, 'pending');
  assert.throws(() => s.review(o.key, reviewFor(o, { rate: { min: 25, max: 15, unit: 'per_item' } })));
});
test('max age filters old or undated posts without assuming freshness', t => {
  const s = storeFor(t); const now = Date.parse('2026-10-26T00:00:00.000Z');
  s.ingest([note('recent', { publishedAt: '2026-10-24T00:00:00.000Z' }),
    note('old', { publishedAt: '2026-10-01T00:00:00.000Z' }), note('undated', { publishedAt: null })]);
  for (const id of ['recent', 'old', 'undated']) {
    const o = s.get(`xiaohongshu:${id}`); s.review(o.key, reviewFor(o));
  }
  assert.equal(screen(s.get('xiaohongshu:recent'), { maxAgeDays: 7 }, now).result, 'match');
  const old = screen(s.get('xiaohongshu:old'), { maxAgeDays: 7 }, now);
  assert.equal(old.result, 'excluded'); assert.ok(old.reasons.includes('TOO_OLD'));
  const undated = screen(s.get('xiaohongshu:undated'), { maxAgeDays: 7 }, now);
  assert.equal(undated.result, 'pending'); assert.ok(undated.reasons.includes('DATE_UNKNOWN'));
});
test('show returns readable quotes; doctor returns plain checks; screen aggregates reasons', async t => {
  const s = storeFor(t); await execute(s, 'import', { document: { notes: [note()] } });
  const shown = await execute(s, 'show', { key: 'xiaohongshu:demo1' });
  assert.equal(shown.quotes[0].text, note().body); assert.equal(shown.quotes[0].kind, 'note');
  const doctor = await execute(s, 'doctor', {});
  assert.ok(Array.isArray(doctor.checks)); assert.equal(doctor.checks.find(c => c.id === 'storage').status, 'ok');
  assert.equal(doctor.checks.find(c => c.id === 'provider').status, 'attention');
  const item = s.get('xiaohongshu:demo1'); s.review(item.key, reviewFor(item, { workMode: 'onsite' }));
  const screened = await execute(s, 'screen', { criteria: { requireRemote: true } });
  assert.equal(screened.summary.excluded, 1); assert.equal(screened.summary.reasons.ONSITE, 1);
  assert.ok(screened.criteria.requireRemote);
});
test('CSV carries work mode, rate and risk columns in English or Chinese', t => {
  const s = storeFor(t); s.ingest([note()]); const o = s.get('xiaohongshu:demo1');
  s.review(o.key, reviewFor(o, { rate: { min: 15, unit: 'per_item', volume: '400 条/月' }, riskFlags: ['unclear_rate'] }));
  const en = exportCsv(s.list()); const zh = exportCsv(s.list(), 'zh');
  assert.ok(en.includes('"work_mode"')); assert.ok(en.includes('"rate_min"')); assert.ok(en.includes('"risk_flags"'));
  assert.ok(en.includes('"remote"')); assert.ok(en.includes('"per_item"')); assert.ok(en.includes('"unclear_rate"'));
  assert.ok(zh.startsWith('"记录ID"')); assert.ok(zh.includes('"工作方式"'));
  assert.ok(zh.includes('"远程"')); assert.ok(zh.includes('"元/条"')); assert.ok(zh.includes('"单价不清"'));
});
test('HTML report escapes post text and separates recommendation from pending', t => {
  const s = storeFor(t); s.ingest([note('xss', { title: '<script>alert(1)</script>', body: '远程合作，<img src=x onerror=1>' })]);
  const o = s.get('xiaohongshu:xss'); s.review(o.key, reviewFor(o));
  const report = buildReport(s.list(), { criteria: { requireRemote: true } });
  assert.ok(report.html.includes('&lt;script&gt;')); assert.ok(!report.html.includes('<script>alert(1)</script>'));
  assert.ok(report.html.includes('建议先联系')); assert.equal(report.summary.match, 1);
  assert.ok(buildReport(s.list(), { criteria: { requireRemote: true }, locale: 'en' }).html.includes('Recommended'));
});
test('demo report is synthetic and never touches the caller database', async t => {
  const s = storeFor(t); const demo = await execute(s, 'demo', {});
  assert.equal(demo.demo, true); assert.equal(demo.count, 5); assert.equal(demo.summary.match, 2);
  assert.ok(demo.data.includes('示例')); assert.ok(!demo.data.includes('<script')); assert.equal(s.count(), 0);
  const report = await execute(s, 'report', {});
  assert.equal(report.format, 'html'); assert.ok(report.data.includes('<!doctype html>'));
});
