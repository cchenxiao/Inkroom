import { matchPath } from 'react-router-dom';
import { ORIGINAL_PROJECT } from './book-context';
/** Go planning IDs are deliberately separate from the demo chapterId namespace. */
export function liveWorkspacePath(chapterId?: string, stage: 'write' | 'assembly' = 'write') {
  const query = new URLSearchParams({
    projectId: ORIGINAL_PROJECT,
    branchId: 'main',
    source: 'planned',
    stage: 'write',
  });
  if (stage === 'assembly') query.set('panel', 'assembly');
  if (chapterId) query.set('planningChapterId', chapterId);
  return `/workspace?${query}`;
}
export function isLiveWorkspace(
  pathname: string,
  search: string,
  projectId: string,
  branchId: string,
) {
  const params = new URLSearchParams(search);
  return (
    Boolean(matchPath({ path: '/workspace', end: true }, pathname)) &&
    params.get('source') !== 'demo' &&
    (params.get('projectId') ?? projectId) === ORIGINAL_PROJECT &&
    (params.get('branchId') ?? branchId) === 'main'
  );
}
export const demoWorkspacePath =
  '/workspace?projectId=project-zhuoliu&branchId=main&chapterId=ch7&source=demo';

export function livePreparePath(section = 'premise', chapterId?: string) {
  const q = new URLSearchParams({ projectId: 'project-zhuoliu', branchId: 'main', section });
  if (chapterId) q.set('planningChapterId', chapterId);
  return `/prepare?${q}`;
}

export function liveContinuationPath(chapterId: string) {
  return `${liveWorkspacePath(chapterId)}&continuation=${crypto.randomUUID()}&panel=closed`;
}
