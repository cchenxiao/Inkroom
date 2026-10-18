export interface ManuscriptStatusInput {
  accepted: boolean;
  adoptedVersion?: number;
  version?: number;
  segments: readonly unknown[];
  loading?: boolean;
  loadError?: boolean;
}

/** Adoption belongs to a saved version, not to the current selection or review task. */
export function manuscriptStatus(part: ManuscriptStatusInput, snapshot = false) {
  const version = part.version === undefined ? '' : ` v${part.version}`;
  if (snapshot) return { tone: 'snapshot', label: '章稿对照 · 只读', detail: '' };
  if (!part.segments.length) {
    if (part.loadError) return { tone: 'unavailable', label: '读取失败', detail: '可重新读取' };
    if (part.loading) return { tone: 'empty', label: '读取中', detail: '' };
    return { tone: 'empty', label: '尚无正文', detail: '' };
  }
  if (part.accepted)
    return {
      tone: 'adopted',
      label: `已采用${part.adoptedVersion === undefined ? version : ` v${part.adoptedVersion}`}`,
      detail: '',
    };
  return {
    tone: 'candidate',
    label: `${part.adoptedVersion === undefined ? '待采用' : '新候选'}${version}`,
    detail: part.adoptedVersion === undefined ? '' : `已采用 v${part.adoptedVersion} 保留`,
  };
}
