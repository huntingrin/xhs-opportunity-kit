#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { OpportunityStore } from './store.js';
import { execute, commandSchemas, type Command } from './api.js';
import { defaultDatabasePath } from './paths.js';
import { createProvider, type OpportunityProvider } from './providers.js';
import { publicError } from './model.js';
import { collectSchema } from './workflows.js';

const descriptions: Record<Command, string> = {
  import: 'Import normalized or historical notes into local SQLite. Does not contact anyone.',
  list: 'List saved opportunities. Unreviewed and stale judgments remain explicit.',
  show: 'Read one opportunity, its evidence IDs and local audit history.',
  review: 'Record an evidence-linked judgment. Requires evidence IDs returned by show.',
  stage: 'Record a business stage transition with a reason. This only changes the local record, not the platform.',
  screen: 'Filter saved opportunities; unknown facts remain pending, never assumed true.',
  export: 'Return JSON or spreadsheet-safe CSV text for a selected page of opportunities.',
  collect: 'Read search results from the host-configured provider. Does not send, publish or start a scheduler.',
  run: 'Read a saved collection run, including partial failures.',
  doctor: 'Report local SDK/storage capabilities; does not verify platform login.',
};
let store: OpportunityStore | undefined; let provider: OpportunityProvider | undefined;
try {
  const { values } = parseArgs({ options: { db: { type: 'string' }, provider: { type: 'string' } } });
  store = new OpportunityStore(values.db || defaultDatabasePath());
  if (values.provider) provider = await createProvider(JSON.parse(await readFile(values.provider, 'utf8')));
  const server = new McpServer({ name: 'xhs-opportunity-kit', version: '0.1.0' });
  for (const name of Object.keys(commandSchemas) as Command[]) {
    // Provider settings belong to the trusted host config, not model-generated tool input.
    const schema = name === 'collect' ? z.object({ options: collectSchema }).strict() : commandSchemas[name];
    server.registerTool(`opportunity_${name}`, {
      description: descriptions[name], inputSchema: schema.shape,
      annotations: { readOnlyHint: ['list', 'show', 'screen', 'export', 'run', 'doctor'].includes(name),
        destructiveHint: false, openWorldHint: name === 'collect' },
    }, async (input: unknown) => {
      try {
        if (name === 'collect' && !provider) return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify({ ok: false, error: { code: 'PROVIDER_REQUIRED', message: 'Host must start server with --provider CONFIG.' } }) }] };
        const data = await execute(store!, name, input, provider);
        return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: true, data }) }] };
      } catch (error) { return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify({ ok: false, error: publicError(error) }) }] }; }
    });
  }
  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return; shuttingDown = true;
    await provider?.close?.().catch(() => {}); store?.close(); await server.close();
  };
  process.once('SIGINT', () => { void shutdown(); }); process.once('SIGTERM', () => { void shutdown(); });
  process.stdin.once('end', () => { void shutdown(); });
  await server.connect(new StdioServerTransport());
} catch (error) {
  console.error(JSON.stringify(publicError(error))); store?.close(); await provider?.close?.().catch(() => {}); process.exitCode = 1;
}
