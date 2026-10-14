import OverviewCharts from './components/OverviewCharts';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Download,
  Sparkles,
  ArrowUpRight,
  BarChart3,
  FlaskConical,
  ShieldCheck,
} from 'lucide-react';
import { useAction, useResource, useTree } from '@/shared/api/hooks';
import { api } from '@/shared/api/client';
import { useUIStore } from '@/shared/lib/ui-store';
import { pages as t } from '@/shared/lib/messages-pages';
import { Button, Badge, Card, Modal, AsyncState, Select, PageHeader, Field } from '@/shared/ui';
import type { ReportOverview, Experiment, RegressionCase, RunState } from '@/types/domain';
import './reports.css';
export default function ReportsPage() {
  const branchId = useUIStore((s) => s.branchId);
  const overview = useResource<ReportOverview>(`/reports/overview?branchId=${branchId}`);
  const experiments = useResource<Experiment[]>('/reports/experiments');
  const regression = useResource<RegressionCase[]>('/reports/regression');
  const tree = useTree();
  const navigate = useNavigate();
  const [tab, setTab] = useState('overview');
  const [sampleId, setSampleId] = useState<string | null>(null);
  const sample = overview.data?.samples.find((item) => item.id === sampleId);
  const [memory, setMemory] = useState('all');
  const [revision, setRevision] = useState('all');
  const [polishOpen, setPolishOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const polish = useAction<RunState, unknown>('/reports/polish');
  const data = overview.data;
  const exportText = async () => {
    setExporting(true);
    setExportError('');
    try {
      const result = await api.get<{ text: string; filename: string }>(
        `/exports?branchId=${branchId}`,
      );
      const url = URL.createObjectURL(
        new Blob([result.text], { type: 'text/plain;charset=utf-8' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = result.filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : t.common.error);
    } finally {
      setExporting(false);
    }
  };
  const filtered =
    experiments.data?.filter(
      (e) =>
        (memory === 'all' || e.memory === (memory === 'on')) &&
        (revision === 'all' || e.revision === (revision === 'on')),
    ) ?? [];
  return (
    <main className="page-content reports-page">
      <PageHeader
        eyebrow={t.reports.eyebrow}
        title={t.reports.title}
        description={t.reports.description}
        actions={
          <>
            <Button disabled={exporting} onClick={() => void exportText().catch(() => undefined)}>
              <Download size={15} />
              {t.common.export}
            </Button>
            <Button
              variant="human"
              disabled={!tree.data?.length}
              onClick={() => {
                setSelected(tree.data?.map((c) => c.id) ?? []);
                setPolishOpen(true);
              }}
            >
              <Sparkles size={15} />
              {t.reports.polish}
            </Button>
          </>
        }
      />
      {exportError && (
        <p role="alert" className="page-error">
          {exportError}
        </p>
      )}
      <div className="report-tabs" role="tablist">
        {[
          { id: 'overview', label: t.reports.overview, icon: BarChart3 },
          { id: 'experiments', label: t.reports.experiments, icon: FlaskConical },
          { id: 'regression', label: t.reports.regression, icon: ShieldCheck },
        ].map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? 'active' : ''}
            onClick={() => setTab(id)}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>
      {tab === 'overview' && (
        <AsyncState
          loading={overview.isLoading}
          error={overview.error}
          onRetry={() => overview.refetch()}
          empty={!data}
        >
          {data && <OverviewCharts data={data} />}
        </AsyncState>
      )}
      {tab === 'experiments' && (
        <>
          <Card className="experiment-controls">
            <p>{t.reports.actual}</p>
            <div className="page-row">
              {[
                { label: t.reports.memory, value: memory, set: setMemory },
                { label: t.reports.revision, value: revision, set: setRevision },
              ].map((field) => (
                <Field key={field.label} label={field.label}>
                  <Select value={field.value} onChange={(e) => field.set(e.target.value)}>
                    <option value="all">{t.reports.all}</option>
                    <option value="on">{t.reports.enabled}</option>
                    <option value="off">{t.reports.disabled}</option>
                  </Select>
                </Field>
              ))}
            </div>
          </Card>
          <AsyncState
            loading={experiments.isLoading}
            error={experiments.error}
            onRetry={() => experiments.refetch()}
          >
            {filtered.length ? (
              <div className="table-scroll">
                <table className="report-table">
                  <thead>
                    <tr>
                      {[
                        t.reports.experiments,
                        t.reports.memory,
                        t.reports.revision,
                        t.reports.tokens,
                        t.reports.cost,
                        t.reports.rounds,
                        t.reports.pass,
                        t.reports.preference,
                        t.reports.samples,
                      ].map((s) => (
                        <th key={s}>{s}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((e) => (
                      <tr key={e.id}>
                        <td>
                          <strong>{e.name}</strong>
                        </td>
                        <td>
                          <Badge tone={e.memory ? 'ai' : 'muted'}>
                            {e.memory ? t.reports.enabled : t.reports.disabled}
                          </Badge>
                        </td>
                        <td>
                          <Badge tone={e.revision ? 'ai' : 'muted'}>
                            {e.revision ? t.reports.enabled : t.reports.disabled}
                          </Badge>
                        </td>
                        <td>{e.tokens.toLocaleString()}</td>
                        <td>{e.cost.toFixed(3)}</td>
                        <td>{e.rounds}</td>
                        <td>{percentage(e.passRate)}</td>
                        <td>{percentage(e.preference)}</td>
                        <td>
                          <div className="experiment-sample-links">
                            {e.sampleIds.map((id) => {
                              const evidence = data?.samples.find((item) => item.id === id);
                              return (
                                <Button
                                  key={id}
                                  variant="ghost"
                                  size="sm"
                                  disabled={!evidence}
                                  disabledReason={t.reports.noSamples}
                                  onClick={() => setSampleId(id)}
                                >
                                  {evidence?.title ?? id}
                                  <ArrowUpRight size={11} />
                                </Button>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Card>
                <p>{t.reports.none}</p>
              </Card>
            )}
          </AsyncState>
        </>
      )}
      {tab === 'regression' && (
        <AsyncState
          loading={regression.isLoading}
          error={regression.error}
          onRetry={() => regression.refetch()}
          empty={!regression.data?.length}
        >
          <div className="page-stack">
            {regression.data?.map((item) => (
              <Card key={item.id}>
                <div className="page-row">
                  <div>
                    <small className="page-eyebrow">{item.category}</small>
                    <h3>{item.name}</h3>
                  </div>
                  <Badge
                    tone={
                      item.status === 'passed'
                        ? 'success'
                        : item.status === 'failed'
                          ? 'danger'
                          : 'muted'
                    }
                  >
                    {t.reports[item.status]}
                  </Badge>
                </div>
                <blockquote>{item.sample}</blockquote>
                <div className="evidence-pair">
                  <div>
                    <small>{t.reports.expected}</small>
                    <p>{item.expected}</p>
                  </div>
                  <div>
                    <small>{t.reports.observed}</small>
                    <p>{item.actual}</p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </AsyncState>
      )}
      <Modal
        open={!!sampleId}
        onOpenChange={(open) => {
          if (!open) setSampleId(null);
        }}
        title={sample?.title ?? t.reports.evidence}
        description={t.reports.evidence}
      >
        {sample && (
          <div className="report-sample-detail">
            <blockquote>{sample.quote}</blockquote>
            <p>{sample.reason}</p>
          </div>
        )}
      </Modal>
      <Modal
        open={polishOpen}
        onOpenChange={setPolishOpen}
        title={t.reports.polishTitle}
        description={t.reports.preserve}
        footer={
          <Button
            variant="human"
            disabled={!selected.length || polish.isPending}
            onClick={() =>
              void polish
                .mutateAsync({ chapterIds: selected, preserveRhythm: true, branchId })
                .then((run) => {
                  setPolishOpen(false);
                  useUIStore.getState().setChapter(run.chapterId);
                  useUIStore.getState().setRun(run.id);
                  useUIStore.getState().setDrawer('half');
                  navigate('/workspace');
                })
                .catch(() => undefined)
            }
          >
            {t.reports.start}
            <ArrowUpRight size={14} />
          </Button>
        }
      >
        <div className="page-stack">
          {tree.data?.map((ch) => (
            <label className="polish-chapter" key={ch.id}>
              <input
                type="checkbox"
                checked={selected.includes(ch.id)}
                onChange={(e) =>
                  setSelected(
                    e.target.checked ? [...selected, ch.id] : selected.filter((id) => id !== ch.id),
                  )
                }
              />
              <span>
                {ch.number.toString().padStart(2, '0')} · {ch.title}
              </span>
              <small>
                {ch.wordCount.toLocaleString()} {t.reports.wordsUnit}
              </small>
            </label>
          ))}
          <p className="quiet">
            {t.reports.selected} · {selected.length}
          </p>
          {polish.error && (
            <p role="alert" className="page-error">
              {polish.error.message}
            </p>
          )}
        </div>
      </Modal>
    </main>
  );
}
function percentage(value: number) {
  return `${Math.round(value <= 1 ? value * 100 : value)}%`;
}
