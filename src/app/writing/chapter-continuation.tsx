import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/shared/ui';
import { livePreparePath } from '@/shared/lib/writing-mode';
import { useWritingPending } from '@/shared/lib/pending-writing';
import { planningKey } from '@/features/prepare/api/planning';
import {
  advanceChapterContinuation,
  continuationNeedsNewId,
  continuationRetryable,
} from '@/features/prepare/api/chapter-continuation';

export function ChapterContinuation({
  chapterId,
  requestId,
  onDone,
  onRetry,
}: {
  chapterId: string;
  requestId: string;
  onDone: (runId?: string) => void;
  onRetry: (newId: boolean) => void;
}) {
  const client = useQueryClient();
  const done = useRef(onDone);
  done.current = onDone;
  const [message, setMessage] = useState('正在读取本章进度与续章材料…');
  const [error, setError] = useState<unknown>();
  const [attempt, setAttempt] = useState(0);
  useWritingPending(!error);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    setError(undefined);
    const step = async () => {
      try {
        const result = await advanceChapterContinuation(chapterId, requestId);
        if (stopped) return;
        setMessage(result.message);
        await client.invalidateQueries({ queryKey: planningKey });
        if (stopped) return;
        if (result.stage === 'done') {
          await client.invalidateQueries({ queryKey: ['planned-chapter-gate', chapterId] });
          await client.invalidateQueries({ queryKey: ['planned-run-gate', chapterId] });
          if (!stopped) done.current(result.runId);
        } else timer = setTimeout(() => void step(), result.stage === 'planning' ? 1500 : 0);
      } catch (e) {
        if (!stopped) setError(e);
      }
    };
    void step();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [chapterId, requestId, client, attempt]);
  return (
    <section className="chapter-continuation" aria-label="自动续章">
      <h2>{error ? '续章暂未完成' : '正在开始本章创作'}</h2>
      <p role={error ? 'alert' : 'status'}>{error instanceof Error ? error.message : message}</p>
      <p className="muted">
        前章定稿与已确认事实 → 本章细纲 → 整章候选 → 作者审核。已有正文与采用稿保留，本章目标不超过
        3000 字。
      </p>
      {!!error && (
        <div className="page-actions">
          {continuationRetryable(error) && (
            <Button
              onClick={() => {
                if (continuationNeedsNewId(error)) onRetry(true);
                else setAttempt((n) => n + 1);
              }}
            >
              继续本章创作
            </Button>
          )}
          <Link to={livePreparePath('outline', chapterId)}>查看与调整本章细纲</Link>
        </div>
      )}
    </section>
  );
}
