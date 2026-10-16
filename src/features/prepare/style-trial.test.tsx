import type { StyleAnalysisJob } from './types/style-analysis';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from '@/mocks/node';
import { useUIStore } from '@/shared/lib/ui-store';
import type { PlanningState } from './types/planning';
import type { StyleTrialJob, StyleSelectionRequest } from './types/style-trial';
import { emptyIntake } from './components/PlanningIntakeForm';
import { emptyTrialSetup } from './components/StyleTrialSetup';
import BackendStyleTrial from './components/BackendStyleTrial';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() =>
  server.use(http.get('*/go-api/planning/style-analyses', () => HttpResponse.json([]))),
);
afterEach(() => {
  server.resetHandlers();
  useUIStore.setState({ projectId: 'project-zhuoliu', branchId: 'main' });
});
afterAll(() => server.close());
function fixture(): PlanningState {
  const input = {
    version: 1,
    digest: 'digest',
    intake: { ...emptyIntake, premise: '修钟店' },
    effectivePacks: [],
  };
  const direction = {
    title: '共同难题',
    logline: '两个人修钟',
    coreConflict: '方法不同',
    characterDilemma: '信任',
    readerAppeal: '合作',
    tone: '克制',
    narrative: '第三人称',
    tradeoff: '事件集中',
  };
  const selection = {
    version: 1,
    inputVersion: 1,
    inputDigest: 'digest',
    jobId: '',
    candidateVersion: 0,
    candidateIndex: -1,
    direction,
    createdAt: '2026-10-16T00:00:00Z',
  };
  const setup = emptyTrialSetup();
  setup.beat = {
    summary: '寻找弹簧',
    facts: ['钟没有修好'],
    outcome: '接过手电',
    pov: '第三人称限知',
    tense: '过去时',
  };
  const job: StyleTrialJob = {
    id: 'trial-job',
    version: 1,
    request: {
      ...setup,
      requestId: 'trial-job',
      expectedInputVersion: 1,
      expectedDirectionVersion: 1,
    },
    createdAt: '2026-10-16T00:00:00Z',
    promptVersion: 'trial_writer.v1',
    schemaVersion: 'trial_writer.v1',
    report: {
      status: 'completed',
      model: 'scripted-fake',
      message: '',
      inputDigest: 'digest',
      input: { ...setup, source: input, selection },
      samples: setup.variants.map((variant) => ({
        variant,
        text: '林舟接过手电，继续寻找弹簧。',
        stats: { mean: 13, variance: 0, calibrated: false, sentenceLengths: [13], hits: [] },
      })),
      calls: [],
      usage: { inputTokens: 0, outputTokens: 0, known: true },
    },
  };
  return {
    input,
    directionVersion: 1,
    selection,
    jobs: [],
    packs: [],
    styleJobs: [job],
    styleVersion: 0,
    styleSelection: null,
  };
}
function setup() {
  useUIStore.setState({ projectId: 'project-zhuoliu', branchId: 'main' });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <BackendStyleTrial />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return userEvent.setup();
}
it('preserves author anchor edits and invalidates adoption after 409', async () => {
  let data = fixture();
  let body: unknown;
  server.use(
    http.get('*/go-api/planning', () => HttpResponse.json(data)),
    http.post('*/go-api/planning/style-selection', async ({ request }) => {
      body = await request.json();
      data = { ...data, directionVersion: 2 };
      return HttpResponse.json({ code: 'version_mismatch', message: 'changed' }, { status: 409 });
    }),
  );
  const user = setup();
  await user.click((await screen.findAllByRole('button', { name: '以此为基础编辑' }))[0]);
  const editor = screen.getByLabelText('作者确认的锚文本');
  await user.clear(editor);
  await user.type(editor, '作者保留的文字。');
  await user.click(screen.getByRole('button', { name: '确认并保存风格' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '确认并保存风格' })).toBeDisabled(),
  );
  expect(editor).toHaveValue('作者保留的文字。');
  expect(body).toMatchObject({
    expectedDirectionVersion: 1,
    expectedStyleVersion: 0,
    jobId: 'trial-job',
    anchorText: '作者保留的文字。',
  });
});
it('adopts an edited anchor and shows the saved profile from the server', async () => {
  let data = fixture();
  server.use(
    http.get('*/go-api/planning', () => HttpResponse.json(data)),
    http.post('*/go-api/planning/style-selection', async ({ request }) => {
      const r = (await request.json()) as StyleSelectionRequest;
      const selected = {
        version: 1,
        inputVersion: 1,
        directionVersion: 1,
        anchorVersion: 1,
        jobId: r.jobId,
        candidateVersion: 1,
        variantId: r.variantId,
        anchorText: r.anchorText,
        rules: r.rules,
        createdAt: '2026-10-16T00:00:00Z',
      };
      data = { ...data, styleVersion: 1, styleSelection: selected };
      return HttpResponse.json(selected);
    }),
  );
  const user = setup();
  await user.click((await screen.findAllByRole('button', { name: '以此为基础编辑' }))[1]);
  await user.click(screen.getByRole('button', { name: '确认并保存风格' }));
  expect(await screen.findByText('已采用的风格参考 · v1')).toBeInTheDocument();
  expect(screen.queryByLabelText('作者确认的锚文本')).not.toBeInTheDocument();
});
it('retains trial provenance when editing an adopted style', async () => {
  const data = fixture();
  data.styleVersion = 1;
  data.styleSelection = {
    version: 1,
    inputVersion: 1,
    directionVersion: 1,
    anchorVersion: 1,
    jobId: 'trial-job',
    candidateVersion: 1,
    variantId: 'restrained',
    anchorText: '作者已选定的锚文本。',
    rules: {
      pov: '第三人称',
      tense: '过去时',
      tone: '克制',
      sentenceLength: { min: 8, max: 30 },
      dialogueRatio: { min: 0.1, max: 0.5 },
      bannedPhrases: [],
      styleArc: '',
    },
    createdAt: '2026-10-16T00:00:00Z',
  };
  let body: unknown;
  server.use(
    http.get('*/go-api/planning', () => HttpResponse.json(data)),
    http.post('*/go-api/planning/style-selection', async ({ request }) => {
      body = await request.json();
      return HttpResponse.json(data.styleSelection);
    }),
  );
  const user = setup();
  await user.click(await screen.findByRole('button', { name: '编辑 / 复核已保存风格' }));
  await user.click(screen.getByRole('button', { name: '确认并保存风格' }));
  await waitFor(() =>
    expect(body).toMatchObject({
      jobId: 'trial-job',
      candidateVersion: 1,
      variantId: 'restrained',
      sourceStyleVersion: 1,
    }),
  );
});

it('analyses pasted reference text and carries its source into author adoption', async () => {
  const data = fixture();
  let analyses: StyleAnalysisJob[] = [];
  let submitted: unknown;
  const source = '风从门缝钻进来。他把手缩回袖口，等着她先说。'.repeat(5);
  server.use(
    http.get('*/go-api/planning', () => HttpResponse.json(data)),
    http.get('*/go-api/planning/style-analyses', () => HttpResponse.json(analyses)),
    http.post('*/go-api/planning/style-analyses', async ({ request }) => {
      const req = (await request.json()) as { text: string; title: string; requestId: string };
      analyses = [
        {
          id: req.requestId,
          version: 1,
          status: 'completed',
          input: {
            title: req.title,
            text: req.text,
            digest: 'source-digest',
            totalCharacters: source.length,
            analyzedCharacters: source.length,
            samples: [{ start: 0, end: source.length, text: source }],
            stats: { mean: 12, variance: 3, calibrated: false, sentenceLengths: [12] },
          },
          output: {
            observations: [
              {
                dimension: 'distance',
                sampleIndex: 0,
                quote: '他把手缩回袖口',
                reason: '通过动作表现迟疑',
                suggestion: '少解释情绪',
                certainty: 'observed',
              },
            ],
            rules: {
              pov: '第三人称',
              tense: '过去时',
              tone: '动作留白',
              sentenceLength: { min: 8, max: 30 },
              dialogueRatio: { min: 0.1, max: 0.5 },
              bannedPhrases: [],
              styleArc: '',
            },
            anchorText: '风从门缝钻进来。他把手缩回袖口，等着她先说。',
            limitations: '只有局部材料，目标区间待作者确认。',
          },
          model: 'scripted-fake',
          promptVersion: 'style_analyst.v1',
          schemaVersion: 'style_analyst.v1',
          calls: [],
          message: '',
          createdAt: '2026-10-16T00:00:00Z',
        },
      ];
      return HttpResponse.json(analyses[0], { status: 202 });
    }),
    http.post('*/go-api/planning/style-selection', async ({ request }) => {
      submitted = await request.json();
      return HttpResponse.json({ version: 1 });
    }),
  );
  const user = setup();
  await user.type(await screen.findByLabelText('参考文本'), source);
  await user.click(screen.getByRole('button', { name: '识别这段文字的风格' }));
  expect(await screen.findByText('通过动作表现迟疑')).toBeInTheDocument();
  expect(submitted).toBeUndefined();
  await user.click(screen.getByRole('button', { name: '导入风格编辑器' }));
  expect(screen.getByLabelText('作者确认的锚文本')).toHaveValue(analyses[0].output!.anchorText);
  await user.click(screen.getByRole('button', { name: '确认并保存风格' }));
  await waitFor(() =>
    expect(submitted).toMatchObject({
      analysisId: analyses[0].id,
      analysisVersion: 1,
      jobId: '',
      expectedDirectionVersion: 1,
    }),
  );
});
