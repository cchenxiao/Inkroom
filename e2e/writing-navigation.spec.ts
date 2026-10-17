import { expect, test } from '@playwright/test';
import input from '../internal/demo/core_settings.json' with { type: 'json' };

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

// Isolated fixtures: navigation tests never generate or approve the author's manuscript.
test('writing and review keep navigation, chapter and panel state stable', async ({
  page,
}, testInfo) => {
  // The development app uses MSW. Stub Go fetches before it starts, so its
  // service worker cannot bypass Playwright routing and reach a real manuscript.
  await page.addInitScript(
    ({ planning, versions }) => {
      const original = window.fetch;
      const restored = new Promise<void>((resolve) =>
        window.addEventListener('test:restore-writing', () => resolve(), { once: true }),
      );
      window.fetch = async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input), location.origin);
        if (!url.pathname.startsWith('/go-api/')) return original(input, init);
        const path = url.pathname;
        if (path.endsWith('/chapter-runs') && init?.method === 'POST') {
          sessionStorage.setItem('test:planned-request', String(init.body));
          return new Response(
            JSON.stringify({ code: 'version_mismatch', message: '请刷新章节版本后重试。' }),
            { status: 409, headers: { 'Content-Type': 'application/json' } },
          );
        }
        if (path.endsWith('/chapter-runs') || path.endsWith('/preview')) await restored;
        const data = path.endsWith('/planning')
          ? planning
          : path.endsWith('/chapter-runs')
            ? {
                ready: true,
                beatId: 'navigation-beat',
                draftVersion: 7,
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
  await expect(page.getByRole('status', { name: '正在读取章节正文' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(
    page.getByText('规划或稿本已变化，旧审核失效；请刷新并复核材料。', { exact: true }),
  ).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('restoring-chapter.png') });
  await page.evaluate(() => window.dispatchEvent(new Event('test:restore-writing')));
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
  await expect(page.getByRole('checkbox', { name: '加强衔接检查 试用' })).toHaveCount(0);
  await page.getByRole('button', { name: '检查设置', exact: true }).click();
  const toggle = page.getByRole('checkbox', { name: '加强衔接检查 试用' });
  await expect(toggle).toBeVisible();
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await expect(toggle).toBeChecked();
  for (const theme of ['day', 'night']) {
    await page.evaluate((t) => (document.documentElement.dataset.theme = t), theme);
    await page.screenshot({ path: testInfo.outputPath('continuity-option-' + theme + '.png') });
  }
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await expect(toggle).toHaveCount(0);
  await page.evaluate(() => (document.documentElement.dataset.theme = 'day'));
  const body = await page.locator('.route-content').boundingBox();
  expect(body!.width).toBeGreaterThan(600);
  await page.getByRole('button', { name: '收起导航', exact: true }).click();
  const collapsed = await rail.boundingBox();
  await page.getByRole('tab', { name: '整章审核', exact: true }).click();
  expect(await rail.boundingBox()).toEqual(collapsed);
  await expect(toggle).toHaveCount(0);
  await page.getByRole('button', { name: '检查设置', exact: true }).click();
  await expect(toggle).toBeChecked();
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await page.getByRole('button', { name: '展开导航', exact: true }).click();
  await page.getByRole('button', { name: '切换夜晚模式', exact: true }).click();
  expect(await rail.boundingBox()).toEqual(railBox);
  await page.reload();
  await expect(page.getByRole('status', { name: '正在读取章节正文' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event('test:restore-writing')));
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
  await page.getByRole('tab', { name: '审核本段', exact: true }).click();
  await expect(toggle).toHaveCount(0);
  await page.getByRole('button', { name: '关闭侧栏', exact: true }).click();
  await page.getByRole('button', { name: '检查设置', exact: true }).click();
  await expect(toggle).not.toBeChecked();
  await page.getByRole('button', { name: '完成', exact: true }).click();
  await page.getByRole('button', { name: '审核本段', exact: true }).click();
  const narrowRail = await rail.boundingBox();
  await page.getByRole('button', { name: '关闭侧栏', exact: true }).click();
  expect(await rail.boundingBox()).toEqual(narrowRail);
  await expect(writing).toBeVisible();
  await expect(tree).toBeVisible();
  // Existing prose version follows the same direct action; no empty confirmation modal.
  await page.getByRole('button', { name: '生成本段', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '重新生成这一段' })).toHaveCount(0);
  await expect(page.getByRole('alert')).toContainText('请刷新章节版本后重试');
  const sent = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem('test:planned-request') || 'null'),
  );
  expect(sent).toMatchObject({
    beatId: 'navigation-beat',
    draftVersion: 7,
    enhancedContinuity: false,
  });
});

test('stale context has a nearby recheck, retries the same request and preserves prose', async ({
  page,
}, testInfo) => {
  await page.addInitScript(
    ({ planning, versions }) => {
      const original = window.fetch;
      const segment = {
        id: 'segment',
        beatId: 'navigation-beat',
        sceneId: 'scene',
        chapterId: 'draft',
        version: 6,
        order: 1,
        text: '窗前传来轻响，林舟停下笔。',
        pov: 'c1',
      };
      let run = {
        id: 'stale-run',
        chapterId: 'draft',
        branchId: 'main',
        status: 'stale',
        draftVersion: 6,
        eventSequence: 1,
        currentNode: 'human_gate',
        pendingAction: undefined as Record<string, unknown> | undefined,
        nodes: [],
        activeRoles: [],
        planning: {
          mode: 'beat',
          beatId: 'navigation-beat',
          chapterId: 'navigation-chapter',
          planVersion: 1,
          expected: versions,
        },
        result: {
          segments: [segment],
          report: { draftVersion: 6, findings: [] as unknown[] },
          // A recheck carries the previous author request; before critics start,
          // historical SSE snapshots serialize the review slice as null.
          authorRequest: {
            instruction: '核对先前修改要求',
            segmentId: 'segment',
            original: segment.text,
            start: 0,
            end: 2,
          },
          criticReviews: [] as unknown[] | null,
          metrics: [],
          reviews: [],
          context: {
            beat: { id: 'navigation-beat', version: 1, locked: false },
            characters: [],
            facts: [],
            sources: [],
          },
          revisions: [],
          findingProposal: undefined as Record<string, unknown> | undefined,
          patches: [],
          draftVersion: 6,
          round: 0,
        },
      };
      let laggingGateRun: typeof run | undefined;
      let draftHead = 6;
      const requests: unknown[] = [];
      window.addEventListener('test:finish-recheck', () => {
        run = {
          ...run,
          status: 'waiting_human',
          eventSequence: 3,
          result: { ...run.result, criticReviews: [] },
        };
      });
      window.addEventListener('test:show-local-finding', () => {
        run = {
          ...run,
          eventSequence: 4,
          result: {
            ...run.result,
            report: {
              draftVersion: 6,
              findings: [
                {
                  id: 'local-finding',
                  segmentId: 'segment',
                  quote: '林舟停下笔。',
                  severity: 'P3',
                  critic: 'ai_taste',
                  reason: '动作重复',
                  suggestion: '精简动作',
                  evidenceRefs: [],
                  repairScope: 'segment',
                },
              ],
            },
          },
        };
      });
      window.addEventListener('test:finish-local-preview', () => {
        laggingGateRun = structuredClone(run);
        run = {
          ...run,
          status: 'waiting_human',
          eventSequence: 6,
          pendingAction: undefined,
          result: {
            ...run.result,
            findingProposal: {
              id: 'preview',
              findingId: 'local-finding',
              draftVersion: 6,
              request: { original: segment.text, start: 7, end: 13 },
              replacement: '林舟收起笔。',
            },
          },
        };
      });
      window.addEventListener('test:sync-gate', () => {
        laggingGateRun = undefined;
      });
      window.addEventListener('test:local-saved-before-head', () => {
        run = {
          ...run,
          draftVersion: 7,
          eventSequence: 7,
          result: { ...run.result, draftVersion: 7, findingProposal: undefined },
        };
      });
      window.addEventListener('test:newer-author-head', () => {
        draftHead = 8;
      });
      window.addEventListener('test:failed-evidence-check', () => {
        run = {
          ...run,
          status: 'failed',
          eventSequence: 8,
          currentNode: 'critics',
          pendingAction: undefined,
          result: {
            ...run.result,
            criticReviews: [
              {
                critic: 'hard_consistency',
                status: 'failed',
                draftVersion: 7,
                findings: [],
                failureCode: 'invalid_content',
                error: 'author assessment quote must exist in target',
              },
            ],
          },
        };
      });
      window.fetch = async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input), location.origin);
        if (!url.pathname.startsWith('/go-api/')) return original(input, init);
        const path = url.pathname;
        const respond = (data: unknown, status = 200) =>
          new Response(JSON.stringify(data), {
            status,
            headers: { 'Content-Type': 'application/json' },
          });
        if (path.endsWith('/chapter-runs') && init?.method === 'POST') {
          requests.push(JSON.parse(String(init.body)));
          sessionStorage.setItem('test:rechecks', JSON.stringify(requests));
          if (requests.length === 1) return respond({ message: '服务连接暂时中断' }, 503);
          run = {
            ...run,
            id: 'rechecked-run',
            status: 'running',
            eventSequence: 2,
            result: { ...run.result, criticReviews: null },
          };
          return respond(run);
        }
        if (path.endsWith('/actions') && init?.method === 'POST') {
          const action = JSON.parse(String(init.body));
          sessionStorage.setItem('test:local-action', JSON.stringify(action));
          run = { ...run, status: 'running', eventSequence: 5, pendingAction: action };
          return respond(run);
        }
        if (path.endsWith('/planning')) return respond(planning);
        if (path.endsWith('/chapter-runs')) {
          if (run.pendingAction?.type === 'propose_finding')
            sessionStorage.setItem('test:busy-gate', 'seen');
          const gateRun = laggingGateRun ?? run;
          return respond({
            ready: gateRun.status !== 'running',
            reason: gateRun.status === 'running' ? '本章候选仍在生成，请等待完成' : '',
            beatId: 'navigation-beat',
            draftVersion: 6,
            planVersion: 1,
            expected: versions,
            runs: [gateRun],
            working: { runId: run.id, version: 6, segments: [segment] },
          });
        }
        if (path.includes('/runs/')) return respond(run);
        if (path.includes('/chapters/'))
          return respond({ chapterId: 'draft', draftVersion: draftHead, segments: [segment] });
        if (path.endsWith('/preview'))
          return respond({ ready: false, slots: [], draft: { parts: [] }, history: [] });
        return respond({});
      };
    },
    { planning, versions },
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(
    '/workspace?projectId=project-zhuoliu&branchId=main&source=planned&planningChapterId=navigation-chapter&beatId=navigation-beat&panel=closed',
  );
  const notice = page.getByRole('region', { name: '审核更新' });
  await expect(notice.getByRole('button', { name: '按最新上下文复检' })).toBeEnabled();
  await expect(page.locator('.writing-review-panel')).toHaveCount(0);
  for (const theme of ['day', 'night']) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    await page.screenshot({ path: testInfo.outputPath(`context-review-${theme}.png`) });
  }
  await notice.getByRole('button', { name: '按最新上下文复检' }).click();
  await expect(notice.getByRole('alert')).toBeVisible();
  await notice.getByRole('button', { name: '重试复检' }).click();
  await expect(notice.getByRole('button', { name: '正在复检', exact: true })).toBeDisabled();
  const requests = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem('test:rechecks') || '[]'),
  );
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
  expect(requests[0]).toMatchObject({
    fromRunId: 'stale-run',
    sourceVersion: 6,
    recheck: true,
    autoRevise: false,
    beatId: 'navigation-beat',
  });
  expect(requests[0]).not.toHaveProperty('rewrite');
  await page.evaluate(() => window.dispatchEvent(new Event('test:finish-recheck')));
  await expect(notice).toHaveCount(0);
  await expect(page.locator('.tiptap > p')).toHaveText('窗前传来轻响，林舟停下笔。');
  await page.evaluate(() => window.dispatchEvent(new Event('test:show-local-finding')));
  await page.locator('[data-finding-id="local-finding"]').first().click();
  const card = page.getByRole('complementary', { name: '问题详情' });
  await card.getByRole('button', { name: '让模型修改', exact: true }).click();
  await card.getByRole('button', { name: '生成修改预览' }).click();
  const progress = page.getByRole('status', { name: '局部处理进度' });
  await expect(progress).toHaveText('正在生成这条问题的修改预览，正文尚未改变。');
  // Wait for the readiness poll, which reports the generic block while a run is active.
  await expect(page.getByRole('button', { name: '让模型修改', exact: true })).toBeDisabled();
  await expect
    .poll(() => page.evaluate(() => sessionStorage.getItem('test:busy-gate')))
    .toBe('seen');
  await expect(page.locator('.route-content .manuscript-alert')).toHaveCount(0);
  await expect(page.getByRole('region', { name: '审核更新' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: '本次修改结果' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '工作台暂时遇到问题' })).toHaveCount(0);
  await expect(page.locator('.tiptap > p')).toHaveText('窗前传来轻响，林舟停下笔。');
  const action = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem('test:local-action') || '{}'),
  );
  expect(action.type).toBe('propose_finding');
  await page.screenshot({ path: testInfo.outputPath('local-preview-progress.png') });
  // Finish the model response first while readiness continues returning its older
  // running snapshot. Inspect every mutation, not just the eventual settled UI.
  await page.evaluate(() => {
    const root = document.querySelector('.route-content')!;
    const observer = new MutationObserver(() => {
      if (root.querySelector('.manuscript-alert'))
        sessionStorage.setItem('test:flashed-alert', 'yes');
    });
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    window.dispatchEvent(new Event('test:finish-local-preview'));
  });
  await expect(page.getByRole('region', { name: '局部修改对照' })).toBeVisible();
  await expect(page.locator('.route-content .manuscript-alert')).toHaveCount(0);
  expect(await page.evaluate(() => sessionStorage.getItem('test:flashed-alert'))).toBeNull();
  await page.evaluate(() => {
    window.dispatchEvent(new Event('test:sync-gate'));
    window.dispatchEvent(new Event('test:local-saved-before-head'));
  });
  await expect(page.getByRole('banner').getByText('v7', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: '审核更新' })).toHaveCount(0);
  await expect(page.locator('.route-content .manuscript-alert')).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event('test:newer-author-head')));
  await expect(page.getByRole('region', { name: '审核更新' })).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('test:failed-evidence-check')));
  await expect(page.getByRole('status', { name: '检查未完成' })).toHaveCount(1);
  await expect(page.getByRole('status', { name: '检查未完成' })).toContainText(
    '在本次目标正文中找不到原句',
  );
  await expect(page.locator('.route-content .manuscript-alert')).toHaveCount(0);
  // Model completion must not reopen a panel the author kept closed.
  await expect(page).toHaveURL(/panel=closed/);
  await page.getByRole('button', { name: '作者审核', exact: true }).click();
  await expect(page.getByRole('status', { name: '检查未完成' })).toHaveCount(1);
  await page.getByRole('button', { name: '关闭侧栏', exact: true }).click();
  await expect(page.getByRole('status', { name: '检查未完成' })).toHaveCount(1);
  await expect(page.getByRole('status', { name: '检查未完成' })).toBeVisible();
  await expect(page.getByRole('button', { name: '保留正文，重新检查本段' })).toBeEnabled();
});

for (const status of ['stale', 'committed']) {
  test(`${status} manuscript sends its own instruction without deadlocking`, async ({ page }) => {
    await page.addInitScript(
      ({ planning, versions, status }) => {
        const original = window.fetch;
        const segment = {
          id: 'segment',
          beatId: 'navigation-beat',
          version: 4,
          text: '窗前传来轻响，林舟停下笔。',
        };
        const run = {
          id: 'locked-run',
          chapterId: 'draft',
          branchId: 'main',
          status,
          draftVersion: 4,
          eventSequence: 1,
          currentNode: 'human_gate',
          nodes: [],
          activeRoles: [],
          commitId: status === 'committed' ? 'adopted' : undefined,
          planning: {
            mode: 'beat',
            beatId: 'navigation-beat',
            chapterId: 'navigation-chapter',
            planVersion: 1,
            expected: versions,
          },
          result: {
            segments: [segment],
            report: { draftVersion: 4, findings: [] },
            criticReviews: [],
            metrics: [],
            reviews: [],
            revisions: [],
            patches: [],
            draftVersion: 4,
            round: 0,
            context: {
              beat: { id: 'navigation-beat', version: 1, locked: false },
              characters: [],
              facts: [],
              sources: [],
            },
          },
        };
        const requests: unknown[] = [];
        window.fetch = async (input, init) => {
          const url = new URL(
            input instanceof Request ? input.url : String(input),
            location.origin,
          );
          if (!url.pathname.startsWith('/go-api/')) return original(input, init);
          const path = url.pathname;
          const respond = (data: unknown, status = 200) =>
            new Response(JSON.stringify(data), {
              status,
              headers: { 'Content-Type': 'application/json' },
            });
          if (path.endsWith('/chapter-runs') && init?.method === 'POST') {
            requests.push(JSON.parse(String(init.body)));
            sessionStorage.setItem('test:rewrite-requests', JSON.stringify(requests));
            if (requests.length === 1) return respond({ message: '连接中断，请重试原请求' }, 503);
            return respond({ ...run, id: 'rewrite-run', status: 'running', commitId: undefined });
          }
          if (path.endsWith('/planning')) return respond(planning);
          if (path.endsWith('/chapter-runs'))
            return respond({
              ready: true,
              beatId: 'navigation-beat',
              draftVersion: 4,
              planVersion: 1,
              expected: versions,
              runs: [run],
            });
          if (path.includes('/runs/'))
            return respond(
              path.endsWith('rewrite-run')
                ? { ...run, id: 'rewrite-run', status: 'running', commitId: undefined }
                : run,
            );
          if (path.includes('/chapters/')) return respond({ draftVersion: 4, segments: [segment] });
          if (path.endsWith('/preview'))
            return respond({ ready: false, slots: [], draft: { parts: [] }, history: [] });
          return respond({});
        };
      },
      { planning, versions, status },
    );
    await page.goto(
      '/workspace?projectId=project-zhuoliu&branchId=main&source=planned&planningChapterId=navigation-chapter&beatId=navigation-beat&panel=review',
    );
    const form = page.getByRole('region', { name: '修改当前稿', exact: true });
    await form.getByRole('textbox').fill('只修改停笔的动作，保留前文。');
    if (status === 'stale') {
      const banner = page.getByRole('region', { name: '审核更新' });
      await expect(banner.getByRole('button', { name: '按最新上下文复检' })).toBeDisabled();
      await banner.getByRole('button', { name: '处理未发送的修改要求' }).click();
      await expect(form.getByRole('textbox')).toBeFocused();
    }
    await expect(form.getByRole('button', { name: '发送修改要求' })).toBeEnabled();
    await form.getByRole('button', { name: '发送修改要求' }).click();
    await expect(form.getByRole('textbox')).toHaveValue('只修改停笔的动作，保留前文。');
    await page.getByRole('button', { name: '重试原请求', exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(
          () => JSON.parse(sessionStorage.getItem('test:rewrite-requests') || '[]').length,
        ),
      )
      .toBe(2);
    const requests = await page.evaluate(() =>
      JSON.parse(sessionStorage.getItem('test:rewrite-requests') || '[]'),
    );
    expect(requests[1]).toEqual(requests[0]);
    expect(requests[0]).toMatchObject({
      fromRunId: 'locked-run',
      sourceVersion: 4,
      rewrite: {
        instruction: '只修改停笔的动作，保留前文。',
        original: '窗前传来轻响，林舟停下笔。',
      },
    });
    expect(requests[0]).not.toHaveProperty('recheck');
    await expect
      .poll(() =>
        page.evaluate(() => sessionStorage.getItem('inkloom-author:instruction:locked-run')),
      )
      .toBeNull();
    await expect(page.getByRole('heading', { name: '工作台暂时遇到问题' })).toHaveCount(0);
  });
}

test('stale finding recovers in place, reopens manual edit and saves only that quote', async ({
  page,
}, testInfo) => {
  await page.addInitScript(
    ({ planning, versions }) => {
      const original = window.fetch;
      const segment = {
        id: 'segment',
        beatId: 'navigation-beat',
        version: 4,
        text: '窗前传来轻响，林舟停下笔。',
      };
      let run = {
        id: 'old-review',
        chapterId: 'draft',
        branchId: 'main',
        status: 'stale',
        draftVersion: 4,
        eventSequence: 1,
        pendingAction: undefined as Record<string, unknown> | undefined,
        currentNode: 'human_gate',
        nodes: [],
        activeRoles: [],
        planning: {
          mode: 'beat',
          beatId: 'navigation-beat',
          chapterId: 'navigation-chapter',
          planVersion: 1,
          expected: versions,
          neighborPolicy: 'working-v1',
        },
        result: {
          segments: [segment],
          report: {
            draftVersion: 4,
            findings: [
              {
                id: 'old-finding',
                segmentId: 'segment',
                quote: '林舟停下笔。',
                severity: 'P3',
                critic: 'ai_taste',
                reason: '动作重复',
                suggestion: '精简动作',
                evidenceRefs: [],
                repairScope: 'segment',
              },
            ],
          },
          criticReviews: [],
          metrics: [],
          reviews: [],
          revisions: [],
          patches: [],
          draftVersion: 4,
          round: 0,
          context: {
            beat: { id: 'navigation-beat', version: 1, locked: false },
            characters: [],
            facts: [],
            sources: [],
          },
        },
      };
      window.addEventListener('test:complete-recovery', () => {
        run = { ...run, status: 'waiting_human', eventSequence: 3 };
      });
      window.fetch = async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input), location.origin);
        if (!url.pathname.startsWith('/go-api/')) return original(input, init);
        const path = url.pathname;
        const respond = (data: unknown) =>
          new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
        if (path.endsWith('/chapter-runs') && init?.method === 'POST') {
          sessionStorage.setItem('test:recovery-request', String(init.body));
          run = {
            ...run,
            id: 'new-review',
            status: 'running',
            eventSequence: 2,
            result: {
              ...run.result,
              report: {
                ...run.result.report,
                findings: run.result.report.findings.map((f) => ({ ...f, id: 'new-finding' })),
              },
            },
          };
          return respond(run);
        }
        if (path.endsWith('/actions') && init?.method === 'POST') {
          sessionStorage.setItem('test:manual-request', String(init.body));
          run = {
            ...run,
            status: 'running',
            eventSequence: 4,
            pendingAction: JSON.parse(String(init.body)),
          };
          return respond(run);
        }
        if (path.endsWith('/planning')) return respond(planning);
        if (path.endsWith('/chapter-runs'))
          return respond({
            ready: run.status !== 'running',
            beatId: 'navigation-beat',
            draftVersion: 4,
            planVersion: 1,
            expected: versions,
            runs: [run],
          });
        if (path.includes('/runs/')) return respond(run);
        if (path.includes('/chapters/')) return respond({ draftVersion: 4, segments: [segment] });
        if (path.endsWith('/preview'))
          return respond({
            ready: false,
            slots: [
              {
                part: { beatId: 'navigation-beat', beatTitle: '听钟', segments: [] },
                reason: '未采用',
                choices: [],
              },
            ],
            draft: { parts: [] },
            history: [],
          });
        return respond({});
      };
    },
    { planning, versions },
  );
  await page.goto(
    '/workspace?projectId=project-zhuoliu&branchId=main&source=planned&planningChapterId=navigation-chapter&beatId=navigation-beat&panel=review',
  );
  await page.locator('[data-finding-id="old-finding"]').first().click();
  const card = page.getByRole('complementary', { name: '问题详情' });
  await card.getByRole('button', { name: '我来修改' }).click();
  await card.getByRole('button', { name: '更新审核后继续修改' }).click();
  await expect
    .poll(() => page.evaluate(() => sessionStorage.getItem('test:recovery-request')))
    .not.toBeNull();
  const request = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem('test:recovery-request') || '{}'),
  );
  expect(request).toMatchObject({ recheck: true, fromRunId: 'old-review' });
  expect(request).not.toHaveProperty('rewrite');
  await page.evaluate(() => window.dispatchEvent(new Event('test:complete-recovery')));
  await expect(card.getByRole('textbox', { name: '替换为' })).toHaveValue('林舟停下笔。');
  await card.getByRole('textbox', { name: '替换为' }).fill('林舟搁下笔。');
  await card.getByRole('button', { name: '保存这处修改' }).click();
  await expect
    .poll(() => page.evaluate(() => sessionStorage.getItem('test:manual-request')))
    .not.toBeNull();
  const action = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem('test:manual-request') || '{}'),
  );
  expect(action).toMatchObject({
    type: 'edit_finding',
    findingId: 'new-finding',
    text: '林舟搁下笔。',
    draftVersion: 4,
  });
  await expect(page.getByRole('status', { name: '局部处理进度' })).toContainText('正在保存');
  await expect(page.getByRole('region', { name: '审核更新' })).toHaveCount(0);
  await page.getByRole('tab', { name: '整章审核' }).click();
  await expect(page.getByRole('button', { name: '去审核这一段' })).toBeVisible();
  await expect(page.getByRole('button', { name: '重新复审' })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('chapter-next-action.png') });
});

for (const { width, crossBeat } of [
  { width: 1600, crossBeat: false },
  { width: 900, crossBeat: false },
  { width: 1600, crossBeat: true },
  { width: 900, crossBeat: true },
]) {
  test(`unflagged prose can be selected, edited and saved without opening a modal (${width}, cross-beat: ${crossBeat})`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript(
      ({ planning, versions, width, crossBeat }) => {
        const original = window.fetch;
        const segment = {
          id: 'segment',
          beatId: 'navigation-beat',
          version: 4,
          text: Array.from(
            { length: 24 },
            (_, i) => `第${i + 1}段。窗前传来轻响，林舟停下笔。`,
          ).join('\n'),
        };
        let run = {
          id: 'editable-run',
          neighborsChanged: true,
          chapterId: 'draft',
          branchId: 'main',
          status: 'waiting_human',
          draftVersion: 4,
          eventSequence: 1,
          currentNode: 'human_gate',
          nodes: [],
          activeRoles: [],
          planning: {
            mode: 'beat',
            beatId: 'navigation-beat',
            chapterId: 'navigation-chapter',
            planVersion: 1,
            expected: versions,
            neighborPolicy: 'working-v1',
          },
          result: {
            segments: [segment],
            report: { draftVersion: 4, findings: [] },
            criticReviews: [],
            metrics: [],
            reviews: [],
            revisions: [],
            patches: [],
            draftVersion: 4,
            round: 0,
            context: {
              beat: { id: 'navigation-beat', version: 1, locked: false },
              characters: [],
              facts: [],
              sources: [],
            },
          },
        };
        const otherSegment = { ...segment, id: 'other-segment', beatId: 'other-beat' };
        let otherRun = {
          ...run,
          id: 'other-run',
          chapterId: 'other-draft',
          approvalBlock: '局部修改尚未统一复审，请先复审当前稿',
          planning: { ...run.planning, beatId: 'other-beat' },
          result: { ...run.result, segments: [otherSegment], reviewPending: true },
        };
        if (crossBeat)
          planning.chapterPlans[0].content.scenes[0].beats.push({
            id: 'other-beat',
            title: '查看窗台',
            action: '查看',
            turn: '发现足迹',
          });
        let attempts = 0;
        window.fetch = async (input, init) => {
          const url = new URL(
            input instanceof Request ? input.url : String(input),
            location.origin,
          );
          if (!url.pathname.startsWith('/go-api/')) return original(input, init);
          const path = url.pathname;
          const respond = (data: unknown) =>
            new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
          if (path.endsWith('/actions') && init?.method === 'POST') {
            attempts++;
            if (crossBeat && attempts === 1) {
              sessionStorage.setItem('test:failed-edit', String(init.body));
              return new Response(JSON.stringify({ message: '测试连接暂时中断，请重试原请求。' }), {
                status: 503,
                headers: { 'Content-Type': 'application/json' },
              });
            }
            sessionStorage.setItem('test:direct-edit', String(init.body));
            run = { ...run, status: 'running', eventSequence: 2 };
            if (crossBeat) {
              otherRun = { ...otherRun, status: 'running', eventSequence: 2 };
              return respond(otherRun);
            }
            return respond(run);
          }
          if (path.endsWith('/planning')) return respond(planning);
          if (path.endsWith('/chapter-runs') && url.searchParams.get('beatId') === 'other-beat')
            return respond({
              ready: true,
              beatId: 'other-beat',
              draftVersion: 4,
              planVersion: 1,
              expected: versions,
              runs: [otherRun],
              working: {
                runId: otherRun.id,
                version: 4,
                state: 'candidate',
                segments: [otherSegment],
              },
            });
          if (path.endsWith('/chapter-runs'))
            return respond({
              ready: true,
              adopted: { version: 1, matchesWorking: width === 900 },
              working: {
                runId: run.id,
                version: 4,
                state: width === 900 ? 'adopted' : 'candidate',
                segments: [segment],
              },
              beatId: 'navigation-beat',
              draftVersion: 4,
              planVersion: 1,
              expected: versions,
              runs: [run],
            });
          if (path.includes('/runs/other-run')) return respond(otherRun);
          if (path.includes('/runs/')) return respond(run);
          if (path.includes('/chapters/other-draft')) {
            // The run arrives before its editable version. Preserve the pending selection.
            await new Promise((resolve) => setTimeout(resolve, 750));
            return respond({ draftVersion: 4, segments: [otherSegment] });
          }
          if (path.includes('/chapters/')) return respond({ draftVersion: 4, segments: [segment] });
          if (path.endsWith('/preview'))
            return respond({ ready: false, slots: [], draft: { parts: [] }, history: [] });
          return respond({});
        };
      },
      { planning, versions, width, crossBeat },
    );
    await page.goto(
      '/workspace?projectId=project-zhuoliu&branchId=main&source=planned&planningChapterId=navigation-chapter&beatId=navigation-beat&panel=closed',
    );
    const editor = page.getByTestId(crossBeat ? 'editor-other-segment' : 'editor-segment');
    await expect(page.getByTestId('editor-segment')).toHaveAttribute('contenteditable', 'true');
    await page.getByRole('button', { name: '作者审核', exact: true }).first().click();
    await expect(page.getByText(/邻段已更新，衔接将在整章复审核对。/)).toBeVisible();
    await expect(page.getByRole('region', { name: '审核更新' })).toHaveCount(0);
    if (width === 900) {
      await expect(page.getByRole('button', { name: '批准本段', exact: true })).toHaveCount(0);
    } else {
      await expect(
        page.getByText('已采用 v1 保留；当前 v4 是修改后的候选，需要确认的是新正文。'),
      ).toBeVisible();
      await expect(page.getByRole('button', { name: '批准本段', exact: true })).toBeEnabled();
    }
    if (width === 900) await page.getByRole('button', { name: '关闭侧栏', exact: true }).click();
    // Select a repeated phrase in paragraph 16: editing must keep this occurrence,
    // not jump to the identical wording in paragraph 1.
    const paragraph = editor.locator('p').nth(15);
    await paragraph.scrollIntoViewIfNeeded();
    const selectQuote = () =>
      paragraph.evaluate((el) => {
        const from = el.textContent!.indexOf('林舟停下笔。');
        const to = from + '林舟停下笔。'.length;
        const range = document.createRange();
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        let offset = 0;
        while (walker.nextNode()) {
          const node = walker.currentNode,
            end = offset + node.textContent!.length;
          if (from >= offset && from < end) range.setStart(node, from - offset);
          if (to > offset && to <= end) range.setEnd(node, to - offset);
          offset = end;
        }
        const selection = window.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
        (el.closest('[contenteditable]') as HTMLElement).focus({ preventScroll: true });
        document.dispatchEvent(new Event('selectionchange'));
      });
    await selectQuote();
    const before = await page.locator('.manuscript-scroll').evaluate((el) => el.scrollTop);
    await page.getByRole('toolbar').getByRole('button', { name: '直接修改原文' }).click();
    await expect(editor).toBeFocused();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await page.locator('.manuscript-scroll').evaluate((el) => el.scrollTop)).toBe(before);
    await page.keyboard.insertText('林舟把笔搁在窗台上。');
    await expect(paragraph).toHaveText('第16段。窗前传来轻响，林舟把笔搁在窗台上。');
    await expect(editor.locator('p').first()).toHaveText('第1段。窗前传来轻响，林舟停下笔。');
    const editActions = page.getByRole('region', { name: '正文修改', exact: true });
    await expect(editActions).toBeInViewport();
    await expect(editActions).toContainText('正文有未保存修改');
    // The open review panel must not create another save button.
    if (width === 1600) {
      await expect(editActions).toBeInViewport();
      await expect(page.getByRole('button', { name: '保存并复检', exact: true })).toHaveCount(1);
    }
    if (width === 900 && crossBeat) {
      await page.getByRole('button', { name: '专注模式', exact: true }).click();
      await expect(editActions).toBeInViewport();
    }
    await page.screenshot({ path: testInfo.outputPath('manuscript-save-controls.png') });
    const discardScroll = await page.locator('.manuscript-scroll').evaluate((el) => el.scrollTop);
    await editActions.getByRole('button', { name: '放弃修改', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(editActions).toHaveCount(0);
    await expect(paragraph).toHaveText('第16段。窗前传来轻响，林舟停下笔。');
    const afterDiscard = await page.locator('.manuscript-scroll').evaluate((el) => ({
      top: el.scrollTop,
      max: el.scrollHeight - el.clientHeight,
    }));
    // Removing the action bar can expand the viewport at the end of the document.
    expect(afterDiscard.top).toBe(Math.min(discardScroll, afterDiscard.max));
    expect(await page.evaluate(() => sessionStorage.getItem('test:direct-edit'))).toBeNull();
    // Discard leaves the same paragraph available for another edit without a server call.
    await selectQuote();
    await page.getByRole('toolbar').getByRole('button', { name: '直接修改原文' }).click();
    await expect(editor).toBeFocused();
    await page.keyboard.insertText('林舟把笔搁在窗台上。');
    await expect(paragraph).toContainText('林舟把笔搁在窗台上。');
    await editActions.getByRole('button', { name: '保存并复检', exact: true }).click();
    if (crossBeat) {
      await expect(editActions.getByRole('alert')).toContainText('连接暂时中断');
      await expect(paragraph).toContainText('林舟把笔搁在窗台上。');
      await editActions.getByRole('button', { name: '重试原请求', exact: true }).click();
    }
    await expect
      .poll(() => page.evaluate(() => sessionStorage.getItem('test:direct-edit')))
      .not.toBeNull();
    const action = await page.evaluate(() =>
      JSON.parse(sessionStorage.getItem('test:direct-edit') || '{}'),
    );
    expect(action).toMatchObject({
      type: 'inline_edit',
      segmentId: crossBeat ? 'other-segment' : 'segment',
      draftVersion: 4,
    });
    if (crossBeat) {
      expect(action).toEqual(
        JSON.parse((await page.evaluate(() => sessionStorage.getItem('test:failed-edit'))) || '{}'),
      );
    }
    expect(action.text.split('\n')[15]).toBe('第16段。窗前传来轻响，林舟把笔搁在窗台上。');
    expect(action.text.split('\n')).toHaveLength(24);
    await expect(editActions).toHaveCount(0);
    await expect(paragraph).toBeInViewport();
    if (crossBeat)
      expect(
        await page.locator('.manuscript-scroll').evaluate((el) => el.scrollTop),
      ).toBeGreaterThan(0);
  });
}
