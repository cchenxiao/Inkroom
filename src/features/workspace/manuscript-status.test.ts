import { expect, it } from 'vitest';
import { manuscriptStatus } from './manuscript-status';

it('distinguishes a displayed candidate from the retained adoption', () => {
  const part = { accepted: false, adoptedVersion: 4, version: 6, segments: [{}] };
  expect(manuscriptStatus(part)).toEqual({
    tone: 'candidate',
    label: '新候选 v6',
    detail: '已采用 v4 保留',
  });
  expect(manuscriptStatus({ ...part, accepted: true, version: 4 })).toEqual({
    tone: 'adopted',
    label: '已采用 v4',
    detail: '',
  });
  expect(manuscriptStatus(part, true).label).toBe('章稿对照 · 只读');
});

it('does not label failed or loading reads as empty prose or invent a version', () => {
  expect(manuscriptStatus({ accepted: false, segments: [], loadError: true }).label).toBe(
    '读取失败',
  );
  expect(manuscriptStatus({ accepted: false, segments: [], loading: true }).label).toBe('读取中');
  expect(manuscriptStatus({ accepted: false, segments: [] }).label).toBe('尚无正文');
  expect(manuscriptStatus({ accepted: false, segments: [{}] }).label).toBe('待采用');
});
