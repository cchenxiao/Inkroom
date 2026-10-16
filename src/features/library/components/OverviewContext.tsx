import { useState } from 'react';
import { ArrowUpRight, Bookmark, Users, Waves } from 'lucide-react';
import { Badge, Button, Card, Progress, Select } from '@/shared/ui';
import { libraryMessages as t } from '@/shared/lib/messages-library';
import type { BookOverview } from '@/types/domain/library';

export default function OverviewContext({
  book,
  onPrepare,
  onChapter,
}: {
  book: BookOverview;
  onPrepare: (section: string) => void;
  onChapter: (chapterId: string, segmentId?: string) => void;
}) {
  const [filter, setFilter] = useState('all');
  const foreshadows = book.bible.foreshadows.filter(
    (item) =>
      filter === 'all' ||
      (filter === 'overdue' ? item.overdue && item.status === 'open' : item.status === filter),
  );
  const style = book.bible.style;
  const rhythm = style.statisticalTargets.rhythm;
  const maxRhythm = Math.max(1, ...rhythm);
  return (
    <div className="overview-context">
      <Card>
        <div className="overview-panel-heading">
          <h2>
            <Users size={16} />
            {t.characters}
          </h2>
          <Button variant="ghost" size="sm" onClick={() => onPrepare('world')}>
            {t.edit}
            <ArrowUpRight size={12} />
          </Button>
        </div>
        {!book.confirmed.world ? (
          <Pending onClick={() => onPrepare('world')} />
        ) : book.bible.characters.length ? (
          <div className="overview-character-list">
            {book.bible.characters.map((character) => (
              <article key={character.id} className="overview-character">
                <div className="overview-character-name">
                  <strong>{character.name}</strong>
                  <small>{character.role}</small>
                </div>
                <dl>
                  <div>
                    <dt>想要</dt>
                    <dd>{character.want || '尚未设定'}</dd>
                  </div>
                  <div>
                    <dt>需要</dt>
                    <dd>{character.need || '尚未设定'}</dd>
                  </div>
                </dl>
                <div className="overview-arc">
                  <span>{character.arcStage || '弧光待完善'}</span>
                  <small>{Math.round(character.arcProgress)}%</small>
                </div>
                <Progress value={character.arcProgress} label={`${character.name}人物弧光`} />
              </article>
            ))}
          </div>
        ) : (
          <p className="muted">尚未设定人物</p>
        )}
      </Card>
      <Card>
        <div className="overview-panel-heading">
          <h2>
            <Bookmark size={16} />
            {t.foreshadows}
          </h2>
          <Button variant="ghost" size="sm" onClick={() => onPrepare('world')}>
            管理
            <ArrowUpRight size={12} />
          </Button>
        </div>
        {!book.confirmed.world ? (
          <Pending onClick={() => onPrepare('world')} />
        ) : (
          <>
            <Select
              aria-label="筛选伏笔"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            >
              <option value="all">全部伏笔</option>
              <option value="open">未回收</option>
              <option value="overdue">已逾期</option>
              <option value="closed">已回收</option>
              <option value="abandoned">已放弃</option>
            </Select>
            <div className="overview-foreshadows">
              {foreshadows.length ? (
                foreshadows.map((item) => {
                  const planted = book.chapters.find(
                    (chapter) => chapter.id === item.plantedChapter,
                  );
                  const resolve = book.chapters.find(
                    (chapter) => chapter.id === item.planResolveChapter,
                  );
                  return (
                    <button
                      key={item.id}
                      onClick={() => onChapter(item.plantedChapter, item.plantedSegment)}
                    >
                      <span>
                        <strong>{item.title}</strong>
                        <Badge
                          tone={
                            item.status === 'closed'
                              ? 'success'
                              : item.overdue
                                ? 'warning'
                                : 'foreshadow'
                          }
                        >
                          {item.status === 'closed'
                            ? '已回收'
                            : item.status === 'abandoned'
                              ? '已放弃'
                              : item.overdue
                                ? '已逾期'
                                : '未回收'}
                        </Badge>
                      </span>
                      <small>
                        {planted ? `第 ${planted.number} 章埋下` : '埋点待完善'} ·{' '}
                        {resolve ? `计划第 ${resolve.number} 章回收` : '回收章节待定'}
                      </small>
                    </button>
                  );
                })
              ) : (
                <p className="muted">此筛选下暂无伏笔</p>
              )}
            </div>
          </>
        )}
      </Card>
      <Card>
        <div className="overview-panel-heading">
          <h2>
            <Waves size={16} />
            {t.style}
          </h2>
          <Button variant="ghost" size="sm" onClick={() => onPrepare('style')}>
            {t.edit}
            <ArrowUpRight size={12} />
          </Button>
        </div>
        {!book.confirmed.style ? (
          <Pending onClick={() => onPrepare('style')} />
        ) : (
          <>
            <div className="overview-style-tags">
              <Badge>{style.pov || '视角待完善'}</Badge>
              <Badge>{style.tense || '时态待完善'}</Badge>
              <Badge tone="ai">{style.tone || '基调待完善'}</Badge>
            </div>
            <dl className="overview-style-metrics">
              <div>
                <dt>目标句长</dt>
                <dd>{style.statisticalTargets.sentenceLength} 字</dd>
              </div>
              <div>
                <dt>对白占比</dt>
                <dd>{Math.round(style.statisticalTargets.dialogueRatio * 100)}%</dd>
              </div>
            </dl>
            <div
              className="overview-rhythm"
              role="img"
              aria-label={`目标节奏曲线：${rhythm.join('、') || '暂无数据'}`}
            >
              <span>目标节奏</span>
              <div>
                {rhythm.map((value, index) => (
                  <i key={index} style={{ height: `${Math.max(4, (value / maxRhythm) * 100)}%` }} />
                ))}
              </div>
            </div>
            {style.anchorText && (
              <blockquote className="overview-style-anchor">{style.anchorText}</blockquote>
            )}
            <p className="muted">
              避用词 · {style.bannedWords.length ? style.bannedWords.join('、') : '尚无'}
            </p>
          </>
        )}
      </Card>
    </div>
  );
}
function Pending({ onClick }: { onClick: () => void }) {
  return (
    <div className="overview-pending">
      <Badge>{t.pending}</Badge>
      <p>{t.pendingHint}</p>
      <Button size="sm" onClick={onClick}>
        前往确认
      </Button>
    </div>
  );
}
