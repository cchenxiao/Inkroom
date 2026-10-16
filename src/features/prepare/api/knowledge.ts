import { backendApi } from '@/shared/api/client';
import type { StoredKnowledge } from '../types/knowledge';

export const knowledgeKeys = {
  version: (version: number) => ['backend-knowledge', 'zhuoliu', 'main', version] as const,
};
export const knowledgeApi = {
  get: (version: number, signal?: AbortSignal) =>
    backendApi.get<StoredKnowledge>(`/knowledge${version ? `?version=${version}` : ''}`, signal),
};
