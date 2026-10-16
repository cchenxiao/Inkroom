export function textLabel(text: string | undefined, fallback: string, limit = 32) {
  const value = text?.replace(/\s+/g, ' ').trim();
  return value ? (value.length > limit ? value.slice(0, limit) + '…' : value) : fallback;
}

export const repairScopeLabels: Record<string, string> = {
  phrase: '当前词句',
  outline: '章节大纲',
  none: '无需修改',
  sentence: '当前句子',
  segment: '当前段落',
  scene: '当前场景',
  beat: '当前情节段',
  chapter: '当前章节',
  cross_chapter: '跨章节',
  global: '全书',
};

/** Preserve useful business explanations; never use an implementation exception as UI copy. */
export function readableMessage(value: string | undefined, fallback: string) {
  if (
    !value ||
    !/[\u3400-\u9fff]/.test(value) ||
    /\uFFFD|SQLSTATE|panic:|dial tcp|stack trace|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f-]{20,}|[a-f0-9]{32,}/i.test(
      value,
    )
  )
    return fallback;
  return value
    .replace(/\bBeat\b/g, '情节段')
    .replace(/\bCritic\b/g, '审稿')
    .replace(/\bWriter\b/g, '正文生成');
}

export function versionLabel(version: number, createdAt: string) {
  const date = new Date(createdAt);
  return `候选 v${version}${Number.isNaN(date.getTime()) ? '' : ` · ${date.toLocaleString('zh-CN')}`}`;
}
