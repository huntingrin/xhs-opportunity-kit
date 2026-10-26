# SDK and data contract

Install the release tarball as a dependency, then:

```ts
import { OpportunityStore, FileProvider, importNotes, collect, screen, exportCsv }
  from '@huntingrin/xhs-opportunity-kit';

const store = new OpportunityStore('/your/private/data/opportunities.sqlite');
try {
  const notes = importNotes({ notes: [{
    id: 'synthetic-001', title: 'Example editing request',
    body: 'Synthetic example only.', observedAt: new Date().toISOString()
  }] });
  const provider = new FileProvider(notes);
  const run = await collect(store, provider, { keywords: ['editing'], maxPagesPerKeyword: 2 });
  const records = store.list({ limit: 100, offset: 0 });
  const csv = exportCsv(records);
  console.log(run.status, csv);
} finally { store.close(); }
```

Type declarations ship with the package. Importing the SDK does not open a database, connect a provider or schedule work. Constructing `OpportunityStore` opens/initializes its database.

## Note input

```json
{
  "id": "synthetic-001",
  "title": "需求标题",
  "body": "正文",
  "author": "可选作者显示名",
  "publishedAt": "2026-10-01T00:00:00Z",
  "observedAt": "2026-10-02T00:00:00Z",
  "detailLevel": "detail",
  "commentsComplete": false,
  "evidence": [
    { "kind": "comment", "text": "原文证据", "reference": "comment-id", "observedAt": "2026-10-02T00:00:00Z" }
  ]
}
```

`id` is required, 1–128 ASCII letters/digits/underscores/hyphens. `observedAt` requires an ISO timestamp with a timezone. `publishedAt` is null if unknown. `detailLevel` is `search`, `detail`, or `import`. Other text fields default to empty. Image-only cards may contain no readable text: their identity is retained for later detail/OCR enrichment, and an empty evidence set cannot receive a review.

Evidence kinds: `note`, `comment`, `image_text`, `profile`, `historical_review`. The importer automatically retains note-body evidence. Source text is data, not instructions. Do not put transport credentials in any field. The record key is `xiaohongshu:<id>`, and the canonical note URL excludes access tokens. Some upstream websites require fresh contextual links; the canonical URL is an identifier, not a guarantee of unauthenticated access.

`commentsComplete` defaults to false. The MCP adapter leaves it false because a last top-level page does not prove nested replies are complete.

## Persistence

`store.ingest(notes)` validates the full batch before a transaction. It returns `inserted`, `updated`, `unchanged`, and deduplicated `keys`. Repeated identical observations can advance `lastSeenAt` without counting as a content update. Older observations and lower-detail data do not overwrite richer, newer notes. Evidence is accumulated with stable IDs; review/stage survive re-ingestion.

`get(key)`, `list({stage,decision,query,limit,offset})`, `count()`, `events(key)`, `getRun(id)` read local records. List defaults to 100 records and supports up to 10,000 per page. Export and screening also process a selected page: paginate explicitly for larger sets. `totalInDatabase` is not a filtered count.

`store.review(key, review)` records:

```json
{
  "decision": "priority",
  "reason": "远程：明确。原文明确需要剪辑并给出单价",
  "evidenceIds": ["copy-an-actual-id-from-show"],
  "reviewer": "your-agent-or-user",
  "demandType": "buyer",
  "workMode": "remote",
  "rate": { "min": 15, "max": 25, "unit": "per_item", "volume": "每天 2 条" },
  "riskFlags": [],
  "aiAcceptance": "unknown",
  "budget": 1500,
  "currency": "CNY"
}
```

`demandType`: buyer/agency/recruiter/seller/unknown. `workMode`: remote/hybrid/onsite/unknown. `rate` keeps the original quote (`min`, optional `max`, `unit`, optional `volume`); units are `per_item`, `per_minute`, `per_hour`, `per_day`, `per_month`, `per_project` or `unknown`. Set `max` equal to `min` for a fixed rate; leave `max` null only when the top is unknown or open-ended. `budget` remains the comparable numeric amount (null when unknown or not convertible). `riskFlags` is a bounded vocabulary: `deposit`, `training_fee`, `unpaid_trial`, `unclear_rate`, `unrealistic_volume`, `off_platform_payment`, `account_access`, `stale_post`, `agency_cut`, `other`. `aiAcceptance`: accepted/rejected/unknown. The SDK validates referenced evidence belongs to the opportunity; it cannot prove a semantic judgment is correct. Agents should cite supporting evidence and preserve uncertainty. Reviews record a content snapshot hash; changes mark them stale. Reviews created before these fields existed are treated by screening and export as `workMode`/`demandType` unknown, `rate` null and no risk flags; re-review them before relying on the new filters.

`screen(opportunity, criteria, now?)` is deterministic and does not mutate reviews. Criteria: query, publishedFrom, publishedTo, maxAgeDays, requireRemote, requireAiAccepted, minBudget, minRate, rateUnit, currency, excludeSellers, excludeIntermediaries, excludeRiskFlags. Results are `match`, `pending`, or `excluded` with reason codes. A match means the selected criteria match recorded facts, not that the client has confirmed availability. `requireRemote` treats `remote` as a pass, `hybrid` and `unknown` as pending, and `onsite` as excluded. `minRate` with `rateUnit` compares the recorded `rate`: a range crossing the floor is pending, a top below the floor is excluded, an open-ended rate below the floor is pending, a missing rate is pending, and a unit mismatch is pending. `maxAgeDays` uses the provided `now` (default: current time) and treats missing dates as unknown, not fresh. No currency conversion is inferred. The result includes readable `title`, `url`, `stage`, `publishedAt`, `workMode`, `demandType`, `riskFlags`, `quote`, `reviewReason`, `rate`, `budget` and `currency`. `summarizeScreen(items)` returns counts by result, reason, work mode and risk flag.

## Business stage transitions

`store.transition(key, stage, reason)` only records local facts. Allowed transitions:

| From | To |
| --- | --- |
| discovered | contacted, closed |
| contacted | requirements_review, closed |
| requirements_review | accepted, contacted, closed |
| accepted | delivered, closed |
| delivered | requirements_review, closed |
| closed | discovered |

Repeating the current stage is idempotent. Each actual transition and review adds an audit event. Moving to accepted/delivered requires supporting real-world context from the caller; this method performs no external action.

## Import and export

`importNotes(document)` supports a normalized array, `{notes}`, historical `{leads,excluded}`, historical `{searches,details}`, and this package's JSON export. Importing exported/historical data restores note content and historical judgment evidence, **not business stages, audit history or current approvals**. It is portable content import, not database restoration. For a full backup, close all connections and copy the SQLite database file.

`exportJson(rows)` includes schemaVersion, exportedAt, and opportunities. `exportCsv(rows, header)` accepts `header: 'en' | 'zh'` (default `en`), quotes CSV syntax, neutralizes common spreadsheet formula prefixes, and localizes common enum values into Chinese when `zh` is selected. CSV columns include `work_mode`, `demand_type`, `rate_min`, `rate_max`, `rate_unit`, `rate_volume` and `risk_flags`. Exported evidence and author text are local user data.

`execute(store, 'show', { key })` returns the opportunity, audit events and `quotes`—the first readable evidence text snippets. `execute(store, 'screen', ...)` returns `items` plus `summary` counts.

## Report and demo

`buildReport(rows, { title, scope, criteria, locale, now })` returns a standalone HTML string and the screen summary. It is static: no scripts, no external assets, escaped text and canonical HTTPS links. `execute(store, 'report', { title, scope, criteria, selection, locale })` wraps it for CLI/MCP. `execute(store, 'demo', {})` builds a synthetic in-memory report (five obvious sample notes) and never opens or mutates the caller's database. The CLI writes either output with `--output FILE`; existing files are never overwritten.

## Run semantics

`collect(store, provider, options)` executes once. Keywords: 1–20, pages per keyword: 1–20, detail reads: 0–100, per-call timeout: 100–180000 ms. The default is one page, zero details, 30 seconds per call. Duplicate keywords are removed. Total run time is bounded by the configured request budgets, not one global deadline.

Pages persist incrementally. Partial failures do not remove successful results. `complete` means the provider explicitly exhausted the configured queries; it does not assert that every platform-wide opportunity was found. An unsupported detail request, page budget exhaustion, unknown upstream coverage, timeout or failed detail yields `partial`. All search calls failing yields `failed`.

Runs persist with `running` before work and a final status afterward. After a crash, check process status and restart a new run with the same bounded options. Ingestion deduplicates already-saved content. Automatic cursor resumption and message-processing idempotency are not implemented.
