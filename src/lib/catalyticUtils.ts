import { collection, getDocs, Firestore } from 'firebase/firestore';
import { Material, Customer, BuyTicket } from '../types';

export const isCatalyticConverterMat = (mat: Material | null | undefined): boolean => {
  if (!mat) return false;
  const c = String(mat.code || '').trim();
  return c === '38' || c === '038' || parseInt(c, 10) === 38;
};

export interface CatalyticCheckResult {
  allowed: boolean;
  errorMessage?: string;
}

export const checkCatalyticConverterLimit = async (
  items: { material?: Material | null; materialId: string }[],
  allMaterials: Material[],
  sellerIdNumber: string,
  businessName: string,
  db: Firestore,
  selectedCustomerId?: string,
  allCustomers?: Customer[]
): Promise<CatalyticCheckResult> => {
  // 1. Count code 38 items on current ticket
  const code38CountCurrent = items.filter(item => {
    const mat = item.material || allMaterials.find(m => m.id === item.materialId);
    return isCatalyticConverterMat(mat);
  }).length;

  if (code38CountCurrent === 0) {
    return { allowed: true };
  }

  // 2. Business Name check (Required ONLY when ticket has code 38)
  if (!businessName || !businessName.trim()) {
    return {
      allowed: false,
      errorMessage: "Business Name is required for transactions containing catalytic converters (material code 38) under Ohio law (ORC 4737.04(F)(5))."
    };
  }

  // 3. Fail Safe: Personal ID Number check
  const cleanSellerId = (sellerIdNumber || '').trim();
  if (!cleanSellerId) {
    return {
      allowed: false,
      errorMessage: "An ID number is required to record a catalytic converter under Ohio law. Please enter the seller's personal ID number."
    };
  }

  // 4. Query today's tickets for this seller matched by personal ID number
  const normalizedSellerId = cleanSellerId.replace(/[^A-Za-z0-9]/g, '').toUpperCase();

  // Find all customer IDs that share this normalized ID number
  const matchingCustomerIds = new Set<string>();
  if (selectedCustomerId) {
    matchingCustomerIds.add(selectedCustomerId);
  }
  if (allCustomers && allCustomers.length > 0) {
    allCustomers.forEach(c => {
      const cIdNum = (c.idNumber || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      if (cIdNum && cIdNum === normalizedSellerId) {
        matchingCustomerIds.add(c.id);
      }
    });
  }

  let alreadyRecordedTodayCount = 0;

  try {
    const ticketsRef = collection(db, 'buyTickets');
    const querySnapshot = await getDocs(ticketsRef);

    const now = new Date();
    const todayYear = now.getFullYear();
    const todayMonth = now.getMonth();
    const todayDate = now.getDate();

    querySnapshot.docs.forEach(docSnap => {
      const t = docSnap.data() as BuyTicket;
      if (t.status === 'cancelled' || t.status === 'voided') return;

      if (!t.timestamp) return;
      const tDate = new Date(t.timestamp);
      const isToday =
        tDate.getFullYear() === todayYear &&
        tDate.getMonth() === todayMonth &&
        tDate.getDate() === todayDate;

      if (!isToday) return;

      // Check if ticket belongs to the same seller by ID number or matching customer ID
      const ticketIdNum = (t.idNumber || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
      const matchesByIdNum = Boolean(normalizedSellerId && ticketIdNum && ticketIdNum === normalizedSellerId);
      const matchesByCustId = Boolean(t.customerId && matchingCustomerIds.has(t.customerId));

      if (matchesByIdNum || matchesByCustId) {
        // Count catalytic converters on this past ticket
        (t.materials || []).forEach(m => {
          const mat = allMaterials.find(mat => mat.id === m.materialId);
          if (isCatalyticConverterMat(mat)) {
            alreadyRecordedTodayCount += 1;
          }
        });
      }
    });
  } catch (err) {
    console.error("Error querying today's tickets for catalytic converter daily limit check:", err);
  }

  // Total converters today if this ticket completes:
  const totalToday = alreadyRecordedTodayCount + code38CountCurrent;

  if (totalToday > 1) {
    return {
      allowed: false,
      errorMessage: "Ohio law (ORC 4737.04(F)(5)) allows only one catalytic converter per person per day. This seller's limit for today has been reached."
    };
  }

  return { allowed: true };
};
