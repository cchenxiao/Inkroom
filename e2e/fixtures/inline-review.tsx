import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { WritingManuscript } from '../../src/features/workspace/components/WritingManuscript';
import { findingRewrite, replaceFindingQuote } from '../../src/app/writing/finding-actions';
import { WritingFinding } from '../../src/app/writing/writing-panels';
import type { Segment, Finding } from '../../src/types/domain';
import type { BackendRun } from '../../src/features/prepare/types/backend';
import '../../src/styles/globals.css';
import '../../src/app/writing/writing.css';
const text = [
  '她走进屋里。',
  '她把布袋锁进铁柜。',
  '信封放在桌上，紧挨着布袋。',
  ...Array.from(
    { length: 40 },
    (_, i) => `后续正文第${i + 1}段。窗外的雨落在屋檐上，她翻开笔记，继续记录这一晚发生的事情。`,
  ),
].join('\n');
const segment = {
  id: 'segment',
  text,
  version: 1,
  order: 1,
  pov: '',
  charactersPresent: [],
  entitiesMentioned: [],
  foreshadowIds: [],
  styleStats: { aiTaste: 0, sentenceLengths: [], dialogueRatio: 0, repeatedPhrases: [] },
} as Segment;
const finding = {
  id: 'finding',
  segmentId: 'segment',
  quote: '信封放在桌上，紧挨着布袋。',
  reason: '布袋刚被锁进铁柜，缺少取回动作。',
  suggestion: '补充取回布袋的动作，或调整桌上物品。',
  severity: 'P1',
  critic: 'hard_consistency',
  status: 'open',
  evidenceRefs: [],
  repairScope: 'segment',
  draftVersion: 1,
} as Finding;
const local = new URLSearchParams(location.search).has('local');
const initialFindings = local
  ? [
      { ...finding, severity: 'P3' as const },
      { ...finding, id: 'second', quote: '她把布袋锁进铁柜。', severity: 'P3' as const },
      { ...finding, id: 'third', quote: '她走进屋里。', severity: 'P3' as const },
    ]
  : [finding];
function Example() {
  const [selected, select] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [saved, setSaved] = useState(0);
  const [run, setRun] = useState({
    id: 'fixture',
    draftVersion: 1,
    status: 'waiting_human',
    instructionBlock: '旧入口限制',
    result: { segments: [segment], report: { findings: initialFindings } },
  } as unknown as BackendRun);
  const [reviews, setReviews] = useState(0);
  const [request, setRequest] = useState('');
  return (
    <main
      style={{
        height: '100vh',
        maxWidth: 900,
        margin: 'auto',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <button onClick={() => setRevision((v) => v + 1)}>模拟审核状态刷新 {revision}</button>
      <button
        onClick={() =>
          setRun({
            ...run,
            draftVersion: run.draftVersion + 1,
            result: {
              ...run.result!,
              segments: [
                {
                  ...run.result!.segments[0],
                  text: run.result!.segments[0].text.replace(
                    '信封放在桌上，紧挨着布袋。',
                    '信封放在桌上，紧挨着笔记。',
                  ),
                },
              ],
              findingChanges: [
                {
                  findingId: 'finding',
                  segmentId: 'segment',
                  before: finding.quote,
                  after: '信封放在桌上，紧挨着笔记。',
                  fromVersion: 1,
                  toVersion: 2,
                },
              ],
            },
          })
        }
      >
        模拟模型返回新正文和检查结果
      </button>
      <output aria-label="正文改动次数">{saved}</output>
      <output aria-label="提交操作" hidden>
        {request}
      </output>
      {local && (
        <div>
          <output aria-label="完整复审次数">{reviews}</output>
          <output aria-label="问题数量">{run.result!.report.findings.length}</output>
          {run.result?.reviewPending && (
            <button
              onClick={() => {
                setReviews((v) => v + 1);
                setRun({
                  ...run,
                  result: { ...run.result!, reviewPending: false, findingChanges: [] },
                });
              }}
            >
              统一复审当前稿
            </button>
          )}
        </div>
      )}
      <WritingManuscript
        parts={[
          {
            id: 'beat',
            title: '窗前',
            segments: [{ ...segment, text: run.result!.segments[0].text }],
            accepted: false,
          },
        ]}
        activeBeat="beat"
        title="测试章节"
        pov=""
        findings={initialFindings.map((f) => ({
          ...f,
          quote: run.result?.findingChanges?.find((c) => c.findingId === f.id)?.after || f.quote,
          status: run.result?.findingChanges?.some((c) => c.findingId === f.id)
            ? 'resolved'
            : 'open',
        }))}
        selectedFinding={selected}
        editable={false}
        localText={{}}
        dirty={false}
        blocked=""
        busy={false}
        onChange={() => setSaved((v) => v + 1)}
        onSelectBeat={() => {}}
        onFinding={select}
        onSelection={() => {}}
        onSave={() => {}}
        onStart={() => {}}
        onReview={() => {}}
        startDisabled={false}
        onRewrite={() => {}}
      >
        {selected && (
          <WritingFinding
            key={`${selected}:${run.draftVersion}`}
            run={run}
            id={selected}
            onClose={() => select(null)}
            onEdit={async (replacement) => {
              const change = replaceFindingQuote(run, selected, replacement);
              setRequest(JSON.stringify({ type: 'inline_edit', ...change }));
              setRun({
                ...run,
                result: {
                  ...run.result!,
                  ...(local
                    ? {
                        reviewPending: true,
                        findingChanges: [
                          ...(run.result?.findingChanges ?? []),
                          {
                            findingId: selected,
                            segmentId: 'segment',
                            before: initialFindings.find((f) => f.id === selected)!.quote,
                            after: replacement,
                            fromVersion: run.draftVersion,
                            toVersion: run.draftVersion + 1,
                          },
                        ],
                      }
                    : {}),
                  segments: [{ ...run.result!.segments[0], text: change.text }],
                },
              });
              setSaved((v) => v + 1);
              return true;
            }}
            onInstruct={async (instruction, whole) => {
              if (local) {
                const request = findingRewrite(run, selected, instruction, false);
                setRun({
                  ...run,
                  result: {
                    ...run.result!,
                    findingProposal: {
                      id: 'preview',
                      findingId: selected,
                      draftVersion: run.draftVersion,
                      request,
                      replacement: '信封搁在笔记旁。',
                    },
                  },
                });
                return true;
              }
              setRequest(
                JSON.stringify({
                  type: 'rewrite',
                  rewrite: findingRewrite(run, selected, instruction, whole),
                }),
              );
              return true;
            }}
            onApply={async () => {
              const p = run.result!.findingProposal!;
              const change = replaceFindingQuote(run, selected, p.replacement);
              setRun({
                ...run,
                draftVersion: run.draftVersion + 1,
                result: {
                  ...run.result!,
                  findingProposal: undefined,
                  reviewPending: true,
                  segments: [{ ...run.result!.segments[0], text: change.text }],
                  findingChanges: [
                    ...(run.result?.findingChanges ?? []),
                    {
                      findingId: selected,
                      segmentId: 'segment',
                      before: initialFindings.find((f) => f.id === selected)!.quote,
                      after: p.replacement,
                      fromVersion: run.draftVersion,
                      toVersion: run.draftVersion + 1,
                    },
                  ],
                },
              });
              setSaved((v) => v + 1);
              return true;
            }}
            onDiscard={async () => {
              setRun({ ...run, result: { ...run.result!, findingProposal: undefined } });
              return true;
            }}
            onDecision={async (decision, reason) => {
              setRequest(JSON.stringify({ type: 'finding_decision', decision, reason }));
              setRun({
                ...run,
                result: {
                  ...run.result!,
                  findingDecisions: [
                    ...(run.result?.findingDecisions ?? []),
                    { findingId: selected, draftVersion: 1, decision, reason },
                  ],
                },
              });
              return true;
            }}
          />
        )}
      </WritingManuscript>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<Example />);
