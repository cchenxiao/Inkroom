/** GET /go-api/planning/overview: current PostgreSQL records, not the demo book contract. */
export interface LiveBook {
  scope: string;
  name: string;
  premise: string;
  genre: string;
  targetWords: string;
  nextSection: string;
  currentChapterId: string;
  nextStage: 'write' | 'assembly';
  confirmed: Record<string, boolean>;
  acceptedWords: number;
  finalizedChapters: number;
  doneBeats: number;
  totalBeats: number;
  chapters: LiveBookChapter[];
  characters: {
    id: string;
    name: string;
    role: string;
    want: string;
    need: string;
    arcIntent: string;
  }[];
  plans: { id: string; intent: string }[];
  style: null | {
    pov: string;
    tense: string;
    tone: string;
    sentenceLength: { min: number; max: number };
    dialogueRatio: { min: number; max: number };
    bannedPhrases: string[];
    styleArc: string;
  };
}
export interface LiveBookChapter {
  id: string;
  title: string;
  act: string;
  number: number;
  targetWords: number;
  status: 'planned' | 'drafting' | 'in_review' | 'human' | 'finalized' | 'stale';
  reason: string;
  acceptedWords: number;
  doneBeats: number;
  totalBeats: number;
  reviewSummary: string;
  historicalPublication: boolean;
}
