import { type Opportunity } from './model.js';

export type CsvHeader = 'en' | 'zh';
const headers: Record<CsvHeader, string[]> = {
  en: ['key', 'title', 'url', 'published_at', 'observed_at', 'stage', 'decision', 'review_stale',
    'work_mode', 'demand_type', 'rate_min', 'rate_max', 'rate_unit', 'rate_volume', 'risk_flags',
    'reason', 'ai_acceptance', 'budget', 'currency'],
  zh: ['记录ID', '标题', '链接', '发布时间', '观察时间', '阶段', '判断', '判断过期',
    '工作方式', '需求方类型', '最低单价', '最高单价', '计价单位', '工作量', '风险标记',
    '判断理由', 'AI接受度', '预算', '币种'],
};
const zhValues = {
  stage: { discovered: '待处理', contacted: '已联系', requirements_review: '需求确认', accepted: '已接受', delivered: '已交付', closed: '已关闭' } as Record<string, string>,
  decision: { priority: '重点', pending: '待定', excluded: '排除', unreviewed: '未判断' } as Record<string, string>,
  workMode: { remote: '远程', hybrid: '混合', onsite: '坐班', unknown: '未知' } as Record<string, string>,
  demandType: { buyer: '直招', agency: '工作室/中介', recruiter: '招募方', seller: '卖服务', unknown: '未知' } as Record<string, string>,
  rateUnit: { per_item: '元/条', per_minute: '元/分钟', per_hour: '元/小时', per_day: '元/天', per_month: '元/月', per_project: '元/项目', unknown: '元' } as Record<string, string>,
  riskFlag: { deposit: '押金', training_fee: '培训费', unpaid_trial: '免费试稿', unclear_rate: '单价不清',
    unrealistic_volume: '工作量异常', off_platform_payment: '站外结算', account_access: '索要账号',
    stale_post: '可能过期', agency_cut: '中介抽成', other: '其他风险' } as Record<string, string>,
  aiAcceptance: { accepted: '接受', rejected: '不接受', unknown: '未知' } as Record<string, string>,
};
function zhValue(group: keyof typeof zhValues, value: string): string {
  return zhValues[group][value] ?? value;
}

function csvCell(value: unknown): string {
  let text = value == null ? '' : String(value);
  // Quote CSV syntax and neutralize spreadsheet formula prefixes, including leading whitespace.
  if (/^[\s\uFEFF]*[=+@-]/u.test(text) || /^[\t\r\n]/u.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
export function exportCsv(rows: Opportunity[], header: CsvHeader = 'en'): string {
  const zh = header === 'zh';
  return [headers[header], ...rows.map(o => {
    const rate = o.review?.rate;
    return [o.key, o.note.title, o.url, o.note.publishedAt, o.lastSeenAt,
      zh ? zhValue('stage', o.stage) : o.stage,
      zh ? zhValue('decision', o.review?.decision ?? 'unreviewed') : (o.review?.decision ?? 'unreviewed'),
      zh ? (o.reviewStale ? '是' : '否') : o.reviewStale,
      zh ? zhValue('workMode', o.review?.workMode ?? 'unknown') : (o.review?.workMode ?? 'unknown'),
      zh ? zhValue('demandType', o.review?.demandType ?? 'unknown') : (o.review?.demandType ?? 'unknown'),
      rate?.min ?? '', rate?.max ?? '',
      rate ? (zh ? zhValue('rateUnit', rate.unit) : rate.unit) : '',
      rate?.volume ?? '',
      (o.review?.riskFlags ?? []).map(flag => zh ? zhValue('riskFlag', flag) : flag).join(';'),
      o.review?.reason,
      zh ? zhValue('aiAcceptance', o.review?.aiAcceptance ?? 'unknown') : (o.review?.aiAcceptance ?? 'unknown'),
      o.review?.budget ?? '', o.review?.currency ?? 'CNY'];
  })].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
export function exportJson(rows: Opportunity[]): string {
  return JSON.stringify({ schemaVersion: 1, exportedAt: new Date().toISOString(), opportunities: rows }, null, 2) + '\n';
}
