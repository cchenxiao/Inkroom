import { api } from '@/shared/api/client';
import { endpoints } from '@/shared/api/endpoints';
import type {
  ApplyPatchInput,
  ChapterDocument,
  ChangeSet,
  Comment,
  Finding,
  Foreshadow,
  RevisionPatch,
  RunState,
} from '@/types/domain';
export const workspaceApi = {
  saveSegment: (
    id: string,
    text: string,
    draftVersion: number,
    branchId: string,
    isDialogueLie?: boolean,
  ) =>
    api.patch<{ draftVersion: number; changeset: ChangeSet }>(`/segments/${id}`, {
      text,
      draftVersion,
      branchId,
      isDialogueLie,
    }),
  comment: (payload: {
    segmentId: string;
    quote: string;
    text: string;
    draftVersion: number;
    branchId: string;
  }) => api.post<{ comment: Comment; patch: RevisionPatch }>('/comments', payload),
  suggest: (id: string, draftVersion: number, branchId: string) =>
    api.post<RevisionPatch>(`/findings/${id}/suggest`, { draftVersion, branchId }),
  ignore: (id: string, draftVersion: number, branchId: string, reason: string) =>
    api.post<Finding>(`/findings/${id}/ignore`, { draftVersion, branchId, reason }),
  apply: (id: string, payload: ApplyPatchInput) =>
    api.post<ChapterDocument>(`/patches/${id}/apply`, payload),
  discard: (id: string, draftVersion: number, branchId: string) =>
    api.post<RevisionPatch>(`/patches/${id}/discard`, {
      draftVersion,
      branchId,
      acceptedSentenceIds: [],
    }),
  annotate: (foreshadow: Foreshadow, reason: string, draftVersion: number, branchId: string) =>
    api.post<ChangeSet>(endpoints.preview, {
      origin: 'human_inline',
      targetType: 'foreshadows',
      targetId: foreshadow.id,
      new: foreshadow,
      reason,
      draftVersion,
      branchId,
    }),
  redirect: (runId: string, finding: Finding, draftVersion: number, branchId: string) =>
    api.post<RunState>(endpoints.actions(runId), {
      action: 'redirect',
      findingId: finding.id,
      scope: finding.repairScope,
      instruction: finding.suggestion,
      draftVersion,
      branchId,
    }),
};
