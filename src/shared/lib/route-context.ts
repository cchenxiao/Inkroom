const pages = new Set(['workspace', 'review', 'prepare', 'changes', 'versions', 'reports']);
export interface ReadingMemory {
  lastProjectId?: string;
  projects?: Record<string, Record<string, string>>;
}
/** URL wins over remembered state. Demo and Go chapter IDs must never cross. */
export function resolveReadingRoute(
  pathname: string,
  search: string,
  hash: string,
  memory: ReadingMemory,
) {
  let path = pathname;
  const query = new URLSearchParams(search);
  const hashRoute = hash.match(
    /^#\/?(workspace|review|prepare|changes|versions|reports)(?:\?(.*))?$/,
  );
  const bookRoute = pathname.match(
    /^\/book\/([^/]+)(?:\/(workspace|review|prepare|changes|versions|reports))?\/?$/,
  );
  if (hashRoute) {
    path = '/' + hashRoute[1];
    new URLSearchParams(hashRoute[2]).forEach((value, key) => query.set(key, value));
  } else if (bookRoute?.[2]) path = '/' + bookRoute[2];
  const page = path.replace(/^\//, '').replace(/\/$/, '').toLowerCase();
  if (!pages.has(page)) return null;
  path = '/' + page;
  const project = bookRoute?.[1]
    ? decodeURIComponent(bookRoute[1])
    : query.get('projectId') || memory.lastProjectId || 'project-zhuoliu';
  const previous = memory.projects?.[project] ?? {};
  const branch = query.get('branchId') || previous.branchId || 'main';
  const explicitChapter = query.has('chapterId') || query.has('planningChapterId');
  const sameSource =
    !query.has('source') || !previous.source || query.get('source') === previous.source;
  if (!explicitChapter && sameSource && (!previous.branchId || branch === previous.branchId)) {
    for (const key of ['chapterId', 'planningChapterId', 'beatId', 'source'])
      if (!query.has(key) && previous[key]) query.set(key, previous[key]);
  }
  query.set('projectId', project);
  query.set('branchId', branch);
  const live =
    project === 'project-zhuoliu' &&
    branch === 'main' &&
    query.get('source') !== 'demo' &&
    (query.get('source') === 'planned' || !query.has('chapterId'));
  if (live && (page === 'workspace' || page === 'review')) {
    path = '/workspace';
    query.set('source', 'planned');
    if (page === 'review' || query.get('stage') === 'assembly') {
      // Legacy review links open a panel in the same chapter workspace.
      if (!['review', 'assembly', 'bible', 'closed'].includes(query.get('panel') ?? ''))
        query.set('panel', 'assembly');
      query.set('stage', 'write');
    }
  } else if (query.has('chapterId') && !query.has('planningChapterId') && !query.has('source'))
    query.set('source', 'demo');
  const target = path + '?' + query.toString();
  return target === pathname + search && !hashRoute ? null : target;
}
export function readReadingMemory(): ReadingMemory {
  try {
    const value = JSON.parse(localStorage.getItem('inkloom-reading-context') || '{}');
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}
export function rememberReadingRoute(pathname: string, search: string) {
  if (!['/workspace', '/prepare', '/review'].includes(pathname)) return;
  const query = new URLSearchParams(search),
    project = query.get('projectId');
  if (!project) return;
  const memory = readReadingMemory();
  const old = memory.projects?.[project] ?? {};
  const next: Record<string, string> = {};
  for (const key of ['branchId', 'chapterId', 'planningChapterId', 'beatId', 'source']) {
    if (query.has(key)) next[key] = query.get(key)!;
  }
  // A prepare page without a chapter does not erase the last writing position.
  const value =
    pathname === '/prepare' && !next.chapterId && !next.planningChapterId
      ? { ...old, ...next }
      : next;
  try {
    localStorage.setItem(
      'inkloom-reading-context',
      JSON.stringify({
        lastProjectId: project,
        projects: { ...memory.projects, [project]: value },
      }),
    );
  } catch {
    /* Restricted storage must not prevent opening a valid URL. */
  }
}
