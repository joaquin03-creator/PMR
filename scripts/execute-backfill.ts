import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, collection, getDocs, doc, writeBatch, increment } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json' with { type: 'json' };

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function run() {
  console.log('Authenticating as Manager...');
  // NOTE: Credentials must be supplied via local .env file (SCRIPT_AUTH_EMAIL and SCRIPT_AUTH_PASSWORD)
  const email = process.env.SCRIPT_AUTH_EMAIL;
  const password = process.env.SCRIPT_AUTH_PASSWORD;

  if (!email || !password) {
    console.error('Error: SCRIPT_AUTH_EMAIL and SCRIPT_AUTH_PASSWORD environment variables must be defined in local .env');
    process.exit(1);
  }

  await signInWithEmailAndPassword(auth, email, password);

  console.log('Reading database state...');
  const invoicesSnap = await getDocs(collection(db, 'invoices'));
  const targetNumbers = ['INV-810117', 'INV-464475'];
  
  const foundInvoices: any[] = [];
  for (const docSnap of invoicesSnap.docs) {
    const data = docSnap.data();
    if (targetNumbers.includes(data.invoiceNumber) || targetNumbers.includes(docSnap.id)) {
      foundInvoices.push({ id: docSnap.id, ...data });
    }
  }

  const inventorySnap = await getDocs(collection(db, 'inventory'));
  const invMap: Record<string, number> = {};
  inventorySnap.docs.forEach(docSnap => {
    invMap[docSnap.id] = Number(docSnap.data().currentWeight) || 0;
  });

  const materialsSnap = await getDocs(collection(db, 'materials'));
  const matMap: Record<string, any> = {};
  materialsSnap.docs.forEach(docSnap => {
    matMap[docSnap.id] = { id: docSnap.id, ...docSnap.data() };
  });

  console.log('\n==================================================');
  console.log('ONE-TIME INVENTORY BACKFILL CORRECTION EXECUTION');
  console.log('==================================================\n');

  for (const inv of foundInvoices) {
    console.log(`\n--------------------------------------------------`);
    console.log(`Processing Invoice: ${inv.invoiceNumber} (ID: ${inv.id})`);
    console.log(`Buyer: ${inv.buyerName} | Date: ${inv.date} | Status: ${inv.status} | Total: $${inv.totalAmount}`);

    // STEP 5: IDEMPOTENCY CHECK
    if (inv.inventoryDeducted) {
      console.log(`[IDEMPOTENCY]: SKIPPED - inventoryDeducted is ALREADY TRUE on ${inv.invoiceNumber}. No action taken.`);
      continue;
    }

    const lineItems = inv.materials || [];
    const reqByMat: Record<string, number> = {};
    lineItems.forEach((item: any) => {
      const matId = item.materialId;
      const weight = Number(item.weight) || 0;
      if (matId) {
        reqByMat[matId] = (reqByMat[matId] || 0) + weight;
      }
    });

    // STEP 3: CHECK FOR NEGATIVE RESULTING INVENTORY
    let wouldGoNegative = false;
    const lineReports: string[] = [];

    for (const [matId, reqWeight] of Object.entries(reqByMat)) {
      const current = invMap[matId] ?? 0;
      const resulting = current - reqWeight;
      const matInfo = matMap[matId];
      const matLabel = matInfo ? `${matInfo.name} (${matInfo.code})` : matId;

      lineReports.push(
        `  • ${matLabel} [ID: ${matId}]: Current=${current.toLocaleString()} lbs, Required=${reqWeight.toLocaleString()} lbs, Resulting=${resulting.toLocaleString()} lbs`
      );

      if (resulting < 0) {
        wouldGoNegative = true;
        lineReports.push(`    ⚠️ WOULD GO NEGATIVE BY ${Math.abs(resulting).toLocaleString()} lbs!`);
      }
    }

    console.log(`Material breakdown:\n${lineReports.join('\n')}`);

    if (wouldGoNegative) {
      console.log(`\n[RESULT]: BLOCKED - One or more lines would drop live inventory below zero.`);
      console.log(`Invoice ${inv.invoiceNumber} was NOT deducted and remains untouched for manual review.`);
      continue;
    }

    // STEP 4: APPLY ATOMIC DEDUCTION
    console.log(`\nAll materials have sufficient live inventory. Applying atomic deduction batch...`);
    const batch = writeBatch(db);
    const timestamp = inv.date || new Date().toISOString();

    for (const [matId, reqWeight] of Object.entries(reqByMat)) {
      const invRef = doc(db, 'inventory', matId);
      batch.set(invRef, {
        materialId: matId,
        currentWeight: increment(-reqWeight),
        lastUpdated: new Date().toISOString()
      }, { merge: true });
    }

    const invoiceRef = doc(db, 'invoices', inv.id);
    batch.update(invoiceRef, {
      inventoryDeducted: true,
      inventoryDeductedAt: timestamp
    });

    await batch.commit();

    console.log(`[RESULT]: SUCCESSFULLY APPLIED for ${inv.invoiceNumber}!`);
    console.log(`Set inventoryDeducted: true, inventoryDeductedAt: "${timestamp}".`);

    // Update local invMap for subsequent checks
    for (const [matId, reqWeight] of Object.entries(reqByMat)) {
      invMap[matId] = (invMap[matId] || 0) - reqWeight;
    }
  }

  console.log('\n==================================================');
  console.log('CORRECTION COMPLETED.');
  console.log('==================================================\n');

  process.exit(0);
}

run().catch(err => {
  console.error('Backfill execution failed:', err);
  process.exit(1);
});
