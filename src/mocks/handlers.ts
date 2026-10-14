import { sentenceDistribution } from './data/statistics';
import { http, HttpResponse } from 'msw';
import type {
  ApplyPatchInput,
  Bible,
  BibleKind,
  ChangeSet,
  ChapterDocument,
  Comment,
  Conflict,
  ConflictChoice,
  Finding,
  MergePreview,
  PreviewChangeInput,
  RunActionInput,
  RunState,
} from '../types/domain';
import {
  db,
  branch,
  document,
  findDoc,
  check,
  fail,
  ApiFailure,
  uid,
  refresh,
  bump,
  makePatch,
  addCommit,
  allConflicts,
  persist,
  resetDB as resetData,
} from './data/db';
import {
  experiments,
  regression,
  now,
  findings as seedFindings,
  bible as seedBible,
  preparationSuggestions,
} from './data/seed';
import {
  cancel,
  clearRuns,
  context,
  emit,
  eventResponse,
  fastForward,
  pause,
  resume,
  scheduleReview,
  schedulePropagation,
} from './runs';
export { enablePersistence } from './data/db';
export function resetDB() {
  mergeSnapshots.clear();
  clearRuns();
  resetData();
}
type Body = { draftVersion?: number; branchId?: string; [key: string]: unknown };
const json = HttpResponse.json;
const bid = (request: Request, body?: Body) =>
  body?.branchId ?? new URL(request.url).searchParams.get('branchId') ?? 'main';
const parse = async <T = Body>(request: Request): Promise<T> => {
  try {
    return (await request.json()) as T;
  } catch {
    return {} as T;
  }
};
function route(
  fn: (request: Request, params: Record<string, string | readonly string[] | undefined>) => unknown,
) {
  return async ({
    request,
    params,
  }: {
    request: Request;
    params: Record<string, string | readonly string[] | undefined>;
  }) => {
    try {
      const result = await fn(request, params);
      persist();
      return result instanceof Response ? result : json(result as never);
    } catch (error) {
      if (error instanceof ApiFailure)
        return json(
          { code: error.code, message: error.message, currentVersion: error.currentVersion },
          { status: error.status },
        );
      console.error('Mock API failure', error);
      return json(
        { code: 'mock_error', message: error instanceof Error ? error.message : '未知错误' },
        { status: 500 },
      );
    }
  };
}
function targetValue(bible: Bible, kind: string, id: string): unknown {
  if (kind === 'style') return bible.style;
  const values = bible[kind as BibleKind];
  return Array.isArray(values) ? values.find((v) => v.id === id) : undefined;
}
function setBible(bible: Bible, kind: string, id: string, value: unknown) {
  if (kind === 'style') {
    bible.style = value as Bible['style'];
    return;
  }
  const collection = bible[kind as BibleKind];
  if (!Array.isArray(collection)) fail(422, 'invalid_kind', '不支持的设定类型');
  const values = collection as { id: string }[];
  const index = values.findIndex((v) => v.id === id);
  if (typeof value !== 'object' || !value) fail(422, 'invalid_value', '设定必须是对象');
  if (index < 0) values.push({ ...value, id });
  else values[index] = { ...values[index], ...value, id };
}
function preview(input: PreviewChangeInput): ChangeSet {
  if (input.targetType === 'foreshadow') input.targetType = 'foreshadows';
  const branchId = input.branchId ?? 'main';
  const data = branch(branchId);
  const inferredChapter =
    input.targetType === 'segment'
      ? findDoc('segments', input.targetId, branchId).chapter.id
      : data.documents[input.targetId]
        ? input.targetId
        : undefined;
  const doc = document(input.chapterId ?? inferredChapter ?? 'ch7', branchId);
  check(doc, input.draftVersion);
  const segment =
    input.targetType === 'segment'
      ? findDoc('segments', input.targetId, branchId).segments.find((s) => s.id === input.targetId)
      : undefined;
  const outlineTarget = ['outline', 'chapter', 'chapters', 'beat', 'beats'].includes(
    input.targetType,
  );
  const old =
    input.targetType === 'project'
      ? db.project
      : outlineTarget
        ? input.targetType.startsWith('beat')
          ? Object.values(data.documents)
              .flatMap((d) => d.chapter.scenes.flatMap((s) => s.beats))
              .find((b) => b.id === input.targetId)
          : data.documents[input.targetId]?.chapter
        : (segment?.text ?? targetValue(data.bible, input.targetType, input.targetId));
  const related = Object.values(data.documents).flatMap((d) =>
    d.segments
      .filter(
        (s) =>
          (outlineTarget && (s.chapterId === input.targetId || s.beatId === input.targetId)) ||
          input.targetType === 'style' ||
          (input.targetType === 'characters' && s.charactersPresent.includes(input.targetId)) ||
          (input.targetType === 'foreshadows' && s.foreshadowIds.includes(input.targetId)) ||
          s.id === input.targetId,
      )
      .map((s) => ({
        id: uid('affected'),
        level: (s.id === input.targetId
          ? 'rewrite'
          : input.targetType === 'foreshadows'
            ? 'orphan_foreshadow'
            : 'review') as 'rewrite' | 'review' | 'orphan_foreshadow',
        chapterId: d.chapter.id,
        sceneId: s.sceneId,
        segmentId: s.id,
        label: `第${d.chapter.number}章 · ${d.chapter.title} · 第${s.order + 1}段`,
        reason:
          input.targetType === 'characters'
            ? '人物硬设定变化，需要复核动作与声音'
            : input.targetType === 'foreshadows'
              ? '伏笔链改变，需要检查铺垫与回收'
              : '关联文本需要重新审阅',
        status: 'pending' as const,
      })),
  );
  const change: ChangeSet = {
    id: uid('changeset'),
    chapterId: doc.chapter.id,
    origin: input.origin,
    targetType: input.targetType,
    targetId: input.targetId,
    old: structuredClone(old ?? null),
    new: structuredClone(input.new),
    reason: input.reason,
    blastRadius: related,
    conflicts: allConflicts(branchId).filter(
      (c) =>
        c.status === 'open' && (c.field.includes(input.targetId) || c.segmentId === input.targetId),
    ),
    parentCommit: db.branches.find((b) => b.id === branchId)!.headCommit,
    draftVersion: doc.chapter.draftVersion,
    status: 'preview',
    createdAt: now(),
  };
  data.changesets.push(change);
  return change;
}
function reconcile(doc: ChapterDocument) {
  for (const c of doc.conflicts) {
    const segment = doc.segments.find((s) => s.id === c.segmentId);
    if (c.status === 'open' && segment && !segment.text.includes(c.manuscriptSays)) {
      c.status = 'resolved';
      c.resolution = 'bible';
      c.reason = '正文已接受与设定一致的修改。';
    }
  }
  refresh(doc);
}
function bibleEntries(value: Bible) {
  return (Object.keys(value) as BibleKind[]).flatMap((kind) => {
    const items = value[kind];
    return (Array.isArray(items) ? items : [items]).map((item) => ({
      kind,
      id: item.id,
      value: item,
    }));
  });
}
type MergeSnapshot = {
  targetVersions: Record<string, number>;
  sourceVersions: Record<string, number>;
};
const mergeSnapshots = new Map<string, MergeSnapshot>();
const mergeVersions = (branchId: string) =>
  Object.fromEntries(
    Object.entries(branch(branchId).documents).map(([id, doc]) => [id, doc.chapter.draftVersion]),
  );
const chapterContent = (doc: ChapterDocument) =>
  JSON.stringify({
    segments: doc.segments.map((s) => ({ id: s.id, order: s.order, text: s.text })),
    scenes: doc.chapter.scenes,
    title: doc.chapter.title,
    pov: doc.chapter.pov,
  });
const chapterStructure = (doc: ChapterDocument) =>
  JSON.stringify({
    segments: doc.segments.map((s) => ({ id: s.id, order: s.order })),
    scenes: doc.chapter.scenes,
    title: doc.chapter.title,
    pov: doc.chapter.pov,
  });
const structuralMerge = (source: ChapterDocument, target: ChapterDocument, base: ChapterDocument) =>
  chapterStructure(source) !== chapterStructure(base) ||
  chapterStructure(target) !== chapterStructure(base);
function checkMergeVersions(sourceId: string, body: Body) {
  const cached = mergeSnapshots.get(sourceId);
  const targetVersions = body.targetVersions ?? cached?.targetVersions;
  const sourceVersions = body.sourceVersions ?? cached?.sourceVersions;
  for (const [id, expected] of [
    ['main', targetVersions],
    [sourceId, sourceVersions],
  ] as const) {
    if (expected === undefined) continue;
    if (!expected || typeof expected !== 'object' || Array.isArray(expected))
      fail(422, 'invalid_version_map', '合并版本快照格式不正确');
    const actual = mergeVersions(id);
    const versions = expected as Record<string, unknown>;
    if (
      Object.keys(actual).length !== Object.keys(versions).length ||
      Object.entries(actual).some(([chapterId, version]) => versions[chapterId] !== version)
    )
      throw new ApiFailure(
        409,
        'version_mismatch',
        '合并预览后主线或来源分支已改变，请重新预览并裁决。',
      );
  }
}
function mergePreview(branchId: string): MergePreview {
  const source = branch(branchId);
  const target = branch('main');
  const conflicts: Conflict[] = [];
  for (const [chapterId, doc] of Object.entries(source.documents)) {
    const mainDoc = target.documents[chapterId];
    const baseDoc = source.baseDocuments[chapterId];
    if (chapterContent(doc) === chapterContent(baseDoc)) continue;
    if (structuralMerge(doc, mainDoc, baseDoc)) {
      if (
        chapterContent(mainDoc) !== chapterContent(baseDoc) &&
        chapterContent(mainDoc) !== chapterContent(doc)
      )
        conflicts.push({
          id: `merge-chapter-${chapterId}`,
          title: `${doc.chapter.title} · 章节结构与正文同时修改`,
          field: 'chapter.structure',
          bibleSays: mainDoc.segments.map((s) => s.text).join('\n\n'),
          manuscriptSays: doc.segments.map((s) => s.text).join('\n\n'),
          witnessRefs: [chapterId],
          options: ['manuscript', 'bible'],
          isDialogueLie: false,
          status: 'open',
          segmentId: mainDoc.segments[0]?.id ?? '',
          branchId,
        });
      continue;
    }
    for (const segment of doc.segments) {
      const main = mainDoc.segments.find((s) => s.id === segment.id)!;
      const base = baseDoc.segments.find((s) => s.id === segment.id)!;
      if (segment.text !== base.text && main.text !== base.text && segment.text !== main.text)
        conflicts.push({
          id: `merge-${segment.id}`,
          title: `${doc.chapter.title} · 第${segment.order + 1}段存在双向修改`,
          field: 'segment.text',
          bibleSays: main.text,
          manuscriptSays: segment.text,
          witnessRefs: [segment.id],
          options: ['manuscript', 'bible'],
          isDialogueLie: false,
          status: 'open',
          segmentId: segment.id,
          branchId,
        });
    }
  }
  for (const item of bibleEntries(source.bible)) {
    const base = targetValue(source.baseBible ?? seedBible, item.kind, item.id);
    const current = targetValue(target.bible, item.kind, item.id);
    const different = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b);
    if (different(item.value, base) && different(current, base) && different(item.value, current))
      conflicts.push({
        id: `merge-bible-${item.kind}-${item.id}`,
        title: `设定 ${item.id} 存在双向修改`,
        field: `bible.${item.kind}.${item.id}`,
        bibleSays: JSON.stringify(current, null, 2),
        manuscriptSays: JSON.stringify(item.value, null, 2),
        witnessRefs: [item.id],
        options: ['manuscript', 'bible'],
        isDialogueLie: false,
        status: 'open',
        segmentId: '',
        branchId,
      });
  }
  return {
    branchId,
    targetBranchId: 'main',
    targetVersions: mergeVersions('main'),
    sourceVersions: mergeVersions(branchId),
    conflicts,
    commits: db.commits.filter((c) => c.branchId === branchId),
    canMerge: conflicts.length === 0,
  };
}
function getRun(id: string): RunState {
  return db.runs[id] ?? fail(404, 'run_not_found', '执行记录不存在');
}
export const handlers = [
  http.get(
    '*/api/projects/:id',
    route(() => db.project),
  ),
  http.patch(
    '*/api/projects/:id',
    route(async (request) => {
      const body = await parse(request);
      Object.assign(db.project, body);
      return db.project;
    }),
  ),
  http.post(
    '*/api/projects/:id/suggestions',
    route(async (request) => {
      const body = await parse(request);
      const branchId = bid(request, body);
      const data = branch(branchId);
      const kind = String(body.kind ?? 'project');
      const targetId =
        kind === 'project'
          ? db.project.id
          : kind === 'characters'
            ? 'char-lu'
            : kind === 'rules'
              ? 'rule-sound'
              : data.bible.style.id;
      if (!['project', 'characters', 'rules', 'style'].includes(kind))
        fail(422, 'invalid_kind', '请选择创作方向、角色、规则或风格建议');
      const old =
        kind === 'project'
          ? db.project
          : kind === 'characters'
            ? data.bible.characters.find((c) => c.id === targetId)
            : kind === 'style'
              ? data.bible.style
              : { id: targetId };
      return preview({
        origin: 'agent',
        targetType: kind,
        targetId,
        new: { ...old, ...preparationSuggestions[kind as keyof typeof preparationSuggestions] },
        reason: 'AI 生成创作准备候选；需作者审阅后应用',
        draftVersion: Number(body.draftVersion),
        chapterId: String(body.chapterId ?? 'ch7'),
        branchId,
      });
    }),
  ),
  http.get(
    '*/api/projects/:id/tree',
    route((request) => Object.values(branch(bid(request)).documents).map((d) => d.chapter)),
  ),
  http.get(
    '*/api/chapters/:id',
    route((request, params) => {
      const doc = document(String(params.id), bid(request));
      const version = new URL(request.url).searchParams.get('version');
      if (version && Number(version) !== doc.chapter.draftVersion) {
        const commit = db.commits.find(
          (c) =>
            c.branchId === bid(request) &&
            (c.chapterId ?? 'ch7') === params.id &&
            c.draftVersion === Number(version),
        );
        if (!commit) fail(404, 'version_not_found', '历史版本不存在');
        return db.snapshots[commit.id]?.documents[String(params.id)] ?? doc;
      }
      refresh(doc, branch(bid(request)).bible.style);
      return doc;
    }),
  ),
  http.patch(
    '*/api/segments/:id',
    route(async (request, params) => {
      const body = await parse(request);
      const branchId = bid(request, body);
      const doc = findDoc('segments', String(params.id), branchId);
      check(doc, body.draftVersion);
      if (typeof body.text !== 'string' || !body.text.trim())
        fail(422, 'empty_text', '正文不能为空');
      const segment = doc.segments.find((s) => s.id === params.id)!;
      const change = preview({
        origin: 'human_inline',
        chapterId: doc.chapter.id,
        targetType: 'segment',
        targetId: segment.id,
        new: body.text,
        reason: '作者手动编辑正文；世界设定等待单独审批',
        draftVersion: doc.chapter.draftVersion,
        branchId,
      });
      segment.text = body.text;
      segment.isDialogueLie = Boolean(body.isDialogueLie);
      bump(doc);
      reconcile(doc);
      change.draftVersion = doc.chapter.draftVersion;
      addCommit(branchId, doc, '作者保存正文', String(change.old));
      return { draftVersion: doc.chapter.draftVersion, changeset: change };
    }),
  ),
  http.get(
    '*/api/bible/:kind',
    route((request, params) =>
      params.kind === 'all'
        ? branch(bid(request)).bible
        : (branch(bid(request)).bible[params.kind as BibleKind] ??
          fail(404, 'not_found', '设定资源不存在')),
    ),
  ),
  ...(['post', 'patch'] as const).flatMap((method) =>
    ['*/api/bible/:kind', '*/api/bible/:kind/:id'].map((path) =>
      http[method](
        path,
        route(async (request, params) => {
          const body = await parse(request);
          const kind = String(params.kind);
          const id = String(params.id ?? body.targetId ?? body.id ?? uid(kind));
          const clean = Object.fromEntries(
            Object.entries(body).filter(
              ([k]) => !['draftVersion', 'branchId', 'chapterId', 'reason'].includes(k),
            ),
          );
          return preview({
            origin: 'human_bible',
            chapterId: String(body.chapterId ?? 'ch7'),
            targetType: kind,
            targetId: id,
            new: body.new ?? clean,
            reason: String(body.reason ?? '编辑创作设定'),
            draftVersion: Number(body.draftVersion),
            branchId: bid(request, body),
          });
        }),
      ),
    ),
  ),
  http.get(
    '*/api/changesets',
    route((request) => branch(bid(request)).changesets),
  ),
  http.post(
    '*/api/changesets/preview',
    route(async (request) => preview(await parse<PreviewChangeInput>(request))),
  ),
  http.post(
    '*/api/changesets/:id/apply',
    route(async (request, params) => {
      const body = await parse(request);
      const branchId = bid(request, body);
      const data = branch(branchId);
      const change =
        data.changesets.find((c) => c.id === params.id) ?? fail(404, 'not_found', '变更不存在');
      const doc = document(change.chapterId ?? String(body.chapterId ?? 'ch7'), branchId);
      check(doc, body.draftVersion);
      if (change.draftVersion !== doc.chapter.draftVersion)
        throw new ApiFailure(
          409,
          'version_mismatch',
          '变更预览基于旧版本，请重新预览。',
          doc.chapter.draftVersion,
        );
      if (change.status !== 'preview') fail(409, 'already_applied', '这项变更已处理');
      if (!['mark_only', 'propagate'].includes(String(body.strategy)))
        fail(422, 'strategy_required', '请选择标记复核或传播修订');
      change.strategy = body.strategy as ChangeSet['strategy'];
      if (change.targetType === 'segment') {
        const target = findDoc('segments', change.targetId, branchId).segments.find(
          (s) => s.id === change.targetId,
        )!;
        target.text = String(change.new);
      } else if (['outline', 'chapter', 'chapters', 'beat', 'beats'].includes(change.targetType)) {
        const value = change.new as Record<string, unknown>;
        if (change.targetType.startsWith('beat')) {
          const beat =
            Object.values(data.documents)
              .flatMap((d) => d.chapter.scenes.flatMap((s) => s.beats))
              .find((b) => b.id === change.targetId) ?? fail(404, 'beat_not_found', '节拍不存在');
          Object.assign(beat, value);
        } else {
          const target = data.documents[change.targetId] ?? doc;
          if (typeof value.description === 'string')
            target.chapter.scenes[0].beats[0].description = value.description;
          if (typeof value.title === 'string') target.chapter.title = value.title;
          if (Array.isArray(value.scenes)) target.chapter.scenes = value.scenes;
        }
      } else if (change.targetType === 'project') {
        Object.assign(db.project, change.new);
      } else setBible(data.bible, change.targetType, change.targetId, change.new);
      change.status = 'applied';
      bump(doc);
      for (const affected of change.blastRadius) {
        const affectedDoc = data.documents[affected.chapterId];
        if (affectedDoc.chapter.status === 'finalized') affectedDoc.chapter.status = 'in_review';
        if (body.strategy === 'propagate') {
          const finding = affectedDoc.findings.find(
            (f) => f.segmentId === affected.segmentId && f.status === 'open',
          );
          if (finding) makePatch(affectedDoc, finding);
        }
      }
      addCommit(branchId, doc, `设定变更 · ${change.reason}`);
      schedulePropagation(doc, change);
      return change;
    }),
  ),
  http.get(
    '*/api/conflicts',
    route((request) => allConflicts(bid(request))),
  ),
  http.post(
    '*/api/conflicts/:id/resolve',
    route(async (request, params) => {
      const body = await parse(request);
      const branchId = bid(request, body);
      const doc = findDoc('conflicts', String(params.id), branchId);
      check(doc, body.draftVersion);
      const conflict = doc.conflicts.find((c) => c.id === params.id)!;
      const choice = String(body.choice) as ConflictChoice;
      if (!conflict.options.includes(choice))
        fail(422, 'invalid_choice', '请选择正文、设定或全局变更');
      const segment = doc.segments.find((s) => s.id === conflict.segmentId)!;
      conflict.status = 'resolved';
      conflict.resolution = choice;
      conflict.reason = String(body.reason ?? '作者已裁决');
      conflict.isDialogueLie = Boolean(body.isDialogueLie);
      if (conflict.isDialogueLie) {
        segment.isDialogueLie = true;
      } else if (choice === 'bible') {
        const f = doc.findings.find((f) => f.segmentId === segment.id && f.id === 'f-p1-hand');
        if (f) {
          segment.text = segment.text.replace(f.quote, f.replacement);
          f.status = 'resolved';
        }
      } else {
        const character = branch(branchId).bible.characters.find((c) => c.id === 'char-shen')!;
        character.hardTraits.惯用手 = '右手';
        character.hardTraits.旧伤 = '右腕旧伤已恢复，能够发力';
        if (choice === 'global')
          for (const related of Object.values(branch(branchId).documents))
            if (related.chapter.status === 'finalized') related.chapter.status = 'in_review';
      }
      if (!conflict.isDialogueLie)
        doc.findings
          .filter((f) => f.id === 'f-p1-hand')
          .forEach((f) => {
            f.status = 'resolved';
            f.quote = '已裁决：惯用手冲突';
          });
      bump(doc);
      addCommit(branchId, doc, `裁决 · ${conflict.title}`);
      return conflict;
    }),
  ),
  http.post(
    '*/api/comments',
    route(async (request) => {
      const body = await parse(request);
      const branchId = bid(request, body);
      const doc = findDoc('segments', String(body.segmentId), branchId);
      check(doc, body.draftVersion);
      if (!String(body.text ?? '').trim()) fail(422, 'instruction_required', '请输入批注指令');
      const segment = doc.segments.find((s) => s.id === body.segmentId)!;
      const quote = String(body.quote ?? segment.text);
      if (!segment.text.includes(quote)) fail(422, 'quote_not_found', '批注引用已不在当前正文');
      const comment: Comment = {
        id: uid('comment'),
        segmentId: segment.id,
        quote,
        text: String(body.text),
        createdAt: now(),
        status: 'open',
      };
      const finding: Finding = {
        id: uid('instruction'),
        critic: 'style',
        severity: 'P2',
        segmentId: segment.id,
        quote,
        evidenceRefs: [],
        reason: comment.text,
        suggestion: comment.text,
        repairScope: 'segment',
        draftVersion: doc.chapter.draftVersion,
        status: 'open',
        replacement: quote.includes('情绪')
          ? '铜扣在掌心压出一道白痕。他没有松手。'
          : quote.includes('冷笑')
            ? '陆青把目光移向河面，没有接话。'
            : `${quote.replace(/。$/, '')}。他停了停，把后半句话咽了回去。`,
      };
      doc.findings.push(finding);
      const patch = makePatch(doc, finding, 'human_instruction');
      comment.patchId = patch.id;
      (segment.comments ??= []).push(comment);
      refresh(doc);
      return { comment, patch };
    }),
  ),
  http.post(
    '*/api/findings/:id/suggest',
    route(async (request, params) => {
      const body = await parse(request);
      const doc = findDoc('findings', String(params.id), bid(request, body));
      check(doc, body.draftVersion);
      return makePatch(
        doc,
        doc.findings.find((f) => f.id === params.id)!,
      );
    }),
  ),
  http.post(
    '*/api/findings/:id/ignore',
    route(async (request, params) => {
      const body = await parse(request);
      const doc = findDoc('findings', String(params.id), bid(request, body));
      check(doc, body.draftVersion);
      if (!String(body.reason ?? '').trim()) fail(422, 'reason_required', '忽略问题必须填写原因');
      const f = doc.findings.find((f) => f.id === params.id)!;
      f.status = 'ignored';
      f.ignoreReason = String(body.reason);
      refresh(doc);
      return f;
    }),
  ),
  http.post(
    '*/api/patches/:id/apply',
    route(async (request, params) => {
      const body = await parse<ApplyPatchInput>(request);
      const branchId = body.branchId ?? 'main';
      const doc = findDoc('patches', String(params.id), branchId);
      check(doc, body.draftVersion);
      const patch = doc.patches.find((p) => p.id === params.id)!;
      if (patch.draftVersion !== doc.chapter.draftVersion)
        throw new ApiFailure(
          409,
          'version_mismatch',
          '候选基于旧版本，请重新生成。',
          doc.chapter.draftVersion,
        );
      if (patch.status !== 'pending') fail(409, 'patch_processed', '候选已被处理');
      if (
        !body.acceptedSentenceIds?.length ||
        body.acceptedSentenceIds.some((id) => !patch.sentences.some((s) => s.id === id))
      )
        fail(422, 'sentence_required', '请至少接受一个有效句子');
      const segment = doc.segments.find((s) => s.id === patch.segmentId)!;
      const old = doc.segments.map((s) => s.text).join('\n\n');
      for (const sentence of patch.sentences) {
        if (body.acceptedSentenceIds.includes(sentence.id)) {
          if (!segment.text.includes(sentence.oldText))
            fail(409, 'quote_changed', '原句已改变，请重新生成候选');
          segment.text = segment.text.replace(sentence.oldText, sentence.newText);
          sentence.status = 'accepted';
        } else sentence.status = 'rejected';
      }
      patch.status = 'applied';
      segment.comments
        ?.filter((c) => c.patchId === patch.id)
        .forEach((c) => {
          c.status = 'replied';
        });
      bump(doc);
      reconcile(doc);
      addCommit(branchId, doc, '接受修订候选', old);
      const f = doc.findings.find((f) => f.id === patch.findingId);
      scheduleReview(doc, f?.severity === 'P0' ? 'structural' : 'micro');
      return doc;
    }),
  ),
  http.post(
    '*/api/patches/:id/discard',
    route(async (request, params) => {
      const body = await parse(request);
      const doc = findDoc('patches', String(params.id), bid(request, body));
      check(doc, body.draftVersion);
      const patch = doc.patches.find((p) => p.id === params.id)!;
      patch.status = 'discarded';
      patch.sentences.forEach((s) => {
        s.status = 'rejected';
      });
      return patch;
    }),
  ),
  http.get(
    '*/api/runs/:id',
    route((_request, params) => getRun(String(params.id))),
  ),
  http.post(
    '*/api/runs',
    route(async (request) => {
      const body = await parse(request);
      const doc = document(String(body.chapterId ?? 'ch7'), bid(request, body));
      const maxRounds = body.maxRounds ?? 2;
      if (maxRounds !== 2 && maxRounds !== 3)
        fail(422, 'invalid_round_limit', '修订轮数必须为 2 或 3。');
      if (doc.run.status === 'running') cancel(doc.run);
      return scheduleReview(doc, 'full', true, maxRounds);
    }),
  ),
  http.get(
    '*/api/runs/:id/events',
    route((request, params) => eventResponse(request, getRun(String(params.id)))),
  ),
  http.get(
    '*/api/runs/:id/context-manifest',
    route((_request, params) => context(getRun(String(params.id)))),
  ),
  http.post(
    '*/api/runs/:id/actions',
    route(async (request, params) => {
      const body = await parse<RunActionInput>(request);
      const run = getRun(String(params.id));
      const doc = document(run.chapterId, run.branchId);
      check(doc, body.draftVersion);
      if (body.action === 'pause') pause(run);
      else if (body.action === 'resume') resume(run);
      else if (body.action === 'fast_forward') fastForward(run);
      else if (body.action === 'cancel') cancel(run);
      else if (body.action === 'approve') {
        if (run.draftVersion !== doc.chapter.draftVersion)
          throw new ApiFailure(
            409,
            'version_mismatch',
            '审阅结果已过期，请重新审阅当前正文。',
            doc.chapter.draftVersion,
          );
        refresh(doc);
        if (!doc.scores.canFinalize)
          fail(422, 'quality_gate_blocked', doc.scores.blockers.join('；'));
        run.status = 'completed';
        run.currentNode = 'commit';
        doc.chapter.status = 'finalized';
        emit(run, 'index.updating', {
          node: 'bible_update',
          phase: 'updating',
          message: '更新已批准事实与索引',
        });
        addCommit(run.branchId, doc, '作者批准 · 章节定稿');
        emit(run, 'index.updating', {
          node: 'bible_update',
          phase: 'ready',
          message: '索引更新完成',
        });
        emit(run, 'run.finished', { node: 'commit', message: '版本已提交' });
      } else if (['redirect', 'instruct', 'inline_edit'].includes(body.action)) {
        if (!body.instruction?.trim()) fail(422, 'instruction_required', '请输入作者指令');
        const finding =
          doc.findings.find((f) => f.id === body.findingId) ??
          doc.findings.find((f) => f.status === 'open');
        if (finding) {
          const patch = makePatch(doc, finding, 'human_instruction');
          patch.sentences.forEach((s) => {
            if (body.instruction?.includes('停顿'))
              s.newText = s.newText.replace(/。$/, '') + '。他停了一会儿。';
          });
        }
        scheduleReview(doc, body.scope === 'phrase' ? 'micro' : 'structural');
      } else fail(422, 'invalid_action', '不支持的执行动作');
      persist();
      return doc.run;
    }),
  ),
  http.get(
    '*/api/commits',
    route((request) =>
      db.commits
        .filter(
          (c) =>
            c.branchId === bid(request) &&
            (!new URL(request.url).searchParams.get('chapterId') ||
              (c.chapterId ?? 'ch7') === new URL(request.url).searchParams.get('chapterId')),
        )
        .slice()
        .reverse(),
    ),
  ),
  http.post(
    '*/api/commits/:id/restore',
    route(async (request, params) => {
      const body = await parse(request);
      const branchId = bid(request, body);
      const commit =
        db.commits.find((c) => c.id === params.id && c.branchId === branchId) ??
        fail(404, 'commit_not_found', '当前分支不存在该提交');
      const chapterId = commit.chapterId ?? 'ch7';
      if (body.chapterId && body.chapterId !== chapterId)
        fail(422, 'chapter_mismatch', '请在该提交所属章节中恢复版本。');
      const doc = document(chapterId, branchId);
      check(doc, body.draftVersion);
      const snap = db.snapshots[commit.id] ?? fail(404, 'snapshot_missing', '版本快照不存在');
      if (doc.run.status === 'running') cancel(doc.run);
      const restored = structuredClone(snap.documents[chapterId]);
      restored.chapter.draftVersion = doc.chapter.draftVersion;
      branch(branchId).documents[chapterId] = restored;
      bump(restored);
      restored.chapter.status = 'in_review';
      restored.run.branchId = branchId;
      restored.run.status = 'waiting_human';
      db.runs[restored.run.id] = restored.run;
      return addCommit(branchId, restored, `恢复到 ${commit.title}`);
    }),
  ),
  http.get(
    '*/api/branches',
    route(() => db.branches.filter((b) => b.status !== 'abandoned')),
  ),
  http.post(
    '*/api/branches',
    route(async (request) => {
      const body = await parse(request);
      if (!String(body.name ?? '').trim()) fail(422, 'name_required', '请输入分支名称');
      const from = String(body.fromBranchId ?? 'main');
      const source = branch(from);
      const id = uid('branch');
      const b = {
        id,
        name: String(body.name),
        headCommit: db.branches.find((b) => b.id === from)!.headCommit,
        description: `从 ${from} 创建的独立创作分支`,
        status: 'active' as const,
        createdAt: now(),
        isMain: false,
      };
      db.branches.push(b);
      db.data[id] = structuredClone(source);
      db.data[id].baseDocuments = structuredClone(source.documents);
      db.data[id].baseBible = structuredClone(source.bible);
      for (const doc of Object.values(db.data[id].documents)) {
        doc.run = { ...doc.run, id: uid('run'), branchId: id, status: 'waiting_human' };
        doc.conflicts.forEach((c) => {
          c.branchId = id;
        });
        db.runs[doc.run.id] = doc.run;
      }
      return b;
    }),
  ),
  http.delete(
    '*/api/branches/:id',
    route((_request, params) => {
      const b = db.branches.find((b) => b.id === params.id) ?? fail(404, 'not_found', '分支不存在');
      if (b.isMain) fail(422, 'main_protected', '主线不能被放弃');
      b.status = 'abandoned';
      for (const run of Object.values(db.runs).filter((r) => r.branchId === b.id)) cancel(run);
      return b;
    }),
  ),
  http.get(
    '*/api/branches/:id/merge',
    route((_request, params) => {
      const id = String(params.id);
      const result = mergePreview(id);
      mergeSnapshots.set(id, {
        targetVersions: result.targetVersions!,
        sourceVersions: result.sourceVersions!,
      });
      return result;
    }),
  ),
  http.post(
    '*/api/branches/:id/merge',
    route(async (request, params) => {
      const body = await parse(request);
      const sourceId = String(params.id);
      if (sourceId === 'main') fail(422, 'invalid_merge', '主线不能合并到自身');
      const main = document(String(body.chapterId ?? 'ch7'));
      check(main, body.draftVersion);
      checkMergeVersions(sourceId, body);
      const preview = mergePreview(sourceId);
      const resolutions = (body.resolutions ?? {}) as Record<string, ConflictChoice>;
      if (
        preview.conflicts.some(
          (c) => !['manuscript', 'bible', 'global'].includes(resolutions[c.id]),
        )
      )
        return json(
          { code: 'merge_conflict', message: '请逐项裁决合并冲突', ...preview },
          { status: 409 },
        );
      const source = branch(sourceId);
      const targetBranch = branch('main');
      const changed = new Set<ChapterDocument>();
      const oldTexts = new Map(
        Object.values(targetBranch.documents).map((doc) => [
          doc.chapter.id,
          doc.segments.map((s) => s.text).join('\n\n'),
        ]),
      );
      for (const [chapterId, doc] of Object.entries(source.documents)) {
        const target = targetBranch.documents[chapterId];
        const base = source.baseDocuments[chapterId];
        if (
          chapterContent(doc) === chapterContent(base) ||
          chapterContent(doc) === chapterContent(target)
        )
          continue;
        if (structuralMerge(doc, target, base)) {
          if (resolutions[`merge-chapter-${chapterId}`] === 'bible') continue;
          target.segments = structuredClone(doc.segments);
          target.findings = structuredClone(doc.findings);
          target.conflicts = structuredClone(doc.conflicts).map((conflict) => ({
            ...conflict,
            branchId: 'main',
          }));
          target.chapter.scenes = structuredClone(doc.chapter.scenes);
          target.chapter.title = doc.chapter.title;
          target.chapter.pov = doc.chapter.pov;
          changed.add(target);
          continue;
        }
        for (const segment of doc.segments) {
          const targetSegment = target.segments.find((s) => s.id === segment.id)!;
          const baseSegment = base.segments.find((s) => s.id === segment.id)!;
          if (
            segment.text !== baseSegment.text &&
            targetSegment.text !== segment.text &&
            resolutions[`merge-${segment.id}`] !== 'bible'
          ) {
            targetSegment.text = segment.text;
            changed.add(target);
          }
        }
      }
      for (const item of bibleEntries(source.bible)) {
        const base = targetValue(source.baseBible ?? seedBible, item.kind, item.id);
        const current = targetValue(targetBranch.bible, item.kind, item.id);
        if (
          JSON.stringify(item.value) !== JSON.stringify(base) &&
          JSON.stringify(item.value) !== JSON.stringify(current) &&
          resolutions[`merge-bible-${item.kind}-${item.id}`] !== 'bible'
        ) {
          setBible(targetBranch.bible, item.kind, item.id, structuredClone(item.value));
          Object.values(targetBranch.documents).forEach((doc) => changed.add(doc));
        }
      }
      for (const doc of changed) {
        bump(doc);
        reconcile(doc);
        doc.chapter.status = 'in_review';
      }
      db.branches.find((b) => b.id === sourceId)!.status = 'merged';
      mergeSnapshots.delete(sourceId);
      const title = `合并 · ${db.branches.find((b) => b.id === sourceId)!.name}`;
      const commits = [...changed].map((doc) =>
        addCommit('main', doc, title, oldTexts.get(doc.chapter.id)),
      );
      return (
        commits.find((commit) => commit.chapterId === main.chapter.id) ??
        commits[0] ??
        addCommit('main', main, title, oldTexts.get(main.chapter.id))
      );
    }),
  ),
  http.get(
    '*/api/reports/overview',
    route((request) => {
      const data = branch(bid(request));
      const docs = Object.values(data.documents);
      docs.forEach((doc) => refresh(doc, data.bible.style));
      const trackedForeshadows = data.bible.foreshadows.filter((f) => f.status !== 'abandoned');
      return {
        chapterStats: docs.map((d) => ({
          chapter: `第${d.chapter.number}章 ${d.chapter.title}`,
          status: d.chapter.status,
          words: d.chapter.wordCount,
          style: d.scores.items.find((i) => i.key === 'styleDistance')?.value ?? 0.08,
          aiTaste: d.scores.items.find((i) => i.key === 'aiTaste')?.value ?? 0.09,
        })),
        foreshadowRate: trackedForeshadows.length
          ? trackedForeshadows.filter((f) => f.status === 'closed').length /
            trackedForeshadows.length
          : 0,
        voiceScores: branch(bid(request)).bible.characters.map((c) => ({
          name: c.name,
          values: c.voice.radar,
          calibrated: false,
        })),
        sentenceDistribution: sentenceDistribution(
          docs.flatMap((doc) =>
            doc.segments.flatMap((segment) => segment.styleStats.sentenceLengths),
          ),
        ),
        samples: [
          {
            id: 'sample-knowledge',
            title: '知识越界 · P0',
            quote: '他认出了那个从未见过的人',
            reason: '第七章的知识状态早于第九章身份揭晓。',
          },
          {
            id: 'sample-style',
            title: '抽象情绪 · P2',
            quote: '一股难以言喻的情绪涌上心头',
            reason: '用具体触觉替换抽象心理总结。',
          },
          {
            id: 'sample-voice',
            title: '陆青的留白',
            quote: '“不是替你留的。”',
            reason: '克制对白符合人物防备状态。',
          },
        ],
      };
    }),
  ),
  http.get(
    '*/api/reports/experiments',
    route(() => experiments),
  ),
  http.get(
    '*/api/reports/regression',
    route((request) =>
      regression.map((item) =>
        item.id === 'reg-hand'
          ? {
              ...item,
              status: document('ch7', bid(request)).conflicts.some((c) => c.status === 'open')
                ? 'failed'
                : 'passed',
            }
          : item,
      ),
    ),
  ),
  http.post(
    '*/api/reports/polish',
    route(async (request) => {
      const body = await parse(request);
      if (body.preserveRhythm !== true)
        fail(422, 'preserve_rhythm_required', '全书润色必须保留章节节奏');
      const ids = body.chapterIds as string[];
      if (!Array.isArray(ids) || !ids.length) fail(422, 'chapters_required', '请先选择章节');
      let first: RunState | undefined;
      for (const id of ids) {
        const run = scheduleReview(document(id, bid(request, body)), 'micro', true);
        first ??= run;
      }
      return first;
    }),
  ),
  http.get(
    '*/api/exports',
    route((request) => {
      const branchId = bid(request);
      return {
        filename: `浊流-${branchId}.md`,
        text: `# 浊流\n\n${Object.values(branch(branchId).documents)
          .map(
            (d) =>
              `## 第${d.chapter.number}章 ${d.chapter.title}\n\n${d.segments.map((s) => s.text).join('\n\n')}`,
          )
          .join('\n\n')}`,
      };
    }),
  ),
  http.post(
    '*/api/imports',
    route(async (request) => {
      const body = await parse(request);
      const branchId = bid(request, body);
      const doc = document(String(body.chapterId ?? 'ch7'), branchId);
      check(doc, body.draftVersion);
      const text = String(body.text ?? '').trim();
      if (!text) fail(422, 'empty_import', '导入内容不能为空');
      if (body.kind === 'outline') {
        const lines = text
          .split(/\n/)
          .map((line) => line.trim())
          .filter(Boolean);
        const beatLines = lines.filter(
          (line) => !/^#{1,6}\s|^第[一二三四五六七八九十0-9]+章/.test(line),
        );
        const scene = doc.chapter.scenes[0];
        scene.beats = beatLines.map((line, i) => ({
          id: `${doc.chapter.id}-beat-import-${i + 1}`,
          sceneId: scene.id,
          title: line.replace(/^[-*\d.、]+\s*/, ''),
          description: line.replace(/^[-*\d.、]+\s*/, ''),
          status: 'planned',
          order: i,
        }));
        if (!scene.beats.length) fail(422, 'outline_empty', '大纲至少需要一个节拍');
        bump(doc);
        doc.chapter.status = 'in_review';
        addCommit(branchId, doc, '导入章节大纲');
        return {
          imported: scene.beats.length,
          message: `已导入 ${scene.beats.length} 个节拍，正文保持原样。`,
        };
      }
      if (body.kind === 'bible' || body.kind === 'json') {
        let parsed: Partial<Bible>;
        try {
          parsed = JSON.parse(text);
        } catch {
          fail(422, 'invalid_json', 'JSON 格式不正确');
        }
        if (!parsed || typeof parsed !== 'object') fail(422, 'invalid_json', '请输入设定对象');
        for (const key of Object.keys(parsed) as BibleKind[]) {
          if (!['characters', 'rules', 'timeline', 'foreshadows', 'info', 'style'].includes(key))
            continue;
          const value = parsed[key];
          if (key === 'style' && value) branch(branchId).bible.style = value as Bible['style'];
          else if (Array.isArray(value))
            for (const item of value) setBible(branch(branchId).bible, key, item.id, item);
        }
        bump(doc);
        return {
          imported: Object.keys(parsed).length,
          message: '设定已导入当前分支；关联正文将重新审阅。',
        };
      }
      const paragraphs = text
        .replace(/^#{1,6} .+$/gm, '')
        .split(/\n\s*\n/)
        .filter((s) => s.trim());
      const template = doc.segments[0];
      doc.segments = paragraphs.map((p, i) => ({
        ...structuredClone(template),
        id: `${doc.chapter.id}-import-${uid('s')}`,
        order: i,
        text: p.trim(),
        comments: [],
      }));
      doc.findings = seedFindings
        .filter((f) => doc.segments.some((s) => s.text.includes(f.quote)))
        .map((f) => ({
          ...structuredClone(f),
          segmentId: doc.segments.find((s) => s.text.includes(f.quote))!.id,
          status: 'open',
        }));
      doc.conflicts = [];
      doc.patches = [];
      bump(doc);
      doc.chapter.status = 'in_review';
      addCommit(branchId, doc, '导入手稿');
      return {
        imported: paragraphs.length,
        message: `已导入 ${paragraphs.length} 段正文到当前分支第七章。`,
      };
    }),
  ),
  http.post(
    '*/api/demo/stale',
    route(async (request) => {
      const body = await parse(request);
      const doc = document(String(body.chapterId ?? 'ch7'), bid(request, body));
      bump(doc);
      emit(doc.run, 'version.stale', {
        message: '演示：另一窗口保存了正文。请刷新以获得最新版本。',
      });
      return { draftVersion: doc.chapter.draftVersion };
    }),
  ),
  http.post(
    '*/api/demo/reset',
    route(() => {
      resetDB();
      return { reset: true, message: '已恢复《浊流》第七章 v3 演示状态。' };
    }),
  ),
];
