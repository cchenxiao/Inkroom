// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { server, resetDB } from '../mocks/node';
import type { Bible, ChapterDocument, ChangeSet, RevisionPatch, RunState } from '../types/domain';
const call = (path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') =>
  fetch(`http://localhost/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const chapter = async (branch = 'main') =>
  (await call(`/chapters/ch7?branchId=${branch}`)).json() as Promise<ChapterDocument>;
beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }));
beforeEach(() => resetDB());
afterAll(() => server.close());
describe('mock backend business invariants', () => {
  it('keeps suggestions non-destructive and applies only accepted sentence IDs', async () => {
    const original = await chapter();
    const patch: RevisionPatch = await (
      await call('/findings/f-p2-emotion/suggest', { draftVersion: 3 })
    ).json();
    expect((await chapter()).segments).toEqual(original.segments);
    expect(
      (await call(`/patches/${patch.id}/apply`, { draftVersion: 3, acceptedSentenceIds: [] }))
        .status,
    ).toBe(422);
    const applied: ChapterDocument = await (
      await call(`/patches/${patch.id}/apply`, {
        draftVersion: 3,
        acceptedSentenceIds: [patch.sentences[0].id],
      })
    ).json();
    expect(applied.chapter.draftVersion).toBe(4);
    expect(applied.segments.find((s) => s.id === patch.segmentId)?.text).not.toContain(
      '一股难以言喻的情绪涌上心头',
    );
    expect(applied.segments.find((s) => s.id === 'ch7-s4')?.text).toContain('嘴角勾起一抹冷笑');
  });
  it('rejects stale writes and isolates alternate branch edits', async () => {
    const main = await chapter();
    expect(
      (
        await call(
          '/segments/ch7-s1',
          { text: '分支独有的雨声', draftVersion: 3, branchId: 'romance-b' },
          'PATCH',
        )
      ).status,
    ).toBe(200);
    expect((await chapter()).segments).toEqual(main.segments);
    expect((await chapter('romance-b')).segments[0].text).toBe('分支独有的雨声');
    await call('/demo/stale', {});
    const stale = await call('/segments/ch7-s1', { text: '不应保存', draftVersion: 3 }, 'PATCH');
    expect(stale.status).toBe(409);
    expect((await stale.json()).code).toBe('version_mismatch');
    expect((await chapter()).segments[0].text).toBe(main.segments[0].text);
  });
  it('previews Bible edits without mutations and applies selected strategy', async () => {
    const before: Bible = await (await call('/bible/all')).json();
    const target = before.characters[0];
    const change: ChangeSet = await (
      await call('/changesets/preview', {
        origin: 'human_bible',
        targetType: 'characters',
        targetId: target.id,
        new: { ...target, hardTraits: { ...target.hardTraits, 惯用手: '右手' } },
        reason: '重新设定',
        draftVersion: 3,
      })
    ).json();
    expect((await (await call('/bible/all')).json()).characters[0]).toEqual(target);
    expect(change.blastRadius.length).toBeGreaterThan(0);
    await call(`/changesets/${change.id}/apply`, { draftVersion: 3, strategy: 'mark_only' });
    expect((await (await call('/bible/all')).json()).characters[0].hardTraits.惯用手).toBe('右手');
  });
  it('requires ignore reasons and keeps an ignored P0 as a finalization blocker', async () => {
    expect((await call('/findings/f-p0-knowledge/ignore', { draftVersion: 3 })).status).toBe(422);
    await call('/findings/f-p0-knowledge/ignore', { draftVersion: 3, reason: '待作者裁决' });
    expect((await chapter()).scores.canFinalize).toBe(false);
    const run = (await chapter()).run;
    expect(
      (await call(`/runs/${run.id}/actions`, { action: 'approve', draftVersion: 3 })).status,
    ).toBe(422);
  });
  it('resolves dialogue-lie conflicts without corrupting character facts', async () => {
    const before: Bible = await (await call('/bible/all')).json();
    await call('/conflicts/conflict-hand/resolve', {
      choice: 'manuscript',
      isDialogueLie: true,
      reason: '人物故意说谎',
      draftVersion: 3,
    });
    expect(await (await call('/bible/all')).json()).toEqual(before);
    expect((await chapter()).conflicts.find((c) => c.id === 'conflict-hand')?.isDialogueLie).toBe(
      true,
    );
  });
  it('streams genuine replayable events without silently applying draft candidates', async () => {
    const before = await chapter();
    const run: RunState = await (
      await call('/runs', { chapterId: 'ch7', branchId: 'main' })
    ).json();
    await call(`/runs/${run.id}/actions`, { action: 'fast_forward', draftVersion: 3 });
    const response = await call(`/runs/${run.id}/events`);
    const text = await response.text();
    expect(text).toContain('event: run.started');
    expect(text).toContain('structural_reviser');
    expect(text).toContain('event: escalated');
    expect((await chapter()).segments).toEqual(before.segments);
    const events = text
      .split('\n\n')
      .filter((x) => x.includes('data:'))
      .map((x) => JSON.parse(x.split('data: ')[1]));
    expect(Math.max(...events.map((e) => e.data.round ?? 0))).toBe(2);
    const last = events.at(-1).id;
    const replay = await fetch(`http://localhost/api/runs/${run.id}/events`, {
      headers: { 'Last-Event-ID': last },
    });
    expect(await replay.text()).not.toContain('data:');
  });
});

describe('version history and review controls', () => {
  it('creates isolated branches and requires conflict choices before merging', async () => {
    const created = await (
      await call('/branches', { name: '备用试写', fromBranchId: 'main' })
    ).json();
    await call(
      '/segments/ch7-s1',
      { text: '分支里的新开头', draftVersion: 3, branchId: created.id },
      'PATCH',
    );
    await call('/segments/ch7-s1', { text: '主线里的新开头', draftVersion: 3 }, 'PATCH');
    const preview = await (await call(`/branches/${created.id}/merge`)).json();
    expect(preview.canMerge).toBe(false);
    expect(
      (await call(`/branches/${created.id}/merge`, { draftVersion: 4, resolutions: {} })).status,
    ).toBe(409);
    const merged = await call(`/branches/${created.id}/merge`, {
      draftVersion: 4,
      resolutions: { [preview.conflicts[0].id]: 'manuscript' },
    });
    expect(merged.status).toBe(200);
    expect((await chapter()).segments[0].text).toBe('分支里的新开头');
    expect((await chapter()).chapter.draftVersion).toBe(5);
  });
  it('restores snapshots into a new version without changing the other branch', async () => {
    const other = await chapter('romance-b');
    const restored = await call('/commits/commit-v1/restore', { draftVersion: 3 });
    expect(restored.status).toBe(200);
    expect((await chapter()).chapter.draftVersion).toBe(4);
    expect((await chapter()).segments[1].text).not.toContain('他认出了那个从未见过的人');
    expect((await chapter('romance-b')).segments).toEqual(other.segments);
  });
  it('pauses before doing work, resumes from the same run, and cancels without text mutations', async () => {
    const before = await chapter();
    const run = await (await call('/runs', { chapterId: 'ch7' })).json();
    await call(`/runs/${run.id}/actions`, { action: 'pause', draftVersion: 3 });
    expect((await (await call(`/runs/${run.id}`)).json()).status).toBe('paused');
    await call(`/runs/${run.id}/actions`, { action: 'resume', draftVersion: 3 });
    expect((await (await call(`/runs/${run.id}`)).json()).status).toBe('running');
    await call(`/runs/${run.id}/actions`, { action: 'cancel', draftVersion: 3 });
    expect((await (await call(`/runs/${run.id}`)).json()).status).toBe('canceled');
    expect((await chapter()).segments).toEqual(before.segments);
  });
  it('resolves a previously ignored P0 when its quote is repaired', async () => {
    await call('/findings/f-p0-knowledge/ignore', { draftVersion: 3, reason: '先处理措辞' });
    const patch: RevisionPatch = await (
      await call('/findings/f-p0-knowledge/suggest', { draftVersion: 3 })
    ).json();
    await call(`/patches/${patch.id}/apply`, {
      draftVersion: 3,
      acceptedSentenceIds: [patch.sentences[0].id],
    });
    expect((await chapter()).scores.p0Count).toBe(0);
  });
  it('previews and applies outline edits without replacing manuscript text', async () => {
    const before = await chapter();
    const preview = await (
      await call('/changesets/preview', {
        origin: 'human_bible',
        targetType: 'outline',
        targetId: 'ch7',
        new: { description: '让铜扣成为夜谈转折' },
        reason: '调整节拍',
        draftVersion: 3,
      })
    ).json();
    expect((await chapter()).chapter.scenes).toEqual(before.chapter.scenes);
    expect(
      (await call(`/changesets/${preview.id}/apply`, { draftVersion: 3, strategy: 'mark_only' }))
        .status,
    ).toBe(200);
    expect((await chapter()).chapter.scenes[0].beats[0].description).toBe('让铜扣成为夜谈转折');
    expect((await chapter()).segments.map((s) => s.text)).toEqual(
      before.segments.map((s) => s.text),
    );
  });
  it('imports outline chapters without overwriting existing prose', async () => {
    const before = await chapter();
    const result = await call('/imports', {
      kind: 'outline',
      text: '第七章 夜谈\n- 铜扣交付\n- 陌生人出现',
      draftVersion: 3,
    });
    expect(result.status).toBe(200);
    expect((await chapter()).segments.map((s) => s.text)).toEqual(
      before.segments.map((s) => s.text),
    );
    expect((await chapter()).chapter.scenes[0].beats.some((b) => b.title === '铜扣交付')).toBe(
      true,
    );
  });
});

describe('end-to-end editorial gate', () => {
  it('accepts all repairs explicitly before finalization and emits index commit events', async () => {
    const initial = await chapter();
    for (const finding of initial.findings) {
      const current = await chapter();
      const patch: RevisionPatch = await (
        await call(`/findings/${finding.id}/suggest`, {
          draftVersion: current.chapter.draftVersion,
        })
      ).json();
      expect(
        (
          await call(`/patches/${patch.id}/apply`, {
            draftVersion: current.chapter.draftVersion,
            acceptedSentenceIds: patch.sentences.map((s) => s.id),
          })
        ).status,
      ).toBe(200);
    }
    const repaired = await chapter();
    expect(repaired.scores.canFinalize).toBe(true);
    await call(`/runs/${repaired.run.id}/actions`, {
      action: 'fast_forward',
      draftVersion: repaired.chapter.draftVersion,
    });
    const approved = await call(`/runs/${repaired.run.id}/actions`, {
      action: 'approve',
      draftVersion: repaired.chapter.draftVersion,
    });
    expect(approved.status).toBe(200);
    expect((await chapter()).chapter.status).toBe('finalized');
    const stream = await (await call(`/runs/${repaired.run.id}/events`)).text();
    expect(stream).toContain('event: index.updating');
    expect(stream).toContain('event: run.finished');
    expect(stream).toContain('micro_polisher');
  });
  it('turns comments into reviewable patches and keeps text intact until acceptance', async () => {
    const before = await chapter();
    const response = await (
      await call('/comments', {
        segmentId: 'ch7-s3',
        quote: '一股难以言喻的情绪涌上心头',
        text: '请改成手部动作，保留停顿',
        draftVersion: 3,
      })
    ).json();
    expect(response.patch.origin).toBe('human_instruction');
    expect((await chapter()).segments[2].text).toBe(before.segments[2].text);
    await call(`/patches/${response.patch.id}/apply`, {
      draftVersion: 3,
      acceptedSentenceIds: [response.patch.sentences[0].id],
    });
    expect((await chapter()).segments[2].text).toContain('铜扣在掌心压出一道白痕');
    expect((await chapter()).segments[2].comments?.[0].status).toBe('replied');
  });
  it('rejects candidates generated against an old version', async () => {
    const patch: RevisionPatch = await (
      await call('/findings/f-p2-smile/suggest', { draftVersion: 3 })
    ).json();
    await call('/segments/ch7-s1', { text: '雨还在下。', draftVersion: 3 }, 'PATCH');
    const response = await call(`/patches/${patch.id}/apply`, {
      draftVersion: 4,
      acceptedSentenceIds: [patch.sentences[0].id],
    });
    expect(response.status).toBe(409);
    expect((await chapter()).segments[3].text).toContain('嘴角勾起一抹冷笑');
  });
});

it('invalidates an in-flight review when canonical text changes', async () => {
  const run: RunState = await (await call('/runs', { chapterId: 'ch7' })).json();
  await call('/segments/ch7-s1', { text: '作者在审阅中保存的新句子。', draftVersion: 3 }, 'PATCH');
  await call(`/runs/${run.id}/actions`, { action: 'fast_forward', draftVersion: 4 });
  expect((await (await call(`/runs/${run.id}`)).json()).status).toBe('failed');
  expect(await (await call(`/runs/${run.id}/events`)).text()).toContain('event: version.stale');
});

it('applies a structural patch sentence by sentence and leaves declined alternatives unchanged', async () => {
  const patch: RevisionPatch = await (
    await call('/findings/f-p0-knowledge/suggest', { draftVersion: 3 })
  ).json();
  expect(patch.sentences.length).toBeGreaterThan(1);
  const unchanged = patch.sentences[1].oldText;
  await call(`/patches/${patch.id}/apply`, {
    draftVersion: 3,
    acceptedSentenceIds: [patch.sentences[0].id],
  });
  const doc = await chapter();
  expect(doc.segments.find((s) => s.id === patch.segmentId)?.text).toContain(unchanged);
  expect(doc.patches.find((p) => p.id === patch.id)?.sentences[1].status).toBe('rejected');
});

it('rejects stale changeset previews even when the caller knows the newest draft version', async () => {
  const bible: Bible = await (await call('/bible/all')).json();
  const change: ChangeSet = await (
    await call('/changesets/preview', {
      origin: 'human_bible',
      targetType: 'characters',
      targetId: bible.characters[0].id,
      new: { ...bible.characters[0], description: '旧预览' },
      reason: '旧编辑',
      draftVersion: 3,
    })
  ).json();
  await call('/segments/ch7-s1', { text: '另一个窗口的新正文', draftVersion: 3 }, 'PATCH');
  const response = await call(`/changesets/${change.id}/apply`, {
    draftVersion: 4,
    strategy: 'mark_only',
  });
  expect(response.status).toBe(409);
  expect((await (await call('/bible/all')).json()).characters[0].description).toBe(
    bible.characters[0].description,
  );
});

it('scopes previews and saved history to the selected chapter', async () => {
  const mainBefore = await chapter();
  const other: ChapterDocument = await (await call('/chapters/ch1')).json();
  const saved = await call(
    '/segments/ch1-s1',
    { text: '第一章的新开头。', draftVersion: 1, chapterId: 'ch1' },
    'PATCH',
  );
  expect(saved.status).toBe(200);
  const { changeset } = await saved.json();
  expect(changeset.chapterId).toBe('ch1');
  expect(
    (
      await call(`/changesets/${changeset.id}/apply`, {
        draftVersion: 2,
        chapterId: 'ch1',
        strategy: 'mark_only',
      })
    ).status,
  ).toBe(200);
  expect((await chapter()).chapter.draftVersion).toBe(mainBefore.chapter.draftVersion);
  expect((await chapter()).segments).toEqual(mainBefore.segments);
  const history = await (await call('/commits')).json();
  expect(history[0].chapterId).toBe('ch1');
  expect(other.chapter.draftVersion).toBe(1);
});

it('uses the same live character count in manuscript tree and reports', async () => {
  const doc = await chapter();
  const count = doc.segments.reduce((sum, s) => sum + s.text.replace(/\s/g, '').length, 0);
  expect(doc.chapter.wordCount).toBe(count);
  const report = await (await call('/reports/overview')).json();
  expect(report.chapterStats[6].words).toBe(count);
});

it('merges nonconflicting branch Bible edits along with manuscript changes', async () => {
  const before: Bible = await (await call('/bible/all')).json();
  const change: ChangeSet = await (
    await call('/changesets/preview', {
      origin: 'human_bible',
      targetType: 'characters',
      targetId: 'char-lu',
      new: { ...before.characters[1], description: '关系线中的独立人物描述' },
      reason: '试写',
      draftVersion: 3,
      branchId: 'romance-b',
    })
  ).json();
  await call(`/changesets/${change.id}/apply`, {
    draftVersion: 3,
    strategy: 'mark_only',
    branchId: 'romance-b',
  });
  expect((await (await call('/bible/all')).json()).characters[1].description).toBe(
    before.characters[1].description,
  );
  await call('/branches/romance-b/merge', { draftVersion: 3, resolutions: {} });
  expect((await (await call('/bible/all')).json()).characters[1].description).toBe(
    '关系线中的独立人物描述',
  );
});

it('requires a Bible conflict choice when both branches change the same character', async () => {
  const original: Bible = await (await call('/bible/all')).json();
  for (const branchId of ['main', 'romance-b']) {
    const change: ChangeSet = await (
      await call('/changesets/preview', {
        origin: 'human_bible',
        targetType: 'characters',
        targetId: 'char-lu',
        new: { ...original.characters[1], description: `${branchId} 的人物改动` },
        reason: '试写',
        draftVersion: 3,
        branchId,
      })
    ).json();
    await call(`/changesets/${change.id}/apply`, {
      draftVersion: 3,
      strategy: 'mark_only',
      branchId,
    });
  }
  const preview = await (await call('/branches/romance-b/merge')).json();
  const conflict = preview.conflicts.find((c: { field: string }) => c.field.startsWith('bible.'));
  expect(conflict).toBeDefined();
  expect(
    (await call('/branches/romance-b/merge', { draftVersion: 4, resolutions: {} })).status,
  ).toBe(409);
  await call('/branches/romance-b/merge', {
    draftVersion: 4,
    resolutions: { [conflict.id]: 'manuscript' },
  });
  expect((await (await call('/bible/all')).json()).characters[1].description).toBe(
    'romance-b 的人物改动',
  );
});

it('generates preparation suggestions as previews before explicit project application', async () => {
  const before = await (await call('/projects/project-zhuoliu')).json();
  const response = await call('/projects/project-zhuoliu/suggestions', {
    kind: 'project',
    draftVersion: 3,
    chapterId: 'ch7',
  });
  expect(response.status).toBe(200);
  const change: ChangeSet = await response.json();
  expect(change.status).toBe('preview');
  expect(await (await call('/projects/project-zhuoliu')).json()).toEqual(before);
  await call(`/changesets/${change.id}/apply`, { draftVersion: 3, strategy: 'mark_only' });
  expect((await (await call('/projects/project-zhuoliu')).json()).logline).not.toBe(before.logline);
});

it('honors an explicit three-round budget and rejects unsupported limits', async () => {
  expect((await call('/runs', { chapterId: 'ch7', maxRounds: 4 })).status).toBe(422);
  const run: RunState = await (await call('/runs', { chapterId: 'ch7', maxRounds: 3 })).json();
  expect(run.maxRounds).toBe(3);
  await call(`/runs/${run.id}/actions`, { action: 'fast_forward', draftVersion: 3 });
  const finalRun: RunState = await (await call(`/runs/${run.id}`)).json();
  expect(finalRun.reviseRound).toBe(3);
  expect(finalRun.status).toBe('escalated');
  expect(await (await call(`/runs/${run.id}/events`)).text()).toContain('3/3');
});

it('calculates foreshadow completion from the selected branch and excludes abandoned threads', async () => {
  const initial = await (await call('/reports/overview')).json();
  expect(initial.foreshadowRate).toBe(0.25);
  const alternate: Bible = await (await call('/bible/all?branchId=romance-b')).json();
  const statuses = ['closed', 'abandoned', 'closed', 'abandoned'] as const;
  await call('/imports', {
    kind: 'bible',
    text: JSON.stringify({
      foreshadows: alternate.foreshadows.map((f, i) => ({ ...f, status: statuses[i] })),
    }),
    draftVersion: 3,
    branchId: 'romance-b',
  });
  expect((await (await call('/reports/overview?branchId=romance-b')).json()).foreshadowRate).toBe(
    1,
  );
  expect((await (await call('/reports/overview')).json()).foreshadowRate).toBe(0.25);
});

it('updates sentence distributions and segment style statistics after a branch edit', async () => {
  const main = await (await call('/reports/overview')).json();
  const before = await (await call('/reports/overview?branchId=romance-b')).json();
  const doc = await chapter('romance-b');
  const priorSentenceCount = doc.segments[0].styleStats.sentenceLengths.length;
  await call(
    '/segments/ch7-s1',
    { text: '雨停了。“回去吧。”', draftVersion: 3, branchId: 'romance-b' },
    'PATCH',
  );
  const after = await (await call('/reports/overview?branchId=romance-b')).json();
  const edited = await chapter('romance-b');
  expect(edited.segments[0].styleStats.sentenceLengths).toEqual([3, 3]);
  expect(edited.segments[0].styleStats.dialogueRatio).toBe(0.5);
  const total = (data: { sentenceDistribution: { count: number }[] }) =>
    data.sentenceDistribution.reduce((sum, b) => sum + b.count, 0);
  expect(total(after) - total(before)).toBe(2 - priorSentenceCount);
  expect(await (await call('/reports/overview')).json()).toEqual(main);
});

it('starts all four independent critics before any critic finishes', async () => {
  const run: RunState = await (await call('/runs', { chapterId: 'ch7' })).json();
  await call(`/runs/${run.id}/actions`, { action: 'fast_forward', draftVersion: 3 });
  const streamed = await (await call(`/runs/${run.id}/events`)).text();
  const events = streamed
    .split('\n\n')
    .filter((s) => s.includes('data:'))
    .map((s) => JSON.parse(s.split('data: ')[1]));
  const criticNodes = ['hard_consistency', 'style', 'ai_taste', 'reader'];
  const critics = events.filter(
    (e) => criticNodes.includes(e.data.node) && ['node.started', 'node.finished'].includes(e.type),
  );
  expect(critics.slice(0, 4).map((e) => e.type)).toEqual([
    'node.started',
    'node.started',
    'node.started',
    'node.started',
  ]);
  expect(
    critics[3].data.run.nodes.filter((n: { status: string }) => n.status === 'running').length,
  ).toBe(4);
});

it('streams delayed changeset propagation phases without revalidating the old review or rewriting prose', async () => {
  const before = await chapter();
  const bible: Bible = await (await call('/bible/all')).json();
  const preview: ChangeSet = await (
    await call('/changesets/preview', {
      origin: 'human_bible',
      targetType: 'characters',
      targetId: 'char-lu',
      new: { ...bible.characters[1], description: '一个新的角色动机' },
      reason: '调整角色',
      draftVersion: 3,
    })
  ).json();
  await call(`/changesets/${preview.id}/apply`, { draftVersion: 3, strategy: 'propagate' });
  const applied = await chapter();
  expect(applied.run.id).not.toBe(before.run.id);
  expect(applied.run.status).toBe('running');
  expect(applied.run.draftVersion).toBe(3);
  const response = await call(`/runs/${applied.run.id}/events`);
  const stream = await response.text();
  const events = stream
    .split('\n\n')
    .filter((s) => s.includes('data:'))
    .map((s) => JSON.parse(s.split('data: ')[1]));
  const phases = events.filter((e) => e.type === 'index.updating');
  expect(phases.map((e) => e.data.phase)).toEqual(['checking', 'indexing', 'summarizing', 'ready']);
  expect(phases[3].data.message).toContain(String(preview.blastRadius.length));
  expect(phases[3].data.message).toContain('待裁决');
  expect((await chapter()).segments.map((s) => s.text)).toEqual(before.segments.map((s) => s.text));
  expect(
    (await call(`/runs/${applied.run.id}/actions`, { action: 'approve', draftVersion: 4 })).status,
  ).toBe(409);
  const replay = await fetch(`http://localhost/api/runs/${applied.run.id}/events`, {
    headers: { 'Last-Event-ID': phases[1].id },
  });
  const replayText = await replay.text();
  expect(replayText).not.toContain('"phase":"checking"');
  expect(replayText).toContain('"phase":"ready"');
});

it('stops propagation when a later author edit supersedes its input', async () => {
  const bible: Bible = await (await call('/bible/all')).json();
  const preview: ChangeSet = await (
    await call('/changesets/preview', {
      origin: 'human_bible',
      targetType: 'characters',
      targetId: 'char-lu',
      new: { ...bible.characters[1], want: '新的目标' },
      reason: '调整动机',
      draftVersion: 3,
    })
  ).json();
  await call(`/changesets/${preview.id}/apply`, { draftVersion: 3, strategy: 'propagate' });
  const run = (await chapter()).run;
  await call(
    '/segments/ch7-s1',
    { text: '作者在传播期间保存的最后版本。', draftVersion: 4 },
    'PATCH',
  );
  const stream = await (await call(`/runs/${run.id}/events`)).text();
  expect(stream).toContain('event: version.stale');
  expect(stream).not.toContain('"phase":"ready"');
  expect((await chapter()).segments[0].text).toBe('作者在传播期间保存的最后版本。');
});

it('bumps every merged chapter and rejects its pre-merge saves patches and reviews', async () => {
  const branch = await (await call('/branches', { name: '跨章修改', fromBranchId: 'main' })).json();
  const before: ChapterDocument = await (await call('/chapters/ch8')).json();
  const comment = await (
    await call('/comments', {
      segmentId: 'ch8-s1',
      quote: before.segments[0].text,
      text: '增加停顿',
      draftVersion: 1,
    })
  ).json();
  await call(
    '/segments/ch8-s1',
    { text: '第八章分支的新正文。', draftVersion: 1, branchId: branch.id },
    'PATCH',
  );
  await call(`/branches/${branch.id}/merge`);
  expect(
    (
      await call(`/branches/${branch.id}/merge`, {
        draftVersion: 3,
        chapterId: 'ch7',
        resolutions: {},
      })
    ).status,
  ).toBe(200);
  const after: ChapterDocument = await (await call('/chapters/ch8')).json();
  expect(after.chapter.draftVersion).toBe(2);
  expect(after.segments[0].text).toBe('第八章分支的新正文。');
  expect(after.run.draftVersion).toBe(1);
  expect(
    (await call('/segments/ch8-s1', { text: '过期窗口覆盖', draftVersion: 1 }, 'PATCH')).status,
  ).toBe(409);
  expect(
    (
      await call(`/patches/${comment.patch.id}/apply`, {
        draftVersion: 2,
        acceptedSentenceIds: [comment.patch.sentences[0].id],
      })
    ).status,
  ).toBe(409);
  expect(
    (await call(`/runs/${after.run.id}/actions`, { action: 'approve', draftVersion: 2 })).status,
  ).toBe(409);
  expect((await chapter()).chapter.draftVersion).toBe(3);
});

it('rejects a merge when another target chapter changed since its preview', async () => {
  const branch = await (await call('/branches', { name: '跨章预览', fromBranchId: 'main' })).json();
  await call(
    '/segments/ch8-s1',
    { text: '分支第八章', draftVersion: 1, branchId: branch.id },
    'PATCH',
  );
  await call(`/branches/${branch.id}/merge`);
  await call('/segments/ch8-s2', { text: '主线在预览后的新句子', draftVersion: 1 }, 'PATCH');
  const response = await call(`/branches/${branch.id}/merge`, {
    draftVersion: 3,
    chapterId: 'ch7',
    resolutions: {},
  });
  expect(response.status).toBe(409);
  expect((await response.json()).code).toBe('version_mismatch');
  const after: ChapterDocument = await (await call('/chapters/ch8')).json();
  expect(after.segments[0].text).not.toBe('分支第八章');
  expect(after.segments[1].text).toBe('主线在预览后的新句子');
  await call(`/branches/${branch.id}/merge`);
  expect(
    (
      await call(`/branches/${branch.id}/merge`, {
        draftVersion: 3,
        chapterId: 'ch7',
        resolutions: {},
      })
    ).status,
  ).toBe(200);
  expect((await (await call('/chapters/ch8')).json()).chapter.draftVersion).toBe(3);
});

it('merges a branch manuscript import including replacement segment IDs', async () => {
  const branch = await (await call('/branches', { name: '导入试写', fromBranchId: 'main' })).json();
  await call('/imports', {
    kind: 'manuscript',
    text: '分支导入的第一段。\n\n分支导入的第二段。',
    draftVersion: 3,
    branchId: branch.id,
    chapterId: 'ch7',
  });
  const branchDoc = await chapter(branch.id);
  await call(`/branches/${branch.id}/merge`);
  const response = await call(`/branches/${branch.id}/merge`, { draftVersion: 3, resolutions: {} });
  expect(response.status).toBe(200);
  const merged = await chapter();
  expect(merged.segments.map((s) => s.text)).toEqual(['分支导入的第一段。', '分支导入的第二段。']);
  expect(merged.segments.map((s) => s.id)).toEqual(branchDoc.segments.map((s) => s.id));
  expect(merged.chapter.draftVersion).toBe(4);
});

it('requires a whole-chapter choice when imported structure and main prose both diverge', async () => {
  const branch = await (await call('/branches', { name: '导入冲突', fromBranchId: 'main' })).json();
  await call('/imports', {
    kind: 'manuscript',
    text: '重排后的分支手稿。',
    draftVersion: 3,
    branchId: branch.id,
    chapterId: 'ch7',
  });
  await call('/segments/ch7-s1', { text: '主线的新开头。', draftVersion: 3 }, 'PATCH');
  const preview = await (await call(`/branches/${branch.id}/merge`)).json();
  expect(preview.conflicts).toHaveLength(1);
  expect(preview.conflicts[0].field).toBe('chapter.structure');
  expect(
    (await call(`/branches/${branch.id}/merge`, { draftVersion: 4, resolutions: {} })).status,
  ).toBe(409);
  expect((await chapter()).segments).toHaveLength(6);
  await call(`/branches/${branch.id}/merge`, {
    draftVersion: 4,
    resolutions: { [preview.conflicts[0].id]: 'manuscript' },
  });
  expect((await chapter()).segments.map((s) => s.text)).toEqual(['重排后的分支手稿。']);
});

it('uses the callers captured merge maps even after another viewer refreshes the preview', async () => {
  const branch = await (
    await call('/branches', { name: '双窗口合并', fromBranchId: 'main' })
  ).json();
  await call(
    '/segments/ch8-s1',
    { text: '分支修改', draftVersion: 1, branchId: branch.id },
    'PATCH',
  );
  const first = await (await call(`/branches/${branch.id}/merge`)).json();
  await call('/segments/ch8-s2', { text: '另一窗口修改', draftVersion: 1 }, 'PATCH');
  await call(`/branches/${branch.id}/merge`);
  const response = await call(`/branches/${branch.id}/merge`, {
    draftVersion: 3,
    chapterId: 'ch7',
    resolutions: {},
    targetVersions: first.targetVersions,
    sourceVersions: first.sourceVersions,
  });
  expect(response.status).toBe(409);
  expect((await response.json()).code).toBe('version_mismatch');
  expect((await (await call('/chapters/ch8')).json()).segments[0].text).not.toBe('分支修改');
});

it('rejects old merge decisions if the source branch changed after preview', async () => {
  const branch = await (await call('/branches', { name: '来源更新', fromBranchId: 'main' })).json();
  await call(
    '/segments/ch8-s1',
    { text: '分支第一版', draftVersion: 1, branchId: branch.id },
    'PATCH',
  );
  const preview = await (await call(`/branches/${branch.id}/merge`)).json();
  await call(
    '/segments/ch8-s1',
    { text: '分支第二版', draftVersion: 2, branchId: branch.id },
    'PATCH',
  );
  const response = await call(`/branches/${branch.id}/merge`, {
    draftVersion: 3,
    resolutions: {},
    targetVersions: preview.targetVersions,
    sourceVersions: preview.sourceVersions,
  });
  expect(response.status).toBe(409);
  expect((await response.json()).code).toBe('version_mismatch');
});
