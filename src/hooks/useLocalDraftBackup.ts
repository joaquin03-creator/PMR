import { useEffect, useRef } from 'react';
import { safeSetItem } from '../lib/safeStorage';

/**
 * Standard crash-safety layer for any multi-field data-entry form, sheet, or
 * count session that takes more than a few seconds to fill out (Material
 * Inventory Sheet, Physical Count Mode, and anything built the same way
 * going forward).
 *
 * A form that only persists on final submit loses everything if the tab is
 * killed first -- crash, accidental swipe/back-gesture on a tablet, OS
 * backgrounding the browser. This hook mirrors in-progress form state to
 * localStorage on a short debounce so a killed tab can never lose more than
 * a few hundred ms of work, independent of network and independent of
 * whether the form has a live backing document to autosave to.
 *
 * Built on the existing draft-storage convention in `lib/safeStorage.ts`
 * (used by CashDrawer's count/denom drafts and Invoices' new-invoice draft):
 * keys are plain strings written via `safeSetItem` (quota-safe, auto-prunes
 * on QuotaExceededError) and read back with plain `localStorage.getItem`.
 * PASS A KEY STARTING WITH `pm_draft_` so it's covered by the existing
 * `clearAllPrunableStorage()` emergency-purge and by `pruneDraftStorage()`
 * for the `cash_*_draft_*` shape -- for anything else, prune it yourself
 * (e.g. clear on successful submit) since nothing else will.
 *
 * Usage:
 *   const draft = readDraft<MyShape>('pm_draft_myform_' + formId); // before first write
 *   // ...if draft is newer than the loaded/clean baseline, restore it into state...
 *   useLocalDraftBackup('pm_draft_myform_' + formId, formState, isDirty);
 *   // ...on successful submit: clearDraft('pm_draft_myform_' + formId);
 */

interface StoredDraft<T> {
  value: T;
  savedAt: string;
}

export function readDraft<T>(key: string): StoredDraft<T> | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as StoredDraft<T>;
  } catch {
    return null;
  }
}

export function clearDraft(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

/**
 * Debounced localStorage mirror of `value`, active only while `active` is
 * true (i.e. the form actually has unsaved changes). Also warns on
 * tab close/refresh while active.
 */
export function useLocalDraftBackup<T>(key: string, value: T, active: boolean, debounceMs = 300) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!active) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      safeSetItem(key, JSON.stringify({ value, savedAt: new Date().toISOString() }));
    }, debounceMs);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, value, active, debounceMs]);

  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (active) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [active]);
}
