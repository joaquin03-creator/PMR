import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { auth, db } from '../firebase';
import { useSettings } from '../context/SettingsContext';
import { collection, onSnapshot, query, orderBy, doc, deleteDoc, updateDoc, increment, writeBatch } from 'firebase/firestore';
import { BuyTicket, Customer, Material, UserProfile } from '../types';
import { COMPANY_NAME, COMPANY_ADDRESS, COMPANY_PHONE, COMPANY_WEBSITE, handleImageError } from '../constants';
import { BrandLogo } from '../components/BrandLogo';
import { 
  Search, 
  Printer, 
  X, 
  CheckCircle2, 
  Loader2, 
  Calendar, 
  User, 
  Package, 
  ChevronRight,
  Filter,
  ArrowUpDown,
  Download,
  ArrowUp,
  ArrowDown,
  Trash2,
  Ban,
  AlertTriangle,
  AlertCircle
} from 'lucide-react';
import { cn } from '../lib/utils';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';
import ManagerPinModal from '../components/ManagerPinModal';
import { printTicket } from '../lib/printTicket';
import { BuyTicketPrint } from '../components/BuyTicketPrint';
import { logAuditEvent } from '../lib/audit';

export default function TicketHistory({ profile }: { profile: UserProfile | null }) {
  const { settings } = useSettings();
  const [buyTickets, setBuyTickets] = useState<BuyTicket[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTicket, setSelectedTicket] = useState<BuyTicket | null>(null);
  const [showPrintPreview, setShowPrintPreview] = useState(false);
  const [printFormat, setPrintFormat] = useState<'letter' | 'thermal'>('letter');
  
  useEffect(() => {
    if (settings.receiptFormat) {
      setPrintFormat(settings.receiptFormat);
    }
  }, [settings.receiptFormat, showPrintPreview]);

  const [autoPrint, setAutoPrint] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{ type: 'void' | 'delete', ticket: BuyTicket } | null>(null);
  const [notification, setNotification] = useState<{ type: 'success' | 'error', message: string } | null>(null);
  const [showPinModal, setShowPinModal] = useState(false);
  const [pendingAction, setPendingAction] = useState<{ type: 'void' | 'delete', ticket: BuyTicket } | null>(null);
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' }>({
    key: 'timestamp',
    direction: 'desc'
  });
  const [searchParams, setSearchParams] = useSearchParams();

  // Handle URL deep linking for selecting a ticket
  useEffect(() => {
    const ticketId = searchParams.get('id');
    if (ticketId && buyTickets.length > 0) {
      const targetTicket = buyTickets.find(t => t.id === ticketId);
      if (targetTicket) {
        setSelectedTicket(targetTicket);
        
        // Clear search parameter so page behavior is normal after selecting
        const newParams = new URLSearchParams(searchParams);
        newParams.delete('id');
        setSearchParams(newParams, { replace: true });
      }
    }
  }, [searchParams, buyTickets, setSearchParams]);

  useEffect(() => {
    // Session tracking
  }, [profile]);

  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  useEffect(() => {
    if (!auth.currentUser) return;

    const unsubBuy = onSnapshot(
      query(collection(db, 'buyTickets'), orderBy('timestamp', 'desc')), 
      (snapshot) => {
        setBuyTickets(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as BuyTicket[]);
        setLoading(false);
      }, 
      (error) => handleFirestoreError(error, OperationType.LIST, 'buyTickets')
    );

    const unsubCustomers = onSnapshot(collection(db, 'customers'), (snapshot) => {
      setCustomers(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Customer[]);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'customers'));

    const unsubMaterials = onSnapshot(collection(db, 'materials'), (snapshot) => {
      setMaterials(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Material[]);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'materials'));

    return () => {
      try { unsubBuy(); } catch (e) { console.warn('unsubBuy error', e); }
      try { unsubCustomers(); } catch (e) { console.warn('unsubCustomers error', e); }
      try { unsubMaterials(); } catch (e) { console.warn('unsubMaterials error', e); }
    };
  }, [profile]);

  useEffect(() => {
    if (showPrintPreview && autoPrint) {
      setAutoPrint(false);
    }
  }, [showPrintPreview, autoPrint]);

  const getCustomerName = (id: string) => customers.find(c => c.id === id)?.name || 'Unknown Customer';

  const sortedAndFilteredTickets = useMemo(() => {
    const filtered = buyTickets.filter(ticket => {
      const customer = customers.find(c => c.id === ticket.customerId);
      const customerName = customer?.name.toLowerCase() || '';
      const ticketId = ticket.id.toLowerCase();
      const search = searchTerm.toLowerCase();
      
      return customerName.includes(search) || ticketId.includes(search);
    });

    return [...filtered].sort((a, b) => {
      let aValue: any;
      let bValue: any;

      switch (sortConfig.key) {
        case 'timestamp':
          aValue = new Date(a.timestamp).getTime();
          bValue = new Date(b.timestamp).getTime();
          break;
        case 'customerName':
          aValue = getCustomerName(a.customerId).toLowerCase();
          bValue = getCustomerName(b.customerId).toLowerCase();
          break;
        case 'totalAmount':
          aValue = a.totalAmount;
          bValue = b.totalAmount;
          break;
        case 'status':
          aValue = (a.status || 'completed').toLowerCase();
          bValue = (b.status || 'completed').toLowerCase();
          break;
        default:
          return 0;
      }

      if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [buyTickets, customers, searchTerm, sortConfig]);

  const handleSort = (key: string) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  const handleVoidTicket = async (ticket: BuyTicket) => {
    if (!profile || profile.role !== 'manager') return;
    
    setProcessing(true);
    try {
      const batch = writeBatch(db);
      
      // Update ticket status
      batch.update(doc(db, 'buyTickets', ticket.id), { status: 'voided' });
      
      // Reverse inventory (Subtract intake)
      for (const item of ticket.materials) {
        const invRef = doc(db, 'inventory', item.materialId);
        batch.set(invRef, {
          materialId: item.materialId,
          currentWeight: increment(-(item.netWeight)),
          lastUpdated: new Date().toISOString()
        }, { merge: true });
      }
      
      await batch.commit();
      
      // Track action in Audit Log
      await logAuditEvent(
        'buyTicket',
        ticket.id,
        'void',
        {
          before: { status: ticket.status || 'open' },
          after: { status: 'voided' }
        },
        `Voided Buy Ticket #${ticket.id.toUpperCase()} (Total payout: $${ticket.totalAmount ? ticket.totalAmount.toFixed(2) : '0.00'})`
      );

      setSelectedTicket(null);
      setConfirmAction(null);
      setNotification({ type: 'success', message: 'Ticket voided successfully. Inventory has been adjusted.' });
    } catch (error) {
      console.error('Error voiding ticket:', error);
      setNotification({ type: 'error', message: 'Failed to void ticket. Please check permissions.' });
      handleFirestoreError(error, OperationType.UPDATE, 'buyTickets');
    } finally {
      setProcessing(false);
    }
  };

  const handleDeleteTicket = async (ticket: BuyTicket) => {
    if (!profile || profile.role !== 'manager') return;

    setProcessing(true);
    try {
      const batch = writeBatch(db);
      
      // Reverse inventory (only if it wasn't already voided)
      if (ticket.status !== 'voided') {
        for (const item of ticket.materials) {
          const invRef = doc(db, 'inventory', item.materialId);
          batch.set(invRef, {
            materialId: item.materialId,
            currentWeight: increment(-(item.netWeight)),
            lastUpdated: new Date().toISOString()
          }, { merge: true });
        }
      }
      
      // Delete ticket
      batch.delete(doc(db, 'buyTickets', ticket.id));
      
      await batch.commit();

      // Track action in Audit Log
      await logAuditEvent(
        'buyTicket',
        ticket.id,
        'delete',
        {
          before: ticket,
          after: null
        },
        `Deleted Buy Ticket #${ticket.id.toUpperCase()} (Total payout was: $${ticket.totalAmount ? ticket.totalAmount.toFixed(2) : '0.00'})`
      );

      setSelectedTicket(null);
      setConfirmAction(null);
      setNotification({ type: 'success', message: 'Ticket permanently deleted.' });
    } catch (error) {
      console.error('Error deleting ticket:', error);
      setNotification({ type: 'error', message: 'Failed to delete ticket. Please check permissions.' });
      handleFirestoreError(error, OperationType.DELETE, 'buyTickets');
    } finally {
      setProcessing(false);
    }
  };

  const exportToCSV = () => {
    const headers = [
      'Ticket ID',
      'Date',
      'Time',
      'Customer Name',
      'Items Count',
      'Total Payout',
      'Status',
      'Payment Method',
      'Vehicle Plate'
    ];

    const rows = sortedAndFilteredTickets.map(ticket => {
      const timestamp = new Date(ticket.timestamp);
      return [
        ticket.id.toUpperCase(),
        timestamp.toLocaleDateString(),
        timestamp.toLocaleTimeString(),
        `"${getCustomerName(ticket.customerId)}"`,
        (ticket.materials || []).length,
        ticket.totalAmount.toFixed(2),
        ticket.status || 'completed',
        ticket.paymentMethod || 'cash',
        ticket.vehiclePlate || ''
      ];
    });

    const csvContent = [
      headers.join(','),
      ...rows.map(r => r.join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `ticket_history_audit_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <main className="space-y-8">
      {/* Notifications */}
      {notification && (
        <div className={cn(
          "fixed bottom-8 right-8 z-[200] px-6 py-4 rounded-2xl shadow-2xl animate-in slide-in-from-bottom-4 duration-300 border flex items-center gap-3 font-bold uppercase tracking-widest text-xs",
          notification.type === 'success' ? "bg-emerald-500 text-white border-emerald-400" : "bg-red-500 text-white border-red-400"
        )}>
          {notification.type === 'success' ? <CheckCircle2 className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
          {notification.message}
        </div>
      )}

      <ManagerPinModal
        isOpen={showPinModal}
        onClose={() => {
          setShowPinModal(false);
          setPendingAction(null);
        }}
        onSuccess={() => {
          if (pendingAction) {
            setConfirmAction(pendingAction);
            setPendingAction(null);
          }
        }}
        title="Manager Approval"
        message={`A Manager PIN is required to ${pendingAction?.type === 'void' ? 'void' : 'permanently delete'} this ticket.`}
      />

      {/* Confirmation Modal */}
      {confirmAction && (
        <div className="fixed inset-0 bg-slate-900/80 z-[150] flex items-center justify-center p-4 backdrop-blur-md">
          <div className="bg-white rounded-[2.5rem] w-full max-w-sm overflow-hidden shadow-2xl p-8 space-y-6 animate-in zoom-in-95 duration-200">
            <div className={cn(
              "w-16 h-16 rounded-3xl flex items-center justify-center mx-auto",
              confirmAction.type === 'void' ? "bg-amber-100 text-amber-600" : "bg-red-100 text-red-600"
            )}>
              {confirmAction.type === 'void' ? <Ban className="w-8 h-8" /> : <Trash2 className="w-8 h-8" />}
            </div>
            
            <div className="text-center space-y-2">
              <h3 className="text-2xl font-black text-slate-900 font-display uppercase tracking-tight">
                {confirmAction.type === 'void' ? 'Void Ticket?' : 'Delete Ticket?'}
              </h3>
              <p className="text-sm text-slate-500 font-medium leading-relaxed px-4">
                {confirmAction.type === 'void' 
                  ? 'This will reverse inventory intake but keep a historical record. This action is permanent.' 
                  : 'CRITICAL: This will reverse inventory AND permanently remove the record. This cannot be undone.'}
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <button
                disabled={processing}
                onClick={() => {
                  if (confirmAction.type === 'void') handleVoidTicket(confirmAction.ticket);
                  else handleDeleteTicket(confirmAction.ticket);
                }}
                className={cn(
                  "w-full py-4 rounded-2xl font-black uppercase tracking-widest text-sm transition-all active:scale-95 flex items-center justify-center gap-2",
                  confirmAction.type === 'void' ? "bg-amber-600 text-white hover:bg-amber-700" : "bg-red-600 text-white hover:bg-red-700",
                  processing && "opacity-50 cursor-not-allowed"
                )}
              >
                {processing ? <Loader2 className="w-5 h-5 animate-spin" /> : (confirmAction.type === 'void' ? 'Void Ticket' : 'Delete Permanently')}
              </button>
              <button
                disabled={processing}
                onClick={() => setConfirmAction(null)}
                className="w-full py-4 rounded-2xl font-black uppercase tracking-widest text-xs text-slate-400 hover:text-slate-600 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
        <div>
          <h1 className="text-4xl font-black text-slate-900 tracking-tight font-display">Ticket History</h1>
          <p className="text-slate-500 font-medium mt-1">Recall, reference, and re-print previous buy tickets.</p>
        </div>
        <button 
          onClick={exportToCSV}
          className="flex items-center gap-2 px-6 py-3 bg-white border border-slate-200 rounded-2xl text-xs font-black uppercase tracking-widest text-slate-700 hover:bg-slate-50 transition-all shadow-sm active:scale-95 outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
        >
          <Download className="w-5 h-5" />
          Export Audit CSV
        </button>
      </header>

      {/* Search and Filter Bar */}
      <div className="flex flex-col md:flex-row gap-6">
        <div className="relative group flex-1">
          <label htmlFor="ticket-search" className="sr-only">Search by customer name or ticket ID</label>
          <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 group-focus-within:text-blue-500 transition-colors" aria-hidden="true" />
          <input
            id="ticket-search"
            type="text"
            placeholder="Search by customer name or ticket ID..."
            className="w-full pl-14 pr-6 py-4 bg-white border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 font-medium shadow-sm transition-all text-lg"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {/* Tickets List */}
      <section className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden" aria-label="Tickets List">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-500 text-[10px] font-bold uppercase tracking-widest border-b border-slate-100">
                <th className="px-8 py-5">
                  <button 
                    onClick={() => handleSort('timestamp')}
                    className="flex items-center gap-2 hover:text-blue-600 transition-colors"
                  >
                    Date & Time
                    {sortConfig.key === 'timestamp' ? (
                      sortConfig.direction === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                    ) : <ArrowUpDown className="w-3 h-3 opacity-30" />}
                  </button>
                </th>
                <th className="px-8 py-5">Ticket ID</th>
                <th className="px-8 py-5">
                  <button 
                    onClick={() => handleSort('customerName')}
                    className="flex items-center gap-2 hover:text-blue-600 transition-colors"
                  >
                    Customer
                    {sortConfig.key === 'customerName' ? (
                      sortConfig.direction === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                    ) : <ArrowUpDown className="w-3 h-3 opacity-30" />}
                  </button>
                </th>
                <th className="px-8 py-5">Items</th>
                <th className="px-8 py-5">
                  <button 
                    onClick={() => handleSort('status')}
                    className="flex items-center gap-2 hover:text-blue-600 transition-colors mx-auto"
                  >
                    Status
                    {sortConfig.key === 'status' ? (
                      sortConfig.direction === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                    ) : <ArrowUpDown className="w-3 h-3 opacity-30" />}
                  </button>
                </th>
                <th className="px-8 py-5 text-right">
                  <button 
                    onClick={() => handleSort('totalAmount')}
                    className="flex items-center gap-2 hover:text-blue-600 transition-colors ml-auto"
                  >
                    Total Payout
                    {sortConfig.key === 'totalAmount' ? (
                      sortConfig.direction === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                    ) : <ArrowUpDown className="w-3 h-3 opacity-30" />}
                  </button>
                </th>
                <th className="px-8 py-5 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {sortedAndFilteredTickets.map((ticket) => (
                <tr 
                  key={ticket.id} 
                  className="hover:bg-blue-50/50 transition-all group cursor-pointer border-b border-slate-50 last:border-0 outline-none focus-within:bg-blue-50" 
                  onClick={() => setSelectedTicket(ticket)}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelectedTicket(ticket);
                    }
                  }}
                  aria-label={`Ticket ${ticket.id.slice(-8).toUpperCase()} for ${getCustomerName(ticket.customerId)}`}
                >
                  <td className="px-8 py-6">
                    <div className="flex items-center gap-4">
                      <div className="p-3 bg-slate-100 rounded-2xl text-slate-500 group-hover:bg-blue-100 group-hover:text-blue-600 transition-all group-hover:scale-110">
                        <Calendar className="w-5 h-5" aria-hidden="true" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-black text-slate-900 uppercase tracking-tight">
                            {new Date(ticket.timestamp).toLocaleDateString()}
                          </p>
                          {(ticket as any).archivedAt && (
                            <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 text-[8px] font-black uppercase rounded tracking-widest border border-amber-200">
                              Archived
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest flex items-center gap-1">
                          {new Date(ticket.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          {ticket.createdByName && (
                            <>
                              <span className="opacity-30">•</span>
                              <span className="text-blue-500/70">{ticket.createdByName}</span>
                            </>
                          )}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-8 py-6">
                    <span className="px-3 py-1 bg-slate-100 rounded-lg text-[10px] font-black text-slate-500 uppercase tracking-widest group-hover:bg-blue-100 group-hover:text-blue-600 transition-colors">
                      #{ticket.id.slice(-8).toUpperCase()}
                    </span>
                  </td>
                  <td className="px-8 py-6">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-slate-100 rounded-full flex items-center justify-center text-slate-400 group-hover:bg-blue-100 group-hover:text-blue-600 transition-colors">
                        <User className="w-4 h-4" aria-hidden="true" />
                      </div>
                      <p className="text-sm font-black text-slate-700 font-display uppercase tracking-tight">{getCustomerName(ticket.customerId)}</p>
                    </div>
                  </td>
                  <td className="px-8 py-6">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-slate-100 rounded-full flex items-center justify-center text-slate-400 group-hover:bg-blue-100 group-hover:text-blue-600 transition-colors">
                        <Package className="w-4 h-4" aria-hidden="true" />
                      </div>
                      <p className="text-sm font-black text-slate-600 font-display uppercase tracking-tight">
                        {(ticket.materials || []).length} { (ticket.materials || []).length === 1 ? 'Item' : 'Items' }
                      </p>
                    </div>
                  </td>
                  <td className="px-8 py-6 text-center">
                    <span className={cn(
                      "px-2 py-1 rounded-full text-[8px] font-black uppercase tracking-widest border",
                      (ticket.status || 'completed') === 'completed' 
                        ? "bg-emerald-50 text-emerald-700 border-emerald-100" 
                        : "bg-amber-50 text-amber-700 border-amber-100"
                    )}>
                      {ticket.status || 'completed'}
                    </span>
                  </td>
                  <td className="px-8 py-6 text-right">
                    <p className="text-xl font-black text-slate-900 font-display">${ticket.totalAmount.toFixed(2)}</p>
                  </td>
                  <td className="px-8 py-6">
                    <div className="flex items-center justify-center gap-3">
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedTicket(ticket);
                          setShowPrintPreview(true);
                          setAutoPrint(true);
                        }}
                        className="p-3 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-2xl transition-all active:scale-90 outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                        title="Print Ticket"
                        aria-label={`Print ticket ${ticket.id.slice(-8).toUpperCase()}`}
                      >
                        <Printer className="w-6 h-6" aria-hidden="true" />
                      </button>
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedTicket(ticket);
                        }}
                        className="p-3 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-2xl transition-all active:scale-90 outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                        title="View Details"
                        aria-label={`View details for ticket ${ticket.id.slice(-8).toUpperCase()}`}
                      >
                        <ChevronRight className="w-6 h-6" aria-hidden="true" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {sortedAndFilteredTickets.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-8 py-20 text-center">
                    <div className="max-w-xs mx-auto space-y-3">
                      <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto">
                        <Search className="w-8 h-8 text-slate-200" />
                      </div>
                      <p className="text-slate-900 font-bold">No tickets found</p>
                      <p className="text-sm text-slate-500">Try adjusting your search term or filters.</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Ticket Details Modal */}
      {selectedTicket && !showPrintPreview && (
        <div 
          className="fixed inset-0 bg-slate-900/60 z-[100] flex items-start justify-center p-4 backdrop-blur-sm overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ticket-details-title"
        >
          <div className="bg-white rounded-3xl w-full max-w-2xl my-auto overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-600 rounded-xl text-white">
                  <Package className="w-5 h-5" aria-hidden="true" />
                </div>
                <div>
                  <h2 id="ticket-details-title" className="font-bold text-slate-900">Ticket Details</h2>
                  <div className="flex items-center gap-2">
                    <p className="text-xs text-slate-500 font-medium uppercase tracking-widest">#{selectedTicket.id.toUpperCase()}</p>
                    {(selectedTicket as any).archivedAt && (
                      <span className="px-1.5 py-0.5 bg-amber-100 text-amber-700 text-[8px] font-black uppercase rounded tracking-widest border border-amber-200">
                        Photos Archived
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <button 
                onClick={() => setSelectedTicket(null)}
                className="p-2 hover:bg-slate-200 rounded-xl transition-colors outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                aria-label="Close modal"
              >
                <X className="w-5 h-5 text-slate-500" aria-hidden="true" />
              </button>
            </div>

            <div className="p-8 space-y-8">
              {(selectedTicket.status === 'voided' || selectedTicket.status === 'cancelled') && (
                <div className="p-4 bg-red-50 border border-red-100 rounded-2xl flex items-center gap-3">
                  <Ban className="w-5 h-5 text-red-600" />
                  <p className="text-sm font-bold text-red-900 uppercase tracking-tight">This ticket has been {selectedTicket.status}</p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-8">
                <div className="space-y-3">
                  <div className="space-y-1">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Customer</p>
                    <p className="text-xl font-black text-slate-900">{getCustomerName(selectedTicket.customerId)}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Handled By</p>
                    <p className="text-xl font-black text-slate-900">{selectedTicket.createdByName || 'System'}</p>
                  </div>
                  {selectedTicket.customerPhotoUrl && (
                    <div className="relative group">
                      <img 
                        src={selectedTicket.customerPhotoUrl} 
                        alt="Customer at time of transaction" 
                        className="w-full h-48 object-cover rounded-2xl border border-slate-200 shadow-sm"
                        referrerPolicy="no-referrer"
                        onError={handleImageError}
                      />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-2xl">
                        <p className="text-white text-xs font-bold uppercase tracking-widest">Transaction Photo</p>
                      </div>
                    </div>
                  )}
                  {selectedTicket.signatureUrl && (
                    <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Customer Signature</p>
                      <img 
                        src={selectedTicket.signatureUrl} 
                        alt="Customer Signature" 
                        className="max-h-24 mx-auto object-contain"
                        referrerPolicy="no-referrer"
                      />
                    </div>
                  )}
                </div>
                <div className="space-y-1 text-right">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Date & Time</p>
                  <p className="text-xl font-black text-slate-900">{new Date(selectedTicket.timestamp).toLocaleString()}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-8 p-4 bg-slate-50 rounded-2xl border border-slate-100">
                <div className="space-y-1">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Vehicle Info</p>
                  <p className="text-sm font-bold text-slate-900">
                    {selectedTicket.vehiclePlate || 'N/A'} {selectedTicket.vehicleType ? `(${selectedTicket.vehicleType})` : ''}
                  </p>
                </div>
                <div className="space-y-1 text-right">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Payment Method</p>
                  <p className="text-sm font-bold text-slate-900 capitalize">{selectedTicket.paymentMethod || 'N/A'}</p>
                </div>
              </div>

              <div className="space-y-4">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Materials</p>
                <div className="space-y-3">
                  {(selectedTicket.materials || []).map((item, idx) => {
                    const material = materials.find(m => m.id === item.materialId);
                    return (
                      <div key={idx} className="p-4 bg-slate-50 rounded-2xl border border-slate-100 space-y-3">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex items-start gap-4 flex-1">
                            <span className="w-8 h-8 bg-white border border-slate-200 rounded-full flex items-center justify-center text-xs font-bold text-slate-400 shrink-0 mt-1">
                              {idx + 1}
                            </span>
                            <div className="space-y-3 flex-1">
                              <div>
                                <p className="font-bold text-slate-900">{material?.name || 'Unknown Material'}</p>
                                <p className="text-xs text-slate-500">
                                  Net Weight: {item.netWeight} lb
                                  {item.deductionWeight ? ` | Deduction: -${item.deductionWeight} lb ${item.deductionReason ? `(${item.deductionReason})` : ''}` : ''}
                                </p>
                              </div>
                              {item.photoUrl && (
                                <div className="relative w-full max-w-[200px] aspect-video rounded-xl overflow-hidden border border-slate-200 shadow-sm">
                                  <img 
                                    src={item.photoUrl} 
                                    alt={`${material?.name || 'Material'} photo`} 
                                    className="w-full h-full object-cover"
                                    referrerPolicy="no-referrer"
                                    onError={handleImageError}
                                  />
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-lg font-black text-slate-900">${item.totalAmount.toFixed(2)}</p>
                            <p className="text-[10px] text-slate-400 font-bold uppercase">
                              {item.netWeight - (item.deductionWeight || 0)} lb paid @ ${item.pricePerUnit.toFixed(2)}/lb
                            </p>
                          </div>
                        </div>
                        {item.notes && (
                          <div className="pl-12 text-xs text-slate-500 italic">
                            Note: {item.notes}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {selectedTicket.notes && (
                <div className="space-y-1">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">General Ticket Notes</p>
                  <p className="text-sm text-slate-600 bg-slate-50 p-4 rounded-2xl border border-slate-100 italic">
                    "{selectedTicket.notes}"
                  </p>
                </div>
              )}

              <div className="pt-8 border-t border-slate-100 flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total Weight</p>
                  <p className="text-2xl font-black text-slate-900">
                    {(selectedTicket.materials || []).reduce((sum, m) => sum + (m.netWeight - (m.deductionWeight || 0)), 0)} lb
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total Payout</p>
                  <p className="text-4xl font-black text-blue-600">${selectedTicket.totalAmount.toFixed(2)}</p>
                </div>
              </div>
            </div>

            <div className="p-6 bg-slate-50 border-t border-slate-100 flex flex-wrap gap-4">
              <button 
                onClick={() => setSelectedTicket(null)}
                className="px-6 py-4 border border-slate-200 rounded-2xl font-bold text-slate-600 hover:bg-white transition-all active:scale-95"
              >
                Close
              </button>
              
              {profile?.role === 'manager' && (
                <div className="flex gap-2">
                  {profile.permissions?.canVoidTickets && (
                    <button 
                      onClick={() => {
                        setPendingAction({ type: 'void', ticket: selectedTicket });
                        setShowPinModal(true);
                      }}
                      disabled={processing || selectedTicket?.status === 'voided' || selectedTicket?.status === 'cancelled'}
                      className="flex items-center gap-2 px-6 py-4 bg-amber-50 text-amber-600 border border-amber-200 rounded-2xl font-bold hover:bg-amber-100 transition-all active:scale-95 disabled:opacity-50"
                    >
                      <Ban className="w-5 h-5" />
                      Void
                    </button>
                  )}
                  {profile.permissions?.canDeleteData && (
                    <button 
                      onClick={() => {
                        setPendingAction({ type: 'delete', ticket: selectedTicket });
                        setShowPinModal(true);
                      }}
                      disabled={processing}
                      className="flex items-center gap-2 px-6 py-4 bg-red-50 text-red-600 border border-red-200 rounded-2xl font-bold hover:bg-red-100 transition-all active:scale-95 disabled:opacity-50"
                    >
                      <Trash2 className="w-5 h-5" />
                      Delete
                    </button>
                  )}
                </div>
              )}

              <button 
                onClick={() => setShowPrintPreview(true)}
                className="flex-1 py-4 bg-slate-900 text-white rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-slate-800 transition-all shadow-lg shadow-slate-200 active:scale-95"
              >
                <Printer className="w-5 h-5" />
                Print Ticket
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Print Preview Modal */}
      {showPrintPreview && selectedTicket && (
        <div 
          className="fixed inset-0 bg-slate-900/80 z-[110] flex items-start justify-center p-4 backdrop-blur-sm overflow-y-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="print-preview-title"
        >
          <div className="bg-white rounded-2xl w-full max-w-lg my-auto overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
            <div className="p-4 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-3 bg-slate-50">
              <div className="flex items-center gap-2">
                <Printer className="w-5 h-5 text-slate-600" aria-hidden="true" />
                <h2 id="print-preview-title" className="font-bold text-slate-900">Print Preview</h2>
              </div>
              <div className="flex bg-slate-200/80 p-0.5 rounded-xl border border-slate-200">
                <button
                  type="button"
                  onClick={() => setPrintFormat('letter')}
                  className={cn(
                    "px-2.5 py-1 text-[9px] font-black uppercase rounded-lg transition-all",
                    printFormat === 'letter' ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                  )}
                >
                  Letter
                </button>
                <button
                  type="button"
                  onClick={() => setPrintFormat('thermal')}
                  className={cn(
                    "px-2.5 py-1 text-[9px] font-black uppercase rounded-lg transition-all",
                    printFormat === 'thermal' ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                  )}
                >
                  Thermal
                </button>
              </div>
              <button 
                onClick={() => setShowPrintPreview(false)}
                className="p-2 hover:bg-slate-200 rounded-lg transition-colors outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                aria-label="Close modal"
              >
                <X className="w-5 h-5 text-slate-500" aria-hidden="true" />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-8 bg-slate-100 space-y-4">
              <div className="p-3.5 bg-blue-50/80 border border-blue-200 rounded-2xl text-left space-y-1">
                <p className="text-xs font-extrabold text-blue-900 flex items-center gap-1.5">
                  <span>💡</span>
                  Browser Printing Pro-Tip
                </p>
                <p className="text-[10px] text-blue-800 leading-normal font-medium">
                  If the print pop-up is blocked or does not open, make sure to click <strong>"Open in New Tab"</strong> at the top of AI Studio. Browsers block system dialogue windows within sandboxed preview frames!
                </p>
              </div>

              <div className={cn(
                "bg-white shadow-sm border border-slate-200 rounded-xl relative mx-auto transition-all duration-300",
                printFormat === 'thermal' 
                  ? "max-w-[280px] p-4 border-dashed font-mono text-slate-900 text-xs gap-y-2" 
                  : "w-full p-8 font-sans"
              )} aria-label="Ticket Content">
                <div className={cn(
                  "text-center border-b border-slate-100 pb-4 mb-4",
                  printFormat === 'thermal' ? "border-dashed border-slate-900" : ""
                )}>
                  <div className="flex justify-center mb-3">
                    <BrandLogo className="h-10 w-auto object-contain grayscale" grayscale />
                  </div>
                  <h1 className={cn("font-black uppercase tracking-tight", printFormat === 'thermal' ? "text-base" : "text-xl")}>{COMPANY_NAME}</h1>
                  {printFormat !== 'thermal' && COMPANY_WEBSITE && <p className="text-[10px] text-slate-400 font-medium tracking-wide mt-0.5">{COMPANY_WEBSITE}</p>}
                  <p className="text-[10px] text-slate-500 font-bold mt-1">{COMPANY_ADDRESS}</p>
                  <p className="text-[10px] text-slate-500">{COMPANY_PHONE}</p>
                  <div className="mt-2 pt-2 border-t border-slate-100">
                    <p className="text-[10px] text-slate-500 mt-1 uppercase">Official Buy Ticket</p>
                    <p className="text-[10px] text-slate-500">{new Date(selectedTicket.timestamp).toLocaleString()}</p>
                  </div>
                </div>
                
                <div className="space-y-3">
                  <div className="flex justify-between gap-4">
                    <span className="text-slate-500 uppercase text-[10px] font-bold">Customer</span>
                    <span className="text-right font-bold">{getCustomerName(selectedTicket.customerId)}</span>
                  </div>

                  {(selectedTicket.vehiclePlate || selectedTicket.vehicleType) && (
                    <div className="flex justify-between gap-4">
                      <span className="text-slate-500 uppercase text-[10px] font-bold">Vehicle</span>
                      <span className="text-right font-bold">{selectedTicket.vehiclePlate} {selectedTicket.vehicleType ? `(${selectedTicket.vehicleType})` : ''}</span>
                    </div>
                  )}

                  <div className="flex justify-between gap-4">
                    <span className="text-slate-500 uppercase text-[10px] font-bold">Payment</span>
                    <span className="text-right font-bold capitalize">{selectedTicket.paymentMethod || 'Cash'}</span>
                  </div>
                  
                  <div className={cn(
                    "border-t border-slate-100 pt-3 space-y-2",
                    printFormat === 'thermal' ? "border-dashed border-slate-900" : ""
                  )}>
                    <p className="text-[10px] font-bold text-slate-400 uppercase">Items</p>
                    {(selectedTicket.materials || []).map((item, idx) => {
                      const material = materials.find(m => m.id === item.materialId);
                      return (
                        <div key={idx} className="space-y-1 border-b border-slate-50 pb-2 last:border-0">
                          <div className="flex justify-between gap-4 text-[11px]">
                            <div className="flex gap-2">
                              <span className="text-slate-400">{idx + 1}.</span>
                              <span className="font-bold">{material?.name || 'N/A'}</span>
                            </div>
                            <div className="text-right font-bold">
                              ${item.totalAmount.toFixed(2)}
                            </div>
                          </div>
                          <div className="flex justify-between text-[9px] text-slate-500 pl-5">
                            <span>
                              {item.netWeight} lb
                              {item.deductionWeight ? ` (Ded: -${item.deductionWeight} lb)` : ''}
                            </span>
                            <span>@ ${item.pricePerUnit.toFixed(2)}/lb</span>
                          </div>
                          {item.notes && (
                            <p className="text-[9px] text-slate-400 italic pl-5">Note: {item.notes}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div className={cn(
                    "flex justify-between gap-4 text-base border-t border-slate-900 pt-3 mt-4",
                    printFormat === 'thermal' ? "border-dashed" : ""
                  )}>
                    <span className="font-black uppercase">Total Weight</span>
                    <span className="font-black">
                      {(selectedTicket.materials || []).reduce((sum, m) => sum + (m.netWeight - (m.deductionWeight || 0)), 0)} lb
                    </span>
                  </div>
                  <div className={cn(
                    "flex justify-between gap-4 text-xl border-t-2 border-slate-900 pt-4 mt-4",
                    printFormat === 'thermal' ? "border-dashed" : ""
                  )}>
                    <span className="font-black uppercase">Total Payout</span>
                    <span className="font-black">${selectedTicket.totalAmount.toFixed(2)}</span>
                  </div>

                  <div className={cn(
                    "mt-8 pt-6 border-t border-slate-200 space-y-4",
                    printFormat === 'thermal' ? "border-dashed border-slate-900 mt-4 pt-4" : ""
                  )}>
                    <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                      <p className="text-[8px] leading-tight text-slate-500 text-center italic">
                        I, the undersigned, certify that I am the sole owner of the material described on this ticket and have the full legal right to sell it.
                      </p>
                    </div>
                    <div className="pt-2 flex flex-col items-center">
                      {selectedTicket.signatureUrl ? (
                        <img src={selectedTicket.signatureUrl} alt="Signature" className="h-16 object-contain" />
                      ) : (
                        <div className="pt-8 border-b border-slate-300 w-full"></div>
                      )}
                      <p className="text-[9px] font-bold text-slate-400 uppercase text-center mt-1">Seller Signature</p>
                    </div>
                  </div>
                </div>
                
                {printFormat === 'thermal' && settings.thermalShowBarcode && (
                  <div className="mt-4 flex flex-col items-center border-t border-dashed border-slate-900 pt-3">
                    <div className="flex h-8 w-36 gap-0.5 bg-white px-2 py-1 border">
                      {Array.from({ length: 30 }).map((_, i) => (
                        <div 
                          key={i} 
                          className="h-full flex-1" 
                          style={{ backgroundColor: (i * 7 + 13) % 5 === 0 || i % 3 === 0 ? 'black' : 'transparent' }} 
                        />
                      ))}
                    </div>
                    <span className="text-[8px] font-mono tracking-widest mt-1">*{selectedTicket.id.toUpperCase().slice(-8)}*</span>
                  </div>
                )}

                <div className="mt-12 pt-8 border-t border-dashed border-slate-300 text-center space-y-2">
                  <p className="text-[10px] text-slate-400">Thank you for your business.</p>
                  <p className="text-[10px] font-bold text-slate-900 uppercase">TICKET ID: {selectedTicket.id.toUpperCase()}</p>
                </div>
              </div>
            </div>
            
            <div className="p-4 bg-white border-t border-slate-100 flex gap-3">
              <button 
                onClick={() => setShowPrintPreview(false)}
                className="flex-1 py-3 border border-slate-200 rounded-xl font-bold text-slate-600 hover:bg-slate-50 transition-all outline-none focus-visible:ring-2 focus-visible:ring-slate-400 text-xs"
              >
                Cancel
              </button>
              <button 
                onClick={async () => {
                  setShowPrintPreview(false);
                  await new Promise(r => setTimeout(r, 150));
                  if (selectedTicket) {
                    await printTicket(
                      <BuyTicketPrint 
                        ticket={selectedTicket} 
                        customerName={getCustomerName(selectedTicket.customerId)} 
                        materials={materials} 
                        format={printFormat}
                      />,
                      { format: printFormat, debugMode: settings.debugPrintMode }
                    );
                  }
                  setSelectedTicket(null);
                }}
                className="flex-1 py-3 bg-slate-900 text-white rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-slate-800 transition-all shadow-lg shadow-slate-200 outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 text-xs uppercase tracking-widest"
              >
                <Printer className="w-4 h-4" aria-hidden="true" />
                Print Now
              </button>
            </div>
          </div>
        </div>
      )}

    </main>
  );
}
