#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { OpportunityStore } from './store.js';
import { execute, commandSchemas, type Command } from './api.js';
import { defaultDatabasePath } from './paths.js';
import { KitError, publicError } from './model.js';

async function readInput(path?: string): Promise<unknown> {
  if (!path) return {};
  let text: string;
  if (path === '-') {
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of process.stdin) {
      const b = Buffer.from(chunk); size += b.length;
      if (size > 20 * 1024 * 1024) throw new KitError('INPUT_TOO_LARGE', 'Input exceeds 20 MiB.'); chunks.push(b);
    }
    text = Buffer.concat(chunks).toString('utf8');
  } else {
    try { text = await readFile(path, 'utf8'); }
    catch { throw new KitError('INPUT_UNREADABLE', `Cannot read input file: ${path}. Pass a readable JSON file path, or "-" to read the request from stdin.`); }
  }
  if (Buffer.byteLength(text) > 20 * 1024 * 1024) throw new KitError('INPUT_TOO_LARGE', 'Input exceeds 20 MiB.');
  try { return JSON.parse(text); } catch { throw new KitError('INVALID_JSON', 'Input must be valid JSON.'); }
}
let store: OpportunityStore | undefined;
try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    db: { type: 'string' }, input: { type: 'string' }, output: { type: 'string' }, help: { type: 'boolean', short: 'h' }, version: { type: 'boolean' },
  } });
  if (values.help || values.version || !positionals.length) {
    console.log(JSON.stringify({ ok: true, version: '0.1.0', usage: 'xhs-opportunity <command> [--db PATH] [--input FILE|-] [--output FILE]',
      commands: Object.keys(commandSchemas), help: 'See docs/cli.md. Every response is JSON. --output is for export, report and demo; it never overwrites files.' }));
  } else {
    if (positionals.length !== 1 || !Object.hasOwn(commandSchemas, positionals[0])) throw new KitError('UNKNOWN_COMMAND', 'Use --help for supported commands.');
    const command = positionals[0] as Command;
    const outputCommands = new Set<string>(['export', 'report', 'demo']);
    if (values.output && !outputCommands.has(command)) throw new KitError('INVALID_OPTION', '--output is only supported by export, report and demo.');
    const input = await readInput(values.input);
    store = new OpportunityStore(command === 'demo' ? ':memory:' : (values.db || defaultDatabasePath()));
    const result = await execute(store, command, input);
    let data = result;
    if (values.output) {
      const exported = result as { format: string; count: number; data: string; summary?: unknown };
      await writeFile(values.output, exported.data, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      data = { format: exported.format, count: exported.count, path: values.output, ...(exported.summary ? { summary: exported.summary } : {}) };
    } else if (command === 'report' || command === 'demo') {
      const { data: html, ...rest } = result as { data: string } & Record<string, unknown>;
      data = { ...rest, htmlLength: html.length, hint: 'Use --output FILE to write the HTML report.' };
    }
    console.log(JSON.stringify({ ok: true, data }));
    if (command === 'collect' && (result as { status: string }).status !== 'complete') process.exitCode = 3;
  }
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: publicError(error) })); process.exitCode = 1;
} finally { store?.close(); }
