import { useState } from 'react';
import { BuyTicket, UserProfile } from '../types';
import { updateTicketPaymentMethod, TicketPaymentMethod } from '../lib/ticketPaymentMethod';
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';

interface TicketPayoutExpanderProps {
  tickets: BuyTicket[];
  profile: UserProfile | null;
}

const METHOD_LABELS: Record<TicketPaymentMethod, string> = {
  cash: 'Cash',
  check: 'Check',
  eft: 'EFT / Transfer',
  other: 'Other'
};

// Lets a manager mark a specific ticket in this ledger line as paid by
// check/transfer/other, right where they're already looking at the day's
// totals. Purely additive to the existing ledger row: collapsed by default,
// print:hidden (doesn't affect the printed balance sheet), and reuses the
// same shared write/audit-log function as Ticket History's equivalent
// control -- this is the same feature, just surfaced a second place.
export function TicketPayoutExpander({ tickets, profile }: TicketPayoutExpanderProps) {
  const [expanded, setExpanded] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  if (tickets.length === 0 || profile?.role !== 'manager') return null;

  const handleChange = async (ticket: BuyTicket, newMethod: TicketPaymentMethod) => {
    if ((ticket.paymentMethod || 'cash') === newMethod) return;
    const confirmed = window.confirm(
      newMethod === 'cash'
        ? `Mark ticket #${ticket.id.toUpperCase()} ($${ticket.totalAmount.toFixed(2)}) as paid via Cash? It will count toward today's expected cash again.`
        : `Mark ticket #${ticket.id.toUpperCase()} ($${ticket.totalAmount.toFixed(2)}) as paid via ${METHOD_LABELS[newMethod]}? It will be excluded from today's expected cash, since it never left the drawer.`
    );
    if (!confirmed) return;

    setUpdatingId(ticket.id);
    try {
      await updateTicketPaymentMethod(ticket, newMethod);
    } catch (error) {
      console.error('Error updating payment method:', error);
      window.alert('Failed to update payment method. Please check permissions and try again.');
    } finally {
      setUpdatingId(null);
    }
  };

  return (
    <div className="print:hidden">
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        className="flex items-center gap-1 text-[9px] font-black text-blue-600 uppercase tracking-widest hover:text-blue-700"
      >
        {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        Review {tickets.length} ticket{tickets.length === 1 ? '' : 's'} &middot; mark non-cash payments
      </button>

      {expanded && (
        <div className="mt-2 space-y-1.5 border-l-2 border-slate-100 pl-3">
          {tickets.map(ticket => (
            <div key={ticket.id} className="flex items-center justify-between gap-2 text-[10px]">
              <div className="min-w-0 flex-1">
                <span className="font-mono font-bold text-slate-500">#{ticket.id.toUpperCase()}</span>{' '}
                <span className="font-mono font-black text-slate-900">${ticket.totalAmount.toFixed(2)}</span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {updatingId === ticket.id ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />
                ) : (
                  <select
                    value={ticket.paymentMethod || 'cash'}
                    onChange={(e) => handleChange(ticket, e.target.value as TicketPaymentMethod)}
                    className={cn(
                      'text-[9px] font-black uppercase tracking-wider border rounded px-1.5 py-0.5 outline-none focus:ring-1 focus:ring-blue-500',
                      (ticket.paymentMethod && ticket.paymentMethod !== 'cash')
                        ? 'bg-amber-50 border-amber-200 text-amber-700'
                        : 'bg-white border-slate-200 text-slate-600'
                    )}
                  >
                    <option value="cash">Cash</option>
                    <option value="check">Check</option>
                    <option value="eft">EFT / Transfer</option>
                    <option value="other">Other</option>
                  </select>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
