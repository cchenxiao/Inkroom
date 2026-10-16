import type { Bible, Branch, ChapterDocument, Commit, Project } from '@/types/domain';
import type {
  BookPlan,
  BookStage,
  BookBrief,
  OutlineDraft,
  StyleDraft,
  WorldDraft,
  DirectionDraft,
} from '@/types/domain/library';
import { generateCandidates, basis } from './candidates';
export interface DemoBook {
  project: Project;
  accent: 'ai' | 'human' | 'foreshadow';
  status: BookStage;
  updatedAt: string;
  plan: BookPlan;
  branches: Branch[];
  data: Record<string, { documents: Record<string, ChapterDocument>; bible: Bible }>;
  commits: Commit[];
}
const step = () => ({ candidates: [], selectedId: null, locked: false, basedOn: '' });
export function emptyBible(id: string): Bible {
  return {
    characters: [],
    rules: [],
    timeline: [],
    foreshadows: [],
    info: [],
    style: {
      id: id + '-style',
      anchorText: '',
      statisticalTargets: { sentenceLength: 18, dialogueRatio: 0.3, rhythm: [] },
      bannedWords: [],
      pov: '待确认',
      tense: '待确认',
      tone: '待确认',
      locked: false,
    },
  };
}
export function newBook(id: string, brief: BookBrief): DemoBook {
  const project: Project = {
    id,
    name: brief.name,
    subtitle: '本地演示作品',
    genre: brief.genre,
    tone: '待确认',
    pov: '待确认',
    tense: '待确认',
    targetWords: brief.targetWords,
    logline: brief.logline,
    coreConflict: '待确认',
    currentChapterId: '',
    locked: false,
    author: '陈',
  };
  return {
    project,
    accent: 'ai',
    status: 'planning',
    updatedAt: new Date().toISOString(),
    plan: { projectId: id, version: 1, brief, steps: [step(), step(), step(), step()] },
    branches: [
      {
        id: 'main',
        name: 'main',
        headCommit: '',
        description: '本地演示主线',
        status: 'active',
        createdAt: new Date().toISOString(),
        isMain: true,
      },
    ],
    data: { main: { documents: {}, bible: emptyBible(id) } },
    commits: [],
  };
}
function selected<T>(book: DemoBook, index: number): T | undefined {
  const s = book.plan.steps[index];
  return s.locked ? (s.candidates.find((c) => c.id === s.selectedId)?.content as T) : undefined;
}
/** 只有锁定版本进入正式展示；已有正文不因向导改变而被覆盖。 */
export function publishPlan(book: DemoBook) {
  const p = book.project,
    plan = book.plan;
  Object.assign(p, {
    name: plan.brief.name,
    genre: plan.brief.genre,
    targetWords: plan.brief.targetWords,
    logline: plan.brief.logline,
    locked: plan.steps.every((s) => s.locked),
  });
  const direction = selected<DirectionDraft>(book, 0),
    style = selected<StyleDraft>(book, 1),
    world = selected<WorldDraft>(book, 2),
    outline = selected<OutlineDraft>(book, 3);
  p.tone = direction?.tone ?? '待确认';
  p.coreConflict = direction?.coreConflict ?? '待确认';
  p.pov = style?.pov ?? '待确认';
  p.tense = style?.tense ?? '待确认';
  const bible = emptyBible(p.id);
  if (style)
    bible.style = {
      ...bible.style,
      pov: style.pov,
      tense: style.tense,
      tone: p.tone,
      bannedWords: style.bannedWords,
      statisticalTargets: {
        sentenceLength: (style.sentenceMin + style.sentenceMax) / 2,
        dialogueRatio: (style.dialogueMin + style.dialogueMax) / 200,
        rhythm: [],
      },
      locked: true,
    };
  if (world) {
    bible.characters = world.characters
      .filter((c) => c.confirmed)
      .map((c) => ({
        id: c.id,
        name: c.name,
        role: '主要人物',
        description: '作者确认的演示设定',
        want: c.want,
        need: c.need,
        flaw: c.flaw,
        arcStage: c.arc,
        arcProgress: 0,
        hardTraits: { 特质: c.hardTraits },
        voice: {
          register: '待试笔',
          sentenceStyle: '待试笔',
          catchphrases: [],
          tags: [],
          radar: [],
        },
        knows: {},
        statusAtChapter: {},
        locked: true,
      }));
    bible.rules = world.rules
      .filter((r) => r.confirmed)
      .map((r) => ({
        id: r.id,
        title: '世界规则',
        rule: r.text,
        scope: '全书',
        rigidity: 'hard',
        locked: true,
      }));
  }
  book.data.main.bible = bible;
  if (outline) {
    const previous = book.data.main.documents;
    if (
      Object.values(previous).some(
        (d) =>
          d.segments.some((s) => s.text.trim()) &&
          !outline.chapters.some((c) => c.id === d.chapter.id),
      )
    )
      throw new Error('已有正文的章节不能通过向导删除，请保留章节并另行处理变更。');
    book.data.main.documents = Object.fromEntries(
      outline.chapters.map((c, index) => {
        const old = previous[c.id];
        const scenes = c.scenes.map((s, order) => ({
          id: s.id,
          chapterId: c.id,
          title: s.title,
          order,
          beats: s.beats.map((b, n) => ({
            ...b,
            sceneId: s.id,
            order: n,
            status: 'planned' as const,
          })),
        }));
        const doc: ChapterDocument = old ?? {
          chapter: {
            id: c.id,
            projectId: p.id,
            number: index + 1,
            title: c.title,
            status: 'planned',
            draftVersion: 1,
            wordCount: 0,
            targetWords: Math.round(p.targetWords / outline.chapters.length),
            pov: p.pov,
            scenes,
            issueCount: 0,
          },
          segments: scenes[0]
            ? [
                {
                  id: c.id + '-s1',
                  chapterId: c.id,
                  sceneId: scenes[0].id,
                  beatId: scenes[0].beats[0]?.id ?? '',
                  order: 0,
                  text: '',
                  pov: p.pov,
                  charactersPresent: [],
                  entitiesMentioned: [],
                  foreshadowIds: [],
                  styleStats: {
                    sentenceLengths: [],
                    dialogueRatio: 0,
                    aiTaste: 0,
                    repeatedPhrases: [],
                  },
                  version: 1,
                },
              ]
            : [],
          findings: [],
          patches: [],
          conflicts: [],
          scores: {
            items: [],
            p0Count: 0,
            canFinalize: false,
            blockers: ['演示作品尚未接入真实评审，不能据此定稿。'],
          },
          run: {
            id: c.id + '-run',
            chapterId: c.id,
            branchId: 'main',
            draftVersion: 1,
            status: 'canceled',
            currentNode: 'human_gate',
            reviseRound: 0,
            maxRounds: 2,
            tokens: 0,
            elapsedMs: 0,
            nodes: [],
          },
        };
        const publishedScenes = scenes.length ? scenes : (old?.chapter.scenes ?? []);
        if (
          doc.segments.some(
            (segment) =>
              segment.text.trim() &&
              !publishedScenes.some(
                (scene) =>
                  scene.id === segment.sceneId &&
                  scene.beats.some((beat) => beat.id === segment.beatId),
              ),
          )
        ) {
          throw new Error('已有正文的场景或 Beat 不能通过向导删除，请先保留关联结构。');
        }
        doc.chapter = {
          ...doc.chapter,
          title: c.title,
          number: index + 1,
          scenes: publishedScenes,
        };
        return [c.id, doc];
      }),
    );
    if (!book.data.main.documents[p.currentChapterId]) p.currentChapterId = outline.chapters[0].id;
    book.status = Object.values(book.data.main.documents).some((d) =>
      d.segments.some((s) => s.text.trim()),
    )
      ? 'writing'
      : 'planning';
  }
  book.updatedAt = new Date().toISOString();
}
function seed() {
  const clock = newBook('project-clock', {
    name: '修钟人的星期天',
    genre: '都市 / 轻喜剧',
    logline: '两位性格相反的修钟人，为保住老店，决定修好一座从不报时的钟。',
    targetWords: 24000,
  });
  clock.accent = 'human';
  for (const i of [0, 1, 2, 3] as const) {
    const s = clock.plan.steps[i];
    s.candidates = generateCandidates(clock.plan, i);
    const chosen = s.candidates[i === 2 ? 1 : 0];
    s.selectedId = chosen.id;
    if (chosen.content.kind === 'world') {
      chosen.content.characters.forEach((c) => (c.confirmed = true));
      chosen.content.rules.forEach((r) => (r.confirmed = true));
    }
    s.basedOn = basis(clock.plan, i);
    s.locked = true;
  }
  publishPlan(clock);
  const prose = [
    '星期天，巷子里的店都开得很晚。林舟把最后一颗螺丝放进瓷碟，抬头看了一眼挂钟。八点零七分，分针又不走了。\n“它也休息。”许宁说。\n林舟没接话。他把门口那块歇业牌翻了个面，字朝着墙。',
    '许宁搬来一把椅子，踮脚去够钟摆。林舟在下面扶着，手指离椅背还有半寸。\n“你是怕我摔下来，还是怕我砸坏钟？”\n“椅子也是老的。”他说。\n许宁笑了一声。那点笑声停下来时，钟里传出了很轻的一次咔哒。',
    '房东来的时候，两个人正趴在地上找弹簧。\n许宁先看见了那双擦得很亮的皮鞋。他没有起身，把螺丝刀往林舟那边推了推。\n“再给我们一个星期。”他说。\n林舟抬起头。这是今天第一件他们没有事先商量、却都同意的事。',
  ];
  Object.values(clock.data.main.documents).forEach((d, i) => {
    d.chapter.title = ['不肯走的钟', '椅子也是老的', '再借一个星期'][i];
    d.chapter.status = i < 2 ? 'finalized' : 'drafting';
    const selectedOutline = clock.plan.steps[3].candidates.find(
      (c) => c.id === clock.plan.steps[3].selectedId,
    )?.content;
    if (selectedOutline?.kind === 'outline') selectedOutline.chapters[i].title = d.chapter.title;
    if (!d.chapter.scenes.length)
      d.chapter.scenes = [
        {
          id: d.chapter.id + '-scene',
          chapterId: d.chapter.id,
          title: '日常里的转折',
          order: 0,
          beats: [
            {
              id: d.chapter.id + '-beat',
              sceneId: d.chapter.id + '-scene',
              order: 0,
              title: '关系发生变化',
              description: '由行动推动关系',
              status: i < 2 ? 'done' : 'planned',
            },
          ],
        },
      ];
    if (!d.segments.length)
      d.segments = [
        {
          ...structuredClone(Object.values(clock.data.main.documents)[0].segments[0]),
          id: d.chapter.id + '-s1',
          chapterId: d.chapter.id,
          sceneId: d.chapter.scenes[0].id,
          beatId: d.chapter.scenes[0].beats[0].id,
        },
      ];
    d.segments[0].text = prose[i];
    d.chapter.wordCount = Array.from(prose[i].replace(/\s/g, '')).length;
  });
  clock.project.currentChapterId = 'project-clock-ch3';
  clock.status = 'writing';
  clock.updatedAt = '2026-10-15T14:30:00Z';
  const snow = newBook('project-snow', {
    name: '雪线以北',
    genre: '旅行 / 成长',
    logline: '一名退休气象员沿着旧观测站路线，寻找父亲留下的一份没有日期的天气记录。',
    targetWords: 48000,
  });
  snow.accent = 'foreshadow';
  snow.updatedAt = '2026-10-14T09:20:00Z';
  return { [clock.project.id]: clock, [snow.project.id]: snow };
}
export let books: Record<string, DemoBook> = seed();
let enabled = false;
export function enableLibraryPersistence() {
  enabled = true;
  try {
    const saved = JSON.parse(localStorage.getItem('inkloom-library-v1') ?? 'null') as Record<
      string,
      DemoBook
    > | null;
    if (
      saved &&
      Object.values(saved).every(
        (b) => b.project?.id && b.plan?.steps?.length === 4 && b.data?.main,
      )
    )
      books = saved;
  } catch {
    /* Corrupt local demo data does not replace the deterministic seed. */
  }
}
export function persistLibrary() {
  if (enabled) localStorage.setItem('inkloom-library-v1', JSON.stringify(books));
}
export function resetLibrary() {
  books = seed();
  persistLibrary();
}
