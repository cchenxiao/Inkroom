import { backendApi } from '@/shared/api/client';
import type { ChapterPlanVersions } from '../types/chapter-plan';
import type { StoredDraft } from '../types/backend';
export interface AssemblyPart {
  sceneId: string;
  sceneTitle: string;
  beatId: string;
  beatTitle: string;
  commitId: string;
  draftVersion: number;
  segments: StoredDraft['segments'];
}
export interface ChapterAssembly {
  id: string;
  scope: string;
  chapterId: string;
  title: string;
  version: number;
  status: 'awaiting_chapter_review';
  expected: ChapterPlanVersions;
  planVersion: number;
  knowledge: { version: number; digest: string };
  parts: AssemblyPart[];
  digest: string;
  createdAt: string;
}
export interface AssemblyPreview {
  ready: boolean;
  reason: string;
  expectedVersion: number;
  previewDigest: string;
  slots: {
    part: AssemblyPart;
    reason: string;
    choices: {
      commitId: string;
      draftVersion: number;
      createdAt: string;
      eligible: boolean;
      reason: string;
    }[];
  }[];
  draft: ChapterAssembly;
  history: ChapterAssembly[];
}
export interface AssemblySaveRequest {
  requestId: string;
  chapterId: string;
  choices: Record<string, string>;
  expectedVersion: number;
  previewDigest: string;
  confirm: boolean;
}
export const assemblyApi = {
  preview: (chapterId: string, choices: Record<string, string>) =>
    backendApi.post<AssemblyPreview>('/planning/chapter-assemblies/preview', {
      chapterId,
      choices,
    }),
  save: (request: AssemblySaveRequest) =>
    backendApi.post<ChapterAssembly>('/planning/chapter-assemblies', request),
};
