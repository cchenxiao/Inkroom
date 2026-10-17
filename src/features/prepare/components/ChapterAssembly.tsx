import { versionLabel, readableMessage } from '@/shared/lib/business-labels';
import { TechnicalDetails } from '@/shared/ui/technical-details';
import type { ManuscriptInspection } from '@/types/domain/manuscript-view';
import { useWritingPending } from '@/shared/lib/pending-writing';
import { useState } from 'react';
import ChapterReview from './ChapterReview';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/shared/api/client';
import { Badge, Button, Card } from '@/shared/ui';
import { assemblyMessages as t } from '@/shared/lib/messages-assembly';
import { assemblyApi, type AssemblySaveRequest, type AssemblyPart } from '../api/chapter-assembly';

function Manuscript({ parts }: { parts: AssemblyPart[] }) {
  return (
    <div className="backend-candidate">
      {parts.flatMap((part) =>
        part.segments.map((s) => (
          <p
            key={`${part.beatId}:${s.id}`}
            title={`${part.sceneTitle} · ${part.beatTitle} · v${part.draftVersion}`}
          >
            {s.text}
          </p>
        )),
      )}
    </div>
  );
}
export default function ChapterAssembly({
  chapterId,
  editing,
  embedded = false,
  onRead,
  onReviewBeat,
  enhancedContinuity,
}: {
  chapterId: string;
  editing: boolean;
  embedded?: boolean;
  enhancedContinuity?: boolean;
  onReviewBeat?: (beatId: string) => void;
  onRead?: (view: ManuscriptInspection) => void;
}) {
  const client = useQueryClient();
  const [step, setStep] = useState('auto');
  const [openedRecords, setOpenedRecords] = useState<string[]>([]);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState('');
  const [uncertain, setUncertain] = useState<AssemblySaveRequest | null>(null);
  const [stale, setStale] = useState(false);
  const query = useQuery({
    queryKey: ['chapter-assembly', chapterId, choices],
    queryFn: () => assemblyApi.preview(chapterId, choices),
    enabled: !!chapterId,
    retry: false,
    refetchInterval: 5000,
  });
  const refresh = () => {
    setConfirmed('');
    void client.invalidateQueries({ queryKey: ['chapter-assembly', chapterId] });
  };
  const save = useMutation({
    mutationFn: assemblyApi.save,
    retry: false,
    onSuccess: () => {
      setUncertain(null);
      setStale(false);
      setStep('review');
      refresh();
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status < 500) {
        setUncertain(null);
        setConfirmed('');
        setStale(error.status === 409);
        refresh();
      }
    },
  });
  const otherEdits = useWritingPending(Boolean(uncertain || save.isPending));
  const data = query.data;
  const block = editing
    ? t.editing
    : otherEdits
      ? t.otherPending
      : query.isError
        ? t.error
        : !data?.ready
          ? readableMessage(data?.reason, t.loading)
          : '';
  const locked = save.isPending || !!uncertain;
  const read = (
    a: typeof data extends undefined ? never : import('../api/chapter-assembly').ChapterAssembly,
    title: string,
  ) =>
    onRead?.({
      title,
      parts: a.parts.map((p) => ({ id: p.beatId, title: p.beatTitle, segments: p.segments })),
      findings: [],
    });
  return (
    <Card className={`core-workbench ${embedded ? 'chapter-workflow' : ''}`} aria-label={t.title}>
      <div className="core-heading">
        <h3>{embedded ? '整章检查与定稿' : t.title}</h3>
        <Button size="sm" disabled={locked} onClick={refresh}>
          {embedded ? '更新状态' : t.refresh}
        </Button>
      </div>
      {!embedded && <p className="muted">{t.note}</p>}
      {query.isPending && <p role="status">{t.loading}</p>}
      {query.isError && <p role="alert">{t.error}</p>}
      {data && (
        <>
          {embedded && (
            <ol className="chapter-workflow-progress" aria-label="整章审核步骤">
              <li aria-current={!data.ready ? 'step' : undefined}>处理段落</li>
              <li aria-current={data.ready ? 'step' : undefined}>检查整章</li>
              <li>确认定稿</li>
            </ol>
          )}
          <div
            hidden={embedded && data.ready && step !== 'assembly' && !!data.history.length}
            className="chapter-workflow-step"
          >
            {embedded && data.ready && !!data.history.length && step === 'assembly' && (
              <Button size="sm" variant="ghost" onClick={() => setStep('review')}>
                返回整章检查
              </Button>
            )}
            <div className="chapter-workflow-summary">
              <strong>{data.ready ? '正文已齐，可以核对章稿' : '先完成段落审核'}</strong>
              <p>
                {data.slots.length
                  ? `${data.slots.filter((s) => !s.reason).length}/${data.slots.length} 段已采用`
                  : readableMessage(data.reason, '请先完成章节创作准备。')}
              </p>
            </div>
            {embedded && !data.ready && (
              <ul className="chapter-missing-parts">
                {data.slots
                  .filter((slot) => slot.reason)
                  .map((slot) => (
                    <li key={slot.part.beatId}>
                      <strong>{slot.part.beatTitle}</strong>
                      <p>请先核对并采用这一段的最新正文。</p>
                      {onReviewBeat && (
                        <Button
                          size="sm"
                          variant="default"
                          disabled={locked || editing || otherEdits}
                          onClick={() => onReviewBeat(slot.part.beatId)}
                        >
                          去审核这一段
                        </Button>
                      )}
                    </li>
                  ))}
              </ul>
            )}
            <details open={!embedded} hidden={embedded && !data.ready}>
              <summary>调整组稿来源 · {data.slots.length} 段</summary>
              {data.slots.map((slot) => (
                <div key={slot.part.beatId} className="core-field">
                  <label>
                    {slot.part.sceneTitle} · {slot.part.beatTitle}
                    <select
                      value={choices[slot.part.beatId] ?? slot.part.commitId}
                      disabled={locked || editing || otherEdits}
                      title={otherEdits ? t.otherPending : undefined}
                      onChange={(e) => {
                        setConfirmed('');
                        setChoices({ ...choices, [slot.part.beatId]: e.target.value });
                        save.reset();
                      }}
                    >
                      <option value="">{t.missing}</option>
                      {slot.choices.map((c) => (
                        <option key={c.commitId} value={c.commitId} disabled={!c.eligible}>
                          {versionLabel(c.draftVersion, c.createdAt)}
                          {c.reason ? ` · ${readableMessage(c.reason, '此版本暂不可用')}` : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                  {slot.reason && <p>{readableMessage(slot.reason, '请先审核并采用此段正文。')}</p>}
                </div>
              ))}
            </details>
            <div
              hidden={embedded && !data.ready && !uncertain && !save.isError && !stale}
              className="chapter-save-actions"
            >
              {embedded && !!data.draft.parts?.length && (
                <Button
                  size="sm"
                  disabled={editing || otherEdits}
                  onClick={() => read(data.draft, '整章组稿预览')}
                >
                  在正文区核对组稿
                </Button>
              )}
              {!embedded && !!data.draft.parts?.length && (
                <details open>
                  <summary>{t.preview}</summary>
                  <Manuscript parts={data.draft.parts} />
                </details>
              )}
              {block && <p>{block}</p>}
              <label className="outline-check">
                <input
                  type="checkbox"
                  checked={!!confirmed && confirmed === data.previewDigest}
                  disabled={!!block || locked || query.isFetching}
                  onChange={(e) => {
                    setStale(false);
                    setConfirmed(e.target.checked ? data.previewDigest : '');
                  }}
                />
                {t.confirm}
              </label>
              <Button
                variant="human"
                loading={save.isPending}
                disabled={
                  !!block ||
                  locked ||
                  query.isFetching ||
                  !confirmed ||
                  confirmed !== data.previewDigest
                }
                disabledReason={block || (uncertain ? t.uncertain : t.needsConfirm)}
                onClick={() => {
                  const req: AssemblySaveRequest = {
                    requestId: crypto.randomUUID(),
                    chapterId,
                    choices: Object.fromEntries(
                      data.draft.parts.map((p) => [p.beatId, p.commitId]),
                    ),
                    expectedVersion: data.expectedVersion,
                    previewDigest: data.previewDigest,
                    confirm: true,
                  };
                  setUncertain(req);
                  save.mutate(req);
                }}
              >
                {embedded ? '保存整章，进入检查' : t.save}
              </Button>
              {save.isSuccess && (
                <p role="status">
                  {t.saved} · v{save.data.version}
                </p>
              )}
              {stale && <p role="alert">{t.stale}</p>}
              {save.isError && !stale && (
                <p role="alert">
                  {save.error instanceof ApiError ? save.error.message : t.uncertain}
                </p>
              )}
              {uncertain && !save.isPending && (
                <>
                  <p role="alert">{t.uncertain}</p>
                  <Button onClick={() => save.mutate(uncertain)}>{t.retry}</Button>
                </>
              )}
            </div>
          </div>
          <div hidden={embedded && (!data.ready || step === 'assembly' || !data.history.length)}>
            {embedded && !data.history.length && (
              <p className="chapter-workflow-summary">先核对并保存章稿，再开始整章复审。</p>
            )}
            <ChapterReview
              assemblies={data.history}
              onPrepare={embedded ? () => setStep('assembly') : undefined}
              editing={editing}
              onRead={onRead}
              enhancedContinuity={enhancedContinuity}
            />
          </div>
          <div className="chapter-workflow-history">
            <details>
              <summary>
                {embedded ? '历史章稿与审核记录' : t.history} · {data.history.length}
              </summary>
              {!data.history.length && <p>{t.noHistory}</p>}
              {data.history.map((a) => (
                <details key={a.id}>
                  <summary>
                    v{a.version} · {new Date(a.createdAt).toLocaleString('zh-CN')}
                  </summary>
                  <p>{t.historical}</p>
                  <Badge>
                    {t.plan} v{a.planVersion} · {t.knowledge} v{a.knowledge.version}
                  </Badge>
                  {embedded ? (
                    <Button
                      size="sm"
                      disabled={editing || otherEdits}
                      onClick={() => read(a, `历史章稿 v${a.version}`)}
                    >
                      查看这份章稿
                    </Button>
                  ) : (
                    <Manuscript parts={a.parts} />
                  )}
                  {embedded && (
                    <details
                      onToggle={(event) => {
                        if (event.currentTarget.open)
                          setOpenedRecords((old) => (old.includes(a.id) ? old : [...old, a.id]));
                      }}
                    >
                      <summary>查看历史审核与定稿</summary>
                      {openedRecords.includes(a.id) && (
                        <ChapterReview
                          assemblies={[a]}
                          editing={editing}
                          onRead={onRead}
                          enhancedContinuity={enhancedContinuity}
                        />
                      )}
                    </details>
                  )}
                  <TechnicalDetails
                    items={{
                      章稿编号: a.id,
                      来源提交编号: a.parts.map((p) => p.commitId).join('、'),
                    }}
                  />
                  {a.parts.map((part) => (
                    <p key={part.beatId}>
                      {part.beatTitle} · 已采用候选 v{part.draftVersion}
                    </p>
                  ))}
                </details>
              ))}
            </details>
          </div>
        </>
      )}
    </Card>
  );
}
