import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));

if (admin.apps.length === 0) {
  admin.initializeApp({
    projectId: firebaseConfig.projectId
  });
}

// Specify the database ID for the custom database
const db = getFirestore(admin.apps[0], firebaseConfig.firestoreDatabaseId);

async function main() {
  try {
    const querySnapshot = await db.collection('cashSessions')
      .orderBy('date', 'desc')
      .limit(30)
      .get();
    
    console.log('ADMIN SESSIONS FOUND:', querySnapshot.size);
    querySnapshot.forEach(doc => {
      console.log(`- ID: ${doc.id}, Date: ${doc.get('date')}, Status: ${doc.get('status')}, Expected: ${doc.get('expectedCash')}, Actual: ${doc.get('actualCash')}`);
    });
  } catch (err) {
    console.error('ADMIN ERROR QUERYING:', err);
  }
}

main();
