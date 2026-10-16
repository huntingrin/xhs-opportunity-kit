import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createProvider, collect, OpportunityStore } from '../dist/index.js';

function cli(db, command, input, extra = []) {
  const r = spawnSync(process.execPath, ['dist/cli.js', command, '--db', db, '--input', '-', ...extra], { input: JSON.stringify(input), encoding: 'utf8' });
  return { ...r, json: JSON.parse(r.stdout) };
}
test('CLI supports stdin JSON, repeatable import, list, export, errors and no overwrite', t => {
  const dir = mkdtempSync(join(tmpdir(), 'xhs-cli-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const db = join(dir, 'state.sqlite'); const input = { document: { notes: [{ id: 'demo1', title: '剪辑', observedAt: '2026-10-01T00:00:00Z' }] } };
  assert.equal(cli(db, 'import', input).json.data.inserted, 1);
  assert.equal(cli(db, 'import', input).json.data.unchanged, 1);
  assert.equal(cli(db, 'list', {}).json.data.items.length, 1);
  const csv = join(dir, 'out.csv'); assert.equal(cli(db, 'export', { format: 'csv' }, ['--output', csv]).status, 0);
  assert.ok(readFileSync(csv, 'utf8').includes('剪辑'));
  assert.equal(cli(db, 'export', { format: 'csv' }, ['--output', csv]).status, 1);
  const missing = cli(db, 'show', { key: 'absent' }); assert.equal(missing.status, 1); assert.equal(missing.json.error.code, 'NOT_FOUND');
});
test('CLI names an unreadable input file instead of a generic failure', t => {
  const dir = mkdtempSync(join(tmpdir(), 'xhs-cli-input-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const r = spawnSync(process.execPath, ['dist/cli.js', 'list', '--db', join(dir, 'state.sqlite'), '--input', join(dir, 'absent.json')], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  const json = JSON.parse(r.stdout);
  assert.equal(json.ok, false); assert.equal(json.error.code, 'INPUT_UNREADABLE');
  assert.ok(json.error.message.includes('absent.json'));
});
test('CLI real file-provider collection and partial exit code', t => {
  const dir = mkdtempSync(join(tmpdir(), 'xhs-collect-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const r = cli(join(dir, 'state.sqlite'), 'collect', { provider: { type: 'file', path: 'examples/notes.json', pageSize: 1 },
    options: { keywords: ['剪辑'], maxPagesPerKeyword: 1 } });
  assert.equal(r.status, 3); assert.equal(r.json.data.status, 'partial');
});
test('MCP server exposes working standard tools and blocks model-supplied provider commands', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'xhs-mcp-')); const client = new Client({ name: 'test-host', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('dist/mcp-server.js'), '--db', join(dir, 'state.sqlite')], stderr: 'ignore' });
  t.after(async () => { await client.close(); rmSync(dir, { recursive: true, force: true }); });
  await client.connect(transport);
  const tools = await client.listTools(); assert.equal(tools.tools.length, 10);
  assert.ok(!('provider' in tools.tools.find(x => x.name === 'opportunity_collect').inputSchema.properties));
  const imported = await client.callTool({ name: 'opportunity_import', arguments: { document: { notes: [{ id: 'mcp1', title: '虚构需求', observedAt: '2026-10-01T00:00:00Z' }] } } });
  assert.equal(JSON.parse(imported.content[0].text).data.inserted, 1);
  const listed = await client.callTool({ name: 'opportunity_list', arguments: {} });
  assert.equal(JSON.parse(listed.content[0].text).data.items[0].key, 'xiaohongshu:mcp1');
  const failed = await client.callTool({ name: 'opportunity_collect', arguments: { options: { keywords: ['test'] } } });
  assert.equal(failed.isError, true);
});
test('SDK connects to a real stdio MCP transport and handles search/detail end to end', async t => {
  const provider = await createProvider({ type: 'mcp', transport: 'stdio', command: process.execPath, args: [resolve('tests/fixtures/mock-mcp.mjs')] });
  const store = new OpportunityStore(':memory:'); t.after(async () => { store.close(); await provider.close(); });
  const run = await collect(store, provider, { keywords: ['剪辑'], maxDetails: 1 });
  assert.equal(run.detailReads, 1); assert.equal(store.list()[0].note.body, '这是合成测试需求，预算 500 元。');
});
