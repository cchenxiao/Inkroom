import { useQuery } from '@tanstack/react-query';
import { knowledgeApi, knowledgeKeys } from '../api/knowledge';

export function useKnowledge(version: number, enabled: boolean) {
  return useQuery({
    queryKey: knowledgeKeys.version(version),
    queryFn: ({ signal }) => knowledgeApi.get(version, signal),
    enabled,
    retry: false,
    // 当前 head 可被外部 CLI 更新，重新展开或点击刷新都应重新读取。
    staleTime: 0,
  });
}
