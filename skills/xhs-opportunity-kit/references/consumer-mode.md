# Consumer mode: remote freelancer seeking work

Read this before the first collection. It defines the default consumer experience: the user is a **remote freelancer looking for paid work**. Remote is a hard requirement, not a preference. The business contract stays in `docs/api.md`; this file only changes what you ask, search, and report.

Keep user-facing copy in the user's language. The Chinese examples below are the default for this skill.

## Who you are talking to

The default user is a remote freelancer, not a data administrator and not a client hiring people. Your job is to turn a bounded search into a short, evidence-backed shortlist of **remote** opportunities and one clear next action. Do not narrate commands, database counters, reason codes or test steps.

If the user says they are hiring rather than looking for work, ask and switch the questions/card fields; do not mix the two modes.

## First run: ask, bound, show three

Ask at most three questions; any answer may be "先看看" / "不确定".

1. 你想接什么活？(剪辑、设计、写作、配音、运营……)
2. 单价或月收入底线是多少？
3. 每天大概能投入几小时？想接长期稳定还是零散单？

Do **not** ask about location or remote: remote is the default premise. Do **not** ask about AI acceptance unless the user says they use AI or asks whether clients allow it.

Before collecting, state the contract:

> 我只找明确说明全程远程/线上的接单机会；要求坐班/到岗的会排除。
>
> 我先用“远程 + 活类型”看首屏 10–12 条，先给你 3 条最值得看的；只读公开内容，存在本机，不会私信，也不会自动接单。小红书搜索不保证翻全，这次不是全平台结果。

Then:
- one or two keywords with remote intent, first page only;
- 10–12 notes, not hundreds;
- enrich at most 3–5 candidates, not every note;
- show three cards first; leave the rest for later.

## Search with remote intent

Build the query from the user's work type plus a remote term:

- `远程剪辑`, `线上剪辑`, `居家剪辑`, `不限地点剪辑`
- or `远程 + 短视频剪辑` / `线上 + 后期剪辑`

Rules:

- Do **not** use `找剪辑` / `招剪辑` alone as the primary query; it pulls on-site and attendance roles.
- If results are thin, broaden the work type (剪辑 → 短视频 / 后期 / 设计), **not** the location.
- If the platform does not combine terms well, search broadly, then classify each post's body. Never assume a result is remote from the query alone.

## Review the shortlist, not the database

Do not review all collected notes. Pick the 3–5 most plausible candidates, review those, and ask the user to calibrate:

> 这 3 条里，哪条你觉得靠谱、哪条不靠谱？我按你的口径再调。

If the user is unsure what to do with posts that do not mention location, ask once:

> 没写地点的单子，你要我先问一句“是否全程远程”，还是直接排除？默认先问一句。

Expand only after calibration. `unreviewed` is a valid state, not a failure; do not fill it just to make `screen` return something.

## Remote classification: three buckets

| Signals in the post | Verdict | Where it goes |
| --- | --- | --- |
| Explicitly says 全程远程 / 远程办公 / 线上办公 / 居家 / 不限地点 / 可异地 / 不需要到岗 | 明确远程 | 建议先联系 |
| Says 可远程 / 远程优先 / 偶尔线下 / does not mention location / only says 线上交付 but not where the person works | 需确认 | 值得问一句 |
| Requires 坐班 / 到岗 / 驻场 / 每周固定线下 | 不远程 | 不建议 |

Hard rules:

- **Silence is not remote.** Editing is often delivered online, but the poster may still require attendance.
- **Publisher location is not work location.** A Shandong publisher can offer a remote role; a Beijing publisher can still require attendance.
- Only mark 明确远程 when the post text supports it; quote that sentence. No quote means 需确认.
- "远程" does not automatically mean flexible hours. Check fixed online hours and time zone.

Set `workMode` in the review to `remote`, `hybrid`, `onsite` or `unknown`. This is what `screen` uses when `requireRemote` is true. Also start the reason with `远程：明确`, `远程：需确认`, or `远程：坐班` for human readers.

- Never mark `remote` without a supporting quote; silence means `unknown` (需确认).
- `hybrid` goes to 值得问一句; `onsite` is excluded under `requireRemote`.
- Never let a `screen` `match` imply remote if `requireRemote` was not set; check `workMode`.

## Report order

1. **Scope and judge** — one line: keywords, first page, N notes, N details, remote counts, agent initial screen, not exhaustive.
2. **建议先联系** — at most 3 cards, only 明确远程.
3. **值得问一句** — what is missing (including 需确认 remote) and the exact question to ask.
4. **不建议** — aggregate by reason with counts (坐班/到岗, agency/recruiter, course/lead-gen, rate below floor, stale/duplicate, off-topic).
5. **技术细节** — collapsed: run id, criteria, evidence IDs, coverage warnings.

Example scope line:

> 这次只看了带“远程/线上”的首屏 12 条；8 条明确远程，3 条需确认，1 条要求坐班已排除。

Screening for this default user:

- Always set `requireRemote: true`.
- Add `maxAgeDays` when the user cares about freshness; missing dates remain pending.
- Add `excludeRiskFlags` for risks the user refuses, such as `training_fee` or `deposit`.
- Use `minRate` + `rateUnit` for a per-item/hour/day floor; use `minBudget` only for a comparable monthly/project amount. Do not compare 元/条 with 元/月; ask or convert first.
- Use the returned `summary` for counts instead of counting cards manually.

## Card contract

Each card answers, in order:

- **远程状态**：明确 / 需确认 (for 需确认, say what is missing);
- **谁在找什么**：work type, rate, volume;
- **原话**：1–2 verbatim sentences (never only an evidence ID);
- **为什么适合你**：at most 2 bullets;
- **先确认**：if 需确认, whether it is fully remote; fixed online hours/time zone; direct client or agency; trial work; deposit; payment cycle; workload;
- **风险**：one line (agency cut, no rate, unrealistic volume, deposit/training fee, stale post);
- **下一步**：打开原帖 / 复制开场白 / 标记已联系 / 不感兴趣.

## Money and demand type

- Quote the original unit: 元/条, 元/分钟, 元/月, 元/项目. Record it in `rate` as `{min, max?, unit, volume}`. Set `max` equal to `min` for a fixed rate; leave `max` null only when the top is unknown or open-ended. Keep `budget` as a comparable monthly/project amount only when the unit can be converted; otherwise leave `budget` null and show the rate.
- Distinguish 直招 / 工作室或中介 / 招募代理 / 卖课或引流 with `demandType` `buyer` / `agency` / `recruiter` / `seller` / `unknown`. A recruiter hiring editors is not a direct client; say which one it looks like.
- If the post asks for a deposit, training fee, membership fee or unpaid trial, add the matching `riskFlags` and flag "先确认，别先付钱"; do not accuse.
- Remote work can still require a fixed online window; put that in 先确认, not in 风险 unless the post states it.

## Say it in human terms

| Internal | Say to the user |
| --- | --- |
| provider | 数据源 / 连接 |
| doctor | 环境检查 |
| inserted / updated / unchanged | 新增 / 更新 / 没有重复新增 |
| detailLevel = search | 只有搜索卡片，还没读正文 |
| review priority | 我判断值得优先看 |
| screen match | 按你给的条件，建议联系 |
| pending | 信息不足，先问一句 |
| excluded | 不建议 |
| reviewStale | 原帖有更新，旧判断暂停使用 |
| INVALID_TRANSITION | 阶段不能跳着记，需要先记录上一步 |
| evidence ID | 原帖依据（引用原话，不只给 ID） |
| partial | 这次没搜全，已保存的结果仍然可用 |

Never put these in the main view unless the user asks: `provider`, `doctor`, `inserted/updated/unchanged`, `evidence ID`, `snapshotHash`, `exit code`, `JSON`, reason codes, `match/pending/excluded`.

Never say "match" as "好线索". Say: "按你给的条件，这条值得联系；还没确认的是 X."

`doctor` returns `checks`: translate them instead of showing raw statuses. Storage `ok` → "本地库正常，已有 N 条记录"; provider `attention` → "还没配置数据源，导入/判断/导出仍可用，实时搜索需要连接"; outbound `info` → "不会发消息，也不会自动接单".

## Stage, stale and coverage

- Record a stage only when the user confirms it happened. If a transition is rejected, explain the required order and offer to record the missing step; never show the code.
- Adding details or comments changes the snapshot and marks prior reviews stale. Before enriching, warn: "补完会重新核验，之前的判断可能变成待定." After, re-check the changed evidence and re-apply the `远程：...` prefix; do not silently reuse the old verdict.
- `partial` means coverage is incomplete. Keep saved results and say what is missing; never report it as "搜完了".

## Export and handoff

- Default to the recommended list, not all records: `{"format":"csv","header":"zh","selection":{"decision":"priority","limit":100}}`. Tell the user where the file is and that CSV opens in Excel.
- Use `header:"zh"` for Chinese columns. The CSV includes `work_mode`, `demand_type`, `rate_*` and `risk_flags`.
- JSON is for developers; do not lead with it.
- The kit does not send messages. Offer a short opener and a confirmation checklist, then let the user send it.

## Local report and demo

- `report` renders a standalone HTML report from local records. Write it with `--output report.html`; the file is static and opens in any browser. Pass a `scope` line with keywords, first-page/partial coverage and remote counts so the report does not imply a complete search.
- `demo` renders synthetic data and never touches the user's database. Use it when the user wants to see the output shape before connecting a provider.
- The report is still local; nothing is sent or published. Do not present it as a hosted web app.

## First message (example)

> 我可以帮你从小红书找公开的远程接单机会，去重后按你的条件初筛，每条都带原帖依据；不会私信，也不会自动接单。
>
> 我只找明确说明全程远程/线上的机会；要求坐班/到岗的会排除。
>
> 先确认 3 件事（都可以说“先看看”）：
> 1. 你想接什么活？
> 2. 单价或月收入底线是多少？
> 3. 每天大概能投入几小时？想接长期还是零散？
>
> 我先用“远程 + 活类型”看首屏 10–12 条，给你 3 条最值得看的；你觉得靠谱，我再扩。

## Result message (example)

> 这次只看了带“远程/线上”的首屏 12 条；8 条明确远程，3 条需确认，1 条要求坐班已排除。这是我先做的初筛，你可以改。
>
> **建议先联系（2）**
> 1. 远程（明确）｜美妆个护带货剪辑｜15 元/条 · 50 秒 · 400 条/月起
>    原话：“……”
>    为什么：单价、时长、量都写清楚；发布者更像工作室/招募方，需确认是否直签。
>    先确认：真远程？固定在线时段？结算周期？试稿/押金？
>    风险：招募方可能抽成；400 条/月的量需要确认是否一人可完成。
>    下一步：打开原帖 / 复制开场白
> 2. 远程（明确）｜抖音直播女装剪辑｜15–25 元/条 · 每天≥2 条 · 可长期
>    ...
>
> **值得问一句（3）**
> - 没写地点的剪辑单 → 先问“是否全程远程，有没有固定在线时段？”
>
> **不建议（1）**
> - 要求每周到岗 2 天。
>
> 下一步：要我补这 2 条评论区，还是先写两段开场白？
> （技术细节：run id / 证据 ID / 筛选条件 / 覆盖范围）

The names, numbers and counts above are format examples; replace them with the actual evidence and results.

## Do not

- Do not start with doctor/provider/database counts.
- Do not review all notes.
- Do not call a screen match a confirmed job.
- Do not show evidence IDs without quotes.
- Do not ask about AI by default.
- Do not claim complete coverage.
- Do not send messages or record stages the user did not confirm.
- Do not export all records by default.
- Do not treat silence as remote.
- Do not use the publisher's location as the work location.
- Do not put on-site or hybrid roles in 建议先联系.
- Do not search only "找剪辑" without remote intent.
- Do not ask client-side questions such as "你要招什么人".
