import { lazy, Suspense, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useChapter } from '@/shared/api/hooks';
import { useUIStore } from '@/shared/lib/ui-store';
import { studio as t } from '@/shared/lib/messages-studio';
import { AsyncState, Button, Empty, Select } from '@/shared/ui';
const Review = lazy(() => import('@/features/review'));
const ConflictCard = lazy(() =>
  import('@/features/changes').then((module) => ({ default: module.ConflictCard })),
);

/** App composes public feature surfaces; the existing mutations and gates remain in their features. */
export function WorkspaceReview() {
  const attention = useUIStore((s) => s.attention);
  const branchId = useUIStore((s) => s.branchId);
  const query = useChapter();
  const [selected, setSelected] = useState('');
  const conflicts = query.data?.conflicts.filter((c) => c.status === 'open') ?? [];
  const conflict = conflicts.find((c) => c.id === selected) ?? conflicts[0];
  useEffect(() => {
    function onEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && !document.querySelector('[role="dialog"]'))
        useUIStore.getState().setAttention(null);
    }
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, []);
  return (
    <aside className="workspace-review" aria-label={t.reviewHere}>
      <header className="workspace-review-heading">
        <div role="tablist" aria-label={t.reviewHere}>
          {(['review', 'conflicts'] as const).map((tab) => (
            <button
              key={tab}
              role="tab"
              aria-selected={attention === tab}
              onClick={() => useUIStore.getState().setAttention(tab)}
            >
              {tab === 'review' ? t.reviewHere : t.conflictsHere}
            </button>
          ))}
        </div>
        <Button
          size="icon"
          variant="ghost"
          aria-label={t.closeReview}
          onClick={() => useUIStore.getState().setAttention(null)}
        >
          <X size={16} />
        </Button>
      </header>
      <Suspense fallback={<AsyncState loading />}>
        {attention === 'review' ? (
          <Review embedded />
        ) : (
          <div className="workspace-conflicts">
            <AsyncState
              loading={query.isLoading}
              error={query.error}
              onRetry={() => query.refetch()}
            >
              {conflict && query.data ? (
                <>
                  {conflicts.length > 1 && (
                    <Select
                      aria-label={t.selectConflict}
                      value={conflict.id}
                      onChange={(event) => setSelected(event.target.value)}
                    >
                      {conflicts.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.title}
                        </option>
                      ))}
                    </Select>
                  )}
                  <ConflictCard
                    key={`${conflict.id}:${query.data.chapter.draftVersion}`}
                    conflict={conflict}
                    version={query.data.chapter.draftVersion}
                    branchId={branchId}
                  />
                </>
              ) : (
                <Empty title={t.noConflicts} />
              )}
            </AsyncState>
          </div>
        )}
      </Suspense>
    </aside>
  );
}
