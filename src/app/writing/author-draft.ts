import { useEffect, useState } from 'react';
import { useWritingPending } from '@/shared/lib/pending-writing';
interface Backup {
  runId: string;
  version: number;
  texts: Record<string, string>;
}
export function useAuthorDraft(runId: string | undefined, version: number | undefined) {
  const [backup, setBackup] = useState<Backup | null>(null);
  const key = runId ? `inkloom-author:${runId}` : '';
  useEffect(() => {
    if (!key) {
      setBackup(null);
      return;
    }
    try {
      const saved = JSON.parse(sessionStorage.getItem(key) ?? 'null') as Backup | null;
      setBackup(
        saved &&
          saved.runId === runId &&
          typeof saved.version === 'number' &&
          saved.texts &&
          Object.values(saved.texts).every((value) => typeof value === 'string')
          ? saved
          : null,
      );
    } catch {
      setBackup(null);
    }
  }, [key, runId]);
  const active = backup?.runId === runId ? backup : null;
  const dirty = !!active && Object.keys(active.texts).length > 0;
  useWritingPending(dirty);
  const change = (id: string, text: string) => {
    if (!runId || version === undefined) return;
    setBackup((old) => {
      const same = old?.runId === runId ? old : null;
      const next = {
        runId,
        version: same && Object.keys(same.texts).length ? same.version : version,
        texts: { ...same?.texts, [id]: text },
      };
      sessionStorage.setItem(key, JSON.stringify(next));
      return next;
    });
  };
  const remove = (id: string) => {
    setBackup((old) => {
      if (!old || old.runId !== runId) return old;
      const next = { ...old, texts: { ...old.texts } };
      delete next.texts[id];
      sessionStorage.setItem(key, JSON.stringify(next));
      return next;
    });
  };
  const clear = () => {
    sessionStorage.removeItem(key);
    setBackup(null);
  };
  return {
    texts: active?.texts ?? {},
    dirty,
    change,
    clear,
    remove,
    stale: dirty && active.version !== version,
  };
}
