import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import firebaseConfig from '../firebase-applet-config.json';

export const app = initializeApp(firebaseConfig);
export const db = initializeFirestore(
  app,
  {
    localCache: persistentLocalCache({
      // Multi-tab: every tab/window of the app on one machine shares the cache and one of
      // them sends for all. The old single-tab manager let a second tab (or a tab waking
      // from sleep) silently lose the lock -- that tab then stored writes locally and never
      // sent them (2026-10-06: three tickets and 24 drafts sat unsent for ~8 hours).
      // All open tabs must be on the same setting, so every station needs a full reload
      // after this ships.
      tabManager: persistentMultipleTabManager(),
      // Tickets embed their photos (~200 KB each), so one screen's listeners pull 40-170 MB.
      // At the old 40 MB cap the cache could never hold a single screen and every visit
      // re-downloaded it, stalling writes queued behind the download. 1 GB lets each station
      // download the bulk once and then fetch only changes.
      cacheSizeBytes: 1024 * 1024 * 1024
    })
  },
  firebaseConfig.firestoreDatabaseId
);

export const auth = getAuth(app);
export const storage = getStorage(app);
