import fs from 'fs';
import path from 'path';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const firebaseConfigPath = path.join(process.cwd(), 'firebase-applet-config.json');
const firebaseConfig = JSON.parse(fs.readFileSync(firebaseConfigPath, 'utf8'));

const app = getApps().length === 0 ? initializeApp({ projectId: firebaseConfig.projectId }) : getApps()[0];
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function check() {
  console.log('Querying invoices using getFirestore(app, databaseId)...');
  const invSnap = await db.collection('invoices').get();
  console.log('Total invoices in DB:', invSnap.size);

  const targetNumbers = ['INV-810117', 'INV-464475'];
  
  for (const docSnap of invSnap.docs) {
    const data = docSnap.data();
    if (targetNumbers.includes(data.invoiceNumber) || targetNumbers.includes(docSnap.id)) {
      console.log('\n=== FOUND INVOICE ===');
      console.log('Doc ID:', docSnap.id);
      console.log('Invoice Number:', data.invoiceNumber);
      console.log('Date:', data.date);
      console.log('Status:', data.status);
      console.log('Buyer Name:', data.buyerName);
      console.log('Total Amount:', data.totalAmount);
      console.log('inventoryDeducted:', data.inventoryDeducted);
      console.log('inventoryDeductedAt:', data.inventoryDeductedAt);
      console.log('Materials:', JSON.stringify(data.materials, null, 2));
    }
  }

  console.log('\n=== QUERYING INVENTORY ===');
  const invInventorySnap = await db.collection('inventory').get();
  console.log('Total inventory items in DB:', invInventorySnap.size);
  invInventorySnap.docs.forEach(docSnap => {
    console.log(`Inventory [${docSnap.id}]:`, JSON.stringify(docSnap.data()));
  });

  console.log('\n=== QUERYING MATERIALS ===');
  const matSnap = await db.collection('materials').get();
  console.log('Total materials in DB:', matSnap.size);
  matSnap.docs.forEach(docSnap => {
    console.log(`Material [${docSnap.id}]:`, docSnap.data().name, `(${docSnap.data().code})`);
  });

  process.exit(0);
}

check().catch(err => {
  console.error(err);
  process.exit(1);
});
