import type { QueryClient, QueryKey } from '@tanstack/react-query';

export async function refreshEventQueries(client: QueryClient, keys: QueryKey[]) {
  // 首次请求尚无缓存时，仅 invalidate 会复用旧请求。先取消其提交资格，再重新读。
  await Promise.all(keys.map((queryKey) => client.cancelQueries({ queryKey })));
  await Promise.all(keys.map((queryKey) => client.invalidateQueries({ queryKey })));
}
