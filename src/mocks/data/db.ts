import type {
  Bible,
  Branch,
  ChapterDocument,
  ChangeSet,
  Commit,
  Conflict,
  Finding,
  QualityGateScores,
  RevisionPatch,
  RunEvent,
  RunState,
} from '../../types/domain';
import { bible, branches, commits, project, seedDocuments, now } from './seed';
import { migrateDemoWordTarget } from './presentation-migration';
import { measureStyle } from './statistics';
export interface BranchData {
  documents: Record<string, ChapterDocument>;
  bible: Bible;
  changesets: ChangeSet[];
  baseDocuments: Record<string, ChapterDocument>;
  baseBible: Bible;
}
export interface Database {
  project: typeof project;
  branches: Branch[];
  commits: Commit[];
  data: Record<string, BranchData>;
  runs: Record<string, RunState>;
  events: Record<string, RunEvent[]>;
  snapshots: Record<string, BranchData>;
  counter: number;
}
const copy = <T>(value: T): T => structuredClone(value);
function initial(): Database {
  const main = seedDocuments();
  const alternate = seedDocuments('romance-b');
  alternate.ch7.segments[3].text =
    '“我不是在等水退。”陆青说。她把外套递过来，手指还捏着袖口。沈砚没有立刻接。';
  const data: Record<string, BranchData> = {
    main: {
      documents: main,
      bible: copy(bible),
      changesets: [],
      baseDocuments: copy(main),
      baseBible: copy(bible),
    },
    'romance-b': {
      documents: alternate,
      bible: copy(bible),
      changesets: [],
      baseDocuments: copy(main),
      baseBible: copy(bible),
    },
  };
  const result: Database = {
    project: copy(project),
    branches: copy(branches),
    commits: copy(commits),
    data,
    runs: {},
    events: {},
    snapshots: {},
    counter: 100,
  };
  for (const branch of Object.values(data))
    for (const doc of Object.values(branch.documents)) {
      result.runs[doc.run.id] = doc.run;
      refresh(doc);
    }
  for (const commit of result.commits) {
    const snap = copy(data[commit.branchId]);
    snap.documents.ch7.chapter.draftVersion = commit.draftVersion;
    commit.newText.split('\n\n').forEach((text, i) => {
      if (snap.documents.ch7.segments[i]) snap.documents.ch7.segments[i].text = text;
    });
    result.snapshots[commit.id] = snap;
  }
  return result;
}
export let db = initial();
let persistent = false;
export function persist() {
  if (persistent && typeof localStorage !== 'undefined')
    try {
      localStorage.setItem('inkloom-mock-v1', JSON.stringify(db));
    } catch {
      /* Storage can be full or disabled; memory remains authoritative. */
    }
}
export function enablePersistence() {
  persistent = true;
  try {
    const saved = localStorage.getItem('inkloom-mock-v1');
    if (saved) {
      const value = JSON.parse(saved) as Database;
      if (value.project?.id === project.id && value.data?.main?.documents?.ch7) {
        db = value;
        db.project = migrateDemoWordTarget(db.project, project);
        for (const data of Object.values(db.data))
          for (const doc of Object.values(data.documents)) {
            db.runs[doc.run.id] = doc.run;
            refresh(doc);
            if (doc.run.status === 'running') {
              doc.run.status = 'paused';
            }
          }
      }
    }
  } catch {
    /* Fall back to the deterministic seed. */
  }
}
export function resetDB() {
  db = initial();
  persist();
}
export function uid(prefix: string) {
  return `${prefix}-${++db.counter}`;
}
export class ApiFailure extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public currentVersion?: number,
  ) {
    super(message);
  }
}
export function fail(status: number, code: string, message: string): never {
  throw new ApiFailure(status, code, message);
}
export function branch(id = 'main') {
  return db.data[id] ?? fail(404, 'branch_not_found', '分支不存在');
}
export function document(chapterId = 'ch7', branchId = 'main') {
  return branch(branchId).documents[chapterId] ?? fail(404, 'chapter_not_found', '章节不存在');
}
export function findDoc(
  field: 'segments' | 'findings' | 'patches' | 'conflicts',
  id: string,
  branchId = 'main',
) {
  return (
    Object.values(branch(branchId).documents).find((d) => d[field].some((v) => v.id === id)) ??
    fail(404, 'not_found', '找不到对应资源')
  );
}
export function check(doc: ChapterDocument, version: unknown) {
  if (version !== doc.chapter.draftVersion)
    throw new ApiFailure(
      409,
      'version_mismatch',
      '正文已在其他窗口更新，请刷新后重试。',
      doc.chapter.draftVersion,
    );
}
export function refresh(doc: ChapterDocument, style = bible.style) {
  for (const segment of doc.segments)
    segment.styleStats = measureStyle(segment.text, style.bannedWords);
  doc.chapter.wordCount = doc.segments.reduce(
    (sum, s) => sum + s.text.replace(/\s/g, '').length,
    0,
  );
  for (const f of doc.findings) {
    const segment = doc.segments.find((s) => s.id === f.segmentId);
    if (segment && !segment.text.includes(f.quote)) f.status = 'resolved';
    if (segment?.text.includes(f.quote) && f.status === 'resolved') f.status = 'open';
  }
  const pending = doc.findings.filter(
    (f) =>
      f.status === 'open' ||
      f.status === 'accepted' ||
      (f.status === 'ignored' && f.severity === 'P0'),
  );
  const p0 = pending.filter((f) => f.severity === 'P0').length;
  const consistency =
    100 -
    pending
      .filter((f) => f.critic === 'hard_consistency')
      .reduce((a, f) => a + (f.severity === 'P0' ? 22 : 13), 0);
  const ai = 0.09 + pending.filter((f) => f.critic === 'ai_taste').length * 0.16;
  const distance = 0.08 + pending.filter((f) => f.critic === 'style').length * 0.14;
  const reader = 4.5 - pending.filter((f) => f.critic === 'reader').length * 0.9;
  const items: QualityGateScores['items'] = [
    {
      key: 'consistency',
      label: '硬一致性',
      value: consistency,
      threshold: 95,
      direction: 'higher',
      calibrated: true,
      passed: consistency >= 95,
      features: [
        {
          label: '证据冲突',
          value: `${pending.filter((f) => f.critic === 'hard_consistency').length} 项`,
          reason: '对照角色硬设定、知识状态与时间线',
          source: '人物卡 / 信息状态 / 章节引用',
          calibrated: true,
        },
      ],
    },
    {
      key: 'aiTaste',
      label: 'AI 味',
      value: Number(ai.toFixed(2)),
      threshold: 0.2,
      direction: 'lower',
      calibrated: false,
      passed: ai <= 0.2,
      features: [
        {
          label: '套话命中',
          value: `${pending.filter((f) => f.critic === 'ai_taste').length} 处`,
          reason: '抽象情绪与程式化表情命中风格禁词',
          source: '风格锚点 + 词组特征（演示值，未校准）',
          calibrated: false,
        },
      ],
    },
    {
      key: 'styleDistance',
      label: '风格距离',
      value: Number(distance.toFixed(2)),
      threshold: 0.15,
      direction: 'lower',
      calibrated: false,
      passed: distance <= 0.15,
      features: [
        {
          label: '句长与节奏',
          value: `${Math.round(distance * 100)}%`,
          reason: '比较长短句变化与作者锚点分布',
          source: '句长分布 / 对话比例（演示值）',
          calibrated: false,
        },
      ],
    },
    {
      key: 'reader',
      label: '读者评分',
      value: reader,
      threshold: 4,
      direction: 'higher',
      calibrated: false,
      passed: reader >= 4,
      features: [
        {
          label: '因果与伏笔',
          value: reader.toFixed(1),
          reason: '铜扣暗号应在本章形成有效推进',
          source: '模拟读者偏好，非真实用户评分',
          calibrated: false,
        },
      ],
    },
  ];
  const blockers = [
    ...(p0 ? [`${p0} 个 P0 硬冲突尚未解决`] : []),
    ...items.filter((x) => !x.passed).map((x) => `${x.label}未达门槛`),
    ...(doc.conflicts.some((c) => c.status === 'open') ? ['设定冲突等待作者裁决'] : []),
  ];
  doc.scores = { items, p0Count: p0, canFinalize: blockers.length === 0, blockers };
  doc.chapter.issueCount = pending.length;
}
export function bump(doc: ChapterDocument) {
  doc.chapter.draftVersion++;
  doc.segments.forEach((s) => (s.version = doc.chapter.draftVersion));
  doc.findings.forEach((f) => (f.draftVersion = doc.chapter.draftVersion));
  refresh(doc);
  persist();
}
export function addCommit(
  branchId: string,
  doc: ChapterDocument,
  title: string,
  oldText = '',
): Commit {
  const b = db.branches.find((b) => b.id === branchId)!;
  const commit: Commit = {
    id: uid('commit'),
    chapterId: doc.chapter.id,
    parentId: b.headCommit,
    branchId,
    title,
    author: 'human',
    createdAt: now(),
    draftVersion: doc.chapter.draftVersion,
    summary: `${doc.chapter.title} · v${doc.chapter.draftVersion} · ${doc.chapter.issueCount} 项待处理`,
    oldText,
    newText: doc.segments.map((s) => s.text).join('\n\n'),
  };
  db.commits.push(commit);
  b.headCommit = commit.id;
  db.snapshots[commit.id] = copy(branch(branchId));
  persist();
  return commit;
}
export function makePatch(
  doc: ChapterDocument,
  finding: Finding,
  origin: RevisionPatch['origin'] = 'agent',
) {
  const existing = doc.patches.find(
    (p) =>
      p.findingId === finding.id &&
      p.status === 'pending' &&
      p.draftVersion === doc.chapter.draftVersion,
  );
  if (existing) return existing;
  const patch: RevisionPatch = {
    id: uid('patch'),
    findingId: finding.id,
    segmentId: finding.segmentId,
    draftVersion: doc.chapter.draftVersion,
    origin,
    status: 'pending',
    sentences: [
      {
        id: uid('sentence'),
        oldText: finding.quote,
        newText: finding.replacement,
        status: 'pending',
      },
    ],
  };
  const segment = doc.segments.find((s) => s.id === finding.segmentId);
  const supportingQuote = '男人的手插在口袋里，雨水顺着袖口滴到地上';
  if (finding.repairScope === 'scene' && segment?.text.includes(supportingQuote)) {
    patch.sentences.push({
      id: uid('sentence'),
      oldText: supportingQuote,
      newText: '男人的手仍插在口袋里。沈砚只看见雨水从袖口滴下来，看不见他握着什么',
      status: 'pending',
    });
  }
  doc.patches.push(patch);
  persist();
  return patch;
}
export function allConflicts(branchId = 'main'): Conflict[] {
  return Object.values(branch(branchId).documents).flatMap((d) => d.conflicts);
}
