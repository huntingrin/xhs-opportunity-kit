import { readFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { z } from 'zod';
import { type Note, KitError } from './model.js';
import { importNotes, isFeed, normalizeFeed, object } from './importer.js';

export interface SearchRequest { keyword: string; cursor?: string; filters?: Record<string, string>; signal: AbortSignal }
export interface SearchPage { notes: Note[]; nextCursor?: string; complete: boolean; warnings?: string[] }
export interface OpportunityProvider {
  name: string;
  search(request: SearchRequest): Promise<SearchPage>;
  detail?(id: string, signal: AbortSignal): Promise<Note>;
  close?(): Promise<void>;
}

export class FileProvider implements OpportunityProvider {
  readonly name = 'file';
  constructor(private notes: Note[], private pageSize = 20) {
    if (!Number.isInteger(pageSize) || pageSize < 1) throw new KitError('INVALID_PAGE_SIZE', 'pageSize must be positive.');
  }
  async search({ keyword, cursor, signal }: SearchRequest): Promise<SearchPage> {
    signal.throwIfAborted();
    const offset = cursor === undefined ? 0 : Number(cursor);
    if (!Number.isSafeInteger(offset) || offset < 0) throw new KitError('INVALID_CURSOR', 'Invalid file cursor.');
    const matched = this.notes.filter(n => `${n.title}\n${n.body}`.toLocaleLowerCase().includes(keyword.toLocaleLowerCase()));
    const notes = matched.slice(offset, offset + this.pageSize);
    const end = offset + notes.length;
    return { notes, complete: end >= matched.length, ...(end < matched.length ? { nextCursor: String(end) } : {}) };
  }
}
const toolNames = z.object({ search: z.string().default('search_feeds'), detail: z.string().default('get_feed_detail') }).default({});
export const providerConfigSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('file'), path: z.string().min(1), pageSize: z.number().int().min(1).max(1000).default(20) }).strict(),
  z.object({ type: z.literal('mcp'), transport: z.enum(['stdio', 'streamable-http', 'sse']),
    command: z.string().optional(), args: z.array(z.string()).default([]),
    env: z.record(z.string()).default({}), url: z.string().url().optional(), bearerTokenEnv: z.string().optional(),
    tools: toolNames, timeoutMs: z.number().int().min(100).max(180000).default(30000),
  }).strict(),
]);
export type ProviderConfig = z.input<typeof providerConfigSchema>;
type McpConfig = Extract<z.output<typeof providerConfigSchema>, { type: 'mcp' }>;

/** Inject a tool caller when the host already owns an MCP connection. */
export type ToolCaller = (name: string, args: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>;
export class McpProvider implements OpportunityProvider {
  readonly name = 'xiaohongshu-mcp';
  private tokens = new Map<string, string>();
  constructor(private call: ToolCaller, private names = { search: 'search_feeds', detail: 'get_feed_detail' },
    private cleanup?: () => Promise<void>) {}
  async close(): Promise<void> { this.tokens.clear(); await this.cleanup?.(); }
  async search({ keyword, cursor, filters, signal }: SearchRequest): Promise<SearchPage> {
    if (cursor) throw new KitError('PAGINATION_UNSUPPORTED', 'This MCP search endpoint has no cursor parameter.');
    const d = object(unwrapMcp(await this.call(this.names.search, { keyword, ...(filters ? { filters } : {}) }, signal)));
    const container = Array.isArray(d.feeds) ? d : object(d.data);
    if (!Array.isArray(container.feeds)) throw new KitError('PROVIDER_SHAPE', 'MCP search did not return a feeds array.');
    const notes: Note[] = []; const warnings: string[] = ['SEARCH_COVERAGE_UNKNOWN'];
    for (const raw of container.feeds) {
      if (!isFeed(raw)) continue;
      const r = object(raw);
      try {
        const n = normalizeFeed(raw, new Date().toISOString()); notes.push(n);
        if (!n.title && !n.body) warnings.push('CONTENT_REQUIRES_DETAIL_OR_OCR');
        if (typeof r.xsecToken === 'string') this.tokens.set(n.id, r.xsecToken);
      } catch { warnings.push('INVALID_FEED_SKIPPED'); }
    }
    if (!notes.length && container.feeds.some(isFeed)) throw new KitError('PROVIDER_SHAPE', 'No returned feed could be normalized.');
    // No documented pagination/exhaustiveness guarantee: never claim all opportunities were searched.
    return { notes, complete: false, warnings: [...new Set(warnings)] };
  }
  async detail(id: string, signal: AbortSignal): Promise<Note> {
    const token = this.tokens.get(id);
    if (!token) throw new KitError('DETAIL_TOKEN_MISSING', 'Detail lookup needs a fresh search result in the same provider session.');
    const response = unwrapMcp(await this.call(this.names.detail,
      { feed_id: id, xsec_token: token, load_all_comments: false }, signal));
    const root = object(response);
    const data = object(root.data);
    if (!object(data.note).noteId && !object(root.note).noteId)
      throw new KitError('PROVIDER_SHAPE', 'MCP detail did not return a note.');
    const n = normalizeFeed({ ...root, feed_id: id }, new Date().toISOString());
    if (n.id !== id) throw new KitError('PROVIDER_ID_MISMATCH', 'Detail returned a different note ID.');
    return n;
  }
}
export function unwrapMcp(value: unknown): unknown {
  const r = object(value);
  if (r.isError === true || r.success === false) throw new KitError('PROVIDER_ERROR', 'Upstream tool reported failure; check its session and configuration.');
  if (r.structuredContent && typeof r.structuredContent === 'object') return unwrapMcp(r.structuredContent);
  if (Array.isArray(r.content)) {
    for (const item of r.content) {
      const c = object(item);
      if (c.type === 'text' && typeof c.text === 'string') {
        let parsed: unknown;
        try { parsed = JSON.parse(c.text); } catch { continue; }
        return unwrapMcp(parsed);
      }
    }
    throw new KitError('PROVIDER_SHAPE', 'Upstream tool did not return structured JSON.');
  }
  return value;
}
async function connectMcp(config: McpConfig): Promise<McpProvider> {
  const client = new Client({ name: 'xhs-opportunity-kit', version: '0.1.0' });
  let transport;
  if (config.transport === 'stdio') {
    if (!config.command) throw new KitError('CONFIG_ERROR', 'stdio transport requires command.');
    transport = new StdioClientTransport({ command: config.command, args: config.args, env: config.env, stderr: 'ignore' });
  } else {
    if (!config.url) throw new KitError('CONFIG_ERROR', 'HTTP transports require url.');
    const url = new URL(config.url);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
      throw new KitError('CONFIG_ERROR', 'Use HTTPS or a loopback HTTP endpoint.');
    if (url.username || url.password) throw new KitError('CONFIG_ERROR', 'Use bearerTokenEnv instead of URL credentials.');
    const headers: Record<string, string> = {};
    if (config.bearerTokenEnv) {
      const token = process.env[config.bearerTokenEnv];
      if (!token) throw new KitError('CONFIG_ERROR', 'Configured bearer token environment variable is unset.');
      headers.Authorization = `Bearer ${token}`;
    }
    transport = config.transport === 'sse' ? new SSEClientTransport(url, {
      requestInit: { headers }, eventSourceInit: { fetch: (input, init) => fetch(input, { ...init, headers: { ...headers, ...Object.fromEntries(new Headers(init?.headers)) } }) },
    }) : new StreamableHTTPClientTransport(url, { requestInit: { headers } });
  }
  try { await client.connect(transport, { timeout: config.timeoutMs, signal: AbortSignal.timeout(config.timeoutMs) }); }
  catch { await client.close().catch(() => {}); throw new KitError('PROVIDER_CONNECT_FAILED', 'Cannot connect to MCP provider; check endpoint, login and transport.'); }
  return new McpProvider(async (name, args, signal) => {
    try { return await client.callTool({ name, arguments: args }, undefined, { timeout: config.timeoutMs, signal }); }
    catch { throw new KitError(signal.aborted ? 'TIMEOUT' : 'PROVIDER_CALL_FAILED', 'Upstream request failed or timed out.'); }
  }, config.tools, () => client.close());
}
export async function createProvider(config: ProviderConfig): Promise<OpportunityProvider> {
  const c = providerConfigSchema.parse(config);
  if (c.type === 'file') return new FileProvider(importNotes(JSON.parse(await readFile(c.path, 'utf8'))), c.pageSize);
  return connectMcp(c);
}
