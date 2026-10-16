import { expect, test } from '@playwright/test';
import input from '../internal/demo/core_settings.json' with { type: 'json' };

// Isolated fixtures: navigation tests never generate or approve the author's manuscript.
test('writing and review keep navigation, chapter and panel state stable', async ({
  page,
}, testInfo) => {
  const versions = {
    planning: { input: 1, direction: 1, style: 1, core: 1 },
    outline: 1,
    bindings: 1,
  };
  const planning = {
    input: input.source,
    selection: input.selection,
    directionVersion: 1,
    styleVersion: 1,
    styleSelection: input.style,
    coreVersion: 1,
    coreSelection: {
      version: 1,
      inputVersion: 1,
      directionVersion: 1,
      styleVersion: 1,
      content: {
        characters: [{ id: 'c1', name: '林舟', voice: [], hardFactIds: [] }],
        worldFacts: [],
        plans: [],
      },
      decisions: { c1: 'confirmed' },
    },
    outlineVersion: 1,
    outlineSelection: {
      version: 1,
      bindingsVersion: 1,
      versions: versions.planning,
      confirmed: true,
      content: { chapters: [{ id: 'navigation-chapter', title: '钟楼来客' }] },
    },
    chapterPlans: [
      {
        chapterId: 'navigation-chapter',
        version: 1,
        versions,
        confirmed: true,
        content: {
          scenes: [
            {
              id: 'scene',
              title: '钟楼',
              povCharacterId: 'c1',
              characterIds: ['c1'],
              beats: [{ id: 'navigation-beat', title: '听钟', action: '聆听', turn: '发现缺口' }],
            },
          ],
          brief: { selectedBeatId: 'navigation-beat' },
        },
      },
    ],
    jobs: [],
    styleJobs: [],
    coreJobs: [],
    outlineJobs: [],
    chapterPlanJobs: [],
    packs: [],
  };
  // The development app uses MSW. Stub Go fetches before it starts, so its
  // service worker cannot bypass Playwright routing and reach a real manuscript.
  await page.addInitScript(
    ({ planning, versions }) => {
      const original = window.fetch;
      window.fetch = async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input), location.origin);
        if (!url.pathname.startsWith('/go-api/')) return original(input, init);
        const path = url.pathname;
        const data = path.endsWith('/planning')
          ? planning
          : path.endsWith('/chapter-runs')
            ? {
                ready: true,
                beatId: 'navigation-beat',
                draftVersion: 0,
                planVersion: 1,
                expected: versions,
                runs: [],
              }
            : path.endsWith('/preview')
              ? {
                  ready: false,
                  reason: '尚缺已提交正文',
                  slots: [],
                  draft: { parts: [] },
                  history: [],
                }
              : {};
        return new Response(JSON.stringify(data), {
          headers: { 'Content-Type': 'application/json' },
        });
      };
    },
    { planning, versions },
  );
  const query =
    '?projectId=project-zhuoliu&branchId=main&source=planned&planningChapterId=navigation-chapter&beatId=navigation-beat';
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/review' + query);
  await expect(page).toHaveURL(/\/workspace\?.*panel=assembly/);
  await expect(page.getByRole('region', { name: '正文创作台' })).toBeVisible();
  await expect(page.getByRole('link', { name: '第 1 章 · 钟楼来客' })).toBeVisible();
  const writing = page.getByRole('link', { name: '章节写作', exact: true });
  await expect(writing).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('link', { name: '人工审核', exact: true })).toHaveCount(0);
  const rail = page.locator('.nav-rail');
  const tree = page.getByRole('complementary', { name: '章节目录' });
  const railBox = await rail.boundingBox();
  const treeBox = await tree.boundingBox();
  await page.getByRole('button', { name: '关闭侧栏', exact: true }).click();
  expect(await rail.boundingBox()).toEqual(railBox);
  expect(await tree.boundingBox()).toEqual(treeBox);
  const disabled = page.getByRole('link', { name: '变更冲突', exact: true });
  await expect(disabled).not.toHaveAttribute('title');
  await disabled.hover();
  await expect(page.getByRole('tooltip')).toHaveCount(1);
  await expect(page.getByRole('tooltip')).toContainText('尚未接入真实流程');
  await page.getByRole('button', { name: '整章审核', exact: true }).click();
  await page.getByRole('tab', { name: '审核本段', exact: true }).click();
  await writing.click();
  await expect(page.getByRole('tab', { name: '审核本段', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(new URL(page.url()).searchParams.get('beatId')).toBe('navigation-beat');
  expect(await rail.boundingBox()).toEqual(railBox);
  expect(await tree.boundingBox()).toEqual(treeBox);
  const body = await page.locator('.route-content').boundingBox();
  expect(body!.width).toBeGreaterThan(600);
  await page.getByRole('button', { name: '收起导航', exact: true }).click();
  const collapsed = await rail.boundingBox();
  await page.getByRole('tab', { name: '整章审核', exact: true }).click();
  expect(await rail.boundingBox()).toEqual(collapsed);
  await page.getByRole('button', { name: '展开导航', exact: true }).click();
  await page.getByRole('button', { name: '切换夜晚模式', exact: true }).click();
  expect(await rail.boundingBox()).toEqual(railBox);
  await page.reload();
  await expect(page.getByRole('tab', { name: '整章审核', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(writing).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: '切换白天模式', exact: true }).click();
  await page.screenshot({
    path: testInfo.outputPath('unified-writing-review.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1100, height: 850 });
  await expect(page.getByRole('dialog', { name: '正文旁审核' })).toBeVisible();
  const narrowRail = await rail.boundingBox();
  await page.getByRole('button', { name: '关闭侧栏', exact: true }).click();
  expect(await rail.boundingBox()).toEqual(narrowRail);
  await expect(writing).toBeVisible();
  await expect(tree).toBeVisible();
});
