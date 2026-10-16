import type { BookBrief, BookPlan, PlanAction, PlanContent } from '@/types/domain/library';
import { ApiFailure } from '../data/db';
import { basis, generateCandidates } from './candidates';
import { publishPlan, type DemoBook } from './store';
const fail = (message: string): never => {
  throw new ApiFailure(422, 'invalid_plan', message);
};
const text = (v: unknown) => typeof v === 'string' && v.trim().length > 0 && v.length <= 6000;
export function validateBrief(b: BookBrief) {
  if (
    !b ||
    !text(b.name) ||
    !text(b.logline) ||
    typeof b.genre !== 'string' ||
    !Number.isInteger(b.targetWords) ||
    b.targetWords < 1000 ||
    b.targetWords > 200000
  )
    fail('请填写作品名、立意，以及 1000–200000 字的目标篇幅。');
}
export function validateContent(c: PlanContent) {
  if (!c) fail('候选内容无效');
  switch (c.kind) {
    case 'direction':
      if (!text(c.tone) || !text(c.coreConflict) || !text(c.appeal) || typeof c.note !== 'string')
        fail('请填写方向、冲突与吸引力');
      break;
    case 'style':
      if (
        !text(c.pov) ||
        !text(c.tense) ||
        !text(c.styleArc) ||
        !Array.isArray(c.bannedWords) ||
        c.bannedWords.some((w) => !text(w)) ||
        ![c.sentenceMin, c.sentenceMax, c.dialogueMin, c.dialogueMax].every(Number.isFinite) ||
        c.sentenceMin < 1 ||
        c.sentenceMax < c.sentenceMin ||
        c.sentenceMax > 200 ||
        c.dialogueMin < 0 ||
        c.dialogueMax < c.dialogueMin ||
        c.dialogueMax > 100
      )
        fail('请检查风格规则和区间，句长 1–200，比例 0–100');
      break;
    case 'world':
      if (
        !Array.isArray(c.characters) ||
        !c.characters.length ||
        !Array.isArray(c.rules) ||
        c.characters.some(
          (x) =>
            ![x.id, x.name, x.want, x.need, x.flaw, x.arc, x.hardTraits].every(text) ||
            typeof x.confirmed !== 'boolean',
        ) ||
        c.rules.some((x) => !text(x.id) || !text(x.text) || typeof x.confirmed !== 'boolean')
      )
        fail('请填写人物、世界规则并逐条确认');
      break;
    case 'outline': {
      if (
        !Array.isArray(c.acts) ||
        c.acts.length !== 3 ||
        !Array.isArray(c.chapters) ||
        !c.chapters.length ||
        c.chapters.length > 30
      )
        fail('大纲需包含三幕和章节');
      const ids = new Set<string>();
      const unique = (id: string) => {
        if (!text(id) || ids.has(id)) fail('结构 ID 不可重复');
        ids.add(id);
      };
      c.acts.forEach((a) => {
        unique(a.id);
        if (!text(a.title)) fail('幕标题必填');
      });
      c.chapters.forEach((ch, i) => {
        unique(ch.id);
        if (
          !text(ch.title) ||
          !text(ch.purpose) ||
          !c.acts.some((a) => a.id === ch.actId) ||
          !Array.isArray(ch.scenes) ||
          (i === 0 && !ch.scenes.length)
        )
          fail('请补齐章节目标和首章场景');
        ch.scenes.forEach((s) => {
          unique(s.id);
          if (!text(s.title) || !Array.isArray(s.beats) || !s.beats.length)
            fail('场景和 Beat 必填');
          s.beats.forEach((b) => {
            unique(b.id);
            if (!text(b.title) || !text(b.description)) fail('Beat 内容必填');
          });
        });
      });
      break;
    }
    default:
      fail('候选类型无效');
  }
}
/** 在副本上校验和发布，失败不会半写入或改变正式展示。 */
export function applyPlan(book: DemoBook, expected: number, action: PlanAction): DemoBook {
  if (expected !== book.plan.version)
    throw new ApiFailure(
      409,
      'version_mismatch',
      '规划已在另一窗口更新，请刷新核对。',
      book.plan.version,
    );
  const next = structuredClone(book),
    plan = next.plan;
  if (action.action === 'brief') {
    validateBrief(action.brief);
    plan.brief = action.brief;
    plan.steps.forEach((s) => (s.locked = false));
  } else {
    const i = action.step;
    if (!Number.isInteger(i) || i < 0 || i > 3) fail('步骤无效');
    const step = plan.steps[i];
    if (action.action === 'unlock') {
      plan.steps.slice(i).forEach((s) => (s.locked = false));
    } else {
      if (plan.steps.slice(0, i).some((s) => !s.locked)) fail('请先锁定上一步');
      if (step.locked) fail('请先解锁当前步骤再修改');
      if (action.action === 'generate') {
        step.candidates = generateCandidates(plan, i);
        step.basedOn = basis(plan, i);
        step.selectedId = null;
      } else {
        if (step.basedOn !== basis(plan, i)) fail('上游规划已变更，候选需要重新生成');
        if (action.action === 'select') {
          if (!step.candidates.some((c) => c.id === action.candidateId)) fail('候选不存在');
          step.selectedId = action.candidateId;
        } else if (action.action === 'edit') {
          const candidate =
            step.candidates.find((c) => c.id === action.candidateId) ?? fail('候选不存在');
          validateContent(action.content);
          if (candidate.content.kind !== action.content.kind) fail('候选类型不可更改');
          candidate.content = action.content;
        } else if (action.action === 'lock') {
          const selected =
            step.candidates.find((c) => c.id === step.selectedId) ?? fail('请先选定候选');
          validateContent(selected.content);
          if (
            selected.content.kind === 'world' &&
            [...selected.content.characters, ...selected.content.rules].some((x) => !x.confirmed)
          )
            fail('人物与规则需逐条确认');
          step.locked = true;
        } else fail('操作无效');
      }
      plan.steps.slice(i + 1).forEach((s) => (s.locked = false));
    }
  }
  plan.version++;
  publishPlan(next);
  return next;
}
export function publicPlan(plan: BookPlan): BookPlan {
  return structuredClone(plan);
}
