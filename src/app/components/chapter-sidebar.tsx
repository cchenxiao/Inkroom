import { useShallow } from 'zustand/react/shallow';
import { useEffect, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  Layers,
  PanelLeftClose,
  Plus,
} from 'lucide-react';
import { useTree, useChapter } from '@/shared/api/hooks';
import { AsyncState, Badge, Button, Progress, Tabs } from '@/shared/ui';
import { useUIStore } from '@/shared/lib/ui-store';
import { shellText as t } from '@/shared/lib/messages-shell';
import { workPath } from '@/shared/lib/book-context';
import { useNavigate } from 'react-router-dom';
export function ChapterSidebar({ onCollapse }: { onCollapse?: () => void }) {
  const tree = useTree();
  const { data } = useChapter();
  const ui = useUIStore(
    useShallow(({ events: _events, node: _node, streamText: _stream, ...state }) => state),
  );
  const [tab, setTab] = useState('structure');
  const [pendingChapter, setPendingChapter] = useState<string | null>(null);
  useEffect(() => {
    if (!pendingChapter) return;
    if (ui.chapterId !== pendingChapter) {
      setPendingChapter(null);
      return;
    }
    if (data?.chapter.id !== pendingChapter) return;
    const finding = data.findings
      .filter((f) => f.status === 'open')
      .sort((a, b) => a.severity.localeCompare(b.severity))[0];
    if (finding) {
      useUIStore.getState().selectFinding(finding.id);
      useUIStore.getState().selectSegment(finding.segmentId);
    }
    setPendingChapter(null);
  }, [pendingChapter, data, ui.chapterId]);
  const navigate = useNavigate();
  const openChapter = (id: string) => {
    ui.setChapter(id);
    navigate(workPath('workspace', ui.projectId, id));
  };
  return (
    <aside className="chapter-sidebar">
      <div className="sidebar-heading">
        <span>{t.chapterTree}</span>
        <Button
          size="icon"
          variant="ghost"
          aria-label={t.toggleLeft}
          onClick={() => (onCollapse ? onCollapse() : ui.setPanel('left', false))}
        >
          <PanelLeftClose size={17} />
        </Button>
      </div>
      <Tabs
        value={tab}
        onValueChange={setTab}
        items={[
          { value: 'structure', label: t.structure },
          { value: 'outline', label: t.outline },
        ]}
      />
      <div className="chapter-scroll">
        <AsyncState loading={tree.isLoading} error={tree.error} onRetry={() => void tree.refetch()}>
          {tree.data?.map((ch) => (
            <div
              key={ch.id}
              className={`chapter-group ${ui.chapterId === ch.id ? 'selected' : ''}`}
            >
              <div className="chapter-entry">
                <button className="chapter-row" onClick={() => openChapter(ch.id)}>
                  {ui.chapterId === ch.id ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  <FileText size={14} />
                  <span>
                    第 {ch.number} 章<span className="chapter-name">{ch.title}</span>
                  </span>
                  {ch.status === 'finalized' && <Check size={13} className="text-success" />}
                </button>
                {ch.status !== 'finalized' && ch.issueCount > 0 && (
                  <button
                    className="issue-count"
                    aria-label={`${ch.issueCount} 处问题，定位最严重问题`}
                    onClick={() => {
                      openChapter(ch.id);
                      setPendingChapter(ch.id);
                    }}
                  >
                    {ch.issueCount}
                  </button>
                )}
              </div>
              {ui.chapterId === ch.id &&
                ch.scenes.map((s, i) => (
                  <div className="scene-group" key={s.id}>
                    <div className="scene-label">
                      <Layers size={12} />
                      <span>
                        {String(i + 1).padStart(2, '0')} · {s.title}
                      </span>
                    </div>
                    {s.beats.map((b, j) => (
                      <button
                        key={b.id}
                        className={`beat-row ${data?.segments.find((x) => x.id === ui.selectedSegment)?.beatId === b.id ? 'selected' : ''}`}
                        onClick={() =>
                          ui.selectSegment(
                            data?.segments.find((x) => x.beatId === b.id)?.id ?? null,
                          )
                        }
                      >
                        <span className={`beat-dot ${b.status}`} />
                        <span>{tab === 'outline' ? b.description : b.title}</span>
                        <small>{j + 1}</small>
                      </button>
                    ))}
                  </div>
                ))}
            </div>
          ))}
        </AsyncState>
        <button
          className="add-chapter"
          onClick={() => navigate(workPath('prepare', ui.projectId, ui.chapterId, 'outline'))}
        >
          <Plus size={14} />
          {t.overview}
        </button>
      </div>
      <footer className="chapter-summary">
        <div className="row">
          <span>{t.written}</span>
          <strong>
            {data?.chapter.wordCount.toLocaleString() ?? '—'}{' '}
            <small>/ {data?.chapter.targetWords.toLocaleString()}</small>
          </strong>
        </div>
        <Progress
          value={data ? (data.chapter.wordCount / data.chapter.targetWords) * 100 : 0}
          label={t.target}
        />
        <div className="sidebar-tags">
          <Badge>{data?.chapter.pov}</Badge>
          <Badge>{data?.chapter.scenes[0]?.title}</Badge>
        </div>
        <small>
          {t.beatProgress}{' '}
          <span className="mono">
            {data?.chapter.scenes.flatMap((s) => s.beats).filter((b) => b.status === 'done').length}{' '}
            / {data?.chapter.scenes.flatMap((s) => s.beats).length}
          </span>
        </small>
      </footer>
    </aside>
  );
}
