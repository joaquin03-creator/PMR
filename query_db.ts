import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, query, orderBy, limit } from 'firebase/firestore';
import fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function main() {
  try {
    const q = query(collection(db, 'cashSessions'), orderBy('date', 'desc'), limit(30));
    const snapshot = await getDocs(q);
    console.log('SESSIONS FOUND:', snapshot.size);
    snapshot.forEach(doc => {
      console.log(`- ID: ${doc.id}, Date: ${doc.get('date')}, Status: ${doc.get('status')}, Expected: ${doc.get('expectedCash')}, Actual: ${doc.get('actualCash')}`);
    });
  } catch (err) {
    console.error('ERROR QUERYING:', err);
  }
}

main();
