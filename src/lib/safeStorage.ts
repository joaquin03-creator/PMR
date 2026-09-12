/**
 * safeStorage.ts
 * Robust localStorage wrapper with quota-management, automated pruning of stale drafts,
 * and emergency fallback recovery to prevent QuotaExceededError crashes.
 */

export function isQuotaExceededError(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof DOMException) {
    return (
      err.code === 22 ||
      err.code === 1014 ||
      err.name === 'QuotaExceededError' ||
      err.name === 'NS_ERROR_DOM_QUOTA_REACHED'
    );
  }
  if (typeof err === 'object' && err !== null) {
    const name = (err as any).name;
    const message = (err as any).message;
    if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED') {
      return true;
    }
    if (typeof message === 'string' && (
      message.toLowerCase().includes('quota') ||
      message.toLowerCase().includes('exceeded the quota')
    )) {
      return true;
    }
  }
  return false;
}

/**
 * Removes all draft keys associated with a specific session once finalized or closed.
 */
export function clearSessionDrafts(sessionId: string): void {
  if (!sessionId) return;
  try {
    const knownKeys = [
      `cash_physical_count_draft_${sessionId}`,
      `cash_sheet_denoms_draft_${sessionId}`,
      `cash_opening_denoms_draft_${sessionId}`,
      `cash_opening_cash_draft_${sessionId}`,
      `cash_close_denoms_draft_${sessionId}`
    ];
    for (const key of knownKeys) {
      try {
        localStorage.removeItem(key);
      } catch (e) {
        console.warn(`[safeStorage] Failed to remove key ${key}:`, e);
      }
    }

    // Also remove any other key ending with this sessionId
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && key.startsWith('cash_') && key.includes('_draft_') && key.endsWith(sessionId)) {
        try {
          localStorage.removeItem(key);
        } catch (e) {
          console.warn(`[safeStorage] Failed to remove key ${key}:`, e);
        }
      }
    }
  } catch (err) {
    console.warn('[safeStorage] Error clearing session drafts:', err);
  }
}

/**
 * Prunes orphaned cash drawer draft keys.
 * Removes any draft whose session id is not in allowedSessions (or history limit 30)
 * or whose session date is older than 7 days.
 */
export function pruneDraftStorage(
  allowedSessions?: { id: string; date?: string }[],
  activeSessionId?: string | null
): number {
  let removedCount = 0;
  try {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const allowedMap = new Map<string, string | undefined>();
    if (allowedSessions) {
      allowedSessions.forEach(s => {
        if (s?.id) allowedMap.set(s.id, s.date);
      });
    }

    const draftKeys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('cash_') && k.includes('_draft')) {
        draftKeys.push(k);
      }
    }

    for (const key of draftKeys) {
      const match = key.match(/^cash_.*_draft_(.+)$/);
      if (!match) continue;
      const sessionId = match[1];

      // Always protect the currently active session
      if (activeSessionId && sessionId === activeSessionId) {
        continue;
      }

      if (allowedSessions && allowedSessions.length > 0) {
        // If it's not in the history list, it's orphaned
        if (!allowedMap.has(sessionId)) {
          localStorage.removeItem(key);
          removedCount++;
          continue;
        }

        // If it is in history, check if it's older than 7 days
        const sessionDate = allowedMap.get(sessionId);
        if (sessionDate) {
          const sessionTime = new Date(`${sessionDate}T00:00:00`).getTime();
          if (!isNaN(sessionTime) && sessionTime < sevenDaysAgo) {
            localStorage.removeItem(key);
            removedCount++;
            continue;
          }
        }
      }
    }
  } catch (err) {
    console.warn('[safeStorage] Error during pruneDraftStorage:', err);
  }
  return removedCount;
}

/**
 * Emergency purge of all non-essential and prunable drafts to release storage quota.
 */
export function clearAllPrunableStorage(): number {
  let removedCount = 0;
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      // Prunable prefixes
      if (
        (k.startsWith('cash_') && k.includes('_draft')) ||
        k.startsWith('pm_draft_') ||
        k.startsWith('pm_editing_') ||
        k.startsWith('pmr_compliance_')
      ) {
        keysToRemove.push(k);
      }
    }

    for (const k of keysToRemove) {
      try {
        localStorage.removeItem(k);
        removedCount++;
      } catch {
        // Ignore individual deletion errors
      }
    }
  } catch (err) {
    console.warn('[safeStorage] Error during clearAllPrunableStorage:', err);
  }
  return removedCount;
}

/**
 * Safe wrapper around localStorage.setItem.
 * If QuotaExceededError is caught, purges prunable caches and retries once.
 * Never throws an uncaught error.
 */
export function safeSetItem(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (err: unknown) {
    if (isQuotaExceededError(err)) {
      console.warn(`[safeStorage] QuotaExceededError writing "${key}". Pruning drafts and retrying...`);
      clearAllPrunableStorage();
      try {
        localStorage.setItem(key, value);
        return true;
      } catch (retryErr) {
        console.error(`[safeStorage] Critical: QuotaExceededError persisted after pruning for "${key}":`, retryErr);
        return false;
      }
    } else {
      console.warn(`[safeStorage] Error writing "${key}" to localStorage:`, err);
      return false;
    }
  }
}

/**
 * Safe wrapper around localStorage.getItem.
 */
export function safeGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch (err) {
    console.warn(`[safeStorage] Error reading "${key}":`, err);
    return null;
  }
}

/**
 * Safe wrapper around localStorage.removeItem.
 */
export function safeRemoveItem(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch (err) {
    console.warn(`[safeStorage] Error removing "${key}":`, err);
  }
}

/**
 * Clears localStorage while preserving Firebase authentication tokens.
 */
export function clearStoragePreservingAuth(): void {
  try {
    const authBackups: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith('firebase:authUser') || key.startsWith('firebase:auth') || key.startsWith('firebase:token'))) {
        const val = localStorage.getItem(key);
        if (val !== null) {
          authBackups[key] = val;
        }
      }
    }

    localStorage.clear();

    for (const [k, v] of Object.entries(authBackups)) {
      try {
        localStorage.setItem(k, v);
      } catch (e) {
        console.warn(`[safeStorage] Failed to restore auth key ${k}:`, e);
      }
    }
  } catch (err) {
    console.warn('[safeStorage] Error during clearStoragePreservingAuth:', err);
  }
}
