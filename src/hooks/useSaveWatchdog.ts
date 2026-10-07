import { useEffect, useState } from 'react';
import { waitForPendingWrites } from 'firebase/firestore';
import { db } from '../firebase';

const STALL_AFTER_MS = 60 * 1000;
const RECHECK_EVERY_MS = 15 * 1000;

/**
 * True when this tab's writes have gone unconfirmed by the server for over a minute
 * while the browser reports it is online.
 *
 * This is the real version of what the old "laptop closure or battery loss was detected"
 * banner only claimed to be. On 2026-10-06 a tab kept accepting tickets for over an hour
 * while none of its writes were reaching the server, with nothing on screen to say so.
 *
 * It asks Firestore to resolve once everything currently queued has been confirmed. With
 * nothing queued that is immediate; if the client is wedged it never resolves -- which is
 * exactly the state to warn about.
 */
export function useSaveWatchdog(enabled: boolean): boolean {
  const [stalled, setStalled] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let recheckTimer: ReturnType<typeof setTimeout> | undefined;

    const check = async () => {
      if (cancelled) return;
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        // Offline is already shown by the online/offline indicator.
        setStalled(false);
        recheckTimer = setTimeout(check, RECHECK_EVERY_MS);
        return;
      }

      let settled = false;
      const stallTimer = setTimeout(() => {
        if (!settled && !cancelled && (typeof navigator === 'undefined' || navigator.onLine)) {
          setStalled(true);
        }
      }, STALL_AFTER_MS);

      try {
        await waitForPendingWrites(db);
      } catch {
        // Rejected when the signed-in user changes; just check again.
      }
      settled = true;
      clearTimeout(stallTimer);
      if (cancelled) return;
      setStalled(false);
      recheckTimer = setTimeout(check, RECHECK_EVERY_MS);
    };

    check();
    return () => {
      cancelled = true;
      if (recheckTimer) clearTimeout(recheckTimer);
    };
  }, [enabled]);

  return stalled;
}
