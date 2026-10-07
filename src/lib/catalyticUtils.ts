import { collection, getDocs, query, where, Firestore } from 'firebase/firestore';
import { Material, Customer, BuyTicket } from '../types';

// PMR material codes that are catalytic converters. The live material is code 33
// ("Catalytic Convertor"); 38 is the code this check was originally written for. Until
// 2026-10-07 only 38 was matched, so the rule below never fired for any real ticket.
const CATALYTIC_CONVERTER_CODES = new Set(['33', '38']);

export const isCatalyticConverterMat = (mat: Material | null | undefined): boolean => {
  if (!mat) return false;
  const c = String(mat.code ?? '').trim().replace(/^0+/, '');
  if (CATALYTIC_CONVERTER_CODES.has(c)) return true;
  // Safety net if the material is ever re-coded: match on the name as well.
  return /catalytic\s+conver/i.test(String(mat.name || ''));
};

/** Information a catalytic-converter ticket should carry. Missing items never block the ticket. */
export type CatalyticFollowUpItem = 'business_name' | 'seller_id_number';

export const CATALYTIC_FOLLOW_UP_LABELS: Record<CatalyticFollowUpItem, string> = {
  business_name: 'Business name',
  seller_id_number: "Seller's ID number"
};

export interface CatalyticCheckResult {
  /** Always true since 2026-10-07: nothing in this check blocks a ticket any more. Kept for callers. */
  allowed: boolean;
  /** Set with dailyLimitExceeded: the notice to show the operator. */
  errorMessage?: string;
  /** True when this ticket takes the seller past one catalytic converter for the day. */
  dailyLimitExceeded?: boolean;
  /** Items to add afterwards. The ticket still completes; it is flagged until they are filled in. */
  missingItems?: CatalyticFollowUpItem[];
}

/**
 * What a saved ticket is still missing for its catalytic converter line(s).
 * Derived from the ticket itself (nothing extra is stored), so it also covers tickets
 * written before this check existed and clears as soon as the information is added.
 */
export const getCatalyticFollowUp = (
  ticket: { materials?: { materialId: string }[]; businessName?: string; idNumber?: string; status?: string } | null | undefined,
  allMaterials: Material[]
): CatalyticFollowUpItem[] => {
  if (!ticket || ticket.status === 'voided' || ticket.status === 'cancelled') return [];
  const hasConverter = (ticket.materials || []).some(m => isCatalyticConverterMat(allMaterials.find(mat => mat.id === m.materialId)));
  if (!hasConverter) return [];
  const missing: CatalyticFollowUpItem[] = [];
  if (!(ticket.businessName || '').trim()) missing.push('business_name');
  if (!(ticket.idNumber || '').trim()) missing.push('seller_id_number');
  return missing;
};

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

  // 2 + 3. Business name and seller ID number: FLAGGED, never blocking (owner decision
  // 2026-10-07). The ticket completes and prints; the missing items are shown on the ticket
  // and the Dashboard until they are added afterwards.
  const missingItems: CatalyticFollowUpItem[] = [];
  if (!businessName || !businessName.trim()) missingItems.push('business_name');
  const cleanSellerId = (sellerIdNumber || '').trim();
  if (!cleanSellerId) missingItems.push('seller_id_number');

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
      if (cIdNum && normalizedSellerId && cIdNum === normalizedSellerId) {
        matchingCustomerIds.add(c.id);
      }
    });
  }

  let alreadyRecordedTodayCount = 0;

  try {
    // Only TODAY's tickets are needed. This used to download the whole buyTickets collection
    // (every ticket with its photos) before the ticket could be saved.
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const todaysTickets = query(collection(db, 'buyTickets'), where('timestamp', '>=', startOfToday.toISOString()));
    // Bounded so a slow lookup can never leave the submit button spinning. On timeout this
    // falls into the catch below and the check continues with this ticket's own count.
    const querySnapshot = await Promise.race([
      getDocs(todaysTickets),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Catalytic converter lookup timed out')), 10000))
    ]);

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

  // One-per-person-per-day: FLAGGED, never blocking (owner decision 2026-10-07). The ticket
  // completes and prints; the screen tells the operator and the ticket is marked for review.
  if (totalToday > 1) {
    return {
      allowed: true,
      missingItems,
      dailyLimitExceeded: true,
      errorMessage: "This seller already has a catalytic converter on a ticket today (limit: one per person per day). The ticket was completed and is flagged for manager review."
    };
  }

  return { allowed: true, missingItems };
};

/**
 * Ids of saved tickets that put a seller past ONE catalytic converter in a local day.
 * Derived across the tickets passed in (nothing extra is stored). Within a seller's day the
 * first converter is fine; every converter line after it marks its ticket.
 */
export const getCatalyticDailyLimitTicketIds = (
  tickets: { id: string; timestamp?: string; status?: string; customerId?: string; idNumber?: string; materials?: { materialId: string }[] }[],
  allMaterials: Material[]
): Set<string> => {
  const flagged = new Set<string>();
  const runningCount = new Map<string, number>();
  const converterTickets = tickets
    .filter(t => t.status !== 'voided' && t.status !== 'cancelled' && t.timestamp)
    .map(t => ({
      ticket: t,
      converters: (t.materials || []).filter(m => isCatalyticConverterMat(allMaterials.find(mat => mat.id === m.materialId))).length
    }))
    .filter(x => x.converters > 0)
    .sort((a, b) => String(a.ticket.timestamp).localeCompare(String(b.ticket.timestamp)));

  for (const { ticket, converters } of converterTickets) {
    const day = new Date(ticket.timestamp as string).toLocaleDateString('en-CA');
    const idNum = (ticket.idNumber || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    // Same seller = same ID number when there is one, otherwise the same customer record.
    const seller = idNum ? `id:${idNum}` : `cust:${ticket.customerId || ticket.id}`;
    const key = `${day}|${seller}`;
    const before = runningCount.get(key) || 0;
    if (before + converters > 1) flagged.add(ticket.id);
    runningCount.set(key, before + converters);
  }
  return flagged;
};
