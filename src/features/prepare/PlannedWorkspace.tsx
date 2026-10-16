import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useUIStore } from '@/shared/lib/ui-store';
import { liveWorkspacePath } from '@/shared/lib/writing-mode';
import { liveWriting as t } from '@/shared/lib/messages-live-writing';
import { AsyncState, Badge, Button } from '@/shared/ui';
import { usePlanning } from './hooks/usePlanning';
import {
  chapterPlanReady,
  chapterPlanVersions,
  sameChapterPlanVersions,
} from './types/chapter-plan';
import PlannedBeatWriting from './components/PlannedBeatWriting';
import ChapterAssembly from './components/ChapterAssembly';
import './prepare.css';
import './components/core-settings.css';
import './components/outline.css';
import './planned-workspace.css';

/** Public feature entry. app composes this with the real shell; demo workspace never imports it. */
export default function PlannedWorkspace() {
  const project = useUIStore((s) => s.projectId),
    branch = useUIStore((s) => s.branchId);
  if (project !== 'project-zhuoliu' || branch !== 'main')
    return (
      <div className="page-content">
        <h1>{t.unsupported}</h1>
        <p>{t.unsupportedNote}</p>
        <Link to="/library">作品库</Link>
      </div>
    );
  return <PlanningWorkspace />;
}
function PlanningWorkspace() {
  const query = usePlanning(),
    navigate = useNavigate();
  const [params] = useSearchParams();
  const chapters = query.data?.outlineSelection?.content.chapters ?? [];
  const requested = params.get('planningChapterId');
  const currentChapter = requested ? chapters.find((c) => c.id === requested) : chapters[0];
  const [opened, setOpened] = useState<{ id: string; title: string } | null>(null);
  const retained = opened?.id === (requested ?? currentChapter?.id) ? opened : null;
  const chapter = currentChapter ?? retained;
  const s = query.data;
  const plan = s?.chapterPlans?.find((p) => p.chapterId === chapter?.id);
  const ready = Boolean(
    s &&
    currentChapter &&
    chapterPlanReady(s) &&
    plan?.confirmed &&
    sameChapterPlanVersions(plan.versions, chapterPlanVersions(s)),
  );
  const canOpen = ready && currentChapter?.id === chapters[0]?.id;
  const chapterId = currentChapter?.id,
    chapterTitle = currentChapter?.title;
  useEffect(() => {
    if (canOpen && chapterId && chapterTitle)
      setOpened((old) =>
        old?.id === chapterId && old.title === chapterTitle
          ? old
          : { id: chapterId, title: chapterTitle },
      );
  }, [canOpen, chapterId, chapterTitle]);
  const stage = params.get('stage') === 'assembly' ? 'assembly' : 'write';
  useEffect(() => {
    if (!requested && chapter) navigate(liveWorkspacePath(chapter.id, stage), { replace: true });
  }, [requested, chapter, stage, navigate]);
  if (!query.data)
    return (
      <div className="page-content">
        <AsyncState
          loading={query.isPending}
          error={query.error}
          onRetry={() => void query.refetch()}
        >
          {null}
        </AsyncState>
        {query.isError && <p>{t.error}</p>}
      </div>
    );
  const preparePath = `/prepare?projectId=project-zhuoliu&branchId=main&section=outline${chapter ? `&planningChapterId=${encodeURIComponent(chapter.id)}` : ''}`;
  return (
    <section className="planned-workspace" aria-label={t.title}>
      <aside className="planned-chapters">
        <h2>{t.chapters}</h2>
        <nav aria-label={t.chapters}>
          {chapters.map((c, i) => (
            <Link
              key={c.id}
              aria-current={chapter?.id === c.id ? 'page' : undefined}
              to={liveWorkspacePath(c.id, stage)}
            >
              <small>{String(i + 1).padStart(2, '0')}</small>
              <span>{c.title}</span>
            </Link>
          ))}
        </nav>
        <Link className="planned-prepare-link" to={preparePath}>
          {t.prepare}
        </Link>
      </aside>
      <div className="planned-content">
        <header className="planned-toolbar">
          <h1>{chapter?.title ?? t.unconfigured}</h1>
          {plan && (
            <Badge>
              {ready ? t.confirmed : t.pending} · v{plan.version}
            </Badge>
          )}
          <Button
            size="sm"
            variant="ghost"
            loading={query.isFetching}
            onClick={() => void query.refetch()}
          >
            {t.refresh}
          </Button>
        </header>
        {query.isError && <p role="alert">{t.error}</p>}
        {retained && !canOpen && <p role="alert">{t.prerequisite}</p>}
        {(canOpen || retained) && chapter ? (
          <ChapterDesk
            key={chapter.id}
            chapterId={chapter.id}
            stage={stage}
            unavailable={query.isError || !canOpen}
          />
        ) : !chapters.length ? (
          <div className="planned-empty">
            <h2>{t.empty}</h2>
            <p>{t.emptyNote}</p>
            <Link to={preparePath}>{t.outline}</Link>
          </div>
        ) : !chapter ? (
          <div className="planned-empty">
            <h2>{t.missing}</h2>
            <p>{t.missingNote}</p>
          </div>
        ) : !plan?.confirmed ? (
          <div className="planned-empty">
            <p>{t.prerequisite}</p>
            <Link to={preparePath}>{t.outline}</Link>
          </div>
        ) : chapter.id !== chapters[0].id ? (
          <div className="planned-empty">
            <p>{t.otherChapter}</p>
            <Link to={preparePath}>{t.outline}</Link>
          </div>
        ) : (
          <div className="planned-empty">
            <p>{t.prerequisite}</p>
            <Link to={preparePath}>{t.outline}</Link>
          </div>
        )}
      </div>
    </section>
  );
}
function ChapterDesk({
  chapterId,
  stage,
  unavailable,
}: {
  chapterId: string;
  stage: 'write' | 'assembly';
  unavailable: boolean;
}) {
  // Keep visited panels mounted: tab changes must not erase an in-progress author edit.
  const [visitedAssembly, setVisitedAssembly] = useState(stage === 'assembly');
  useEffect(() => {
    if (stage === 'assembly') setVisitedAssembly(true);
  }, [stage]);
  return (
    <>
      <nav className="planned-tabs" aria-label={t.stage}>
        <Link
          aria-current={stage === 'write' ? 'page' : undefined}
          to={liveWorkspacePath(chapterId)}
        >
          {t.write}
        </Link>
        <Link
          aria-current={stage === 'assembly' ? 'page' : undefined}
          to={liveWorkspacePath(chapterId, 'assembly')}
        >
          {t.assembly}
        </Link>
        <span>{t.boundary}</span>
      </nav>
      <div className="planned-scroll">
        <div hidden={stage !== 'write'}>
          <PlannedBeatWriting chapterId={chapterId} editing={unavailable} workspace />
        </div>
        {(visitedAssembly || stage === 'assembly') && (
          <div hidden={stage !== 'assembly'}>
            <ChapterAssembly chapterId={chapterId} editing={unavailable} />
          </div>
        )}
      </div>
    </>
  );
}
