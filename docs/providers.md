# Provider integration

There are three ways to obtain data: file input, a configured MCP connection, or an injected SDK provider. The business SDK is independent of agent brands and LLMs.

## File provider

```json
{"type":"file","path":"examples/notes.json","pageSize":20}
```

Paths resolve relative to the process working directory. File search is a local title/body substring match. It does not emulate platform filters; enforce criteria with `screen`. Use absolute paths in unattended environments.

## MCP provider

```json
{
  "type":"mcp",
  "transport":"streamable-http",
  "url":"http://127.0.0.1:18060/mcp",
  "bearerTokenEnv":"XHS_MCP_TOKEN",
  "timeoutMs":30000,
  "tools":{"search":"search_feeds","detail":"get_feed_detail"}
}
```

The URL is an example, not a bundled service. Use the actual endpoint supplied by your provider. Remove bearerTokenEnv if your local provider does not require bearer authentication. HTTPS is required for non-loopback endpoints. Redirect/authentication behavior otherwise follows the upstream MCP SDK. Never publish your configured endpoint credentials.

`transport: "sse"` supports legacy SSE endpoints. For stdio:

```json
{
  "type":"mcp", "transport":"stdio",
  "command":"/absolute/path/to/your-mcp-server",
  "args":[], "env":{}, "timeoutMs":30000
}
```

stdio commands are executed as argv without a shell. Provider configurations are trusted local configuration: a stdio command can execute a program. The MCP-facing tool cannot replace the host-configured command. Environment values supplied to the child are explicit, in addition to the MCP SDK's default inherited environment.

The adapter expects:

- `search_feeds({keyword,filters?})` → `{feeds:[{id,xsecToken?,noteCard:{displayTitle,user?}}]}` (or a data wrapper).
- `get_feed_detail({feed_id,xsec_token,load_all_comments:false})` → `{data:{note:{noteId,title,desc,time,user?},comments:{list,hasMore}}}`.
- Standard MCP JSON text content or structuredContent envelopes are unwrapped. Tool errors, plain login text, and unexpected shapes are errors, not empty results.

Search filters are passed to the configured upstream unchanged; the SDK does not infer support. The current search endpoint has no documented cursor input, so coverage is reported as unknown/partial. Access tokens used to read details remain in the provider object's memory and are cleared when closed. Canonical records do not contain raw tool output or signed links.

Only search and detail tools are called. Authentication must already be valid; expired sessions surface as failures. This package does not launch a browser, activate windows, or perform platform login.

## Agent-owned tools

If an Agent host owns the connection and exposes a callable bridge in your application:

```ts
const provider = new McpProvider(async (toolName, args, signal) => {
  return host.callTool(toolName, args, { signal }); // your host's bridge, not a bundled global
});
```

If that bridge cannot be called from a Node process, let the Agent read the content with its tools and submit normalized notes through `import`. Do not assume a tool available in a chat is automatically available to installed packages.

## Custom SDK provider

```ts
interface OpportunityProvider {
  name: string;
  search(request: {
    keyword: string; cursor?: string;
    filters?: Record<string,string>; signal: AbortSignal;
  }): Promise<{
    notes: Note[]; nextCursor?: string; complete: boolean; warnings?: string[];
  }>;
  detail?(id: string, signal: AbortSignal): Promise<Note>;
  close?(): Promise<void>;
}
```

Honor AbortSignal and preserve unknown pagination state. `complete: true` should only mean that this query's results are exhausted within your provider's scope. Use stable source IDs and normalized timestamps. Throw structured `KitError` codes without embedding credentials; arbitrary errors are sanitized by collection workflows.

Create and close providers explicitly in SDK usage. CLI-created providers are closed automatically. A long-lived MCP server reuses its provider until shutdown.
