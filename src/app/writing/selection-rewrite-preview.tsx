import { useState } from 'react';
import { Button } from '@/shared/ui';
import type { BackendRun } from '@/features/prepare/types/backend';

type Proposal = NonNullable<NonNullable<BackendRun['result']>['findingProposal']>;
export function SelectionRewritePreview({
  proposal,
  busy,
  onApply,
  onDiscard,
}: {
  proposal: Proposal;
  busy: boolean;
  onApply: (id: string) => Promise<boolean | undefined> | undefined;
  onDiscard: (id: string) => Promise<boolean | undefined> | undefined;
}) {
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState('');
  const submit = async (apply: boolean) => {
    if (busy || sending) return;
    setSending(true);
    setNotice('');
    try {
      if (!(await (apply ? onApply(proposal.id) : onDiscard(proposal.id))))
        setNotice('操作尚未完成，预览已保留，请核对状态后重试。');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '操作未完成，请重试。');
    } finally {
      setSending(false);
    }
  };
  return (
    <aside className="finding-popover" aria-label="选区修改预览">
      <section className="finding-preview">
        <strong>选区修改预览 · 正文尚未改变</strong>
        <div>
          <span>修改前</span>
          <blockquote>
            {Array.from(proposal.request.original)
              .slice(proposal.request.start, proposal.request.end)
              .join('')}
          </blockquote>
        </div>
        <div>
          <span>修改后</span>
          <blockquote>{proposal.replacement || '（删除选中文字）'}</blockquote>
        </div>
        <p className="muted">只替换所选文字，选区外正文保持不变。处理完修改后，再统一复审。</p>
        <div className="page-actions">
          <Button size="sm" disabled={busy || sending} onClick={() => void submit(true)}>
            确认替换选中文字
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy || sending}
            onClick={() => void submit(false)}
          >
            放弃这次预览
          </Button>
        </div>
        {notice && <p role="status">{notice}</p>}
      </section>
    </aside>
  );
}
