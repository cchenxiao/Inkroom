import { db } from '../data/db';
import type { BookOverview, BookSummary, OutlineDraft } from '@/types/domain/library';
import type { Bible, ChapterDocument, Project } from '@/types/domain';
import { books, emptyBible } from './store';
function summarize(
  project: Project,
  docs: ChapterDocument[],
  branchId: string,
  branchName: string,
  updatedAt: string,
): BookSummary {
  const finalized = docs.filter((d) => d.chapter.status === 'finalized').length;
  return {
    project,
    branchId,
    branchName,
    updatedAt,
    status:
      docs.length && finalized === docs.length
        ? 'finalized'
        : docs.some((d) => d.chapter.wordCount > 0)
          ? 'writing'
          : 'planning',
    accent: 'ai',
    totalWords: docs.reduce((n, d) => n + d.chapter.wordCount, 0),
    finalizedChapters: finalized,
    totalChapters: docs.length,
    wizardId: null,
    demo: true,
  };
}
export function bookOverview(id: string, branchId = 'main'): BookOverview | undefined {
  const original = id === db.project.id;
  const book = books[id];
  if (!original && !book) return;
  const data = original ? db.data[branchId] : book.data[branchId];
  if (!data) return;
  const project = original ? db.project : book.project;
  const confirmed = original
    ? { direction: project.locked, style: data.bible.style.locked, world: true, outline: true }
    : {
        direction: book.plan.steps[0].locked,
        style: book.plan.steps[1].locked,
        world: book.plan.steps[2].locked,
        outline: book.plan.steps[3].locked,
      };
  const docs = confirmed.outline
    ? Object.values(data.documents).sort((a, b) => a.chapter.number - b.chapter.number)
    : [];
  const branches = original ? db.branches : book.branches;
  const summary = summarize(
    project,
    docs,
    branchId,
    branches.find((b) => b.id === branchId)?.name ?? branchId,
    original ? (db.commits.at(-1)?.createdAt ?? '2026-10-13T09:30:00Z') : book.updatedAt,
  );
  if (book) {
    summary.accent = book.accent;
    summary.wizardId = id;
  }
  const bible: Bible = structuredClone(data.bible);
  if (!confirmed.world) {
    bible.characters = [];
    bible.rules = [];
    bible.foreshadows = [];
  }
  if (!confirmed.style) bible.style = emptyBible(id).style;
  const outline = book?.plan.steps[3].candidates.find((c) => c.id === book.plan.steps[3].selectedId)
    ?.content as OutlineDraft | undefined;
  const acts =
    outline?.kind === 'outline'
      ? outline.acts.map((a) => ({
          ...a,
          chapterIds: docs
            .filter((d) => outline.chapters.find((c) => c.id === d.chapter.id)?.actId === a.id)
            .map((d) => d.chapter.id),
        }))
      : [
          { id: 'act1', title: '第一幕 · 河口疑云' },
          { id: 'act2', title: '第二幕 · 暗流与夜谈' },
          { id: 'act3', title: '第三幕 · 真相浮出' },
        ].map((a, i) => ({
          ...a,
          chapterIds: docs
            .filter((_, index) => Math.min(2, Math.floor((index * 3) / docs.length)) === i)
            .map((d) => d.chapter.id),
        }));
  const findings = docs
    .flatMap((d) =>
      d.findings.filter((f) => f.status === 'open').map((f) => ({ ...f, chapterId: d.chapter.id })),
    )
    .sort((a, b) => a.severity.localeCompare(b.severity));
  const blockers = docs.flatMap((d) =>
    d.scores.blockers.map((reason) => `第 ${d.chapter.number} 章：${reason}`),
  );
  const beats = docs.flatMap((d) => d.chapter.scenes.flatMap((s) => s.beats));
  return {
    ...summary,
    chapters: docs.map((d) => d.chapter),
    acts,
    bible,
    confirmed,
    beatProgress: { done: beats.filter((b) => b.status === 'done').length, total: beats.length },
    quality: {
      items: [],
      p0Count: findings.filter((f) => f.severity === 'P0').length,
      canFinalize: docs.length > 0 && docs.every((d) => d.scores.canFinalize),
      blockers: docs.length ? Array.from(new Set(blockers)) : ['章纲尚未确认，暂无全书评审。'],
    },
    worstFinding: findings[0]
      ? {
          severity: findings[0].severity,
          reason: findings[0].reason,
          chapterId: findings[0].chapterId,
          segmentId: findings[0].segmentId,
        }
      : null,
    heatmap: docs.map((d) => ({
      chapterId: d.chapter.id,
      label: `第 ${d.chapter.number} 章`,
      value: d.scores.items.find((s) => s.key === 'aiTaste')?.value ?? null,
    })),
  };
}
export function listBooks(): BookSummary[] {
  return [db.project.id, ...Object.keys(books)].map((id) => bookOverview(id)!).filter(Boolean);
}
