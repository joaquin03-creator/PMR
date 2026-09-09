import { useState, useEffect } from 'react';

let pendingSyncCount = 0;
const syncListeners = new Set<() => void>();

export function incrementPendingSync() {
  pendingSyncCount++;
  syncListeners.forEach((fn) => fn());
}

export function decrementPendingSync() {
  if (pendingSyncCount > 0) {
    pendingSyncCount--;
    syncListeners.forEach((fn) => fn());
  }
}

export function resetPendingSync() {
  pendingSyncCount = 0;
  syncListeners.forEach((fn) => fn());
}

export function getPendingSyncCount() {
  return pendingSyncCount;
}

export function trackOfflineWrite<T>(promise: Promise<T>): Promise<T> {
  const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
  if (isOffline) {
    incrementPendingSync();
    return promise.finally(() => {
      decrementPendingSync();
    });
  }
  return promise;
}

export function useNetworkStatus() {
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [pendingCount, setPendingCount] = useState(pendingSyncCount);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      resetPendingSync();
    };
    const handleOffline = () => {
      setIsOnline(false);
    };

    const updateCount = () => {
      setPendingCount(pendingSyncCount);
    };

    syncListeners.add(updateCount);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      syncListeners.delete(updateCount);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return { isOnline, pendingSyncCount: pendingCount };
}
