import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useState,
  type ReactNode,
} from 'react';
import { useBeforeUnload, useBlocker } from 'react-router-dom';
import { Button, Modal } from '@/shared/ui';
import { liveWriting as t } from './messages-live-writing';
const Context = createContext({
  pending: false,
  entries: {} as Record<string, boolean>,
  set: (() => {}) as (id: string, value: boolean) => void,
});
/** Track only unsaved author input and unresolved writes, never a background model run. */
export function PendingWritingProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<Record<string, boolean>>({});
  const set = useCallback(
    (id: string, value: boolean) =>
      setEntries((old) => {
        if (Boolean(old[id]) === value) return old;
        const next = { ...old };
        if (value) next[id] = true;
        else delete next[id];
        return next;
      }),
    [],
  );
  const pending = Object.keys(entries).length > 0;
  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    if (!pending) return false;
    const current = new URLSearchParams(currentLocation.search),
      next = new URLSearchParams(nextLocation.search);
    const defaults: Record<string, string> = {
      source: 'planned',
      projectId: 'project-zhuoliu',
      branchId: 'main',
    };
    return (
      currentLocation.pathname.replace(/\/+$/, '').toLowerCase() !==
        nextLocation.pathname.replace(/\/+$/, '').toLowerCase() ||
      ['source', 'projectId', 'branchId', 'planningChapterId', 'beatId'].some(
        (key) => (current.get(key) ?? defaults[key]) !== (next.get(key) ?? defaults[key]),
      )
    );
  });
  useBeforeUnload(
    useCallback(
      (event: BeforeUnloadEvent) => {
        if (pending) {
          event.preventDefault();
          event.returnValue = '';
        }
      },
      [pending],
    ),
  );
  return (
    <Context.Provider value={{ pending, entries, set }}>
      {children}
      <Modal
        open={blocker.state === 'blocked'}
        onOpenChange={(open) => {
          if (!open && blocker.state === 'blocked') blocker.reset();
        }}
        title={t.leaveTitle}
        description={t.leaveNote}
        footer={
          <>
            <Button onClick={() => blocker.state === 'blocked' && blocker.reset()}>{t.stay}</Button>
            <Button onClick={() => blocker.state === 'blocked' && blocker.proceed()}>
              {t.leave}
            </Button>
          </>
        }
      >
        {null}
      </Modal>
    </Context.Provider>
  );
}
export function useWritingPending(value: boolean, ownerId?: string) {
  const { set, entries } = useContext(Context),
    generatedId = useId();
  const id = ownerId ?? generatedId;
  useEffect(() => {
    set(id, value);
    return () => set(id, false);
  }, [set, id, value]);
  return Object.keys(entries).some((entry) => entry !== id);
}
export function useWritingLocked(exceptOwner?: string) {
  return Object.keys(useContext(Context).entries).some((id) => id !== exceptOwner);
}
