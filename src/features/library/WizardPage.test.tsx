import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { server } from '@/mocks/node';
import type { BookPlan, PlanAction } from '@/types/domain/library';
import WizardPage from './WizardPage';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function fixture(): BookPlan {
  return {
    projectId: 'wizard-test',
    version: 1,
    brief: { name: '修钟人', logline: '两个修钟人拯救小店', genre: '都市', targetWords: 50000 },
    steps: [
      {
        candidates: [
          {
            id: 'direction-a',
            title: '时间的重量',
            summary: '关系与选择',
            content: {
              kind: 'direction',
              tone: '克制',
              coreConflict: '效率与手艺',
              appeal: '人物关系',
              note: '',
            },
          },
        ],
        selectedId: 'direction-a',
        locked: false,
        basedOn: '',
      },
      { candidates: [], selectedId: null, locked: false, basedOn: '' },
      { candidates: [], selectedId: null, locked: false, basedOn: '' },
      { candidates: [], selectedId: null, locked: false, basedOn: '' },
    ],
  };
}
function Location() {
  const location = useLocation();
  return (
    <output data-testid="location">
      {location.pathname}
      {location.search}
    </output>
  );
}
function setup(path = '/library/new?projectId=wizard-test&step=0') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Location />
        <Routes>
          <Route path="/library/new" element={<WizardPage />} />
          <Route path="/book/:id" element={<p>作品总览</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

it('guards direct access to later steps and does not generate candidates automatically', async () => {
  const data = fixture();
  data.steps[0].candidates = [];
  data.steps[0].selectedId = null;
  let writes = 0;
  server.use(
    http.get('*/api/projects/wizard-test/planning', () => HttpResponse.json(data)),
    http.patch('*/api/projects/wizard-test/planning', () => {
      writes++;
      return HttpResponse.json(data);
    }),
  );
  setup('/library/new?projectId=wizard-test&step=3');
  expect(await screen.findByText('从两个不同方向中选择')).toBeInTheDocument();
  await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('step=0'));
  expect(screen.getByRole('button', { name: /下一步/ })).toBeDisabled();
  expect(writes).toBe(0);
});

it('preserves an unsaved field after a 409 and does not exit the wizard', async () => {
  let data = fixture();
  server.use(
    http.get('*/api/projects/wizard-test/planning', () => HttpResponse.json(data)),
    http.patch('*/api/projects/wizard-test/planning', () => {
      data = { ...data, version: 2 };
      return HttpResponse.json(
        { code: 'version_mismatch', message: '另一窗口已更新' },
        { status: 409 },
      );
    }),
  );
  const user = setup();
  const input = await screen.findByLabelText('故事基调');
  await user.clear(input);
  await user.type(input, '作者未保存的基调');
  await user.click(screen.getByRole('button', { name: '先存为草稿' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('你的输入仍保留');
  expect(screen.getByLabelText('故事基调')).toHaveValue('作者未保存的基调');
  expect(screen.getByTestId('location')).toHaveTextContent('/library/new');
  await waitFor(() => expect(screen.getByRole('button', { name: '保存编辑' })).toBeDisabled());
});

it('saves the current form before leaving for the book overview', async () => {
  let data = fixture();
  let saved: unknown;
  server.use(
    http.get('*/api/projects/wizard-test/planning', () => HttpResponse.json(data)),
    http.patch('*/api/projects/wizard-test/planning', async ({ request }) => {
      const body = (await request.json()) as PlanAction;
      saved = body;
      data = { ...data, version: data.version + 1 };
      if (body.action === 'edit') data.steps[body.step].candidates[0].content = body.content;
      return HttpResponse.json(data);
    }),
  );
  const user = setup();
  const input = await screen.findByLabelText('核心冲突');
  await user.clear(input);
  await user.type(input, '信任与控制');
  await user.click(screen.getByRole('button', { name: '先存为草稿' }));
  expect(await screen.findByText('作品总览')).toBeInTheDocument();
  expect(saved).toMatchObject({
    action: 'edit',
    expectedVersion: 1,
    step: 0,
    content: { coreConflict: '信任与控制' },
  });
});

it('requires each world confirmation and keeps uncommitted edits when going back a step', async () => {
  const data = fixture();
  data.steps[0].locked = true;
  data.steps[1].locked = true;
  data.steps[2] = {
    basedOn: '',
    locked: false,
    selectedId: 'world-a',
    candidates: [
      {
        id: 'world-a',
        title: '钟店与街区',
        summary: '小店的规则',
        content: {
          kind: 'world',
          characters: [
            {
              id: 'person-a',
              name: '阿宁',
              want: '留住小店',
              need: '接受帮助',
              flaw: '控制欲',
              arc: '学会合作',
              hardTraits: '左撇子',
              confirmed: false,
            },
          ],
          rules: [{ id: 'rule-a', text: '时间不可逆转', confirmed: false }],
        },
      },
    ],
  };
  server.use(http.get('*/api/projects/wizard-test/planning', () => HttpResponse.json(data)));
  const user = setup('/library/new?projectId=wizard-test&step=2');
  const name = await screen.findByLabelText('人物姓名');
  await user.clear(name);
  await user.type(name, '阿宁的新名字');
  expect(screen.getByRole('button', { name: '保存并锁定' })).toBeDisabled();
  await user.click(screen.getByLabelText('已确认此人物设定'));
  expect(screen.getByRole('button', { name: '保存并锁定' })).toBeDisabled();
  await user.click(screen.getByLabelText('已确认此世界规则'));
  expect(screen.getByRole('button', { name: '保存并锁定' })).toBeEnabled();
  await user.click(screen.getByRole('button', { name: /上一步/ }));
  await user.click(screen.getByRole('button', { name: /人物与世界/ }));
  expect(await screen.findByLabelText('人物姓名')).toHaveValue('阿宁的新名字');
  expect(screen.getByLabelText('已确认此世界规则')).toBeChecked();
});
