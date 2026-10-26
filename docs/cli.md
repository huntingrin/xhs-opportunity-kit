# CLI JSON contract

```text
xhs-opportunity <command> [--db PATH] [--input FILE|-] [--output FILE]
```

Input is one JSON request object. No input means `{}`. `--input -` reads stdin (up to 20 MiB). CLI options are parsed strictly. All responses are one JSON document on stdout; warnings may appear on stderr. No interactive prompts or shell evaluation are used.

| Command | JSON request |
| --- | --- |
| doctor | `{}` |
| import | `{"document":{"notes":[...]}}` |
| list | `{"query":"剪辑","decision":"unreviewed","limit":20,"offset":0}` |
| show | `{"key":"xiaohongshu:note-id"}` |
| review | `{"key":"xiaohongshu:note-id","review":{...}}` |
| stage | `{"key":"xiaohongshu:note-id","stage":"contacted","reason":"已核对真实沟通记录"}` |
| screen | `{"criteria":{"requireRemote":true,"minRate":15,"rateUnit":"per_item","excludeRiskFlags":["training_fee"]},"selection":{"limit":100}}` |
| export | `{"format":"csv","header":"zh","selection":{"decision":"priority","limit":100}}` |
| report | `{"title":"远程接单机会","criteria":{"requireRemote":true},"locale":"zh"}` |
| demo | `{}` |
| collect | `{"options":{"keywords":["远程剪辑","线上剪辑"],"maxDetails":1},"provider":{...}}` |
| run | `{"id":"run-id-from-collect"}` |

See [API](api.md) for full model fields. `list`, `screen`, `export`, and `report` default to the first 100 records. Their selection fields support query, stage, decision, limit and offset. Export returns `{format,header,count,selection,data}`. `screen` returns `{items,summary,criteria,selection}`; `summary` aggregates results, reasons, work modes and risk flags. `show` returns `{item,events,quotes}`. `doctor` returns `{...,checks,summary}`. `report` returns a standalone HTML report; `demo` returns the synthetic equivalent without touching the database. With `--output`, only the requested text (CSV, JSON or HTML) is written to a new file and stdout returns the path; existing files are never overwritten. `--output` is supported by `export`, `report` and `demo`.

Exit codes:

- `0`: successful operation; inspect returned values for business meaning.
- `1`: validation, configuration, storage or other execution error; `{ok:false,error:{code,message}}`.
- `3`: collect returned partial/failed; `{ok:true,data:{status,...}}`. This distinguishes an executed but incomplete collection from CLI failure. Preserve saved results and surface warnings/errors.

Errors include VALIDATION_ERROR, NOT_FOUND, INVALID_TRANSITION, UNKNOWN_EVIDENCE, INPUT_UNREADABLE (the `--input` path could not be read; pass a readable JSON file or `-` for stdin), PROVIDER_REQUIRED, PROVIDER_CONNECT_FAILED, PROVIDER_CALL_FAILED, PROVIDER_SHAPE, TIMEOUT, CURSOR_LOOP, INVALID_OPTION. Unexpected errors are summarized instead of reflecting upstream credentials or raw output.

For SDK callers, `execute(store, command, input, optionalProvider)` implements the same commands. It returns the data payload and throws errors; wrap with `publicError` for the CLI-shaped error envelope.

## Standard MCP tools

The MCP server exposes the same twelve operations as `opportunity_<command>`. Inputs match this table except `opportunity_collect`, whose provider is configured by the host at server startup and cannot be supplied by a model tool call. `opportunity_report` and `opportunity_demo` return the HTML text in their JSON payload; `opportunity_demo` never touches the user database. The server uses stdout exclusively for MCP messages. Collection status and coverage warnings remain part of the returned payload.

The MCP server is a local, single-user stdio process. It has no built-in remote authentication or multi-tenant isolation. A client should use a separate database and provider configuration for each account/workspace. It starts no scheduler. `doctor.providerConfigured` reports configuration presence, not login validity.
