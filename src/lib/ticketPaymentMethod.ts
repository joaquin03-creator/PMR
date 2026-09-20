import { db } from '../firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { logAuditEvent } from './audit';
import { BuyTicket } from '../types';

export type TicketPaymentMethod = 'cash' | 'check' | 'eft' | 'other';

/**
 * Retroactively mark a completed ticket's payment method. This does not
 * touch the ticket's status, materials, or totalAmount -- the only field
 * that changes is paymentMethod. Cash-drawer reconciliation math (see
 * cashLogicLock.ts's isCashPayoutTicket, used throughout CashDrawer.tsx)
 * excludes any ticket whose paymentMethod is not 'cash', so marking a
 * ticket as check/eft/other retroactively removes it from that day's
 * expected cash without needing any other adjustment.
 *
 * Shared by TicketHistory.tsx and CashDrawer.tsx so both entry points log
 * an identical audit trail. Caller is responsible for the manager-role
 * check and any confirmation UI -- this function only performs the write.
 */
export async function updateTicketPaymentMethod(ticket: BuyTicket, newMethod: TicketPaymentMethod): Promise<void> {
  const oldMethod = ticket.paymentMethod || 'cash';
  if (oldMethod === newMethod) return;

  await updateDoc(doc(db, 'buyTickets', ticket.id), { paymentMethod: newMethod });

  await logAuditEvent(
    'buyTicket',
    ticket.id,
    'update',
    {
      before: { paymentMethod: oldMethod },
      after: { paymentMethod: newMethod }
    },
    newMethod === 'cash'
      ? `Marked Buy Ticket #${ticket.id.toUpperCase()} as paid via Cash (was ${oldMethod}). This ticket's $${ticket.totalAmount.toFixed(2)} total will now count toward the cash drawer's expected cash for its day.`
      : `Marked Buy Ticket #${ticket.id.toUpperCase()} as paid via ${newMethod === 'eft' ? 'EFT/Transfer' : newMethod === 'check' ? 'Check' : 'Other'} (was ${oldMethod}). This ticket's $${ticket.totalAmount.toFixed(2)} total will no longer count toward the cash drawer's expected cash for its day.`
  );
}
