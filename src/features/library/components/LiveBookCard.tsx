import { Link } from 'react-router-dom';
import { Button, Card, StatNumber } from '@/shared/ui';
import { liveBookText as t } from '@/shared/lib/messages-live-book';
import { useLiveBook } from '../api/live-book';
import { nextBookPath } from '../live-book-path';
export default function LiveBookCard() {
  const q = useLiveBook(),
    b = q.data;
  return (
    <Card
      className="library-book library-book-linked library-live-book library-accent-ai"
      aria-label={b?.name || '浊流'}
    >
      <div className="library-book-body">
        <div className="library-book-title">
          <h2>
            <Link
              className="library-book-entry"
              to="/book/project-zhuoliu?branchId=main"
              aria-label={`打开作品《${b?.name || '浊流'}》`}
            >
              {b?.name || '浊流'}
            </Link>
          </h2>
        </div>
        {q.isError ? (
          <>
            <p role="alert">作品信息暂时无法读取，请重试。</p>
            <Button className="library-book-control" onClick={() => void q.refetch()}>
              {t.refresh}
            </Button>
          </>
        ) : !b ? (
          <p role="status">正在读取作品…</p>
        ) : (
          <>
            <p className="library-logline">{b.premise || t.emptyNote}</p>
            <div className="library-book-meta">
              <span>
                <StatNumber>{b.acceptedWords.toLocaleString()}</StatNumber> 字可采用正文
              </span>
              <span>
                <StatNumber>
                  {b.finalizedChapters} / {b.chapters.length}
                </StatNumber>{' '}
                章定稿
              </span>
            </div>
            <div className="library-book-actions">
              <Link className="ui-button button-primary button-normal" to={nextBookPath(b)}>
                {b.nextSection ? t.prepare : b.nextStage === 'assembly' ? t.review : t.write}
              </Link>
              <Link
                className="ui-button button-secondary button-normal"
                to="/book/project-zhuoliu?branchId=main"
              >
                {t.title}
              </Link>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
