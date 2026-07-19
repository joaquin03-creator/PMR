import axios from 'axios';
import fs from 'fs';

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));

async function main() {
  const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${firebaseConfig.firestoreDatabaseId}/documents:runQuery?key=${firebaseConfig.apiKey}`;
  
  const query = {
    structuredQuery: {
      from: [{ collectionId: 'cashSessions' }],
      orderBy: [{ field: { fieldPath: 'date' }, direction: 'DESCENDING' }],
      limit: 30
    }
  };

  try {
    const res = await axios.post(url, query);
    console.log('QUERY SUCCESSFUL, RESULT COUNT:', res.data.length);
    res.data.forEach((item: any) => {
      const doc = item.document;
      if (!doc) return;
      const fields = doc.fields;
      const id = doc.name.split('/').pop();
      console.log(`- ID: ${id}`);
      console.log(`  Date: ${fields.date?.stringValue}`);
      console.log(`  Status: ${fields.status?.stringValue}`);
      console.log(`  OpeningCash: ${fields.openingCash?.doubleValue || fields.openingCash?.integerValue}`);
      console.log(`  ExpectedCash: ${fields.expectedCash?.doubleValue || fields.expectedCash?.integerValue}`);
      console.log(`  ActualCash: ${fields.actualCash?.doubleValue || fields.actualCash?.integerValue}`);
    });
  } catch (err: any) {
    console.error('REST ERROR:', err.response?.data || err.message);
  }
}

main();
