import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, Field, Select, Badge } from '@/shared/ui';
import { liveWorkspacePath } from '@/shared/lib/writing-mode';
import { writingDesk as plannedRunMessages } from '@/shared/lib/messages-writing-desk';
import type { LiveReports } from '../useLiveReports';
export function RunRecords({ live }: { live: LiveReports }) {
  const [revision, setRevision] = useState('all');
  const [chapter, setChapter] = useState('all');
  const [expanded, setExpanded] = useState<string>();
  const runs =
    live.quality.data?.runs.filter(
      (r) =>
        (chapter === 'all' || r.chapterId === chapter) &&
        (revision === 'all' || r.autoRevise === (revision === 'on')),
    ) ?? [];
  return (
    <>
      <Card className="experiment-controls">
        <h2>真实运行记录</h2>
        <p>查看实际生成与复检的状态、模型耗用和失败原因。</p>
        <div className="page-row">
          <Field label="章节">
            <Select value={chapter} onChange={(e) => setChapter(e.target.value)}>
              <option value="all">全部章节</option>
              {live.book.data?.chapters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="自动修订">
            <Select value={revision} onChange={(e) => setRevision(e.target.value)}>
              <option value="all">全部</option>
              <option value="on">已开启</option>
              <option value="off">未开启</option>
            </Select>
          </Field>
        </div>
      </Card>
      <div className="table-scroll">
        <table className="report-table">
          <thead>
            <tr>
              {['章节 / 时间', '状态', '材料检索准备', '自动修订', 'Token', '修订轮次', '详情'].map(
                (t) => (
                  <th key={t}>{t}</th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id}>
                <td>
                  {live.book.data?.chapters.find((c) => c.id === r.chapterId)?.title}
                  <br />
                  <small>{new Date(r.createdAt).toLocaleString('zh-CN')}</small>
                </td>
                <td>
                  <Badge tone={r.status === 'failed' ? 'danger' : 'muted'}>
                    {plannedRunMessages.statuses[
                      r.status as keyof typeof plannedRunMessages.statuses
                    ] ?? r.status}
                  </Badge>
                </td>
                <td>{r.lookup ? '已执行准备' : '未记录'}</td>
                <td>{r.autoRevise ? '开启' : '关闭'}</td>
                <td>{r.tokensKnown ? r.tokens.toLocaleString() : '未提供'}</td>
                <td>{r.reviseRound}</td>
                <td>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setExpanded(expanded === r.id ? undefined : r.id)}
                  >
                    查看记录
                  </Button>
                  {expanded === r.id && (
                    <div className="report-run-detail">
                      <p>模型：{r.model}</p>
                      <p>{r.error || '未记录运行错误'}</p>
                      <Link
                        to={
                          liveWorkspacePath(r.chapterId) +
                          (r.beatId !== '__chapter__'
                            ? '&beatId=' + encodeURIComponent(r.beatId)
                            : '') +
                          '&panel=review'
                        }
                      >
                        打开对应章节
                      </Link>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!runs.length && <p className="quiet">没有符合筛选的运行。</p>}
      </div>
    </>
  );
}
