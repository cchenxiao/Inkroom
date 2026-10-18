import { TextChange } from './text-change';
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
  const whole =
    proposal.request.start === 0 &&
    proposal.request.end === Array.from(proposal.request.original).length;
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
        <strong>{whole ? '本段改写预览' : '选区修改预览'} · 正文尚未改变</strong>
        <p className="muted">
          {whole ? '只替换当前情节段，其他段落保持不变。' : '只替换所选文字，选区外正文保持不变。'}
          应用后保存为待复检候选，处理完后统一复检。
        </p>
        <div className="page-actions">
          <Button size="sm" disabled={busy || sending} onClick={() => void submit(true)}>
            {whole ? '应用到本段候选稿' : '应用选区修改'}
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
        <TextChange
          before={Array.from(proposal.request.original)
            .slice(proposal.request.start, proposal.request.end)
            .join('')}
          after={proposal.replacement}
        />
        {notice && <p role="status">{notice}</p>}
      </section>
    </aside>
  );
}
