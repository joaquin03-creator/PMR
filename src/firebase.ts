import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentSingleTabManager } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import firebaseConfig from '../firebase-applet-config.json';

export const app = initializeApp(firebaseConfig);
export const db = initializeFirestore(
  app,
  {
    localCache: persistentLocalCache({
      tabManager: persistentSingleTabManager(undefined),
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
