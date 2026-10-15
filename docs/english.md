# English quick start

XHS Opportunity Kit is a local-first business SDK for collecting, reviewing and tracking Xiaohongshu opportunities. It is not an official platform SDK and does not include login credentials, a browser, an LLM or messaging automation.

Requires Node.js >=22.13. Install the compiled GitHub release:

```sh
npm install -g https://github.com/huntingrin/xhs-opportunity-kit/releases/download/v0.1.0/huntingrin-xhs-opportunity-kit-0.1.0.tgz
xhs-opportunity --help
```

Use the JSON CLI from any tool-enabled Agent, the standard stdio MCP server from an MCP-capable host, or the typed SDK in Node. The optional Skill is a workflow guide, not a vendor-specific runtime dependency. An Agent with no code/tool execution cannot run this package by itself.

Clone the repository and run `npm ci && npm test` to develop. `node examples/quickstart.mjs` runs a synthetic, offline end-to-end example in a temporary database.

Collect/import notes, inspect evidence IDs, record an evidence-backed review, screen unknown facts conservatively, and export JSON/CSV. Real platform access requires a separately configured MCP provider or notes supplied by the host. Search coverage and partial failures are explicit. No messaging, scheduling or publishing is performed.

Read [CLI](cli.md), [SDK](api.md) and [providers](providers.md) for contracts. Data is stored outside the package by default. Do not commit real leads, messages, accounts or provider credentials. MIT License.
