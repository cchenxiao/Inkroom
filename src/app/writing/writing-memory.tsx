import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { backendApi } from '@/shared/api/client';
import { Button } from '@/shared/ui';

type MemoryResult = {
  visibleCount: number;
  context: {
    view: { at: { chapter: number; storyTime: number } };
    mode: string;
    hits: {
      digest: string;
      record: {
        id: string;
        kind: string;
        text: string;
        version: number;
        chapterId: string;
        at: { chapter: number };
      };
    }[];
  };
};

export function WritingMemory({ runId, beatId }: { runId?: string; beatId: string }) {
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [audience, setAudience] = useState<'character' | 'author'>('character');
  const result = useQuery({
    queryKey: ['writing-memory', runId, beatId, query, audience],
    enabled: !!runId && !!query,
    queryFn: ({ signal }) =>
      backendApi.get<MemoryResult>(
        `/runs/${runId}/memory?${new URLSearchParams({ q: query, beatId, audience })}`,
        signal,
      ),
    retry: false,
  });
  return (
    <section className="page-stack" aria-label="前情检索">
      <h3>查找前情与依据</h3>
      <p className="muted">
        {audience === 'character'
          ? '查看当前人物在本段时点已知的材料，与写作检索使用同一范围。'
          : '查阅此前定稿的事实和原文。这里的内容不会自动变成人物已知事实。'}
      </p>
      {!runId ? (
        <p>生成候选后，可以查看这次写作使用的前情范围。</p>
      ) : (
        <>
          <div className="tab-list" role="group" aria-label="检索范围">
            <Button
              aria-pressed={audience === 'character'}
              onClick={() => setAudience('character')}
            >
              人物已知
            </Button>
            <Button aria-pressed={audience === 'author'} onClick={() => setAudience('author')}>
              作者查阅
            </Button>
          </div>
          <form
            className="page-stack"
            onSubmit={(e) => {
              e.preventDefault();
              if (text.trim() === query) void result.refetch();
              else setQuery(text.trim());
            }}
          >
            <label>
              人物、物件或事件
              <input
                value={text}
                maxLength={500}
                onChange={(e) => setText(e.target.value)}
                placeholder="例如：钥匙、缺页、渡口"
              />
            </label>
            <Button type="submit" disabled={!text.trim() || result.isFetching}>
              {result.isFetching ? '正在查找…' : '查找前情'}
            </Button>
          </form>
          {result.error && (
            <div role="alert">
              <p>{result.error.message}</p>
              <Button onClick={() => void result.refetch()}>重新查找</Button>
            </div>
          )}
          {result.data && (
            <>
              <p role="status">
                找到 {result.data.context.hits.length} 条相关材料 · 当前范围内共{' '}
                {result.data.visibleCount} 条可用材料
              </p>
              {result.data.context.hits.map((hit) => (
                <article className="ui-card" key={hit.digest}>
                  <strong>
                    {hit.record.kind === 'fact' ? '已确认事实' : '定稿原文'} ·{' '}
                    {hit.record.at.chapter === 0 ? '初始设定' : `第 ${hit.record.at.chapter} 章`}
                  </strong>
                  <p>
                    {hit.record.text.length > 180
                      ? `${hit.record.text.slice(0, 180)}…`
                      : hit.record.text}
                  </p>
                  <details>
                    <summary>原文与来源</summary>
                    {hit.record.text.length > 180 && <p>{hit.record.text}</p>}
                    <p>v{hit.record.version}</p>
                    <code>{hit.record.id}</code>
                  </details>
                </article>
              ))}
            </>
          )}
        </>
      )}
    </section>
  );
}
