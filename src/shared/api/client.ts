import type { ApiErrorBody } from '@/types/domain';
export const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) || '/api';
export class ApiError extends Error {
  constructor(
    public status: number,
    public body: ApiErrorBody,
  ) {
    super(body.message);
    this.name = 'ApiError';
  }
}
/** 真实后端接入仅在这里添加鉴权；REST 和流事件复用地址与请求头。 */
export function apiHeaders() {
  return { 'Content-Type': 'application/json', Accept: 'application/json' };
}
export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { ...apiHeaders(), ...options.headers },
  });
  if (!response.ok) {
    const body = (await response.json()) as ApiErrorBody;
    throw new ApiError(response.status, body);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
export const api = {
  get: <T>(p: string) => request<T>(p),
  post: <T>(p: string, data: unknown = {}) =>
    request<T>(p, { method: 'POST', body: JSON.stringify(data) }),
  patch: <T>(p: string, data: unknown) =>
    request<T>(p, { method: 'PATCH', body: JSON.stringify(data) }),
  delete: <T>(p: string) => request<T>(p, { method: 'DELETE' }),
};
