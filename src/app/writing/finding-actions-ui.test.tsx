import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '@/mocks/node';
import { WritingFinding } from './writing-panels';
import { findingRewrite, replaceFindingQuote } from './finding-actions';
import { useWritingActions } from '@/features/prepare/hooks/useWritingActions';
import type { BackendRun, HumanAction } from '@/features/prepare/types/backend';
const initial = {
  id: 'finding-run',
  draftVersion: 1,
  eventSequence: 1,
  status: 'waiting_human',
  instructionBlock: '旧修复入口被阻断',
  result: {
    segments: [{ id: 'segment', text: '前文。旧句。后文。', version: 1 }],
    report: {
      findings: [
        {
          id: 'finding',
          segmentId: 'segment',
          quote: '旧句。',
          reason: '动作衔接有误',
          suggestion: '补充必要动作',
          critic: 'hard_consistency',
          severity: 'P1',
          evidenceRefs: [],
          repairScope: 'segment',
        },
      ],
    },
  },
} as unknown as BackendRun;
function Example({ local = false }: { local?: boolean }) {
  const { data: run } = useQuery({
    queryKey: ['backend-trial', 'finding-run'],
    initialData: local
      ? {
          ...initial,
          result: {
            ...initial.result!,
            report: {
              ...initial.result!.report,
              findings: initial.result!.report.findings.map((f) => ({
                ...f,
                severity: 'P3' as const,
              })),
            },
          },
        }
      : initial,
    enabled: false,
  });
  const actions = useWritingActions(run, run.draftVersion);
  return (
    <>
      <output aria-label="已保存正文">{run.result?.segments[0].text}</output>
      {run.result?.reviewPending && (
        <button onClick={() => void actions.reviewBatch()}>统一复审当前稿</button>
      )}
      <WritingFinding
        run={run}
        id="finding"
        onClose={() => {}}
        busy={actions.busy}
        onEdit={async (replacement) => {
          if (local)
            return actions.editFinding(
              'finding',
              findingRewrite(run, 'finding', '作者修改原句', false),
              replacement,
            );
          const change = replaceFindingQuote(run, 'finding', replacement);
          return actions.edit(change.segmentId, change.text);
        }}
        onInstruct={async (instruction, whole) =>
          local
            ? actions.proposeFinding('finding', findingRewrite(run, 'finding', instruction, false))
            : actions.rewrite(findingRewrite(run, 'finding', instruction, whole))
        }
        onApply={async (id) => actions.applyFinding(id)}
        onDiscard={async (id) => actions.discardFinding(id)}
        onDecision={async (decision, reason) => actions.decideFinding('finding', decision, reason)}
      />
    </>
  );
}
function mount(local = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <Example local={local} />
    </QueryClientProvider>,
  );
  return () => {
    view.unmount();
    client.clear();
  };
}
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
it('submits versioned quote edits, model requests and reversible author decisions through the real action hook', async () => {
  const requests: HumanAction[] = [];
  let current = structuredClone(initial);
  server.use(
    http.post('*/go-api/runs/finding-run/actions', async ({ request }) => {
      const action = (await request.json()) as HumanAction;
      requests.push(action);
      current = { ...current, eventSequence: current.eventSequence + 1 };
      if (action.type === 'finding_decision')
        current = {
          ...current,
          result: {
            ...current.result!,
            findingDecisions: [
              ...(current.result?.findingDecisions ?? []),
              {
                findingId: action.findingId!,
                draftVersion: 1,
                decision: action.decision!,
                reason: action.instruction!,
              },
            ],
          },
        };
      return HttpResponse.json(current);
    }),
  );
  const cleanup = mount(),
    user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: '我来修改' }));
  await user.clear(screen.getByLabelText('替换为'));
  await user.type(screen.getByLabelText('替换为'), '新句。');
  await user.click(screen.getByRole('button', { name: '保存修改并复检' }));
  await screen.findByText('已提交，正在复检；完成后请核对新稿。');
  expect(requests[0]).toMatchObject({
    type: 'inline_edit',
    segmentId: 'segment',
    text: '前文。新句。后文。',
    draftVersion: 1,
  });
  await user.click(screen.getByRole('button', { name: '让模型修改' }));
  await user.selectOptions(screen.getByLabelText('修改范围'), 'segment');
  await user.click(screen.getByRole('button', { name: '发送给模型' }));
  await screen.findByText('已提交，正在复检；完成后请核对新稿。');
  expect(requests[1]).toMatchObject({
    type: 'rewrite',
    draftVersion: 1,
    rewrite: { segmentId: 'segment', start: 0, end: 9 },
  });
  expect(requests[1].rewrite?.instruction).toContain('动作衔接有误');
  await user.click(screen.getByRole('button', { name: '保留原文' }));
  expect(screen.queryByLabelText('保留理由')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '确认保留原文' })).not.toBeInTheDocument();
  await screen.findByText('作者保留原文');
  expect(requests[2]).toMatchObject({
    type: 'finding_decision',
    findingId: 'finding',
    decision: 'keep',
    instruction: '',
    draftVersion: 1,
  });
  await user.click(screen.getByRole('button', { name: '撤销保留' }));
  await screen.findByText('已撤销保留，恢复待处理。');
  expect(requests[3]).toMatchObject({ type: 'finding_decision', decision: 'reopen' });
  expect(new Set(requests.map((r) => r.id)).size).toBe(4);
  cleanup();
});
it('preserves the author input and reports version conflicts instead of silently closing', async () => {
  server.use(
    http.post('*/go-api/runs/finding-run/actions', () =>
      HttpResponse.json({ message: '稿本已变化' }, { status: 409 }),
    ),
  );
  const cleanup = mount(),
    user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: '我来修改' }));
  await user.clear(screen.getByLabelText('替换为'));
  await user.type(screen.getByLabelText('替换为'), '保留输入');
  await user.click(screen.getByRole('button', { name: '保存修改并复检' }));
  await screen.findByText(/操作未提交/);
  expect(screen.getByLabelText('替换为')).toHaveValue('保留输入');
  cleanup();
});

it('previews a P2 without changing text, applies only on confirmation, and reviews only explicitly', async () => {
  const requests: HumanAction[] = [];
  let current = structuredClone(initial);
  current.result!.report.findings[0].severity = 'P2';
  server.use(
    http.post('*/go-api/runs/finding-run/actions', async ({ request }) => {
      const action = (await request.json()) as HumanAction;
      requests.push(action);
      current = {
        ...current,
        eventSequence: current.eventSequence + 1,
        result: { ...current.result! },
      };
      if (action.type === 'propose_finding')
        current.result!.findingProposal = {
          id: action.id,
          findingId: 'finding',
          draftVersion: 1,
          request: action.rewrite!,
          replacement: '新句。',
        };
      if (action.type === 'discard_finding') current.result!.findingProposal = undefined;
      if (action.type === 'apply_finding') {
        current.result!.findingProposal = undefined;
        current.result!.segments = [
          { ...current.result!.segments[0], text: '前文。新句。后文。', version: 2 },
        ];
        current.draftVersion = 2;
        current.result!.reviewPending = true;
        current.result!.findingChanges = [
          {
            findingId: 'finding',
            segmentId: 'segment',
            before: '旧句。',
            after: '新句。',
            fromVersion: 1,
            toVersion: 2,
          },
        ];
      }
      if (action.type === 'review_batch') {
        current.result!.reviewPending = false;
        current.result!.findingChanges = [];
      }
      return HttpResponse.json(current);
    }),
  );
  const cleanup = mount(true),
    user = userEvent.setup();
  const propose = async () => {
    await user.click(screen.getByRole('button', { name: '让模型修改' }));
    expect(screen.queryByLabelText('修改范围')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '生成修改预览' }));
    await screen.findByLabelText('局部修改对照');
  };
  await propose();
  expect(screen.getByLabelText('已保存正文')).toHaveTextContent('前文。旧句。后文。');
  expect(requests.map((a) => a.type)).toEqual(['propose_finding']);
  await user.click(screen.getByRole('button', { name: '放弃这次预览' }));
  await screen.findByText('已提交放弃预览，正文不变。');
  await propose();
  await user.click(screen.getByRole('button', { name: '确认替换这处' }));
  await screen.findByText(/本条已修改，待统一复审/);
  expect(screen.getByLabelText('已保存正文')).toHaveTextContent('前文。新句。后文。');
  expect(requests.map((a) => a.type)).toEqual([
    'propose_finding',
    'discard_finding',
    'propose_finding',
    'apply_finding',
  ]);
  expect(requests[3].proposalId).toBe(requests[2].id);
  await user.click(screen.getByRole('button', { name: '统一复审当前稿' }));
  await screen.findByRole('button', { name: '我来修改' });
  expect(requests[4]).toMatchObject({ type: 'review_batch', draftVersion: 2 });
  cleanup();
});
