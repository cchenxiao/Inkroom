import type { BibleKind } from '@/types/domain';
/** Fully shaped local candidates remain unsaved until their API preview is approved. */
export function newBibleEntry(kind: BibleKind, chapterId: string): Record<string, unknown> {
  const id = `${kind}-${crypto.randomUUID()}`;
  const defaults: Record<BibleKind, Record<string, unknown>> = {
    characters: {
      name: '',
      role: '',
      description: '',
      want: '',
      need: '',
      flaw: '',
      arcStage: '',
      arcProgress: 0,
      hardTraits: {},
      voice: {
        register: '',
        sentenceStyle: '',
        catchphrases: [],
        tags: [],
        radar: [0, 0, 0, 0, 0],
      },
      knows: {},
      statusAtChapter: {},
      locked: false,
    },
    rules: { title: '', rule: '', scope: '', rigidity: 'hard', locked: false },
    timeline: { title: '', storyTime: '', chapterId, summary: '', causalBefore: [] },
    foreshadows: {
      title: '',
      plantedChapter: chapterId,
      plantedSegment: '',
      payload: '',
      planResolveChapter: chapterId,
      status: 'open',
      importance: 'P2',
      overdue: false,
    },
    info: { fact: '', knownBy: {}, disclosedChapter: chapterId, source: '' },
    style: {
      anchorText: '',
      statisticalTargets: { sentenceLength: 20, dialogueRatio: 0.3, rhythm: [] },
      bannedWords: [],
      pov: '',
      tense: '',
      tone: '',
      locked: false,
    },
  };
  return { id, ...defaults[kind] };
}
