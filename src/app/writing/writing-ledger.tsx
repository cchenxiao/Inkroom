import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/shared/ui';
import { useBookArchive } from '@/features/prepare/api/book-archive';
import { liveWorkspacePath } from '@/shared/lib/writing-mode';

export function WritingLedger({
  mode,
  chapterNumber,
}: {
  mode: 'timeline' | 'knowledge';
  chapterNumber: number;
}) {
  const q = useBookArchive();
  const [character, setCharacter] = useState('');
  if (q.isError)
    return (
      <div role="alert">
        <p>{q.error.message}</p>
        <Button onClick={() => void q.refetch()}>重新读取事实</Button>
      </div>
    );
  if (!q.data) return <p role="status">正在读取已定稿事实…</p>;
  const b = q.data;
  const facts = b.chapters
    .filter((c) => c.number <= chapterNumber)
    .flatMap((c) => c.facts.map((f) => ({ ...f, chapter: c })));
  const visible = facts
    .filter((f) => !character || f.knownBy.includes(character))
    .sort((a, b) => a.storyTime - b.storyTime || a.chapter.number - b.chapter.number);
  return (
    <section
      className="page-stack"
      aria-label={mode === 'timeline' ? '已定稿事件与事实' : '已确认角色知情'}
    >
      <div className="page-actions">
        <h3>{mode === 'timeline' ? '已定稿事件与事实' : '已确认角色知情'}</h3>
        <Button size="sm" loading={q.isFetching} onClick={() => void q.refetch()}>
          更新
        </Button>
      </div>
      <p className="muted">
        来自第 {chapterNumber}{' '}
        章及之前的定稿记录。未记录知情不代表角色一定不知情；这里不会自动补全。
      </p>
      {mode === 'knowledge' && (
        <label>
          按人物查看
          <select value={character} onChange={(e) => setCharacter(e.target.value)}>
            <option value="">全部人物与未分配事实</option>
            {Object.entries(b.characters).map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
      )}
      <p>{visible.length} 条已定稿事实</p>
      {visible.map((f) => (
        <article className="ui-card" key={`${f.chapter.publicationId}/${f.id}`}>
          <small>
            第 {f.chapter.number} 章 · 故事时点 {f.storyTime}
            {!f.chapter.current && ' · 历史定稿'}
          </small>
          <p>{f.text}</p>
          <p className="muted">
            明确知情：{f.knownBy.map((id) => b.characters[id] ?? id).join('、') || '未记录'}
          </p>
          <details>
            <summary>原文依据与来源</summary>
            <blockquote>{f.evidence.quote}</blockquote>
            <p>
              {f.chapter.title} · 定稿 v{f.chapter.version}
            </p>
            {!f.chapter.current && <p>{f.chapter.reason}</p>}
            <Link to={liveWorkspacePath(f.chapter.chapterId, 'assembly')}>打开来源章节</Link>
          </details>
        </article>
      ))}
      {!visible.length && <p>尚无符合范围的已定稿事实。完成章末事实确认与定稿后，会在这里显示。</p>}
      <details>
        <summary>
          初始设定 ·{' '}
          {
            b.initialFacts.filter(
              (f) => !character || f.knownBy.some((k) => k.characterId === character),
            ).length
          }{' '}
          条
        </summary>
        {b.initialFacts
          .filter((f) => !character || f.knownBy.some((k) => k.characterId === character))
          .map((f) => (
            <article key={f.id}>
              <p>{f.text}</p>
              <small>
                故事时点 {f.storyTime ?? '未确定'} · 明确知情：
                {f.knownBy
                  .map(
                    (k) =>
                      `${b.characters[k.characterId] ?? k.characterId}（时点 ${k.learnedAt ?? '未确定'}）`,
                  )
                  .join('、') || '未记录'}
              </small>
            </article>
          ))}
      </details>
    </section>
  );
}
