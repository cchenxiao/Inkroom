import { expect, it } from 'vitest';
import { ApiError } from '@/shared/api/client';
import { readableMessage, textLabel, versionLabel } from './business-labels';

it('preserves actionable business messages and keeps raw exceptions out of the UI', () => {
  expect(readableMessage('请先确认当前 Beat', '操作失败')).toBe('请先确认当前 情节段');
  for (const message of [
    'dial tcp: connection refused',
    'SQLSTATE 23505：写入失败',
    '运行 e5b2c8f7-d73d-4bc0-b613-5d1ce46ba475 失败',
    '解析失败：�',
  ]) {
    const error = new ApiError(503, { code: 'unavailable', message });
    expect(error.message).toBe('服务暂时无法完成操作，请稍后重试。');
    expect(error.body.message).toBe(message);
  }
  expect(new ApiError(409, { code: 'version_mismatch', message: 'stale' }).message).toContain(
    '本地输入仍保留',
  );
});
it('uses content and version labels without inventing names for missing evidence', () => {
  expect(textLabel('沈砚\n收到钥匙', '原文暂缺')).toBe('沈砚 收到钥匙');
  expect(textLabel('', '关联证据暂缺')).toBe('关联证据暂缺');
  expect(versionLabel(2, 'invalid')).toBe('候选 v2');
  expect(versionLabel(2, '2026-10-16T18:41:48+08:00')).toContain('候选 v2');
});
