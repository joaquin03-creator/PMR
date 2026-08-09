import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, collection, getDocs, doc, getDoc } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json' with { type: 'json' };

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

async function run() {
  // NOTE: Credentials must be supplied via local .env file (SCRIPT_AUTH_EMAIL and SCRIPT_AUTH_PASSWORD)
  const email = process.env.SCRIPT_AUTH_EMAIL;
  const password = process.env.SCRIPT_AUTH_PASSWORD;

  if (!email || !password) {
    console.error('Error: SCRIPT_AUTH_EMAIL and SCRIPT_AUTH_PASSWORD environment variables must be defined in local .env');
    process.exit(1);
  }

  await signInWithEmailAndPassword(auth, email, password);

  const invoicesSnap = await getDocs(collection(db, 'invoices'));
  const targetNumbers = ['INV-810117', 'INV-464475'];
  
  const foundInvoices: any[] = [];
  for (const docSnap of invoicesSnap.docs) {
    const data = docSnap.data();
    if (targetNumbers.includes(data.invoiceNumber) || targetNumbers.includes(docSnap.id)) {
      foundInvoices.push({ id: docSnap.id, ...data });
    }
  }

  console.log('=== TARGET INVOICES FOUND ===');
  console.log(JSON.stringify(foundInvoices, null, 2));

  // Also fetch current live inventory map
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

  console.log('\n=== PREVIEW DEDUCTIONS FOR BOTH INVOICES ===');

  for (const inv of foundInvoices) {
    console.log(`\n--------------------------------------------------`);
    console.log(`Invoice: ${inv.invoiceNumber} | Doc ID: ${inv.id}`);
    console.log(`Buyer: ${inv.buyerName} | Date: ${inv.date} | Status: ${inv.status} | Total: $${inv.totalAmount}`);
    console.log(`inventoryDeducted: ${inv.inventoryDeducted} | inventoryDeductedAt: ${inv.inventoryDeductedAt}`);

    const lineItems = inv.materials || [];
    console.log(`Line items count: ${lineItems.length}`);

    // Aggregate weight by materialId
    const reqByMat: Record<string, number> = {};
    lineItems.forEach((item: any, idx: number) => {
      const matId = item.materialId;
      const weight = Number(item.weight) || 0;
      console.log(`  Line #${idx+1}: matId="${matId}" name="${item.customName || (matMap[matId]?.name)}" weight=${weight} lbs @ $${item.salePrice}`);
      if (matId) {
        reqByMat[matId] = (reqByMat[matId] || 0) + weight;
      }
    });

    console.log(`\n  Material level breakdown:`);
    let wouldGoNegative = false;

    for (const [matId, reqWeight] of Object.entries(reqByMat)) {
      const current = invMap[matId] ?? 0;
      const resulting = current - reqWeight;
      const matInfo = matMap[matId];
      const matLabel = matInfo ? `${matInfo.name} (${matInfo.code})` : matId;

      console.log(`   • Material: ${matLabel} [ID: ${matId}]`);
      console.log(`     - Current Live Inventory: ${current.toLocaleString()} lbs`);
      console.log(`     - Required Deduction:    ${reqWeight.toLocaleString()} lbs`);
      console.log(`     - Resulting Inventory:   ${resulting.toLocaleString()} lbs`);

      if (resulting < 0) {
        wouldGoNegative = true;
        console.log(`     ⚠️ WOULD GO NEGATIVE by ${Math.abs(resulting).toLocaleString()} lbs!`);
      }
    }

    if (inv.inventoryDeducted) {
      console.log(`\n  [IDEMPOTENCY CHECK]: inventoryDeducted is ALREADY TRUE! Will be SKIPPED.`);
    } else if (wouldGoNegative) {
      console.log(`\n  [DECISION]: BLOCKED due to negative inventory resulting on one or more lines.`);
    } else {
      console.log(`\n  [DECISION]: READY TO APPLY (All resulting inventory levels >= 0).`);
    }
  }

  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
