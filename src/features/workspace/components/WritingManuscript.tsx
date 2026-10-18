import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Cloud, PenLine } from 'lucide-react';
import { Button, StatNumber } from '@/shared/ui';
import { useUIStore } from '@/shared/lib/ui-store';
import type { Finding, Segment } from '@/types/domain';
import { writingDesk as t } from '@/shared/lib/messages-writing-desk';
import { EditorToolbar, type EditorMode } from './EditorToolbar';
import { SegmentEditor, type SelectedText } from '../editor/SegmentEditor';
import { ManuscriptGutter } from './ManuscriptGutter';
import { ManuscriptStatus } from './ManuscriptStatus';
import { manuscriptStatus } from '../manuscript-status';
import '../workspace.css';
export interface ManuscriptPart {
  id: string;
  title: string;
  segments: Segment[];
  accepted: boolean;
  adoptedVersion?: number;
  version?: number;
  loading?: boolean;
  loadError?: boolean;
  onRetry?: () => void;
}
export function WritingManuscript({
  parts,
  activeBeat,
  title,
  pov,
  tone,
  findings,
  selectedFinding,
  editable,
  localText,
  dirty,
  blocked,
  reviewNotice,
  editRequest,
  busy,
  onChange,
  onSelectBeat,
  onFinding,
  onSelection,
  onSave,
  reviewPending,
  reviewing,
  recheckBlock,
  onRecheck,
  onDiscard,
  onRestore,
  saveBlockedReason,
  saveError,
  onRetrySave,
  onStart,
  onReview,
  startDisabled,
  children,
  selectionPreview,
  onRewrite,
  snapshot = false,
}: {
  snapshot?: boolean;
  parts: ManuscriptPart[];
  activeBeat: string;
  title: string;
  pov: string;
  tone?: string;
  findings: Finding[];
  selectedFinding: string | null;
  editable: boolean;
  localText: Record<string, string>;
  dirty: boolean;
  blocked: string;
  reviewNotice?: ReactNode;
  editRequest?: { segmentId: string; quote: string; requestId: number };
  busy: boolean;
  onChange: (id: string, text: string) => void;
  onSelectBeat: (id: string) => void;
  onFinding: (id: string) => void;
  onSelection: (selection: SelectedText) => void;
  onSave: () => void;
  reviewPending?: boolean;
  reviewing?: boolean;
  recheckBlock?: string;
  onRecheck?: () => void;
  onDiscard?: () => void;
  onRestore?: () => void;
  saveBlockedReason?: string;
  saveError?: string;
  onRetrySave?: () => void;
  onStart: () => void;
  onReview: (beatId?: string) => void;
  startDisabled: boolean;
  children?: ReactNode;
  selectionPreview?: { id: string; segmentId: string; quote: string; content: ReactNode };
  onRewrite: (beatId: string) => void;
}) {
  const [mode, setMode] = useState<EditorMode>('editor');
  const activePart = parts.find((part) => part.id === activeBeat);
  const initialLoading = parts.length > 0 && parts.every((p) => p.loading && !p.segments.length);
  const incomplete = parts.some((p) => p.loading || p.loadError);
  const scrollRef = useRef<HTMLDivElement>(null);
  const selectedInProse = useRef(false);
  const focus = useUIStore((s) => s.focus),
    heatmap = useUIStore((s) => s.heatmap);
  const partsRef = useRef(parts);
  partsRef.current = parts;
  useEffect(() => {
    if (selectedInProse.current) {
      selectedInProse.current = false;
      return;
    }
    const segment = partsRef.current.find((p) => p.id === activeBeat)?.segments[0];
    if (segment)
      scrollRef.current
        ?.querySelector(`[data-manuscript-segment="${CSS.escape(segment.id)}"]`)
        ?.closest('.writing-beat')
        ?.querySelector('.writing-beat-heading')
        ?.scrollIntoView({ block: 'nearest' });
  }, [activeBeat]); // Keep scroll still during SSE updates and author input.
  const selectedSegment = findings.find((f) => f.id === selectedFinding)?.segmentId;
  const selectedQuote = findings.find((f) => f.id === selectedFinding)?.quote;
  const findingLocation = useRef({ selectedSegment, selectedQuote });
  findingLocation.current = { selectedSegment, selectedQuote };
  useEffect(() => {
    const segment = findingLocation.current.selectedSegment;
    if (!segment) return;
    const row = scrollRef.current?.querySelector(
      `[data-manuscript-segment="${CSS.escape(segment)}"]`,
    );
    const mark =
      selectedFinding && row?.querySelector(`[data-finding-id="${CSS.escape(selectedFinding)}"]`);
    (mark || row)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedFinding]); // Only choosing a different problem is navigation; changed quotes are not.
  return (
    <section
      className={`workspace-center ${mode === 'final' ? 'is-final' : ''}`}
      aria-label="正文创作台"
    >
      {focus && (
        <div className="focus-exit-bar">
          <Button variant="ghost" onClick={() => useUIStore.getState().setFocus(false)}>
            退出专注 · Esc
          </Button>
        </div>
      )}
      <EditorToolbar
        liveWriting
        title={title}
        pov={pov}
        tone={tone}
        mode={mode}
        onMode={(next) => {
          setMode(next);
          if (next === 'comments') onReview();
        }}
        heatmap={heatmap}
        onHeatmap={() => useUIStore.getState().setHeatmap(!heatmap)}
        focus={focus}
        onFocus={() => useUIStore.getState().setFocus(!focus)}
      />
      {activePart && (
        <div className="manuscript-current-context" aria-label="当前正文版本">
          <span className="manuscript-current-title">当前段 · {activePart.title}</span>
          <ManuscriptStatus part={activePart} snapshot={snapshot} />
          {dirty ? (
            <span className="manuscript-local-state">本机修改未保存</span>
          ) : (
            mode === 'final' && <span>净读视图 · 不代表已定稿</span>
          )}
        </div>
      )}
      {reviewNotice}
      {blocked && (
        <div className="manuscript-alert" role="alert">
          {blocked}
        </div>
      )}
      <div className="manuscript-region">
        <div className="manuscript-scroll" ref={scrollRef}>
          <div className="manuscript-page" aria-busy={initialLoading}>
            {initialLoading && (
              <div className="manuscript-loading" role="status" aria-label="正在读取章节正文">
                <p>正在读取章节正文…</p>
                <div aria-hidden="true" className="manuscript-loading-lines">
                  <i />
                  <i />
                  <i />
                </div>
              </div>
            )}
            {!initialLoading &&
              parts.map((part) => (
                <section
                  key={part.id}
                  className={`writing-beat state-${manuscriptStatus(part, snapshot).tone} ${part.id === activeBeat ? 'is-active' : ''}`}
                  aria-label={part.title}
                  aria-current={part.id === activeBeat ? 'true' : undefined}
                >
                  <div className="writing-beat-heading">
                    <button
                      aria-pressed={part.id === activeBeat}
                      onClick={() => onSelectBeat(part.id)}
                      disabled={dirty || busy}
                    >
                      {part.title}
                    </button>
                    <div className="beat-actions">
                      {part.id === activeBeat && (
                        <span className="beat-selection-mark">当前段</span>
                      )}
                      <ManuscriptStatus part={part} snapshot={snapshot} />
                      {!snapshot && !!part.segments.length && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={dirty || busy}
                          onClick={() => {
                            onReview(part.id);
                          }}
                        >
                          审核
                        </Button>
                      )}
                      {!snapshot && !!part.segments.length && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={dirty || busy}
                          onClick={() => onRewrite(part.id)}
                        >
                          修改本段
                        </Button>
                      )}
                    </div>
                  </div>
                  {part.loading && !part.segments.length ? (
                    <p className="manuscript-part-loading" role="status">
                      正在读取本段正文…
                    </p>
                  ) : !part.segments.length ? (
                    <div className="writing-empty">
                      <PenLine size={22} />
                      <h3>{part.loadError ? '本段正文暂时无法读取' : t.empty}</h3>
                      <p>{part.loadError ? '读取失败不代表正文不存在，请重试。' : t.emptyHint}</p>
                      {part.loadError ? (
                        <Button onClick={part.onRetry}>重新读取正文</Button>
                      ) : part.id === activeBeat ? (
                        <Button
                          disabled={startDisabled}
                          disabledReason={blocked}
                          loading={busy}
                          onClick={onStart}
                        >
                          {t.start}
                        </Button>
                      ) : (
                        <Button disabled={dirty || busy} onClick={() => onSelectBeat(part.id)}>
                          选择这一段
                        </Button>
                      )}
                    </div>
                  ) : (
                    part.segments.map((segment) => (
                      <article
                        className={`manuscript-segment ${part.id === activeBeat ? 'segment-selected' : ''}`}
                        key={`${part.id}:${segment.id}`}
                        data-manuscript-segment={segment.id}
                        data-segment-order={segment.order}
                        data-beat-title={part.title}
                        onClick={(event) => {
                          if (
                            !dirty &&
                            !busy &&
                            part.id !== activeBeat &&
                            (event.target as HTMLElement).closest('.tiptap') &&
                            !window.getSelection()?.toString()
                          ) {
                            selectedInProse.current = true;
                            onSelectBeat(part.id);
                          }
                        }}
                      >
                        <SegmentEditor
                          segment={segment}
                          editRequest={
                            editRequest?.segmentId === segment.id ? editRequest : undefined
                          }
                          text={localText[segment.id] ?? segment.text}
                          findings={
                            mode === 'final'
                              ? []
                              : findings.filter((f) => f.segmentId === segment.id)
                          }
                          editable={editable && part.id === activeBeat && mode !== 'final'}
                          heatmap={heatmap && mode !== 'final'}
                          onChange={onChange}
                          onFocus={() => {}}
                          onFinding={onFinding}
                          onSelection={(selection) => {
                            selectedInProse.current = part.id !== activeBeat;
                            if (['edit', 'rewrite', 'instruct'].includes(selection.action))
                              setMode('editor');
                            onSelection(selection);
                          }}
                          review={
                            mode === 'final'
                              ? undefined
                              : selectionPreview?.segmentId === segment.id
                                ? { ...selectionPreview, keepVisibleOnClose: true }
                                : selectedFinding && selectedSegment === segment.id && children
                                  ? {
                                      id: selectedFinding,
                                      quote: selectedQuote ?? '',
                                      content: children,
                                      keepVisibleOnClose: true,
                                    }
                                  : undefined
                          }
                          availableActions={['edit', 'rewrite', 'review', 'bible']}
                        />
                      </article>
                    ))
                  )}
                </section>
              ))}
          </div>
        </div>
        <ManuscriptGutter
          scrollRef={scrollRef}
          findings={mode === 'final' ? [] : findings}
          onSelect={onFinding}
          revision={parts.map((p) => p.segments.map((s) => s.version).join()).join()}
        />
      </div>
      {dirty && (
        <section className="manuscript-edit-actions" aria-label="正文修改">
          <div className="manuscript-edit-summary" role="status">
            <strong>正文有未保存修改</strong>
            <span>{parts.find((part) => part.id === activeBeat)?.title} · 已暂存本机</span>
          </div>
          <div className="manuscript-edit-buttons">
            {onDiscard && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={onDiscard}>
                放弃修改
              </Button>
            )}
            <Button
              size="sm"
              variant="default"
              disabled={!onRetrySave && (!editable || busy || !!saveBlockedReason)}
              disabledReason={saveBlockedReason}
              onClick={onRetrySave ?? onSave}
            >
              {onRetrySave ? t.retry : busy ? '正在保存…' : '保存修改'}
            </Button>
          </div>
          {(saveError || saveBlockedReason) && (
            <p className="manuscript-edit-feedback" role={saveError ? 'alert' : 'status'}>
              {saveError || saveBlockedReason}
            </p>
          )}
        </section>
      )}
      {!dirty && reviewPending && onRecheck && (
        <section className="manuscript-edit-actions" aria-label="已保存待复检">
          <div className="manuscript-edit-summary" role="status">
            <strong>{reviewing ? '正在复检已保存正文' : '修改已保存 · 待复检'}</strong>
            <span>
              {reviewing
                ? '正文保持不变，完成后查看审查结果。'
                : '可以继续修改，处理完后统一复检。'}
            </span>
          </div>
          <Button
            size="sm"
            disabled={busy || !!recheckBlock}
            disabledReason={recheckBlock}
            onClick={onRecheck}
          >
            {reviewing ? '正在复检…' : '复检当前稿'}
          </Button>
        </section>
      )}
      {!dirty && onRestore && (
        <div className="manuscript-discard-receipt" role="status">
          <span>已撤销本次本地修改</span>
          <Button size="sm" variant="ghost" disabled={busy} onClick={onRestore}>
            恢复刚才的修改
          </Button>
        </div>
      )}
      <footer className="manuscript-status">
        <div role="status">
          {dirty ? <Cloud size={12} /> : <Check size={12} />}
          <span>
            {dirty
              ? t.saveLocal
              : incomplete
                ? '正文尚未完整载入'
                : busy
                  ? '正在处理，正文已保留'
                  : t.saved}
          </span>
          {!dirty && (
            <span className="selected-beat-status">
              已选：{parts.find((part) => part.id === activeBeat)?.title}
            </span>
          )}
        </div>
        <StatNumber>
          {incomplete
            ? '—'
            : parts
                .reduce(
                  (n, p) =>
                    n +
                    p.segments.reduce(
                      (v, s) => v + (localText[s.id] ?? s.text).replace(/\s/g, '').length,
                      0,
                    ),
                  0,
                )
                .toLocaleString()}{' '}
          字
        </StatNumber>
      </footer>
    </section>
  );
}
