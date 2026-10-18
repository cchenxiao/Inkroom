/** Go API 的序列化契约；所有 ID 为字符串，时间为 ISO 8601。 */
export type ID = string;
export type Severity = 'P0' | 'P1' | 'P2' | 'P3';
export type Critic = 'hard_consistency' | 'style' | 'ai_taste' | 'reader';
export type ChapterStatus =
  'planned' | 'drafting' | 'in_review' | 'revising' | 'human' | 'finalized';
export type RepairScope = 'phrase' | 'segment' | 'scene' | 'beat' | 'outline' | 'cross_chapter';
/** 创作方向；锁定后的重大方向变化应先生成 ChangeSet。 */
export interface Project {
  id: ID;
  name: string;
  subtitle: string;
  genre: string;
  tone: string;
  pov: string;
  tense: string;
  targetWords: number;
  logline: string;
  coreConflict: string;
  currentChapterId: ID;
  locked: boolean;
  author: string;
}
/** 章状态与当前候选稿版本；审批必须匹配 draftVersion。 */
export interface Chapter {
  id: ID;
  projectId: ID;
  number: number;
  title: string;
  status: ChapterStatus;
  draftVersion: number;
  wordCount: number;
  targetWords: number;
  pov: string;
  scenes: Scene[];
  issueCount: number;
}
export interface Scene {
  id: ID;
  chapterId: ID;
  title: string;
  order: number;
  beats: Beat[];
}
export interface Beat {
  id: ID;
  sceneId: ID;
  title: string;
  description: string;
  status: 'planned' | 'writing' | 'done';
  order: number;
}
export interface StyleStats {
  sentenceLengths: number[];
  dialogueRatio: number;
  aiTaste: number;
  repeatedPhrases: string[];
}
/** 正文最小可定位单元；文本、标记引用与分段版本共同维护。 */
export interface Segment {
  id: ID;
  chapterId: ID;
  sceneId: ID;
  beatId: ID;
  order: number;
  text: string;
  pov: string;
  charactersPresent: ID[];
  entitiesMentioned: ID[];
  foreshadowIds: ID[];
  styleStats: StyleStats;
  version: number;
  isDialogueLie?: boolean;
  comments?: Comment[];
}
export interface VoiceProfile {
  register: string;
  sentenceStyle: string;
  catchphrases: string[];
  tags: string[];
  radar: number[];
}
export interface Character {
  id: ID;
  name: string;
  role: string;
  description: string;
  want: string;
  need: string;
  flaw: string;
  arcStage: string;
  arcProgress: number;
  hardTraits: Record<string, string>;
  voice: VoiceProfile;
  knows: Record<string, number>;
  statusAtChapter: Record<string, string>;
  locked: boolean;
}
export interface WorldRule {
  id: ID;
  title: string;
  rule: string;
  scope: string;
  rigidity: 'hard' | 'soft';
  locked: boolean;
}
export interface TimelineEvent {
  id: ID;
  title: string;
  storyTime: string;
  chapterId: ID;
  summary: string;
  causalBefore: ID[];
}
export interface Foreshadow {
  id: ID;
  title: string;
  plantedChapter: ID;
  plantedSegment: ID;
  payload: string;
  planResolveChapter: ID;
  status: 'open' | 'closed' | 'abandoned';
  importance: 'P0' | 'P1' | 'P2';
  overdue: boolean;
}
export interface InfoState {
  id: ID;
  fact: string;
  knownBy: Record<string, boolean>;
  disclosedChapter: ID;
  source: string;
}
export interface StyleProfile {
  id: ID;
  anchorText: string;
  statisticalTargets: { sentenceLength: number; dialogueRatio: number; rhythm: number[] };
  bannedWords: string[];
  pov: string;
  tense: string;
  tone: string;
  locked: boolean;
}
export interface Bible {
  characters: Character[];
  rules: WorldRule[];
  timeline: TimelineEvent[];
  foreshadows: Foreshadow[];
  info: InfoState[];
  style: StyleProfile;
}
export type BibleKind = keyof Bible;
/** 独立 Critic 的可解释发现，证据与修复范围不可省略。 */
export interface Finding {
  id: ID;
  critic: Critic;
  severity: Severity;
  segmentId: ID;
  quote: string;
  evidenceRefs: string[];
  reason: string;
  suggestion: string;
  repairScope: RepairScope;
  draftVersion: number;
  status: 'open' | 'accepted' | 'ignored' | 'resolved';
  replacement: string;
  ignoreReason?: string;
}
export interface SentenceChange {
  id: ID;
  oldText: string;
  newText: string;
  status: 'pending' | 'accepted' | 'rejected';
}
/** 非破坏候选；仅采纳的句子会落入正文，拒绝句保留原文。 */
export interface RevisionPatch {
  id: ID;
  findingId: ID;
  segmentId: ID;
  draftVersion: number;
  sentences: SentenceChange[];
  origin: 'agent' | 'human_instruction';
  status: 'pending' | 'applied' | 'discarded';
}
export interface AffectedRef {
  id: ID;
  level: 'rewrite' | 'review' | 'orphan_foreshadow';
  chapterId: ID;
  sceneId: ID;
  segmentId: ID;
  label: string;
  reason: string;
  status: 'pending' | 'resolved';
}
export type ConflictChoice = 'manuscript' | 'bible' | 'global';
/** 作者裁决的事实冲突；对白谎言不提升为全书世界事实。 */
export interface Conflict {
  id: ID;
  title: string;
  field: string;
  bibleSays: string;
  manuscriptSays: string;
  witnessRefs: string[];
  options: ConflictChoice[];
  isDialogueLie: boolean;
  status: 'open' | 'resolved';
  resolution?: ConflictChoice;
  reason?: string;
  segmentId: ID;
  branchId?: ID;
}
/** 人工与 AI 统一变更记录；先预览再应用，追踪传播和父提交。 */
export interface ChangeSet {
  id: ID;
  chapterId?: ID;
  origin: 'human_inline' | 'human_bible' | 'human_instruction' | 'agent';
  targetType: string;
  targetId: ID;
  old: unknown;
  new: unknown;
  reason: string;
  blastRadius: AffectedRef[];
  conflicts: Conflict[];
  parentCommit: ID;
  draftVersion: number;
  status: 'preview' | 'applied' | 'rejected';
  createdAt: string;
  strategy?: 'mark_only' | 'propagate';
}
export interface Commit {
  id: ID;
  chapterId?: ID;
  parentId: ID | null;
  branchId: ID;
  title: string;
  author: 'agent' | 'human';
  createdAt: string;
  draftVersion: number;
  summary: string;
  oldText: string;
  newText: string;
}
/** 独立稿本与检索范围；合并冲突由作者裁决。 */
export interface Branch {
  id: ID;
  name: string;
  headCommit: ID;
  description: string;
  status: 'active' | 'merged' | 'abandoned';
  createdAt: string;
  isMain: boolean;
}
export interface ScoreFeature {
  label: string;
  value: string;
  reason: string;
  source: string;
  calibrated: boolean;
}
export interface QualityScore {
  key: 'consistency' | 'aiTaste' | 'styleDistance' | 'reader';
  label: string;
  value: number;
  threshold: number;
  direction: 'lower' | 'higher';
  calibrated: boolean;
  passed: boolean;
  features: ScoreFeature[];
}
/** 仅已校准分项与 P0 硬伤进入定稿门禁。 */
export interface QualityGateScores {
  items: QualityScore[];
  p0Count: number;
  canFinalize: boolean;
  blockers: string[];
}
export type RunNode =
  | 'assemble'
  | 'draft'
  | 'hard_consistency'
  | 'style'
  | 'ai_taste'
  | 'reader'
  | 'aggregate'
  | 'structural_reviser'
  | 'scene_reviser'
  | 'micro_polisher'
  | 'human_gate'
  | 'bible_update'
  | 'commit';
export interface NodeExecution {
  id: RunNode;
  status: 'idle' | 'running' | 'done' | 'failed';
  inputVersion: number;
  input: string;
  output: string;
  reason: string;
  tokens: number;
  durationMs: number;
}
/** 一次章节运行及节点输入版本；运行结果不得覆盖更新稿本。 */
export interface RunState {
  id: ID;
  chapterId: ID;
  branchId: ID;
  draftVersion: number;
  status:
    'running' | 'paused' | 'waiting_human' | 'escalated' | 'completed' | 'canceled' | 'failed';
  currentNode: RunNode;
  reviseRound: number;
  maxRounds: 2 | 3;
  tokens: number;
  elapsedMs: number;
  nodes: NodeExecution[];
}
export type RunEventType =
  | 'run.started'
  | 'node.started'
  | 'node.finished'
  | 'draft.delta'
  | 'findings.ready'
  | 'revise.round'
  | 'gate.waiting'
  | 'escalated'
  | 'conflict.created'
  | 'index.updating'
  | 'run.finished'
  | 'run.failed'
  | 'version.stale';
export interface RunEvent {
  id: string;
  type: RunEventType;
  runId: ID;
  draftVersion: number;
  timestamp: string;
  data: {
    node?: RunNode;
    text?: string;
    segmentId?: ID;
    round?: number;
    max?: number;
    message?: string;
    phase?: string;
    findings?: Finding[];
    run?: RunState;
  };
}
/** 上下文来源与版本账本，包含未纳入材料及其原因。 */
export interface ContextManifest {
  runId: ID;
  draftVersion: number;
  tokenEstimate: number;
  budget: number;
  sources: {
    id: ID;
    title: string;
    version: number;
    method: 'direct' | 'graph' | 'keyword' | 'vector';
    tokens: number;
    excerpt: string;
  }[];
  excluded: { title: string; reason: string }[];
}
export interface Comment {
  id: ID;
  segmentId: ID;
  quote: string;
  text: string;
  createdAt: string;
  status: 'open' | 'replied';
  patchId?: ID;
}
export interface ChapterDocument {
  chapter: Chapter;
  segments: Segment[];
  findings: Finding[];
  scores: QualityGateScores;
  run: RunState;
  patches: RevisionPatch[];
  conflicts: Conflict[];
}
export interface ReportOverview {
  chapterStats: {
    chapter: string;
    status: ChapterStatus;
    words: number;
    style: number | null;
    aiTaste: number | null;
  }[];
  foreshadowRate: number | null;
  voiceScores: { name: string; values: number[]; calibrated: boolean }[];
  sentenceDistribution: { range: string; count: number }[];
  samples: {
    id: ID;
    title: string;
    quote: string;
    reason: string;
    chapterId?: string;
    beatId?: string;
    kept?: boolean;
  }[];
}
export interface Experiment {
  id: ID;
  name: string;
  memory: boolean;
  revision: boolean;
  tokens: number;
  cost: number;
  rounds: number;
  passRate: number;
  preference: number;
  sampleIds: ID[];
}
export interface RegressionCase {
  id: ID;
  name: string;
  category: string;
  expected: string;
  actual: string;
  status: 'passed' | 'failed' | 'pending';
  sample: string;
}
export interface MergePreview {
  targetVersions?: Record<ID, number>;
  sourceVersions?: Record<ID, number>;
  branchId: ID;
  targetBranchId: ID;
  conflicts: Conflict[];
  commits: Commit[];
  canMerge: boolean;
}
export interface ApiErrorBody {
  code: string;
  message: string;
  currentVersion?: number;
}
export interface PreviewChangeInput {
  chapterId?: ID;
  origin: ChangeSet['origin'];
  targetType: string;
  targetId: ID;
  new: unknown;
  reason: string;
  draftVersion: number;
  branchId?: ID;
}
export interface RunActionInput {
  action:
    | 'approve'
    | 'redirect'
    | 'instruct'
    | 'inline_edit'
    | 'cancel'
    | 'pause'
    | 'resume'
    | 'fast_forward';
  draftVersion: number;
  instruction?: string;
  scope?: RepairScope;
  findingId?: ID;
}
export interface ApplyPatchInput {
  draftVersion: number;
  acceptedSentenceIds: ID[];
  branchId?: ID;
}
