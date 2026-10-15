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
  "reason": "原文明确提出需求并接受 AI",
  "evidenceIds": ["copy-an-actual-id-from-show"],
  "reviewer": "your-agent-or-user",
  "demandType": "buyer",
  "aiAcceptance": "accepted",
  "budget": 800,
  "currency": "CNY"
}
```

`demandType`: buyer/seller/unknown. `aiAcceptance`: accepted/rejected/unknown. Budget is a user/agent-reviewed numeric amount (null when unknown), not a claim automatically extracted by this package. The SDK validates referenced evidence belongs to the opportunity; it cannot prove a semantic judgment is correct. Agents should cite supporting evidence and preserve uncertainty. Reviews record a content snapshot hash; changes mark them stale.

`screen(opportunity, criteria)` is deterministic and does not mutate reviews. Criteria: query, publishedFrom, publishedTo, requireAiAccepted, minBudget, currency, excludeSellers. Results are `match`, `pending`, or `excluded` with reason codes. A match means the selected criteria match recorded facts, not that the client has confirmed availability. No currency conversion is inferred.

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

`exportJson(rows)` includes schemaVersion, exportedAt, and opportunities. `exportCsv(rows)` quotes CSV syntax and neutralizes common spreadsheet formula prefixes. Exported evidence and author text are local user data.

## Run semantics

`collect(store, provider, options)` executes once. Keywords: 1–20, pages per keyword: 1–20, detail reads: 0–100, per-call timeout: 100–180000 ms. The default is one page, zero details, 30 seconds per call. Duplicate keywords are removed. Total run time is bounded by the configured request budgets, not one global deadline.

Pages persist incrementally. Partial failures do not remove successful results. `complete` means the provider explicitly exhausted the configured queries; it does not assert that every platform-wide opportunity was found. An unsupported detail request, page budget exhaustion, unknown upstream coverage, timeout or failed detail yields `partial`. All search calls failing yields `failed`.

Runs persist with `running` before work and a final status afterward. After a crash, check process status and restart a new run with the same bounded options. Ingestion deduplicates already-saved content. Automatic cursor resumption and message-processing idempotency are not implemented in v0.1.
