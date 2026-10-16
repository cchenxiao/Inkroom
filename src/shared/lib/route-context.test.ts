import { isLiveWorkspace } from './writing-mode';
import { expect, it } from 'vitest';
import { resolveReadingRoute, type ReadingMemory } from './route-context';
const memory: ReadingMemory = {
  lastProjectId: 'project-zhuoliu',
  projects: {
    'project-zhuoliu': {
      branchId: 'main',
      source: 'planned',
      planningChapterId: 'real-ch2',
      beatId: 'beat-3',
    },
  },
};
it('restores bare workspace/review links and preserves the Go chapter and beat', () => {
  const work = new URL(resolveReadingRoute('/workspace', '', '', memory)!, 'http://test');
  expect(work.pathname).toBe('/workspace');
  expect(work.searchParams.get('planningChapterId')).toBe('real-ch2');
  expect(work.searchParams.get('beatId')).toBe('beat-3');
  const review = new URL(resolveReadingRoute('/review', '', '', memory)!, 'http://test');
  expect(review.searchParams.get('stage')).toBe('write');
  expect(review.searchParams.get('panel')).toBe('assembly');
  expect(review.searchParams.get('planningChapterId')).toBe('real-ch2');
  expect(resolveReadingRoute(work.pathname, work.search, '', memory)).toBeNull();
});
it('honors explicit project, chapter, and source without leaking remembered material', () => {
  const demo = new URL(
    resolveReadingRoute(
      '/workspace',
      '?projectId=project-zhuoliu&chapterId=ch7&source=demo',
      '',
      memory,
    )!,
    'http://test',
  );
  expect(demo.searchParams.has('planningChapterId')).toBe(false);
  expect(demo.searchParams.has('beatId')).toBe(false);
  const other = new URL(
    resolveReadingRoute('/workspace', '?projectId=another&chapterId=own', '', memory)!,
    'http://test',
  );
  expect(other.searchParams.get('projectId')).toBe('another');
  expect(other.searchParams.has('planningChapterId')).toBe(false);
  const branch = new URL(
    resolveReadingRoute('/workspace', '?projectId=project-zhuoliu&branchId=trial', '', memory)!,
    'http://test',
  );
  expect(branch.searchParams.has('planningChapterId')).toBe(false);
});
it('accepts book-scoped and hash bookmarks while leaving ordinary page anchors alone', () => {
  const url = new URL(
    resolveReadingRoute(
      '/book/project-zhuoliu',
      '',
      '#/review?planningChapterId=ch-explicit&beatId=beat-explicit',
      memory,
    )!,
    'http://test',
  );
  expect(url.pathname).toBe('/workspace');
  expect(url.searchParams.get('planningChapterId')).toBe('ch-explicit');
  expect(url.searchParams.get('beatId')).toBe('beat-explicit');
  expect(resolveReadingRoute('/book/project-zhuoliu', '', '#outline', memory)).toBeNull();
});

it('never sends another project or branch into the fixed Go workspace', () => {
  expect(
    isLiveWorkspace('/workspace', '?source=planned&projectId=another', 'project-zhuoliu', 'main'),
  ).toBe(false);
  expect(
    isLiveWorkspace('/workspace', '?source=planned&branchId=trial', 'project-zhuoliu', 'main'),
  ).toBe(false);
});

it('keeps an explicit panel and beat when opening a legacy assembly bookmark', () => {
  for (const panel of ['review', 'assembly', 'closed']) {
    const url = new URL(
      resolveReadingRoute(
        '/workspace',
        `?projectId=project-zhuoliu&source=planned&stage=assembly&planningChapterId=ch1&beatId=b2&panel=${panel}`,
        '',
        memory,
      )!,
      'http://test',
    );
    expect(url.searchParams.get('stage')).toBe('write');
    expect(url.searchParams.get('panel')).toBe(panel);
    expect(url.searchParams.get('beatId')).toBe('b2');
    expect(resolveReadingRoute(url.pathname, url.search, '', memory)).toBeNull();
  }
});
