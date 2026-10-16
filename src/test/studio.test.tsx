import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { seedDocuments, project } from '@/mocks/data/seed';
import { migrateDemoWordTarget } from '@/mocks/data/presentation-migration';
import { deriveRunAction } from '@/shared/lib/run-action';
import { NavRail } from '@/app/components/nav-rail';
import { useUIStore } from '@/shared/lib/ui-store';
vi.mock('@/shared/api/hooks', () => ({ useChapter: () => ({ data: undefined }) }));
beforeEach(() => useUIStore.setState({ navCollapsed: false, theme: 'day' }));
describe('编辑室外壳保护', () => {
  it('Radix tooltip 中导航仍有有效样式类、当前路由和六个中文入口', () => {
    render(
      <MemoryRouter initialEntries={['/prepare']}>
        <NavRail />
      </MemoryRouter>,
    );
    expect(screen.getAllByRole('link')).toHaveLength(9);
    expect(screen.getByRole('link', { name: '作品库' })).toHaveAttribute('href', '/library');
    expect(screen.getByRole('link', { name: '创作准备' })).toHaveClass('rail-link', 'active');
    expect(screen.getByRole('link', { name: '章节写作' })).toHaveClass('rail-link');
    expect(screen.getByRole('button', { name: '收起导航' })).toBeVisible();
  });
  it('等待裁决优先于继续，旧版本不可定稿，暂停可恢复', () => {
    const data = seedDocuments().ch7;
    data.scores = { items: [], blockers: [], canFinalize: true, p0Count: 0 };
    data.run.status = 'escalated';
    expect(deriveRunAction(data, false).kind).toBe('review');
    data.run.status = 'running';
    expect(deriveRunAction(data, false).kind).toBe('pause');
    data.run.status = 'paused';
    expect(deriveRunAction(data, false).kind).toBe('resume');
    data.run.status = 'completed';
    expect(deriveRunAction(data, false).kind).toBe('finalize');
    expect(deriveRunAction(data, true).disabled).toBe(true);
    data.run.draftVersion -= 1;
    expect(deriveRunAction(data, false).kind).not.toBe('finalize');
  });
  it('白天与夜晚切换立即更新页面并记住选择', () => {
    render(
      <MemoryRouter>
        <NavRail />
      </MemoryRouter>,
    );
    expect(document.documentElement).toHaveAttribute('data-theme', 'day');
    fireEvent.click(screen.getByRole('button', { name: '切换夜晚模式' }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'night');
    expect(JSON.parse(localStorage.getItem('inkloom-layout')!).state.theme).toBe('night');
    fireEvent.click(screen.getByRole('button', { name: '切换白天模式' }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'day');
  });
  it('只修正原封不动的旧演示篇幅，不覆盖自定义作品', () => {
    expect(migrateDemoWordTarget({ ...project, targetWords: 180_000 }, project).targetWords).toBe(
      50_000,
    );
    expect(
      migrateDemoWordTarget({ ...project, logline: '我的新故事', targetWords: 180_000 }, project)
        .targetWords,
    ).toBe(180_000);
  });
});
