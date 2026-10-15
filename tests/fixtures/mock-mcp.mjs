import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
const server = new McpServer({ name: 'synthetic-xhs', version: '1.0.0' });
const result = data => ({ content: [{ type: 'text', text: JSON.stringify(data) }] });
server.registerTool('search_feeds', { inputSchema: { keyword: z.string() } }, async () => result({ feeds: [
  { id: 'synthetic1', modelType: 'note', xsecToken: 'synthetic-token', noteCard: { displayTitle: '剪辑需求' } },
] }));
server.registerTool('get_feed_detail', { inputSchema: { feed_id: z.string(), xsec_token: z.string(), load_all_comments: z.boolean() } }, async () => result({ data: {
  note: { noteId: 'synthetic1', title: '剪辑需求', desc: '这是合成测试需求，预算 500 元。' }, comments: { list: [], hasMore: false },
} }));
await server.connect(new StdioServerTransport());
