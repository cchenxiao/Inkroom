import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Cloud, PenLine } from 'lucide-react';
import { Button, StatNumber } from '@/shared/ui';
import { useUIStore } from '@/shared/lib/ui-store';
import type { Finding, Segment } from '@/types/domain';
import { writingDesk as t } from '@/shared/lib/messages-writing-desk';
import { EditorToolbar, type EditorMode } from './EditorToolbar';
import { SegmentEditor, type SelectedText } from '../editor/SegmentEditor';
import { ManuscriptGutter } from './ManuscriptGutter';
import '../workspace.css';
export interface ManuscriptPart {
  id: string;
  title: string;
  segments: Segment[];
  accepted: boolean;
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
  busy,
  onChange,
  onSelectBeat,
  onFinding,
  onSelection,
  onSave,
  onStart,
  onReview,
  startDisabled,
  children,
  onRewrite,
}: {
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
  busy: boolean;
  onChange: (id: string, text: string) => void;
  onSelectBeat: (id: string) => void;
  onFinding: (id: string) => void;
  onSelection: (selection: SelectedText) => void;
  onSave: () => void;
  onStart: () => void;
  onReview: (beatId?: string) => void;
  startDisabled: boolean;
  children?: ReactNode;
  onRewrite: (beatId: string) => void;
}) {
  const [mode, setMode] = useState<EditorMode>('editor');
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
  useEffect(() => {
    const segment = findings.find((f) => f.id === selectedFinding)?.segmentId;
    if (segment)
      scrollRef.current
        ?.querySelector(`[data-manuscript-segment="${CSS.escape(segment)}"]`)
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [selectedFinding, findings]);
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
      {blocked && (
        <div className="manuscript-alert" role="alert">
          {blocked}
        </div>
      )}
      <div className="manuscript-region">
        <div className="manuscript-scroll" ref={scrollRef}>
          <div className="manuscript-page">
            {parts.map((part) => (
              <section
                key={part.id}
                className={`writing-beat ${part.id === activeBeat ? 'is-active' : ''}`}
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
                      <span className="beat-selection-mark">
                        <Check size={12} />
                        已选中
                      </span>
                    )}
                    <span>
                      {part.accepted ? t.accepted : part.segments.length ? t.candidate : ''}
                    </span>
                    {!!part.segments.length && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={dirty || busy}
                        onClick={() => {
                          onReview(part.id);
                        }}
                      >
                        作者审核
                      </Button>
                    )}
                    {!!part.segments.length && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={dirty || busy}
                        onClick={() => onRewrite(part.id)}
                      >
                        重写本段
                      </Button>
                    )}
                  </div>
                </div>
                {!part.segments.length ? (
                  <div className="writing-empty">
                    <PenLine size={22} />
                    <h3>
                      {part.loading
                        ? '正在读取本段正文…'
                        : part.loadError
                          ? '本段正文暂时无法读取'
                          : t.empty}
                    </h3>
                    <p>
                      {part.loading
                        ? '正在查找已生成的候选稿。'
                        : part.loadError
                          ? '读取失败不代表正文不存在，请重试。'
                          : t.emptyHint}
                    </p>
                    {part.loadError ? (
                      <Button onClick={part.onRetry}>重新读取正文</Button>
                    ) : part.loading ? null : part.id === activeBeat ? (
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
                        text={localText[segment.id] ?? segment.text}
                        findings={findings.filter((f) => f.segmentId === segment.id)}
                        editable={editable && part.id === activeBeat && mode !== 'final'}
                        heatmap={heatmap && mode !== 'final'}
                        onChange={onChange}
                        onFocus={() => {}}
                        onFinding={onFinding}
                        onSelection={(selection) => {
                          if (selection.action === 'edit') setMode('editor');
                          onSelection(selection);
                        }}
                        availableActions={['edit', 'instruct', 'rewrite', 'review', 'bible']}
                      />
                      {selectedFinding &&
                        findings.find((f) => f.id === selectedFinding)?.segmentId === segment.id &&
                        children}
                    </article>
                  ))
                )}
              </section>
            ))}
          </div>
        </div>
        <ManuscriptGutter
          scrollRef={scrollRef}
          findings={findings}
          onSelect={onFinding}
          revision={parts.map((p) => p.segments.map((s) => s.version).join()).join()}
        />
      </div>
      <footer className="manuscript-status">
        <div role="status">
          {dirty ? <Cloud size={12} /> : <Check size={12} />}
          <span>{dirty ? t.saveLocal : busy ? '正在处理，完成后更新审核结果' : t.saved}</span>
          {!dirty && (
            <span className="selected-beat-status">
              已选：{parts.find((part) => part.id === activeBeat)?.title}
            </span>
          )}
          {dirty && (
            <Button size="sm" disabled={!editable || busy} onClick={onSave}>
              {t.recheck}
            </Button>
          )}
        </div>
        <StatNumber>
          {parts
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
