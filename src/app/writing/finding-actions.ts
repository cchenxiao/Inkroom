import type { BackendRun } from '@/features/prepare/types/backend';
import { rewriteRequest } from './rewrite-request';

export function findingTarget(run: BackendRun | undefined, id: string) {
  const finding = run?.result?.report.findings.find((f) => f.id === id);
  const segment = run?.result?.segments.find((s) => s.id === finding?.segmentId);
  if (!finding || !segment) throw new Error('问题或正文已变化，请重新选择当前版本的问题。');
  return { finding, segment };
}
export function replaceFindingQuote(run: BackendRun | undefined, id: string, replacement: string) {
  const { finding, segment } = findingTarget(run, id);
  if (!finding.quote) throw new Error('这条意见没有可定位的原文，请在正文中选择修改范围。');
  const range = rewriteRequest(segment, '', finding.quote);
  const chars = Array.from(segment.text);
  const text = chars.slice(0, range.start).join('') + replacement + chars.slice(range.end).join('');
  if (!text.trim()) throw new Error('本段正文不能为空。');
  return { segmentId: segment.id, text };
}
export function findingRewrite(
  run: BackendRun | undefined,
  id: string,
  instruction: string,
  whole: boolean,
) {
  const { finding, segment } = findingTarget(run, id);
  if (!whole && !finding.quote) throw new Error('这条意见没有可定位的原文，请选择当前情节段。');
  const request = `针对审查意见：${finding.reason}\n作者要求：${instruction}\n只修改指定范围；其他情节段仅作衔接参照，不可修改。`;
  if (Array.from(request).length > 1000)
    throw new Error('问题说明与修改要求合计超过 1000 字，请精简修改要求。');
  return rewriteRequest(segment, request, whole ? undefined : finding.quote);
}
