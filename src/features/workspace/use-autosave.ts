import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/shared/api/client';
import { endpoints, queryKeys } from '@/shared/api/endpoints';
import { useUIStore } from '@/shared/lib/ui-store';
import type { ChapterDocument } from '@/types/domain';
import { workspaceApi } from './api';
interface DraftBackup {
  baseVersion: number | null;
  drafts: Record<string, string>;
}
function readBackup(storageKey: string, currentVersion: number): DraftBackup {
  try {
    const raw: unknown = JSON.parse(sessionStorage.getItem(storageKey) || 'null');
    if (!raw || typeof raw !== 'object') return { baseVersion: currentVersion, drafts: {} };
    const record = raw as Record<string, unknown>;
    const versioned = record.drafts && typeof record.drafts === 'object';
    const values = versioned ? (record.drafts as Record<string, unknown>) : record;
    const drafts = Object.fromEntries(
      Object.entries(values).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    );
    return {
      baseVersion:
        versioned && typeof record.baseVersion === 'number'
          ? record.baseVersion
          : Object.keys(drafts).length
            ? null
            : currentVersion,
      drafts,
    };
  } catch {
    return { baseVersion: currentVersion, drafts: {} };
  }
}
export function useAutosave(document: ChapterDocument, branchId: string) {
  const client = useQueryClient();
  const key = useMemo(
    () => queryKeys.resource(endpoints.chapter(document.chapter.id, branchId)),
    [document.chapter.id, branchId],
  );
  const latestVersion = useRef(document.chapter.draftVersion);
  latestVersion.current = document.chapter.draftVersion;
  const storageKey = `inkloom-draft:${branchId}:${document.chapter.id}`;
  const [backup] = useState(() => readBackup(storageKey, document.chapter.draftVersion));
  const [drafts, setDrafts] = useState(backup.drafts);
  const pending = useRef(drafts),
    version = useRef<number | null>(backup.baseVersion),
    saving = useRef(false),
    timer = useRef<ReturnType<typeof setTimeout>>();
  // Only our successful responses may advance the base of queued local text.
  const conflict = useRef(false);
  const [needsReconciliation, setNeedsReconciliation] = useState(false);
  const ownAcknowledgements = useRef(new Set<number>());
  const observedDuringSave = useRef<number | null>(null);
  const [status, setStatus] = useState<'saved' | 'dirty' | 'saving' | 'failed'>(
    Object.keys(drafts).length ? 'dirty' : 'saved',
  );
  const markStale = useCallback(() => {
    conflict.current = true;
    setNeedsReconciliation(true);
    useUIStore.getState().setStale(true);
    setStatus('failed');
    clearTimeout(timer.current);
  }, []);
  useEffect(() => {
    const incoming = document.chapter.draftVersion;
    if (!Object.keys(pending.current).length && !saving.current) {
      version.current = incoming;
      return;
    }
    if (incoming === version.current || ownAcknowledgements.current.has(incoming)) return;
    if (saving.current) {
      observedDuringSave.current = incoming;
      return;
    }
    markStale();
  }, [document.chapter.draftVersion, markStale]);
  const publish = useCallback(() => {
    const next = { ...pending.current };
    setDrafts(next);
    sessionStorage.setItem(
      storageKey,
      JSON.stringify({ baseVersion: version.current, drafts: next }),
    );
  }, [storageKey]);
  const flush = useCallback(async () => {
    if (
      saving.current ||
      conflict.current ||
      useUIStore.getState().stale ||
      !Object.keys(pending.current).length
    )
      return;
    if (version.current === null) {
      markStale();
      return;
    }
    saving.current = true;
    setStatus('saving');
    try {
      while (Object.keys(pending.current).length && !useUIStore.getState().stale) {
        const [id, text] = Object.entries(pending.current)[0];
        const result = await workspaceApi.saveSegment(id, text, version.current, branchId);
        version.current = result.draftVersion;
        ownAcknowledgements.current.add(result.draftVersion);
        client.setQueryData<ChapterDocument>(key, (old) =>
          old && old.chapter.draftVersion <= result.draftVersion
            ? {
                ...old,
                chapter: { ...old.chapter, draftVersion: result.draftVersion },
                segments: old.segments.map((segment) =>
                  segment.id === id ? { ...segment, text, version: result.draftVersion } : segment,
                ),
              }
            : old,
        );
        if (pending.current[id] === text) delete pending.current[id];
        publish();
        const observed = observedDuringSave.current;
        if (observed !== null && !ownAcknowledgements.current.has(observed)) {
          markStale();
          break;
        }
        observedDuringSave.current = null;
      }
      setStatus(
        useUIStore.getState().stale
          ? 'failed'
          : Object.keys(pending.current).length
            ? 'dirty'
            : 'saved',
      );
      void client.invalidateQueries({ queryKey: key });
    } catch (error) {
      setStatus('failed');
      if (
        (error instanceof ApiError && error.status === 409) ||
        observedDuringSave.current !== null
      ) {
        markStale();
        void client.invalidateQueries({ queryKey: queryKeys.all });
      }
    } finally {
      saving.current = false;
    }
  }, [branchId, client, key, publish, markStale]);
  const change = useCallback(
    (id: string, text: string) => {
      pending.current[id] = text;
      publish();
      setStatus(useUIStore.getState().stale ? 'failed' : 'dirty');
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), 700);
    },
    [flush, publish],
  );
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      void flush();
    },
    [flush],
  );
  const reconcileToLatest = (confirmedVersion = latestVersion.current) => {
    if (saving.current || confirmedVersion !== latestVersion.current) {
      markStale();
      return false;
    }
    version.current = confirmedVersion;
    conflict.current = false;
    setNeedsReconciliation(false);
    observedDuringSave.current = null;
    ownAcknowledgements.current.clear();
    useUIStore.getState().setStale(false);
    publish();
    setStatus(Object.keys(pending.current).length ? 'dirty' : 'saved');
    return true;
  };
  const acknowledgeRefresh = (refreshedVersion = latestVersion.current) => {
    if (Object.keys(pending.current).length) {
      markStale();
      return;
    }
    version.current = refreshedVersion;
    conflict.current = false;
    setNeedsReconciliation(false);
    useUIStore.getState().setStale(false);
    setStatus('saved');
  };
  return {
    drafts,
    status,
    change,
    flush,
    acknowledgeRefresh,
    reconcileToLatest,
    needsReconciliation,
    hasPending: Object.keys(drafts).length > 0,
    currentVersion: document.chapter.draftVersion,
  };
}
