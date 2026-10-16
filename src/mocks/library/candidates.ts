import type {
  BookCandidate,
  BookPlan,
  PlanStep,
  DirectionDraft,
  OutlineDraft,
} from '@/types/domain/library';
// 确定性演示候选，不调用模型、不声称根据立意理解了作品。
export function generateCandidates(plan: BookPlan, step: PlanStep): BookCandidate[] {
  const prefix = `${plan.projectId}-p${plan.version}`;
  const direction = plan.steps[0].candidates.find((c) => c.id === plan.steps[0].selectedId)
    ?.content as DirectionDraft | undefined;
  if (step === 0)
    return [
      {
        id: prefix + '-a',
        title: '人物选择驱动',
        summary: '围绕人物想守住的东西，以及为此付出的代价。',
        content: {
          kind: 'direction',
          tone: '贴近人物，克制而有温度',
          coreConflict: '主角想完成一件重要的事，却必须放弃一直依赖的安全感。请结合你的立意调整。',
          appeal: '让每一次选择改变关系，让代价逐步显现。',
          note: '演示模板，需作者具体化；适合人物关系推进。',
        },
      },
      {
        id: prefix + '-b',
        title: '处境与反差驱动',
        summary: '让立场相反的人共同面对一件无法回避的难题。',
        content: {
          kind: 'direction',
          tone: '节奏明快，处境反差带来适度幽默',
          coreConflict: '人物需要合作才能解决眼前问题，却对成功有不同理解。请结合你的立意调整。',
          appeal: '通过立场碰撞、行动失误与相互理解推动阅读。',
          note: '演示模板，需作者具体化；幽默不覆盖重要情绪。',
        },
      },
    ];
  if (step === 1)
    return [false, true].map((close, i) => ({
      id: prefix + '-' + i,
      title: close ? '贴身观察' : '动作与留白',
      summary: close ? '更贴近感受，允许短暂抒情。' : '让动作承载情绪，对白保留余地。',
      content: {
        kind: 'style',
        pov: close ? '第一人称限知' : '第三人称限知',
        tense: '过去时',
        sentenceMin: close ? 12 : 6,
        sentenceMax: close ? 36 : 28,
        dialogueMin: 20,
        dialogueMax: 45,
        bannedWords: ['一股难以言喻的情绪涌上心头'],
        styleArc: `开端建立${direction?.tone ?? '作品基调'}；冲突加剧时收紧；结尾允许舒缓。`,
      },
    }));
  if (step === 2)
    return [false, true].map((pair, i) => ({
      id: prefix + '-' + i,
      title: pair ? '双人关系' : '单一主角',
      summary: pair ? '以两人的不同需求形成行动阻力。' : '集中刻画一个人的选择与变化。',
      content: {
        kind: 'world',
        characters: [
          {
            id: plan.projectId + '-lead',
            name: '林舟',
            want: '完成一项关乎生计的委托',
            need: '学会接受他人的帮助',
            flaw: '把独自承担当成可靠',
            arc: '从回避合作到主动承担关系中的责任',
            hardTraits: '做事前会反复核对细节',
            confirmed: false,
          },
          ...(pair
            ? [
                {
                  id: plan.projectId + '-partner',
                  name: '许宁',
                  want: '证明自己的办法有效',
                  need: '理解别人的坚持有其理由',
                  flaw: '急于给出答案',
                  arc: '从说服别人到真正倾听',
                  hardTraits: '习惯随身带一本小册子',
                  confirmed: false,
                },
              ]
            : []),
        ],
        rules: [
          {
            id: plan.projectId + '-rule',
            text: '人物只能依据自己已知的信息行动；未解释的能力不得作为解决冲突的捷径。',
            confirmed: false,
          },
        ],
      },
    }));
  const count = Math.max(3, Math.min(12, Math.ceil(plan.brief.targetWords / 8000)));
  return [false, true].map((slow, i) => {
    const acts = [
      { id: 'act1', title: '第一幕 · 开局与承诺' },
      { id: 'act2', title: '第二幕 · 代价与转变' },
      { id: 'act3', title: '第三幕 · 选择与余波' },
    ];
    const outline: OutlineDraft = {
      kind: 'outline',
      acts,
      chapters: Array.from({ length: count }, (_, index) => ({
        id: `${plan.projectId}-ch${index + 1}`,
        actId: acts[Math.min(2, Math.floor((index * 3) / count))].id,
        title:
          index === 0
            ? slow
              ? '生活里的裂缝'
              : '无法推迟的委托'
            : index === count - 1
              ? '留下的回声'
              : `选择的代价 ${index}`,
        purpose:
          index === 0
            ? '建立人物欲望，让日常被一个具体事件打断。'
            : index === count - 1
              ? '用行动完成选择，呈现代价与关系变化。'
              : '让前一章的选择产生后果，再逼出新的行动。',
        scenes:
          index === 0
            ? [
                {
                  id: plan.projectId + '-scene1',
                  title: '事情发生的那一天',
                  beats: [
                    {
                      id: plan.projectId + '-beat1',
                      title: '进入日常',
                      description: '通过具体动作呈现人物处境。',
                    },
                    {
                      id: plan.projectId + '-beat2',
                      title: '打破平衡',
                      description: '委托到来，主角必须作出回应。',
                    },
                  ],
                },
              ]
            : [],
      })),
    };
    return {
      id: prefix + '-' + i,
      title: slow ? '日常渐变' : '事件先行',
      summary: slow ? '先建立人与生活的联系，再让变化到来。' : '开篇即给人物一道无法回避的选择。',
      content: outline,
    };
  });
}
export function basis(plan: BookPlan, step: PlanStep): string {
  return JSON.stringify([
    plan.brief,
    ...plan.steps
      .slice(0, step)
      .map((s) => s.candidates.find((c) => c.id === s.selectedId)?.content ?? null),
  ]);
}
