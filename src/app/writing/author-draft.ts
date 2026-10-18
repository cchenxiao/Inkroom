import { useEffect, useState } from 'react';
import { useWritingPending } from '@/shared/lib/pending-writing';
import type { BackendRun, HumanAction } from '@/features/prepare/types/backend';

// An HTTP receipt alone does not mean that the currently rendered snapshot
// contains the edit. Retiring the local text early briefly restores old prose.
export function inlineEditVisible(run: BackendRun, action: HumanAction) {
  if (action.type !== 'inline_edit' || !action.segmentId) return false;
  return (
    (run.pendingAction?.type === 'inline_edit' &&
      run.pendingAction.segmentId === action.segmentId &&
      run.pendingAction.text === action.text) ||
    (run.draftVersion > action.draftVersion &&
      !!run.result?.segments.some((s) => s.id === action.segmentId && s.text === action.text))
  );
}
interface Backup {
  runId: string;
  version: number;
  texts: Record<string, string>;
}
export function useAuthorDraft(
  runId: string | undefined,
  version: number | undefined,
  ownerId?: string,
) {
  const [backup, setBackup] = useState<Backup | null>(null);
  const [discarded, setDiscarded] = useState<Backup | null>(null);
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
  useWritingPending(dirty, ownerId);
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
  const discard = () => {
    setDiscarded(active);
    clear();
  };
  const restorable = !dirty && discarded?.runId === runId && discarded?.version === version;
  const restore = () => {
    if (!restorable || !discarded) return;
    sessionStorage.setItem(key, JSON.stringify(discarded));
    setBackup(discarded);
    setDiscarded(null);
  };
  const acknowledgeEdits = (
    sourceRunId: string,
    sourceVersion: number,
    edits: Record<string, string>,
  ) => {
    const sourceKey = `inkloom-author:${sourceRunId}`;
    try {
      const saved = JSON.parse(sessionStorage.getItem(sourceKey) ?? 'null') as Backup | null;
      if (!saved || saved.version !== sourceVersion) return;
      const texts = { ...saved.texts };
      for (const [id, text] of Object.entries(edits)) if (texts[id] === text) delete texts[id];
      const next = { ...saved, texts };
      sessionStorage.setItem(sourceKey, JSON.stringify(next));
      setBackup((old) =>
        old?.runId === sourceRunId && old.version === sourceVersion ? next : old,
      );
    } catch {
      /* Preserve unrecognized backups. */
    }
  };
  const acknowledgeInstruction = (
    sourceRunId: string,
    sourceVersion: number,
    instruction: string,
  ) => {
    const sourceKey = `inkloom-author:instruction:${sourceRunId}`;
    try {
      const saved = JSON.parse(sessionStorage.getItem(sourceKey) ?? 'null') as Backup | null;
      if (saved?.version !== sourceVersion || saved.texts.instruction !== instruction) return;
      sessionStorage.removeItem(sourceKey);
      setBackup((old) =>
        old?.runId === saved.runId &&
        old.version === sourceVersion &&
        old.texts.instruction === instruction
          ? null
          : old,
      );
    } catch {
      /* A damaged backup must not block receipt handling. */
    }
  };
  return {
    acknowledgeInstruction,
    acknowledgeEdits,
    texts: active?.texts ?? {},
    dirty,
    change,
    clear,
    discard,
    restore,
    restorable,
    remove,
    stale: dirty && active.version !== version,
  };
}
