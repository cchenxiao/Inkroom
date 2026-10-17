import { useEffect, useState } from 'react';
import type { ModelCall } from '@/features/prepare/types/backend';

import './review-progress.css';
type ProgressCall = Pick<ModelCall, 'number' | 'role' | 'activity' | 'startedAt' | 'timeoutMs'> & {
  phase: string;
};
type ProgressRun = { status: string; activeRoles?: string[]; activeCalls?: ProgressCall[] };
const roles = new Set(['hard_consistency', 'chapter_consistency', 'ai_taste', 'chapter_language']);
const activities: Record<string, string> = {
  consistency: '核对事实与设定',
  author_verification: '核对作者修改要求',
  continuity: '核对前后文衔接',
  continuity_objects: '核对物件与数量衔接',
  continuity_characters: '核对人物与动作衔接',
  format_repair: '整理检查结果',
};
function label(call: Pick<ModelCall, 'role' | 'activity'>) {
  return (
    activities[call.activity ?? ''] ??
    (call.role === 'ai_taste' || call.role === 'chapter_language'
      ? '检查语言与重复'
      : '核对事实与设定')
  );
}
function elapsed(call: ProgressCall, now: number) {
  const start = Date.parse(call.startedAt ?? '');
  return Number.isFinite(start) && start > 0 ? Math.max(0, Math.floor((now - start) / 1000)) : null;
}

export function ReviewProgress({ run }: { run?: ProgressRun }) {
  const active = run?.status === 'running';
  const calls = active
    ? (run.activeCalls ?? []).filter((c) => c.phase === 'started' && roles.has(c.role))
    : [];
  const fallback = active ? (run.activeRoles ?? []).filter((role) => roles.has(role)) : [];
  const visible = calls.length > 0 || fallback.length > 0;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!visible) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [visible]);
  if (!visible) return null;
  const slow = calls.some((c) => (elapsed(c, now) ?? 0) >= 20);
  const overdue = calls.some((c) => c.timeoutMs && (elapsed(c, now) ?? 0) * 1000 >= c.timeoutMs);
  return (
    <section className="writing-review-progress" aria-label="检查进度">
      <div role="status">
        <strong>正在检查正文</strong>
        <span>
          {overdue
            ? '等待服务确认检查结果'
            : slow
              ? '耗时较长，你可以继续阅读正文。'
              : '完成后在审核栏查看结果。'}
        </span>
      </div>
      <ul aria-live="off">
        {calls.length
          ? calls.map((c) => (
              <li key={c.number}>
                <span>{label(c)}</span>
                {elapsed(c, now) !== null && (
                  <span className="review-elapsed">已等待 {elapsed(c, now)} 秒</span>
                )}
              </li>
            ))
          : [...new Set(fallback)].map((role) => <li key={role}>{label({ role })}</li>)}
      </ul>
    </section>
  );
}
