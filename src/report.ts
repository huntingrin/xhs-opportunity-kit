import { z } from 'zod';
import { type DemandType, type Opportunity, type Rate, type ReviewInput, type RiskFlag, type Stage, type WorkMode } from './model.js';
import { filterSchema, screen, summarizeScreen, type ScreenResult, type ScreenSummary } from './workflows.js';
import { OpportunityStore } from './store.js';

type Locale = 'zh' | 'en';
export interface ReportOptions {
  title?: string; scope?: string; criteria?: z.input<typeof filterSchema>; locale?: Locale; now?: number;
}
export interface ReportResult { html: string; summary: ScreenSummary; items: ScreenResult[] }

const labels = {
  zh: {
    defaultTitle: '机会报告', defaultScope: '本地记录，按当前条件筛选',
    match: '建议先联系', pending: '值得问一句', excluded: '不建议', noMatch: '这次没有符合条件的记录。',
    noPending: '这次没有需要追问的记录。', noExcluded: '这次没有排除记录。',
    quote: '原帖原话', risk: '先确认', open: '打开原帖', untitled: '未命名笔记',
    generated: '生成时间', technical: '技术细节', footer: '本报告由本地数据生成；不会发送消息，也不会自动接单。',
    reasons: '原因', workModes: '工作方式', counts: '统计', total: '记录数',
    remoteCount: '明确远程', remotePending: '远程待确认', onsiteCount: '坐班/到岗',
    noQuote: '暂无正文摘录，请打开原帖查看。',
  },
  en: {
    defaultTitle: 'Opportunity report', defaultScope: 'Local records, filtered by the current criteria',
    match: 'Recommended', pending: 'Worth asking', excluded: 'Not recommended', noMatch: 'No records match the current criteria.',
    noPending: 'Nothing needs a follow-up question.', noExcluded: 'Nothing was excluded.',
    quote: 'Post excerpt', risk: 'Confirm first', open: 'Open post', untitled: 'Untitled note',
    generated: 'Generated', technical: 'Technical details', footer: 'Generated from local data; no messages are sent and no work is accepted automatically.',
    reasons: 'Reasons', workModes: 'Work mode', counts: 'Counts', total: 'Records',
    remoteCount: 'Remote', remotePending: 'Remote unconfirmed', onsiteCount: 'On-site',
    noQuote: 'No readable excerpt; open the post to inspect it.',
  },
} as const;

const workModeLabels: Record<Locale, Record<WorkMode, string>> = {
  zh: { remote: '远程（明确）', hybrid: '远程（可能混合）', onsite: '坐班/到岗', unknown: '远程（需确认）' },
  en: { remote: 'Remote (confirmed)', hybrid: 'Remote (hybrid)', onsite: 'On-site', unknown: 'Remote (unconfirmed)' },
};
const demandTypeLabels: Record<Locale, Record<DemandType, string>> = {
  zh: { buyer: '直招', agency: '工作室/中介', recruiter: '招募方', seller: '卖服务/课程', unknown: '需求方未判断' },
  en: { buyer: 'Direct client', agency: 'Agency', recruiter: 'Recruiter', seller: 'Seller/course', unknown: 'Demand type unknown' },
};
const stageLabels: Record<Locale, Record<Stage, string>> = {
  zh: { discovered: '待处理', contacted: '已联系', requirements_review: '需求确认', accepted: '已接受', delivered: '已交付', closed: '已关闭' },
  en: { discovered: 'Discovered', contacted: 'Contacted', requirements_review: 'Requirements review', accepted: 'Accepted', delivered: 'Delivered', closed: 'Closed' },
};
const riskLabels: Record<Locale, Record<RiskFlag, string>> = {
  zh: { deposit: '押金', training_fee: '培训费', unpaid_trial: '免费试稿', unclear_rate: '单价不清',
    unrealistic_volume: '工作量异常', off_platform_payment: '站外结算', account_access: '索要账号',
    stale_post: '可能过期', agency_cut: '中介抽成', other: '其他风险' },
  en: { deposit: 'Deposit', training_fee: 'Training fee', unpaid_trial: 'Unpaid trial', unclear_rate: 'Unclear rate',
    unrealistic_volume: 'Unrealistic volume', off_platform_payment: 'Off-platform payment', account_access: 'Account access',
    stale_post: 'Possibly stale', agency_cut: 'Agency cut', other: 'Other risk' },
};
const rateUnitLabels: Record<Locale, Record<Rate['unit'], string>> = {
  zh: { per_item: '元/条', per_minute: '元/分钟', per_hour: '元/小时', per_day: '元/天', per_month: '元/月', per_project: '元/项目', unknown: '元' },
  en: { per_item: '/item', per_minute: '/minute', per_hour: '/hour', per_day: '/day', per_month: '/month', per_project: '/project', unknown: '' },
};
const reasonLabels: Record<Locale, Record<string, string>> = {
  zh: {
    REMOTE_UNVERIFIED: '还没确认是否全程远程', HYBRID: '可能是混合办公', ONSITE: '要求坐班/到岗',
    SELLER: '同行/卖服务或课程', INTERMEDIARY: '中介/招募方', RISK_FLAG: '命中你排除的风险标记',
    DEMAND_UNVERIFIED: '还没判断是直招还是中介', DATE_UNKNOWN: '发布时间未知', TOO_OLD: '发布时间太久',
    QUERY_MISMATCH: '和搜索词不匹配', OUTSIDE_DATE_RANGE: '不在时间范围内',
    EXCLUDED_OR_CLOSED: '已排除或已关闭', REVIEW_STALE: '原帖有更新，旧判断已过期',
    AI_ACCEPTANCE_UNKNOWN: '对方是否接受 AI 未知', AI_REJECTED: '对方明确不接受 AI',
    BUDGET_UNKNOWN: '单价/预算未知', BUDGET_TOO_LOW: '低于你的底线', CURRENCY_MISMATCH: '币种不一致',
    RATE_UNKNOWN: '单价未知', RATE_UNIT_MISMATCH: '计价单位和你的底线不一致',
    RATE_TOO_LOW: '单价低于你的底线', RATE_RANGE: '单价区间跨过你的底线',
    REVIEW_PENDING: '还没有下最终判断',
  },
  en: {
    REMOTE_UNVERIFIED: 'Remote work is not confirmed', HYBRID: 'Possibly hybrid', ONSITE: 'Requires attendance',
    SELLER: 'Seller/course, not a buyer', INTERMEDIARY: 'Agency or recruiter', RISK_FLAG: 'Matches an excluded risk flag',
    DEMAND_UNVERIFIED: 'Demand type is not judged yet', DATE_UNKNOWN: 'Publish date unknown', TOO_OLD: 'Published too long ago',
    QUERY_MISMATCH: 'Does not match the query', OUTSIDE_DATE_RANGE: 'Outside the date range',
    EXCLUDED_OR_CLOSED: 'Excluded or closed', REVIEW_STALE: 'Post changed; the old judgment is stale',
    AI_ACCEPTANCE_UNKNOWN: 'AI acceptance is unknown', AI_REJECTED: 'AI use is rejected',
    BUDGET_UNKNOWN: 'Rate or budget unknown', BUDGET_TOO_LOW: 'Below your floor', CURRENCY_MISMATCH: 'Currency mismatch',
    RATE_UNKNOWN: 'Rate unknown', RATE_UNIT_MISMATCH: 'Rate unit differs from your floor',
    RATE_TOO_LOW: 'Rate is below your floor', RATE_RANGE: 'Rate range crosses your floor',
    REVIEW_PENDING: 'No final judgment yet',
  },
};

const htmlEntities: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, ch => htmlEntities[ch]!);
}
function safeHref(value: string): string {
  try { const url = new URL(value); return url.protocol === 'https:' ? escapeHtml(url.toString()) : '#'; } catch { return '#'; }
}
function formatRate(rate: Rate | null, locale: Locale): string {
  if (!rate) return '';
  const unit = rateUnitLabels[locale][rate.unit];
  const amount = rate.max == null ? String(rate.min) : `${rate.min}–${rate.max}`;
  const suffix = locale === 'zh' ? `${amount} ${unit}` : `CNY ${amount}${unit}`;
  return `${suffix}${rate.volume ? ` · ${rate.volume}` : ''}`;
}
function formatMoney(item: ScreenResult, locale: Locale): string {
  const rate = formatRate(item.rate, locale);
  if (rate) return rate;
  if (item.budget != null) return locale === 'zh' ? `预算 ${item.budget} ${item.currency}` : `${item.budget} ${item.currency}`;
  return locale === 'zh' ? '单价/预算待确认' : 'Rate/budget to confirm';
}
function reasonLabel(code: string, locale: Locale): string { return reasonLabels[locale][code] ?? code; }
function formatDate(value: string | null, locale: Locale): string {
  if (!value) return locale === 'zh' ? '发布时间未知' : 'Date unknown';
  return value.slice(0, 10);
}
function aggregateReasons(items: ScreenResult[]): { code: string; count: number }[] {
  const counts: Record<string, number> = {};
  for (const item of items) for (const reason of new Set(item.reasons)) counts[reason] = (counts[reason] ?? 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([code, count]) => ({ code, count }));
}
function card(item: ScreenResult, locale: Locale): string {
  const t = labels[locale];
  const risks = item.riskFlags.map(flag => riskLabels[locale][flag]);
  const riskJoiner = locale === 'zh' ? '、' : ', ';
  const riskColon = locale === 'zh' ? '：' : ': ';
  const why = item.reviewReason ? `<p class="why">${escapeHtml(item.reviewReason)}</p>` : '';
  const reason = item.result === 'pending'
    ? `${why}<ul class="reasons">${[...new Set(item.reasons)].map(r => `<li>${escapeHtml(reasonLabel(r, locale))}</li>`).join('')}</ul>`
    : why;
  return `<article class="card ${item.workMode}">
  <div class="card-head"><span class="badge ${item.workMode}">${escapeHtml(workModeLabels[locale][item.workMode])}</span>
  <span class="badge muted">${escapeHtml(demandTypeLabels[locale][item.demandType])}</span></div>
  <h3>${escapeHtml(item.title || t.untitled)}</h3>
  <p class="meta">${escapeHtml(formatMoney(item, locale))} · ${escapeHtml(stageLabels[locale][item.stage as Stage] ?? item.stage)} · ${escapeHtml(formatDate(item.publishedAt, locale))}</p>
  <blockquote><span>${escapeHtml(t.quote)}</span>${escapeHtml(item.quote || t.noQuote)}</blockquote>
  ${reason}
  ${risks.length ? `<p class="risk"><strong>${escapeHtml(t.risk)}${riskColon}</strong>${escapeHtml(risks.join(riskJoiner))}</p>` : ''}
  <a class="open" href="${safeHref(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(t.open)}</a>
</article>`;
}
export function buildReport(opportunities: Opportunity[], options: ReportOptions = {}): ReportResult {
  const locale = options.locale ?? 'zh';
  const t = labels[locale];
  const criteria = filterSchema.parse(options.criteria ?? {});
  const now = options.now ?? Date.now();
  const items = opportunities.map(o => screen(o, criteria, now));
  const summary = summarizeScreen(items);
  const matches = items.filter(item => item.result === 'match');
  const pending = items.filter(item => item.result === 'pending');
  const excluded = items.filter(item => item.result === 'excluded');
  const excludedReasons = aggregateReasons(excluded);
  const generatedAt = new Date(now).toISOString();
  const title = options.title ?? t.defaultTitle;
  const scope = options.scope ?? t.defaultScope;
  const technical = escapeHtml(JSON.stringify({ generatedAt, criteria, summary, total: items.length }, null, 2));
  const html = `<!doctype html>
<html lang="${locale === 'zh' ? 'zh-CN' : 'en'}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#f6f4ef;color:#211f1b;font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB",sans-serif}
main{max-width:900px;margin:0 auto;padding:40px 20px 64px}h1{font-size:32px;line-height:1.2;margin:8px 0 10px}
.eyebrow{color:#8a5a2b;font-weight:700;letter-spacing:.08em;text-transform:uppercase;font-size:12px;margin:0}
.scope{color:#625c52;margin:0 0 20px}.stats{display:flex;gap:18px;flex-wrap:wrap;padding:16px 0 24px;border-bottom:1px solid #ddd6ca}
.stats b{font-size:22px;display:block}.stats span{color:#625c52;font-size:13px}
h2{font-size:20px;margin:32px 0 12px}.card{background:#fff;border:1px solid #e5ded2;border-radius:16px;padding:18px 20px;margin:12px 0;box-shadow:0 2px 10px rgba(50,40,20,.04)}
.card.remote{border-left:5px solid #2f7d4f}.card.hybrid{border-left:5px solid #b7791f}.card.unknown{border-left:5px solid #b7791f}.card.onsite{border-left:5px solid #a33a3a}
.card-head{display:flex;gap:8px;flex-wrap:wrap}.badge{display:inline-block;border-radius:999px;padding:2px 10px;font-size:12px;font-weight:700;background:#e8f3ec;color:#23633f}
.badge.hybrid{background:#fff3dc;color:#7a4d00}.badge.onsite{background:#fbe7e7;color:#8a2525}.badge.unknown{background:#fff3dc;color:#7a4d00}.badge.muted{background:#f0ece4;color:#5a5348}
.card h3{margin:10px 0 4px;font-size:19px}.meta{color:#625c52;margin:0 0 10px;font-size:14px}
blockquote{margin:10px 0;padding:10px 14px;background:#faf8f3;border-left:3px solid #d8cfc0;border-radius:6px;white-space:pre-wrap}
blockquote span{display:block;font-size:11px;letter-spacing:.06em;color:#8a8276;text-transform:uppercase;margin-bottom:4px}
.why{margin:10px 0}.reasons{margin:10px 0;padding-left:20px;color:#5d4a1f}.risk{background:#fff8e8;border:1px solid #f0dfb8;padding:8px 10px;border-radius:8px;font-size:14px}
.open{display:inline-block;margin-top:8px;color:#1f5c3a;font-weight:700}.excluded-list{background:#fff;border:1px solid #e5ded2;border-radius:12px;padding:6px 20px}
.excluded-list li{margin:8px 0}.excluded-list span{color:#8a8276;float:right}details{margin-top:32px;color:#625c52}pre{white-space:pre-wrap;word-break:break-word;background:#fff;border:1px solid #e5ded2;border-radius:10px;padding:12px;font-size:12px}
footer{margin-top:28px;color:#8a8276;font-size:13px}
</style></head>
<body><main>
<header><p class="eyebrow">XHS Opportunity Kit</p><h1>${escapeHtml(title)}</h1><p class="scope">${escapeHtml(scope)}</p>
<div class="stats"><span><b>${summary.match}</b>${escapeHtml(t.match)}</span><span><b>${summary.pending}</b>${escapeHtml(t.pending)}</span><span><b>${summary.excluded}</b>${escapeHtml(t.excluded)}</span><span><b>${items.length}</b>${escapeHtml(t.total)}</span><span><b>${summary.workModes.remote}</b>${escapeHtml(t.remoteCount)}</span><span><b>${summary.workModes.hybrid + summary.workModes.unknown}</b>${escapeHtml(t.remotePending)}</span><span><b>${summary.workModes.onsite}</b>${escapeHtml(t.onsiteCount)}</span></div></header>
<section><h2>${escapeHtml(t.match)}</h2>${matches.length ? matches.map(item => card(item, locale)).join('') : `<p>${escapeHtml(t.noMatch)}</p>`}</section>
<section><h2>${escapeHtml(t.pending)}</h2>${pending.length ? pending.map(item => card(item, locale)).join('') : `<p>${escapeHtml(t.noPending)}</p>`}</section>
<section><h2>${escapeHtml(t.excluded)}</h2>${excludedReasons.length ? `<ul class="excluded-list">${excludedReasons.map(r => `<li>${escapeHtml(reasonLabel(r.code, locale))}<span>${r.count}</span></li>`).join('')}</ul>` : `<p>${escapeHtml(t.noExcluded)}</p>`}</section>
<details><summary>${escapeHtml(t.technical)}</summary><pre>${technical}</pre></details>
<footer>${escapeHtml(t.footer)}<br>${escapeHtml(t.generated)}: ${escapeHtml(generatedAt)}</footer>
</main></body></html>`;
  return { html, summary, items };
}

export interface DemoResult { html: string; summary: ScreenSummary; count: number; criteria: z.input<typeof filterSchema> }
export function createDemoReport(): DemoResult {
  const store = new OpportunityStore(':memory:');
  try {
    const now = Date.now();
    const observedAt = new Date(now).toISOString();
    const publishedAt = new Date(now - 2 * 86_400_000).toISOString();
    const notes = [
      { id: 'demo-remote-001', title: '示例：远程短视频剪辑（美妆类）',
        body: '示例数据：招远程剪辑，15 元/条，50 秒内，每月 400 条起，长期合作。',
        publishedAt, observedAt },
      { id: 'demo-remote-002', title: '示例：远程直播切片剪辑',
        body: '示例数据：抖音直播切片，全程远程，15–25 元/条，每天至少 2 条。',
        publishedAt, observedAt },
      { id: 'demo-remote-003', title: '示例：剪辑长期合作（未写地点）',
        body: '示例数据：招长期剪辑，按市场价，具体沟通。',
        publishedAt, observedAt },
      { id: 'demo-onsite-001', title: '示例：北京坐班剪辑',
        body: '示例数据：北京剪辑岗位，需每周到岗 3 天，坐班。',
        publishedAt, observedAt },
      { id: 'demo-recruiter-001', title: '示例：招募剪辑接单代理',
        body: '示例数据：招募剪辑接单代理，加入前需交培训费。',
        publishedAt, observedAt },
    ];
    store.ingest(notes);
    const review = (id: string, data: Omit<ReviewInput, 'evidenceIds' | 'reviewer' | 'currency'>): void => {
      const key = `xiaohongshu:${id}`; const o = store.get(key);
      if (!o || !o.evidence[0]) throw new Error(`Demo note missing: ${id}`);
      store.review(key, { reviewer: 'demo', currency: 'CNY', evidenceIds: [o.evidence[0].id], ...data });
    };
    review('demo-remote-001', { decision: 'priority', reason: '示例：远程明确，单价和量都写清楚',
      workMode: 'remote', demandType: 'buyer', rate: { min: 15, max: 15, unit: 'per_item', volume: '400 条/月' },
      budget: 6000, riskFlags: [] });
    review('demo-remote-002', { decision: 'priority', reason: '示例：远程明确，单价区间和每日量都写清楚',
      workMode: 'remote', demandType: 'agency', rate: { min: 15, max: 25, unit: 'per_item', volume: '每天 2 条' },
      budget: 1500, riskFlags: ['agency_cut'] });
    review('demo-remote-003', { decision: 'pending', reason: '示例：没写地点，单价也未说明',
      workMode: 'unknown', demandType: 'unknown', riskFlags: ['unclear_rate'] });
    review('demo-onsite-001', { decision: 'priority', reason: '示例：要求每周到岗 3 天',
      workMode: 'onsite', demandType: 'buyer', rate: { min: 200, max: 200, unit: 'per_day' }, budget: 4000, riskFlags: [] });
    review('demo-recruiter-001', { decision: 'priority', reason: '示例：招募代理并收培训费',
      workMode: 'remote', demandType: 'recruiter', riskFlags: ['training_fee', 'unclear_rate'] });
    const criteria: z.input<typeof filterSchema> = { requireRemote: true, maxAgeDays: 30, excludeRiskFlags: ['training_fee'] };
    const result = buildReport(store.list({ limit: 100 }), {
      title: '示例：远程接单机会', scope: '合成示例数据，仅用于演示；不是真实线索。', criteria, now,
    });
    return { html: result.html, summary: result.summary, count: result.items.length, criteria };
  } finally { store.close(); }
}
