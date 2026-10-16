import { readableMessage } from '@/shared/lib/business-labels';
import { useUIStore } from '@/shared/lib/ui-store';
import type { ApiErrorBody } from '@/types/domain';
export const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) || '/api';
export class ApiError extends Error {
  constructor(
    public status: number,
    public body: ApiErrorBody,
  ) {
    super(
      readableMessage(
        body.message,
        status === 409
          ? '内容版本已更新，请刷新后核对。本地输入仍保留。'
          : status === 401 || status === 403
            ? '当前没有访问权限，请检查登录状态或联系管理员。'
            : status === 404
              ? '这份内容已不存在或暂时不可用，请刷新后重新选择。'
              : status >= 500
                ? '服务暂时无法完成操作，请稍后重试。'
                : '操作未完成，请检查填写内容后重试。',
      ),
    );
    this.name = 'ApiError';
  }
}
/** 真实后端接入仅在这里添加鉴权；REST 和流事件复用地址与请求头。 */
export function apiHeaders() {
  return { 'Content-Type': 'application/json', Accept: 'application/json' };
}
export async function request<T>(
  path: string,
  options: RequestInit = {},
  base = API_BASE,
): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: { ...apiHeaders(), ...options.headers },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({
      code: 'service_unavailable',
      message: `HTTP ${response.status}`,
    }))) as ApiErrorBody;
    throw new ApiError(response.status, body);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
/** I3 单段试运行走 Go，其余资源继续由现有 Mock 提供。密钥只保存在后端。 */
export const GO_API_BASE =
  (import.meta.env.VITE_GO_API_BASE_URL as string | undefined) || '/go-api';
export const backendApi = {
  patch: <T>(p: string, data: unknown) =>
    request<T>(p, { method: 'PATCH', body: JSON.stringify(data) }, GO_API_BASE),
  get: <T>(p: string, signal?: AbortSignal) => request<T>(p, { signal }, GO_API_BASE),
  post: <T>(p: string, data: unknown) =>
    request<T>(p, { method: 'POST', body: JSON.stringify(data) }, GO_API_BASE),
};
// 仅 Mock/前端资源使用作品作用域；Go 接口独立，不能把新作品误送给固定的浊流后端。
function scopedPath(path: string) {
  const state = useUIStore.getState();
  const [base, query = ''] = path.split('?');
  const params = new URLSearchParams(query);
  if (!params.has('projectId')) params.set('projectId', state.projectId);
  if (!params.has('branchId')) params.set('branchId', state.branchId);
  return `${base}?${params}`;
}
export const api = {
  get: <T>(p: string) => request<T>(scopedPath(p)),
  post: <T>(p: string, data: unknown = {}) =>
    request<T>(scopedPath(p), { method: 'POST', body: JSON.stringify(data) }),
  patch: <T>(p: string, data: unknown) =>
    request<T>(scopedPath(p), { method: 'PATCH', body: JSON.stringify(data) }),
  delete: <T>(p: string) => request<T>(scopedPath(p), { method: 'DELETE' }),
};
