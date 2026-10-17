import { expect, test } from '@playwright/test';
import review from './fixtures/chapter-facts-review.json' with { type: 'json' };
import type {
  FactsJob,
  FactsSelectionRequest,
  FactsState,
} from '../src/features/prepare/api/chapter-facts';
import type { ChapterReviewJob } from '../src/features/prepare/api/chapter-review';

test('failed extraction can be taken over manually and published with saved decisions', async ({
  page,
}, testInfo) => {
  let job: FactsJob = {
    id: 'failed-facts',
    request: {
      requestId: 'failed-facts',
      reviewId: review.id,
      inputDigest: review.inputDigest,
      mode: 'model',
    },
    status: 'failed',
    provider: 'fake',
    model: 'fixture',
    message: '候选引文与本次章稿不一致，未载入候选。',
    failure: {
      stage: 'validation',
      code: 'evidence_mismatch',
      message: '候选引文与本次章稿不一致，未载入候选。',
    },
    createdAt: '2026-10-17T00:00:00Z',
    calls: [],
    input: {
      chapterId: 'chapter',
      review: review.input as ChapterReviewJob['input'],
      baseKnowledge: { version: 1, digest: 'knowledge' },
      knowledge: { characters: ['shen'], facts: [] },
    },
  };
  const state: FactsState = {
    job,
    selection: null,
    current: true,
    published: false,
    block: job.message,
  };
  let receipt: Record<string, unknown> | null = null;
  let publicationRequests = 0;
  await page.route('**/facts-acceptance', async (route) => {
    const response = await route.fetch();
    const html = await response.text();
    await route.fulfill({
      response,
      body: html.replace(/\/src\/main\.tsx[^" ]*/g, '/e2e/fixtures/chapter-facts-acceptance.tsx'),
    });
  });
  await page.route('**/go-api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/facts')) return route.fulfill({ json: state });
    if (path.endsWith('/publication'))
      return route.fulfill({ json: { publication: receipt, current: !!receipt, reason: '' } });
    if (path.endsWith('/chapter-fact-jobs')) {
      const req = route.request().postDataJSON();
      expect(req.mode).toBe('manual');
      job = {
        ...job,
        id: req.requestId,
        request: req,
        provider: 'human',
        model: '',
        status: 'completed',
        failure: undefined,
        message: '请按原文补充候选并逐条决定',
        output: { candidates: [] },
      };
      state.job = job;
      state.block = '请保存逐条决定';
      return route.fulfill({ json: job });
    }
    if (path.endsWith('/chapter-fact-selections')) {
      const req = route.request().postDataJSON() as FactsSelectionRequest;
      expect(req.jobId).toBe(job.id);
      expect(req.decisions[0].knownBy).toEqual(['shen']);
      state.selection = {
        version: 1,
        request: req,
        createdAt: job.createdAt,
        block: '',
        package: {
          baseKnowledge: job.input.baseKnowledge,
          facts: [
            {
              id: 'confirmed',
              text: req.decisions[0].text,
              chapterId: 'chapter',
              commitId: 'commit',
              segmentId: 'segment',
              sourceVersion: 1,
              storyTime: 10,
              evidence: req.manual[0].evidence,
              knownBy: req.decisions[0].knownBy,
            },
          ],
        },
      };
      state.block = '';
      return route.fulfill({ json: state.selection });
    }
    if (path.endsWith('/chapter-publications')) {
      publicationRequests++;
      const req = route.request().postDataJSON();
      expect(req.factJobId).toBe(job.id);
      expect(req.factVersion).toBe(1);
      expect(state.selection).not.toBeNull();
      receipt = {
        id: 'publication',
        version: 1,
        assembly: { version: 1 },
        createdAt: job.createdAt,
        request: req,
        factSelection: state.selection,
      };
      state.published = true;
      return route.fulfill({ json: { publication: receipt, current: true, reason: '' } });
    }
    throw new Error('Unexpected acceptance API: ' + path);
  });
  await page.goto('/facts-acceptance');
  await expect(page.getByRole('alert')).toContainText('候选引文');
  await expect(page.getByRole('button', { name: '确认整章定稿', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '我来整理事实', exact: true }).click();
  await page.getByRole('button', { name: '确认并继续', exact: true }).click();
  await page.getByRole('button', { name: '补充一条事实', exact: true }).click();
  await page.getByRole('combobox', { name: '原文段落', exact: true }).selectOption('s1');
  await page.getByRole('textbox', { name: '事实陈述', exact: true }).fill('沈砚收到铜扣');
  await page.getByRole('combobox', { name: /候选 1/ }).selectOption('confirm');
  await page.getByRole('checkbox', { name: 'shen', exact: true }).check();
  await page.getByRole('textbox', { name: '决定理由', exact: true }).fill('已核对交接动作与知情人');
  await expect(page.getByRole('button', { name: '确认整章定稿', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '保存逐条决定', exact: true }).click();
  await page.getByRole('radio', { name: '我已核对，新增事实已逐条决定，没有遗留冲突' }).check();
  await page.getByRole('button', { name: '确认整章定稿', exact: true }).click();
  await expect(page.getByText('本章已定稿', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('本章已定稿', { exact: true })).toBeVisible();
  expect(publicationRequests).toBe(1);
  await page.getByText('定稿回执', { exact: true }).click();
  await expect(page.getByText(/沈砚收到铜扣/).last()).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('manual-facts-publication.png'),
    fullPage: true,
  });
});
