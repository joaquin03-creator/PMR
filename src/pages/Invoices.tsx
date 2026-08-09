import React, { useState, useEffect } from 'react';
import { auth, db } from '../firebase';
import { useSettings } from '../context/SettingsContext';
import { collection, onSnapshot, addDoc, doc, updateDoc, query, orderBy, getDoc, deleteDoc, writeBatch, increment } from 'firebase/firestore';
import { Material, TripTicket, Invoice, TripTicketMaterial, Customer, UserProfile, BuyTicket, LoadPlan } from '../types';
import { logAuditEvent } from '../lib/audit';
import { COMPANY_NAME, COMPANY_ADDRESS, COMPANY_PHONE, COMPANY_EMAIL, COMPANY_WEBSITE, handleImageError } from '../constants';
import { BrandLogo } from '../components/BrandLogo';
import { roundNetWeight } from '../lib/weightUtils';
import { 
  FileText, 
  Plus, 
  Search, 
  ChevronRight, 
  Calendar, 
  User, 
  CheckCircle2, 
  Clock, 
  Trash2,
  AlertCircle, 
  Printer, 
  X, 
  Download,
  ArrowUpRight,
  Filter,
  MoreVertical,
  DollarSign,
  Truck,
  Loader2,
  History,
  Edit2,
  Save,
  ChevronDown,
  Package
} from 'lucide-react';
import { cn } from '../lib/utils';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';
import { useRef } from 'react';

interface SearchableMaterialSelectorProps {
  value: string;
  onChange: (val: string) => void;
  materials: Material[];
  className?: string;
  placeholder?: string;
}

function SearchableMaterialSelector({
  value,
  onChange,
  materials,
  className = '',
  placeholder = '-- Choose Material --'
}: SearchableMaterialSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedMaterial = materials.find(m => m.id === value);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Filter materials based on search code/name
  const filteredMaterials = materials.filter(m => {
    const s = search.toLowerCase();
    return m.name.toLowerCase().includes(s) || m.code.toLowerCase().includes(s);
  }).sort((a, b) => {
    const s = search.toLowerCase();
    const aCode = a.code.toLowerCase();
    const bCode = b.code.toLowerCase();
    const aName = a.name.toLowerCase();
    const bName = b.name.toLowerCase();

    // 1. Exact code match
    if (aCode === s && bCode !== s) return -1;
    if (bCode === s && aCode !== s) return 1;

    // 2. Code starts with search
    if (aCode.startsWith(s) && !bCode.startsWith(s)) return -1;
    if (bCode.startsWith(s) && !aCode.startsWith(s)) return 1;

    // 3. Name starts with search
    if (aName.startsWith(s) && !bName.startsWith(s)) return -1;
    if (bName.startsWith(s) && !aName.startsWith(s)) return 1;

    return aCode.localeCompare(bCode, undefined, { numeric: true, sensitivity: 'base' });
  });

  return (
    <div ref={containerRef} className={cn("relative inline-block text-left", className)}>
      <div>
        <button
          type="button"
          onClick={() => {
            setIsOpen(!isOpen);
            setSearch('');
          }}
          className="w-full flex items-center justify-between px-3 py-1.5 bg-white border border-slate-200 rounded-lg font-bold text-slate-700 outline-none focus:border-blue-500 text-left text-xs"
        >
          <span className="truncate">
            {selectedMaterial ? `${selectedMaterial.code} - ${selectedMaterial.name}` : placeholder}
          </span>
          <ChevronDown className="w-4 h-4 ml-2 text-slate-400 flex-shrink-0" />
        </button>
      </div>

      {isOpen && (
        <div className="absolute left-0 mt-1 w-64 rounded-xl bg-white shadow-2xl border border-slate-100 z-50 animate-in fade-in slide-in-from-top-1 duration-100">
          <div className="p-2 border-b border-slate-100">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <input
                type="text"
                autoFocus
                className="w-full pl-8 pr-3 py-1 bg-slate-50 border border-slate-100 rounded-md text-xs outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="Search code or name..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          <div className="max-h-48 overflow-y-auto p-1 text-xs">
            {filteredMaterials.length === 0 ? (
              <div className="py-2 px-3 text-slate-400 font-medium italic">No material found</div>
            ) : (
              filteredMaterials.map(m => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    onChange(m.id);
                    setIsOpen(false);
                    setSearch('');
                  }}
                  className={cn(
                    "w-full text-left px-3 py-1.5 rounded-lg font-bold hover:bg-slate-50 transition-colors flex flex-col",
                    value === m.id ? 'text-blue-600 bg-blue-50/50' : 'text-slate-700'
                  )}
                >
                  <span>{m.code} - {m.name}</span>
                  {m.salePrice !== undefined && (
                    <span className="text-[10px] text-slate-400 font-normal">
                      Sell: ${m.salePrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Reusable Invoice Document Component for both Preview and Portal Printing
const InvoiceDocument = ({ 
  invoice, 
  materials, 
  className = "" 
}: { 
  invoice: Invoice; 
  materials: Material[]; 
  className?: string;
}) => {
  return (
    <div className={cn(
      "bg-white px-6 py-4 font-sans text-slate-900 invoice-container relative flex flex-col min-h-0 w-full max-w-[1000px] print:max-w-none mx-auto",
      className
    )}>
      {/* Decorative Elements */}
      <div className="absolute top-0 left-0 w-full h-2 bg-slate-900 no-print" />
      
      {/* Header */}
      <div className="flex justify-between items-start mb-4 text-left text-xs">
        <div className="space-y-1">
          <h1 className="text-4xl font-black uppercase tracking-tight text-slate-900">{COMPANY_NAME}</h1>
          <p className="text-sm text-slate-400 font-medium tracking-wide mt-0.5">{COMPANY_WEBSITE}</p>
          <p className="text-sm text-slate-500 font-bold mt-1">{COMPANY_ADDRESS}</p>
          <p className="text-sm text-slate-500 mt-1">{COMPANY_PHONE} | {COMPANY_EMAIL}</p>
        </div>
        <div className="h-14 w-auto flex items-center justify-center">
          <BrandLogo className="h-full w-auto object-contain grayscale opacity-60" grayscale />
        </div>
      </div>

      <div className="text-center space-y-1 mb-4 border-y border-slate-100 py-2">
        <div className="flex items-center justify-center gap-8 text-[10px] font-bold uppercase tracking-[0.4em] text-slate-300">
          <span>Industrial Scrap Solutions</span>
          <div className="w-2 h-2 rounded-full bg-slate-100" />
          <span>Global Logistics</span>
          <div className="w-2 h-2 rounded-full bg-slate-100" />
          <span>Commercial Recycling</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-8 mb-6 text-left">
        <div className="space-y-8">
          <div className="space-y-2">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Bill To</p>
            <div className="space-y-3">
              <p className="text-2xl font-black text-slate-900 uppercase tracking-tight">{invoice.buyerName}</p>
              {invoice.buyerAddress ? (
                <p className="text-sm text-slate-500 whitespace-pre-wrap">{invoice.buyerAddress}</p>
              ) : (
                <p className="text-sm text-slate-500 italic">Buyer Information Pending</p>
              )}
              {invoice.buyerPhone && (
                <p className="text-sm text-slate-500">{invoice.buyerPhone}</p>
              )}
            </div>
          </div>
        </div>
        <div className="space-y-8 text-right">
          <div className="grid grid-cols-2 gap-8 justify-items-end">
            <div className="space-y-1 text-right">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Invoice #</p>
              <p className="text-sm font-bold">{invoice.invoiceNumber}</p>
            </div>
            <div className="space-y-1 text-right">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Date</p>
              <p className="text-sm font-bold">{new Date(invoice.date).toLocaleDateString()}</p>
            </div>
            <div className="space-y-1 text-right">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Due Date</p>
              <p className="text-sm font-bold">{new Date(invoice.dueDate).toLocaleDateString()}</p>
            </div>
            <div className="space-y-1 text-right">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Terms</p>
              <p className="text-sm font-bold">{invoice.paymentTerms || 'Net 30'}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b-2 border-slate-900">
              <th className="py-4 text-left text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Description</th>
              <th className="py-4 text-right text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Quantity</th>
              <th className="py-4 text-right text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Unit Price</th>
              <th className="py-4 text-right text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 font-sans">
            {invoice.materials.map((item, idx) => {
              const material = materials.find(m => m.id === item.materialId);
              const showBoxDetails = item.boxNumber !== undefined || item.grossWeight !== undefined || item.tareWeight !== undefined;
              return (
                <tr key={idx} className="group border-b border-slate-100 last:border-none">
                  <td className="py-3 text-left">
                    <div className="space-y-0.5">
                      <p className="text-sm font-black text-slate-900 uppercase tracking-tight">
                        {item.boxNumber ? `${item.boxNumber}: ` : ''}{item.customName || material?.name || 'Unknown Material'}
                      </p>
                      <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest">
                        Code: {material?.code || '-'} {item.slotIndex !== undefined ? `• Flatbed Slot ${item.slotIndex + 1}` : ''}
                      </p>
                    </div>
                  </td>
                  <td className="py-3 text-right">
                    <div className="space-y-0.5 text-right font-sans">
                      <p className="text-sm font-bold text-slate-900">{item.weight.toLocaleString()} {material?.unit || 'lb'}</p>
                      {showBoxDetails && (
                        <p className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">
                          G: {item.grossWeight || 0} lb | T: {item.tareWeight || 0} lb
                        </p>
                      )}
                    </div>
                  </td>
                  <td className="py-3 text-right font-sans">
                    <p className="text-sm font-bold text-slate-500">${item.salePrice.toFixed(2)}</p>
                  </td>
                  <td className="py-3 text-right font-sans">
                    <p className="text-sm font-black text-slate-900">${(item.weight * item.salePrice).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer Totals */}
      <div className="mt-4 pt-4 border-t-2 border-slate-900 flex justify-between items-start text-left">
        <div className="flex-1 space-y-4">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Notes & Instructions</p>
          <div className="p-4 bg-slate-50/50 rounded-2xl border border-slate-100 min-h-[60px] w-full max-w-lg">
             <p className="text-sm text-slate-600 leading-relaxed italic">{invoice.notes || 'No additional notes.'}</p>
          </div>
        </div>
        <div className="w-80 space-y-3">
          <div className="flex justify-between items-center py-2 border-b border-slate-100">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Subtotal</span>
            <span className="text-sm font-bold text-slate-900">${invoice.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
          </div>
          <div className="flex justify-between items-center py-2 border-b border-slate-100">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Taxes (0%)</span>
            <span className="text-sm font-bold text-slate-900">$0.00</span>
          </div>
          <div className="flex justify-between items-center py-6">
            <span className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-900">Total Amount</span>
            <span className="text-3xl font-black text-slate-900 tracking-tighter">${invoice.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
          </div>
        </div>
      </div>

      <div className="mt-8 pt-4 border-t border-slate-100 flex justify-between items-end opacity-40">
        <div className="space-y-1">
          <p className="text-[8px] font-black uppercase tracking-widest text-slate-400">Security Verifier</p>
          <p className="text-[7px] font-mono font-bold tracking-tighter">HEX-ID-{invoice.id.toUpperCase()}</p>
        </div>
        <div className="text-right">
          <p className="text-[8px] font-black uppercase tracking-widest text-slate-900">{COMPANY_NAME}</p>
          <p className="text-[7px] font-bold text-slate-400 uppercase tracking-tight">Industrial Recycling Systems • {COMPANY_WEBSITE}</p>
        </div>
      </div>
    </div>
  );
};

export default function Invoices({ profile }: { profile: UserProfile | null }) {
  const { settings } = useSettings();
  const [activeTab, setActiveTab] = useState<'pending' | 'history' | 'create'>(() => {
    const saved = localStorage.getItem('pm_invoices_active_tab');
    return (saved as any) || 'create';
  });

  useEffect(() => {
    localStorage.setItem('pm_invoices_active_tab', activeTab);
  }, [activeTab]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [tripTickets, setTripTickets] = useState<TripTicket[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [buyTickets, setBuyTickets] = useState<BuyTicket[]>([]);
  const [inventoryMap, setInventoryMap] = useState<Record<string, number>>({});
  const [expandedInvoiceIds, setExpandedInvoiceIds] = useState<Record<string, boolean>>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  
  // Standalone Invoice Form State
  const [buyerName, setBuyerName] = useState('');
  const [buyerAddress, setBuyerAddress] = useState('');
  const [buyerPhone, setBuyerPhone] = useState('');
  const [selectedBuyerId, setSelectedBuyerId] = useState('');
  const [selectedMaterials, setSelectedMaterials] = useState<TripTicketMaterial[]>([]);
  const [materialSearch, setMaterialSearch] = useState('');
  const [notes, setNotes] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('Net 30');
  const [loadPlans, setLoadPlans] = useState<LoadPlan[]>([]);
  const [selectedLoadPlanId, setSelectedLoadPlanId] = useState<string>('');

  const [selectedTicket, setSelectedTicket] = useState<TripTicket | null>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [showInvoicePreview, setShowInvoicePreview] = useState(false);
  const [autoPrint, setAutoPrint] = useState(false);
  const [processing, setProcessing] = useState(false);

  // Helper to calculate material bought and already invoiced weights
  const getMaterialPurchaseSummary = (materialId: string) => {
    // Sum net weights of this material across all completed buy tickets
    const totalBought = buyTickets
      .filter(t => t.status === 'completed')
      .reduce((sum, t) => {
        const matItems = t.materials.filter(m => m.materialId === materialId);
        return sum + matItems.reduce((s, m) => s + (m.netWeight || 0), 0);
      }, 0);

    // Sum weights of this material across all invoices (except this draft/selected invoice if it's currently being edited, to avoid double-counting)
    const totalInvoiced = invoices
      .filter(inv => inv.id !== selectedInvoice?.id)
      .reduce((sum, inv) => {
        const matItems = inv.materials.filter(m => m.materialId === materialId);
        return sum + matItems.reduce((s, m) => s + (m.weight || 0), 0);
      }, 0);

    const remaining = Math.max(0, totalBought - totalInvoiced);

    return {
      totalBought,
      totalInvoiced,
      remaining
    };
  };

  const [draftLoaded, setDraftLoaded] = useState(false);

  // Load drafts on mount
  useEffect(() => {
    // 1. Standalone Draft
    const savedDraft = localStorage.getItem('pm_draft_invoice');
    if (savedDraft) {
      try {
        const draft = JSON.parse(savedDraft);
        if (draft.buyerName) setBuyerName(draft.buyerName);
        if (draft.buyerAddress) setBuyerAddress(draft.buyerAddress);
        if (draft.buyerPhone) setBuyerPhone(draft.buyerPhone);
        if (draft.selectedBuyerId) setSelectedBuyerId(draft.selectedBuyerId);
        if (draft.selectedMaterials) setSelectedMaterials(draft.selectedMaterials);
        if (draft.notes) setNotes(draft.notes);
        if (draft.paymentTerms) setPaymentTerms(draft.paymentTerms);
        if (draft.selectedLoadPlanId) setSelectedLoadPlanId(draft.selectedLoadPlanId);
      } catch (e) {
        console.error('Error loading draft invoice:', e);
      }
    }

    // 2. Active Editing Invoice
    const savedEditing = localStorage.getItem('pm_editing_invoice');
    if (savedEditing) {
      try {
        const editingData = JSON.parse(savedEditing);
        if (editingData.invoice) {
          setSelectedInvoice(editingData.invoice);
          setIsEditing(editingData.isEditing || false);
          setShowInvoicePreview(editingData.showInvoicePreview || false);
        }
      } catch (e) {
        console.error('Error loading active editing invoice:', e);
      }
    }

    setDraftLoaded(true);
  }, []);

  // Save standalone draft on change
  useEffect(() => {
    if (!draftLoaded) return;

    const draft = {
      buyerName,
      buyerAddress,
      buyerPhone,
      selectedBuyerId,
      selectedMaterials,
      notes,
      paymentTerms,
      selectedLoadPlanId
    };

    const isDirty = buyerName || buyerAddress || buyerPhone || selectedBuyerId || selectedMaterials.length > 0 || notes || paymentTerms !== 'Net 30' || selectedLoadPlanId;
    if (isDirty) {
      localStorage.setItem('pm_draft_invoice', JSON.stringify(draft));
    } else {
      localStorage.removeItem('pm_draft_invoice');
    }
  }, [buyerName, buyerAddress, buyerPhone, selectedBuyerId, selectedMaterials, notes, paymentTerms, selectedLoadPlanId, draftLoaded]);

  // Save active editing invoice on change
  useEffect(() => {
    if (!draftLoaded) return;

    if (showInvoicePreview && isEditing && selectedInvoice) {
      localStorage.setItem('pm_editing_invoice', JSON.stringify({
        invoice: selectedInvoice,
        isEditing,
        showInvoicePreview
      }));
    } else {
      localStorage.removeItem('pm_editing_invoice');
    }
  }, [selectedInvoice, isEditing, showInvoicePreview, draftLoaded]);

  const handleDiscardDraft = () => {
    if (window.confirm('Are you sure you want to discard this draft? This will clear all entered fields.')) {
      setBuyerName('');
      setBuyerAddress('');
      setBuyerPhone('');
      setSelectedBuyerId('');
      setSelectedMaterials([]);
      setNotes('');
      setPaymentTerms('Net 30');
      setSelectedLoadPlanId('');
      localStorage.removeItem('pm_draft_invoice');
    }
  };

  useEffect(() => {
    if (!auth.currentUser) return;

    const unsubMaterials = onSnapshot(collection(db, 'materials'), (snapshot) => {
      setMaterials(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Material[]);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'materials'));

    const unsubTrips = onSnapshot(
      query(collection(db, 'tripTickets'), orderBy('timestamp', 'desc')), 
      (snapshot) => {
        setTripTickets(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as TripTicket[]);
      }, 
      (error) => handleFirestoreError(error, OperationType.LIST, 'tripTickets')
    );

    const unsubInvoices = onSnapshot(
      query(collection(db, 'invoices'), orderBy('date', 'desc')), 
      (snapshot) => {
        setInvoices(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Invoice[]);
        setLoading(false);
      }, 
      (error) => handleFirestoreError(error, OperationType.LIST, 'invoices')
    );

    const unsubCustomers = onSnapshot(collection(db, 'customers'), (snapshot) => {
      setCustomers(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Customer[]);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'customers'));

    const unsubBuyTickets = onSnapshot(
      query(collection(db, 'buyTickets'), orderBy('timestamp', 'desc')),
      (snapshot) => {
        setBuyTickets(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as BuyTicket[]);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'buyTickets')
    );

    const unsubLoadPlans = onSnapshot(
      query(collection(db, 'loadPlans'), orderBy('date', 'desc')),
      (snapshot) => {
        setLoadPlans(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as LoadPlan[]);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'loadPlans')
    );

    const unsubInventory = onSnapshot(collection(db, 'inventory'), (snapshot) => {
      const map: Record<string, number> = {};
      snapshot.docs.forEach(docSnap => {
        map[docSnap.id] = Number(docSnap.data().currentWeight) || 0;
      });
      setInventoryMap(map);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'inventory'));

    return () => {
      try { unsubMaterials(); } catch (e) { console.warn('unsubMaterials error', e); }
      try { unsubTrips(); } catch (e) { console.warn('unsubTrips error', e); }
      try { unsubInvoices(); } catch (e) { console.warn('unsubInvoices error', e); }
      try { unsubCustomers(); } catch (e) { console.warn('unsubCustomers error', e); }
      try { unsubBuyTickets(); } catch (e) { console.warn('unsubBuyTickets error', e); }
      try { unsubLoadPlans(); } catch (e) { console.warn('unsubLoadPlans error', e); }
      try { unsubInventory(); } catch (e) { console.warn('unsubInventory error', e); }
    };
  }, [profile]);

  useEffect(() => {
    if (showInvoicePreview && autoPrint) {
      // Small timeout to ensure the modal content is rendered before printing
      const timer = setTimeout(() => {
        if (!settings.debugPrintMode) window.print();
        if (!settings.debugPrintMode) setAutoPrint(false);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [showInvoicePreview, autoPrint, settings.debugPrintMode]);

  const handleUpdateInvoiceStatus = async (invoiceId: string, status: Invoice['status']) => {
    setActionError(null);
    setActionSuccess(null);
    const inv = invoices.find(i => i.id === invoiceId) || (selectedInvoice?.id === invoiceId ? selectedInvoice : null);
    if (!inv) return;

    // Requirement 5: Block status change away from Paid if inventory was already deducted
    if (inv.inventoryDeducted && status !== 'paid') {
      const msg = `Status change blocked: Inventory was already deducted for this invoice. Changing status away from Paid is blocked to prevent inventory discrepancies.`;
      setActionError(msg);
      alert(msg);
      return;
    }

    // Requirement 3 & 4: Deduct inventory when transitioning to Paid
    if (status === 'paid' && !inv.inventoryDeducted) {
      const requiredByMaterial: Record<string, number> = {};
      inv.materials?.forEach(item => {
        if (item.materialId) {
          const w = Number(item.weight) || 0;
          requiredByMaterial[item.materialId] = (requiredByMaterial[item.materialId] || 0) + w;
        }
      });

      const insufficientLines: string[] = [];
      for (const [matId, reqWeight] of Object.entries(requiredByMaterial)) {
        const availWeight = inventoryMap[matId] ?? 0;
        if (availWeight < reqWeight) {
          const mat = materials.find(m => m.id === matId);
          const matName = mat ? `${mat.name} (${mat.code})` : matId;
          const shortfall = reqWeight - availWeight;
          insufficientLines.push(`${matName}: required ${reqWeight.toLocaleString()} lbs, available ${availWeight.toLocaleString()} lbs (short by ${shortfall.toLocaleString()} lbs)`);
        }
      }

      if (insufficientLines.length > 0) {
        const msg = `Cannot mark invoice as Paid due to insufficient live inventory:\n• ${insufficientLines.join('\n• ')}`;
        setActionError(msg);
        alert(msg);
        return;
      }

      setProcessing(true);
      try {
        const batch = writeBatch(db);
        const timestamp = new Date().toISOString();

        for (const [matId, reqWeight] of Object.entries(requiredByMaterial)) {
          const invRef = doc(db, 'inventory', matId);
          batch.set(invRef, {
            materialId: matId,
            currentWeight: increment(-reqWeight),
            lastUpdated: timestamp
          }, { merge: true });
        }

        const invRef = doc(db, 'invoices', invoiceId);
        batch.update(invRef, {
          status: 'paid',
          inventoryDeducted: true,
          inventoryDeductedAt: timestamp
        });

        await batch.commit();

        if (selectedInvoice && selectedInvoice.id === invoiceId) {
          setSelectedInvoice({
            ...selectedInvoice,
            status: 'paid',
            inventoryDeducted: true,
            inventoryDeductedAt: timestamp
          });
        }

        await logAuditEvent(
          'invoice',
          invoiceId,
          'update',
          { after: { status: 'paid', inventoryDeducted: true } },
          `Marked invoice ${inv.invoiceNumber} as Paid and deducted line-item inventory`
        );

        setActionSuccess(`Invoice ${inv.invoiceNumber} marked as Paid and inventory deducted successfully.`);
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `invoices/${invoiceId}`);
      } finally {
        setProcessing(false);
      }
      return;
    }

    setProcessing(true);
    try {
      await updateDoc(doc(db, 'invoices', invoiceId), { status });
      if (selectedInvoice && selectedInvoice.id === invoiceId) {
        setSelectedInvoice({ ...selectedInvoice, status });
      }
      await logAuditEvent(
        'invoice',
        invoiceId,
        'update',
        { after: { status } },
        `Updated invoice status to ${status}`
      );
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `invoices/${invoiceId}`);
    } finally {
      setProcessing(false);
    }
  };

  const handleRunBackfill = async (inv: Invoice) => {
    if (inv.inventoryDeducted) {
      alert(`Inventory was already deducted for invoice ${inv.invoiceNumber}.`);
      return;
    }
    if (!confirm(`Run inventory backfill correction for ${inv.invoiceNumber}? This will calculate aggregated line-item weights and deduct live inventory.`)) {
      return;
    }

    setProcessing(true);
    setActionError(null);
    setActionSuccess(null);

    try {
      const requiredByMaterial: Record<string, number> = {};
      inv.materials?.forEach(item => {
        if (item.materialId) {
          const w = Number(item.weight) || 0;
          requiredByMaterial[item.materialId] = (requiredByMaterial[item.materialId] || 0) + w;
        }
      });

      const insufficientLines: string[] = [];
      for (const matId of Object.keys(requiredByMaterial)) {
        const invSnap = await getDoc(doc(db, 'inventory', matId));
        const currentWeight = invSnap.exists() ? (Number(invSnap.data().currentWeight) || 0) : 0;
        const reqWeight = requiredByMaterial[matId];

        if (currentWeight < reqWeight) {
          const mat = materials.find(m => m.id === matId);
          const matName = mat ? `${mat.name} (${mat.code})` : matId;
          const shortfall = reqWeight - currentWeight;
          insufficientLines.push(`${matName}: required ${reqWeight.toLocaleString()} lbs, available ${currentWeight.toLocaleString()} lbs (short by ${shortfall.toLocaleString()} lbs)`);
        }
      }

      if (insufficientLines.length > 0) {
        const msg = `Backfill blocked due to insufficient live inventory:\n• ${insufficientLines.join('\n• ')}`;
        setActionError(msg);
        alert(msg);
        return;
      }

      const batch = writeBatch(db);
      const timestamp = inv.date || '2026-08-07T16:06:50.117Z';

      for (const [matId, reqWeight] of Object.entries(requiredByMaterial)) {
        const invRef = doc(db, 'inventory', matId);
        batch.set(invRef, {
          materialId: matId,
          currentWeight: increment(-reqWeight),
          lastUpdated: new Date().toISOString()
        }, { merge: true });
      }

      const invRef = doc(db, 'invoices', inv.id);
      batch.update(invRef, {
        inventoryDeducted: true,
        inventoryDeductedAt: timestamp
      });

      await batch.commit();

      if (selectedInvoice && selectedInvoice.id === inv.id) {
        setSelectedInvoice({
          ...selectedInvoice,
          inventoryDeducted: true,
          inventoryDeductedAt: timestamp
        });
      }

      await logAuditEvent(
        'invoice',
        inv.id,
        'update',
        { after: { inventoryDeducted: true, inventoryDeductedAt: timestamp } },
        `Executed inventory backfill correction for invoice ${inv.invoiceNumber}`
      );

      setActionSuccess(`Inventory backfill for invoice ${inv.invoiceNumber} successfully applied!`);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `invoices/${inv.id}`);
    } finally {
      setProcessing(false);
    }
  };

  const handleSaveEditedInvoice = async () => {
    if (!selectedInvoice) return;
    setProcessing(true);
    try {
      await updateDoc(doc(db, 'invoices', selectedInvoice.id), {
        buyerName: selectedInvoice.buyerName,
        buyerAddress: selectedInvoice.buyerAddress || '',
        buyerPhone: selectedInvoice.buyerPhone || '',
        date: selectedInvoice.date,
        dueDate: selectedInvoice.dueDate,
        paymentTerms: selectedInvoice.paymentTerms || 'Net 30',
        notes: selectedInvoice.notes || '',
        materials: selectedInvoice.materials,
        totalWeight: selectedInvoice.totalWeight,
        totalAmount: selectedInvoice.totalAmount
      });
      await logAuditEvent(
        'invoice',
        selectedInvoice.id,
        'update',
        { after: selectedInvoice },
        `Saved edited invoice ${selectedInvoice.invoiceNumber}`
      );
      setIsEditing(false);
      setAutoPrint(true);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'invoices');
    } finally {
      setProcessing(false);
    }
  };

  const updateInvoiceField = (field: keyof Invoice, value: any) => {
    if (!selectedInvoice) return;
    setSelectedInvoice({ ...selectedInvoice, [field]: value } as Invoice);
  };

  const updateInvoiceMaterial = (index: number, field: keyof TripTicketMaterial, value: any) => {
    if (!selectedInvoice) return;
    const newMaterials = [...selectedInvoice.materials];
    
    // Convert value appropriately
    let val = value;
    if (field === 'weight' || field === 'salePrice' || field === 'grossWeight' || field === 'tareWeight') {
      val = value === '' ? 0 : Number(value);
    }
    
    const updatedItem = {
      ...newMaterials[index],
      [field]: val
    };

    // If materialId changes, pre-populate the salePrice
    if (field === 'materialId') {
      const mat = materials.find(m => m.id === value);
      if (mat) {
        updatedItem.salePrice = mat.salePrice;
      }
    }

    // Recalculate Net Weight if grossWeight or tareWeight changes
    if (field === 'grossWeight' || field === 'tareWeight') {
      const gross = Number(updatedItem.grossWeight || 0);
      const tare = Number(updatedItem.tareWeight || 0);
      updatedItem.weight = roundNetWeight(Math.max(0, gross - tare));
    }

    newMaterials[index] = updatedItem;
    
    // Recalculate totals
    const totalWeight = newMaterials.reduce((sum, m) => sum + (m.weight || 0), 0);
    const totalAmount = newMaterials.reduce((sum, m) => sum + ((m.weight || 0) * (m.salePrice || 0)), 0);
    
    setSelectedInvoice({ 
      ...selectedInvoice, 
      materials: newMaterials,
      totalWeight,
      totalAmount
    } as Invoice);
  };

  const handleAddMaterial = (materialId: string) => {
    const material = materials.find(m => m.id === materialId);
    if (!material) return;

    setSelectedMaterials(prev => [...prev, {
      materialId,
      weight: 0,
      salePrice: material.salePrice,
      boxNumber: `Box #${prev.length + 1}`,
      grossWeight: 0,
      tareWeight: 0
    }]);
  };

  const handleRemoveLineItem = (index: number) => {
    setSelectedMaterials(prev => prev.filter((_, idx) => idx !== index));
  };

  const handleAddEmptyLineItem = () => {
    setSelectedMaterials(prev => [...prev, {
      materialId: '',
      weight: 0,
      salePrice: 0,
      boxNumber: `Box #${prev.length + 1}`,
      grossWeight: 0,
      tareWeight: 0
    }]);
  };

  const handleUpdateLineItem = (index: number, field: keyof TripTicketMaterial, value: any) => {
    setSelectedMaterials(prev => prev.map((item, idx) => {
      if (idx !== index) return item;
      
      const updated = { ...item, [field]: value };
      
      // If materialId changes, pre-populate the salePrice
      if (field === 'materialId') {
        const mat = materials.find(m => m.id === value);
        if (mat) {
          updated.salePrice = mat.salePrice;
        }
      }
      
      // If grossWeight or tareWeight changes, re-calculate Net Weight (weight)
      if (field === 'grossWeight' || field === 'tareWeight') {
        const gross = Number(updated.grossWeight || 0);
        const tare = Number(updated.tareWeight || 0);
        updated.weight = roundNetWeight(Math.max(0, gross - tare));
      }
      
      return updated;
    }));
  };

  const handlePreloadFromLoadPlan = (loadPlanId: string) => {
    setSelectedLoadPlanId(loadPlanId);
    if (!loadPlanId) return;

    const lp = loadPlans.find(p => p.id === loadPlanId);
    if (!lp) return;

    if (lp.carrier) {
      setBuyerName(lp.carrier);
    }
    if (lp.notes) {
      setNotes(`Flatbed Load Plan: ${lp.loadNumber}\nNotes: ${lp.notes}`);
    }

    const preloadedItems: TripTicketMaterial[] = [];
    lp.boxes.forEach(box => {
      if (box.materialId) {
        const mat = materials.find(m => m.id === box.materialId);
        preloadedItems.push({
          materialId: box.materialId,
          weight: box.weight || 0,
          salePrice: mat?.salePrice || 0,
          boxNumber: `Box #${box.slotIndex + 1}`,
          grossWeight: box.weight || 0,
          tareWeight: 0,
          slotIndex: box.slotIndex
        });
      }
    });

    if (preloadedItems.length > 0) {
      setSelectedMaterials(preloadedItems);
    }
  };

  const handleSyncBackToLoadPlan = async () => {
    if (!selectedLoadPlanId) return;
    const lp = loadPlans.find(p => p.id === selectedLoadPlanId);
    if (!lp) return;

    setProcessing(true);
    try {
      const updatedBoxes = Array.from({ length: 8 }).map((_, idx) => {
        const matchedItem = selectedMaterials.find(item => item.slotIndex === idx);
        if (matchedItem && matchedItem.materialId) {
          return {
            slotIndex: idx,
            materialId: matchedItem.materialId,
            weight: Number(matchedItem.weight || 0),
            notes: `${matchedItem.boxNumber || `Box #${idx + 1}`}${matchedItem.customName ? ` - ${matchedItem.customName}` : ''}`
          };
        }
        return {
          slotIndex: idx,
          materialId: '',
          weight: 0,
          notes: ''
        };
      });

      const totalWeightNum = updatedBoxes.reduce((sum, b) => sum + (b.materialId ? b.weight : 0), 0);

      const updatedData = {
        ...lp,
        boxes: updatedBoxes,
        totalWeight: totalWeightNum,
        recordedAt: new Date().toISOString(),
        recordedBy: profile?.email || 'System'
      };

      await updateDoc(doc(db, 'loadPlans', lp.id), {
        boxes: updatedBoxes,
        totalWeight: totalWeightNum,
        recordedAt: new Date().toISOString(),
        recordedBy: profile?.email || 'System'
      });

      await logAuditEvent(
        'loadPlan',
        lp.id,
        'update',
        { before: lp, after: updatedData },
        `Synced invoice boxes back to flatbed load plan ${lp.loadNumber}`
      );

      alert(`Successfully synced ${selectedMaterials.filter(m => m.slotIndex !== undefined).length} boxes back to Flatbed Load Plan ${lp.loadNumber}!`);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'loadPlans');
    } finally {
      setProcessing(false);
    }
  };

  const calculateDueDate = (date: string, terms: string) => {
    const baseDate = new Date(date);
    let days = 30;
    if (terms === 'Due on Receipt' || terms === 'Via Check on Receipt' || terms === 'Via ACH on Receipt') days = 0;
    if (terms === 'Net 15') days = 15;
    if (terms === 'Net 30') days = 30;
    if (terms === 'Net 45') days = 45;
    if (terms === 'Net 60') days = 60;
    if (terms === 'Net 90') days = 90;
    
    baseDate.setDate(baseDate.getDate() + days);
    return baseDate.toISOString();
  };

  const handleStandaloneSubmit = async () => {
    if (!buyerName || selectedMaterials.length === 0) return;
    setProcessing(true);
    try {
      const invoiceNumber = `INV-${Date.now().toString().slice(-6)}`;
      const totalWeight = selectedMaterials.reduce((sum, m) => sum + m.weight, 0);
      const totalAmount = selectedMaterials.reduce((sum, m) => sum + (m.weight * m.salePrice), 0);
      const invoiceDate = new Date().toISOString();

      const invoiceData: Omit<Invoice, 'id'> = {
        invoiceNumber,
        tripTicketId: '', // Standalone for now
        buyerName,
        buyerAddress,
        buyerPhone,
        date: invoiceDate,
        dueDate: calculateDueDate(invoiceDate, paymentTerms),
        materials: selectedMaterials,
        totalWeight,
        totalAmount,
        paymentTerms,
        status: 'draft',
        notes,
        createdBy: profile?.uid || '',
        createdByName: profile?.displayName || profile?.email || 'System',
        loadPlanId: selectedLoadPlanId || ''
      };

      const docRef = await addDoc(collection(db, 'invoices'), invoiceData);
      
      await logAuditEvent(
        'invoice',
        docRef.id,
        'create',
        { after: invoiceData },
        `Created standalone invoice ${invoiceNumber} for buyer ${buyerName}`
      );

      // Reset Form
      setBuyerName('');
      setBuyerAddress('');
      setBuyerPhone('');
      setSelectedBuyerId('');
      setSelectedMaterials([]);
      setNotes('');
      setSelectedLoadPlanId('');
      localStorage.removeItem('pm_draft_invoice');
      
      setSelectedInvoice({ id: docRef.id, ...invoiceData });
      setIsEditing(false);
      setShowInvoicePreview(true);
      setAutoPrint(true);
      setActiveTab('history');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'invoices');
    } finally {
      setProcessing(false);
    }
  };

  const handleCreateInvoice = async (ticket: TripTicket) => {
    setProcessing(true);
    try {
      const invoiceNumber = `INV-${Date.now().toString().slice(-6)}`;
      const totalWeight = ticket.totalWeight || ticket.materials.reduce((sum, m) => sum + m.weight, 0);
      const totalAmount = ticket.totalValue || ticket.materials.reduce((sum, m) => sum + (m.weight * m.salePrice), 0);
      const invoiceDate = new Date().toISOString();

      const invoiceData: Omit<Invoice, 'id'> = {
        invoiceNumber,
        tripTicketId: ticket.id,
        buyerName: ticket.destination,
        buyerAddress: ticket.buyerAddress || '',
        buyerPhone: ticket.buyerPhone || '',
        date: invoiceDate,
        dueDate: calculateDueDate(invoiceDate, paymentTerms), // Uses current selected terms
        materials: ticket.materials,
        totalWeight,
        totalAmount,
        paymentTerms,
        status: 'draft',
        createdBy: profile?.uid || '',
        createdByName: profile?.displayName || profile?.email || 'System'
      };

      const docRef = await addDoc(collection(db, 'invoices'), invoiceData);
      
      await logAuditEvent(
        'invoice',
        docRef.id,
        'create',
        { after: invoiceData },
        `Created invoice ${invoiceNumber} from Trip Ticket ${ticket.id}`
      );

      // Update Trip Ticket status
      await updateDoc(doc(db, 'tripTickets', ticket.id), {
        invoiceId: docRef.id,
        invoiceStatus: 'invoiced'
      });

      setSelectedInvoice({ id: docRef.id, ...invoiceData });
      setIsEditing(false);
      setShowInvoicePreview(true);
      setAutoPrint(true);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'invoices');
    } finally {
      setProcessing(false);
    }
  };

  const handleDeleteInvoice = async (invoiceId: string, tripTicketId?: string) => {
    setActionError(null);
    setActionSuccess(null);
    const targetInvoice = invoices.find(inv => inv.id === invoiceId) || (selectedInvoice?.id === invoiceId ? selectedInvoice : null);
    if (!targetInvoice) return;

    if (!window.confirm(`Are you sure you want to delete invoice ${targetInvoice.invoiceNumber}? This action cannot be undone.`)) return;

    setProcessing(true);
    try {
      const batch = writeBatch(db);
      const timestamp = new Date().toISOString();

      // Requirement 6 & 7: Restore inventory if invoice was Paid (inventoryDeducted is true)
      if (targetInvoice.inventoryDeducted) {
        const restoreByMaterial: Record<string, number> = {};
        targetInvoice.materials?.forEach(item => {
          if (item.materialId) {
            const w = Number(item.weight) || 0;
            restoreByMaterial[item.materialId] = (restoreByMaterial[item.materialId] || 0) + w;
          }
        });

        const missingMaterials: string[] = [];
        for (const matId of Object.keys(restoreByMaterial)) {
          const matExists = materials.some(m => m.id === matId);
          if (!matExists) {
            missingMaterials.push(matId);
          }
        }

        if (missingMaterials.length > 0) {
          const msg = `Deletion blocked: Material '${missingMaterials.join(', ')}' referenced on this invoice no longer exists in the system. Restoration cannot be completed cleanly.`;
          setActionError(msg);
          alert(msg);
          setProcessing(false);
          return;
        }

        for (const [matId, weightToRestore] of Object.entries(restoreByMaterial)) {
          const invRef = doc(db, 'inventory', matId);
          batch.set(invRef, {
            materialId: matId,
            currentWeight: increment(weightToRestore),
            lastUpdated: timestamp
          }, { merge: true });
        }
      }

      batch.delete(doc(db, 'invoices', invoiceId));

      if (tripTicketId) {
        batch.update(doc(db, 'tripTickets', tripTicketId), {
          invoiceId: null,
          invoiceStatus: 'pending'
        });
      }

      await batch.commit();

      await logAuditEvent(
        'invoice',
        invoiceId,
        'delete',
        undefined,
        `Deleted invoice ${targetInvoice.invoiceNumber}.${targetInvoice.inventoryDeducted ? ' Restored deducted inventory.' : ''}`
      );

      setShowInvoicePreview(false);
      setActionSuccess(`Invoice ${targetInvoice.invoiceNumber} deleted successfully.`);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `invoices/${invoiceId}`);
    } finally {
      setProcessing(false);
    }
  };

  const pendingTickets = tripTickets.filter(t => t.invoiceStatus !== 'invoiced' && t.status !== 'cancelled' && t.status !== 'voided');

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <div className={cn("space-y-8", showInvoicePreview && "print:hidden")}>
        {actionError && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-red-800 text-sm flex items-start gap-3 animate-in fade-in">
            <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
            <div className="flex-1 whitespace-pre-line">
              <p className="font-bold">Action Blocked</p>
              <p className="mt-0.5 text-xs text-red-700 font-medium">{actionError}</p>
            </div>
            <button onClick={() => setActionError(null)} className="p-1 hover:bg-red-100 rounded-lg text-red-500">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {actionSuccess && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 text-emerald-800 text-sm flex items-start gap-3 animate-in fade-in">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-bold">Success</p>
              <p className="mt-0.5 text-xs text-emerald-700 font-medium">{actionSuccess}</p>
            </div>
            <button onClick={() => setActionSuccess(null)} className="p-1 hover:bg-emerald-100 rounded-lg text-emerald-500">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="text-4xl font-black text-slate-900 tracking-tight font-display">Invoicing</h1>
          <p className="text-slate-500 font-medium mt-1">Generate and manage invoices for outbound shipments.</p>
        </div>
        <nav className="flex bg-slate-100 p-1.5 rounded-2xl" aria-label="Invoice Tabs">
          <button
            onClick={() => setActiveTab('create')}
            className={cn(
              "px-6 py-3 rounded-xl text-sm font-black uppercase tracking-widest transition-all flex items-center gap-2",
              activeTab === 'create' ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
            )}
          >
            <Plus className="w-4 h-4" />
            New Invoice
          </button>
          <button
            onClick={() => setActiveTab('pending')}
            className={cn(
              "px-6 py-3 rounded-xl text-sm font-black uppercase tracking-widest transition-all flex items-center gap-2",
              activeTab === 'pending' ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
            )}
          >
            <Clock className="w-4 h-4" />
            Pending
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={cn(
              "px-6 py-3 rounded-xl text-sm font-black uppercase tracking-widest transition-all flex items-center gap-2",
              activeTab === 'history' ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
            )}
          >
            <History className="w-4 h-4" />
            History
          </button>
        </nav>
      </div>

      {activeTab === 'create' ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 animate-in fade-in slide-in-from-bottom-4 duration-300">
          {/* Left Column: Invoice Details */}
          <div className="lg:col-span-2 space-y-8">
            <div className="bg-white rounded-[2.5rem] p-10 border border-slate-200 shadow-sm space-y-8">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="p-4 bg-blue-600 rounded-2xl text-white shadow-lg shadow-blue-200">
                    <FileText className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="text-2xl font-black text-slate-900 uppercase tracking-tight">Invoice Details</h2>
                    <p className="text-xs text-slate-500 font-black uppercase tracking-widest">Create a standalone invoice</p>
                  </div>
                </div>
                {(buyerName || buyerAddress || buyerPhone || selectedBuyerId || selectedMaterials.length > 0 || notes || paymentTerms !== 'Net 30') && (
                  <button
                    onClick={handleDiscardDraft}
                    className="sm:ml-auto px-4 py-2 border border-red-200 hover:border-red-300 bg-red-50 hover:bg-red-100 text-red-600 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all shadow-sm"
                  >
                    Discard Draft
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Select Buyer (from Customers)</label>
                  <div className="relative group">
                    <User className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 group-focus-within:text-blue-600 transition-colors" />
                    <select
                      className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-all appearance-none"
                      value={selectedBuyerId}
                      onChange={(e) => {
                        const buyerId = e.target.value;
                        setSelectedBuyerId(buyerId);
                        if (buyerId === 'custom') {
                          setBuyerName('');
                          setBuyerAddress('');
                          setBuyerPhone('');
                        } else {
                          const buyer = customers.find(c => c.id === buyerId);
                          if (buyer) {
                            setBuyerName(buyer.businessName || buyer.name);
                            setBuyerAddress(buyer.address || '');
                            setBuyerPhone(buyer.phone || '');
                          }
                        }
                      }}
                    >
                      <option value="">-- Choose a Buyer --</option>
                      <option value="custom">Enter Manually...</option>
                      {customers.filter(c => c.isBuyer).map(buyer => (
                        <option key={buyer.id} value={buyer.id}>
                          {buyer.businessName ? `${buyer.businessName} (${buyer.name})` : buyer.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Buyer Name</label>
                  <input
                    type="text"
                    className="w-full px-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                    placeholder="Enter buyer name..."
                    value={buyerName}
                    onChange={(e) => setBuyerName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Buyer Address</label>
                  <input
                    type="text"
                    className="w-full px-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                    placeholder="Enter buyer address..."
                    value={buyerAddress}
                    onChange={(e) => setBuyerAddress(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Buyer Phone</label>
                  <input
                    type="text"
                    className="w-full px-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                    placeholder="Enter buyer phone..."
                    value={buyerPhone}
                    onChange={(e) => setBuyerPhone(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Payment Terms</label>
                  <div className="relative group">
                    <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 group-focus-within:text-blue-600 transition-colors" />
                    <select
                      className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-all appearance-none"
                      value={paymentTerms}
                      onChange={(e) => setPaymentTerms(e.target.value)}
                    >
                      <option value="Due on Receipt">Due on Receipt</option>
                      <option value="Via Check on Receipt">Via Check on Receipt</option>
                      <option value="Via ACH on Receipt">Via ACH on Receipt</option>
                      <option value="Net 15">Net 15</option>
                      <option value="Net 30">Net 30</option>
                      <option value="Net 45">Net 45</option>
                      <option value="Net 60">Net 60</option>
                      <option value="Net 90">Net 90</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Flatbed Planner Integration Widget */}
              <div className="bg-slate-50 border border-slate-200/60 p-6 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1 text-left">
                  <h3 className="text-sm font-black text-slate-800 uppercase tracking-tight">Flatbed Planner Integration</h3>
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Pre-load gaylord boxes directly from an active truck layout</p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <select
                    className="bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-all cursor-pointer shadow-sm"
                    value={selectedLoadPlanId}
                    onChange={(e) => handlePreloadFromLoadPlan(e.target.value)}
                  >
                    <option value="">-- Select Flatbed Load Plan --</option>
                    {loadPlans
                      .filter(lp => lp.status === 'draft')
                      .map(lp => (
                        <option key={lp.id} value={lp.id}>
                          {lp.loadNumber} - {lp.carrier || 'No Carrier'} ({lp.boxes.filter(b => b.materialId).length} boxes)
                        </option>
                      ))}
                  </select>
                  {selectedLoadPlanId && (
                    <button
                      type="button"
                      onClick={handleSyncBackToLoadPlan}
                      className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-black uppercase tracking-widest transition-all active:scale-95 flex items-center gap-1.5 shadow-md shadow-blue-100"
                      title="Save the current boxes, weights, and materials back to the active Flatbed load plan in Firestore"
                    >
                      🔄 Sync to Flatbed
                    </button>
                  )}
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between px-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Box # / Line Items</label>
                  <span className="text-[10px] font-black text-blue-600 uppercase tracking-widest bg-blue-50 px-2 py-1 rounded-md">
                    {selectedMaterials.length} Boxes Selected
                  </span>
                </div>
                
                <div className="space-y-3">
                  {selectedMaterials.length === 0 ? (
                    <div className="py-12 border-2 border-dashed border-slate-100 rounded-[2rem] text-center space-y-3">
                      <div className="w-12 h-12 bg-slate-50 rounded-full flex items-center justify-center mx-auto">
                        <Plus className="w-6 h-6 text-slate-300" />
                      </div>
                      <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">No box line items added yet</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto bg-slate-50/50 rounded-2xl border border-slate-100 p-4">
                      <table className="w-full text-left border-collapse text-xs min-w-[750px]">
                        <thead>
                          <tr className="border-b border-slate-200 text-slate-400 font-black uppercase tracking-widest text-[9px]">
                            <th className="py-3 px-2">Box Label</th>
                            <th className="py-3 px-2">Flatbed Slot</th>
                            <th className="py-3 px-2">Material</th>
                            <th className="py-3 px-2 text-right">Gross (lb)</th>
                            <th className="py-3 px-2 text-right">Tare (lb)</th>
                            <th className="py-3 px-2 text-right">Net (lb)</th>
                            <th className="py-3 px-2 text-right">Sell Price ($)</th>
                            <th className="py-3 px-2 text-right">Total ($)</th>
                            <th className="py-3 px-2 text-center"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {selectedMaterials.map((item, idx) => {
                            const material = materials.find(m => m.id === item.materialId);
                            const net = item.weight || 0;
                            const total = net * (item.salePrice || 0);

                            return (
                              <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                                <td className="py-3 px-2">
                                  <input
                                    type="text"
                                    className="w-20 px-2 py-1.5 bg-white border border-slate-200 rounded-lg font-black text-slate-800 outline-none focus:border-blue-500"
                                    placeholder="Box #"
                                    value={item.boxNumber || ''}
                                    onChange={(e) => handleUpdateLineItem(idx, 'boxNumber', e.target.value)}
                                  />
                                </td>
                                <td className="py-3 px-2">
                                  <select
                                    className="w-28 px-2 py-1.5 bg-white border border-slate-200 rounded-lg font-bold text-slate-700 outline-none focus:border-blue-500"
                                    value={item.slotIndex !== undefined ? item.slotIndex : ''}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      handleUpdateLineItem(idx, 'slotIndex', val === '' ? undefined : Number(val));
                                    }}
                                  >
                                    <option value="">No Match</option>
                                    {Array.from({ length: 8 }).map((_, sIdx) => (
                                      <option key={sIdx} value={sIdx}>Slot {sIdx + 1}</option>
                                    ))}
                                  </select>
                                </td>
                                <td className="py-3 px-2">
                                  <div className="flex flex-col gap-1.5">
                                    <SearchableMaterialSelector
                                      value={item.materialId}
                                      onChange={(val) => handleUpdateLineItem(idx, 'materialId', val)}
                                      materials={materials}
                                      className="w-44"
                                    />
                                    {item.materialId && (
                                      <input
                                        type="text"
                                        placeholder={`Rename: ${material?.name || ''}`}
                                        value={item.customName || ''}
                                        onChange={(e) => handleUpdateLineItem(idx, 'customName', e.target.value)}
                                        className="w-44 px-2 py-1 bg-slate-100 border border-slate-200 rounded text-[11px] font-bold text-slate-700 outline-none focus:bg-white focus:border-blue-500 transition-all placeholder:text-slate-400 placeholder:font-normal"
                                      />
                                    )}
                                  </div>
                                </td>
                                <td className="py-3 px-2 text-right">
                                  <input
                                    type="number"
                                    className="w-20 px-2 py-1.5 bg-white border border-slate-200 rounded-lg font-black text-right outline-none focus:border-blue-500"
                                    placeholder="0"
                                    value={item.grossWeight || ''}
                                    onChange={(e) => handleUpdateLineItem(idx, 'grossWeight', Number(e.target.value))}
                                  />
                                </td>
                                <td className="py-3 px-2 text-right">
                                  <input
                                    type="number"
                                    step="0.5"
                                    className="w-16 px-2 py-1.5 bg-white border border-slate-200 rounded-lg font-black text-right outline-none focus:border-blue-500"
                                    placeholder="0.0"
                                    value={item.tareWeight || ''}
                                    onChange={(e) => handleUpdateLineItem(idx, 'tareWeight', Number(e.target.value))}
                                  />
                                </td>
                                <td className="py-3 px-2 text-right font-black text-slate-800">
                                  {net.toLocaleString()}
                                </td>
                                <td className="py-3 px-2 text-right">
                                  <div className="relative inline-block">
                                    <span className="absolute left-1 top-1/2 -translate-y-1/2 text-slate-400">$</span>
                                    <input
                                      type="number"
                                      step="0.01"
                                      className="w-20 pl-4 pr-1.5 py-1.5 bg-white border border-slate-200 rounded-lg font-black text-right outline-none focus:border-blue-500"
                                      placeholder="0.00"
                                      value={item.salePrice || ''}
                                      onChange={(e) => handleUpdateLineItem(idx, 'salePrice', Number(e.target.value))}
                                    />
                                  </div>
                                </td>
                                <td className="py-3 px-2 text-right font-black text-blue-600">
                                  ${total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </td>
                                <td className="py-3 px-2 text-center">
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveLineItem(idx)}
                                    className="text-slate-300 hover:text-red-500 p-1"
                                  >
                                    <X className="w-4 h-4" />
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                  
                  <button
                    type="button"
                    onClick={handleAddEmptyLineItem}
                    className="w-full py-3.5 border-2 border-dashed border-slate-200 rounded-2xl font-black text-xs uppercase tracking-widest text-slate-500 hover:text-blue-600 hover:border-blue-300 hover:bg-blue-50/20 transition-all flex items-center justify-center gap-2 mt-4"
                  >
                    <Plus className="w-4 h-4" />
                    Add Box Line Item
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Invoice Notes</label>
                <textarea
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm outline-none focus:ring-2 focus:ring-blue-500 min-h-[100px] resize-none"
                  placeholder="Payment instructions, special notes..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Right Column: Material Selection & Summary */}
          <div className="space-y-8">
            <div className="bg-white rounded-[2.5rem] p-8 border border-slate-200 shadow-sm space-y-6">
              <div className="space-y-4">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Add Materials</label>
                <div className="relative group">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-blue-600 transition-colors" />
                  <input
                    type="text"
                    className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                    placeholder="Search materials..."
                    value={materialSearch}
                    onChange={(e) => setMaterialSearch(e.target.value)}
                  />
                </div>
                <div className="max-h-[300px] overflow-y-auto pr-2 space-y-2 no-scrollbar">
                  {materials
                    .filter(m => 
                      m.name.toLowerCase().includes(materialSearch.toLowerCase()) ||
                      m.code.toLowerCase().includes(materialSearch.toLowerCase())
                    )
                    .sort((a, b) => {
                      const search = materialSearch.toLowerCase();
                      const aCode = a.code.toLowerCase();
                      const bCode = b.code.toLowerCase();
                      const aName = a.name.toLowerCase();
                      const bName = b.name.toLowerCase();

                      if (aCode === search && bCode !== search) return -1;
                      if (bCode === search && aCode !== search) return 1;
                      if (aCode.startsWith(search) && !bCode.startsWith(search)) return -1;
                      if (bCode.startsWith(search) && !aCode.startsWith(search)) return 1;
                      if (aName.startsWith(search) && !bName.startsWith(search)) return -1;
                      if (bName.startsWith(search) && !aName.startsWith(search)) return 1;
                      return aCode.localeCompare(bCode, undefined, { numeric: true, sensitivity: 'base' });
                    })
                    .map((material) => {
                      const count = selectedMaterials.filter(sm => sm.materialId === material.id).length;
                      return (
                        <button
                          key={material.id}
                          onClick={() => handleAddMaterial(material.id)}
                          className="w-full flex items-center gap-4 p-4 rounded-2xl border transition-all text-left group bg-white border-slate-100 hover:border-blue-200 hover:shadow-md hover:shadow-blue-50"
                        >
                          <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center font-bold text-slate-600 border border-slate-200 group-hover:bg-blue-50 group-hover:text-blue-600 group-hover:border-blue-100 transition-all shrink-0">
                            {material.code}
                          </div>
                          <div className="flex-1">
                            <p className="text-xs font-black text-slate-900 uppercase tracking-tight">{material.name}</p>
                            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">${material.salePrice.toFixed(2)} / {material.unit}</p>
                            {count > 0 && (
                              <span className="inline-block mt-1 text-[8px] font-black text-blue-600 uppercase bg-blue-50 px-1.5 py-0.5 rounded">
                                {count} box(es) added
                              </span>
                            )}
                          </div>
                          <Plus className="w-4 h-4 transition-all text-blue-600 group-hover:scale-110" />
                        </button>
                      );
                    })}
                </div>
              </div>

              <div className="pt-6 border-t border-slate-100 space-y-4">
                <div className="flex justify-between text-xs font-black text-slate-400 uppercase tracking-widest">
                  <span>Total Weight</span>
                  <span className="text-slate-900">{selectedMaterials.reduce((sum, m) => sum + m.weight, 0).toLocaleString()} lb</span>
                </div>
                <div className="flex justify-between text-xs font-black text-slate-400 uppercase tracking-widest">
                  <span>Total Amount</span>
                  <span className="text-blue-600 font-black text-lg">${selectedMaterials.reduce((sum, m) => sum + (m.weight * m.salePrice), 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                </div>
                <button
                  onClick={handleStandaloneSubmit}
                  disabled={!buyerName || selectedMaterials.length === 0 || processing}
                  className="w-full py-5 bg-slate-900 text-white rounded-2xl font-black text-sm uppercase tracking-widest hover:bg-slate-800 transition-all disabled:opacity-50 flex items-center justify-center gap-3 shadow-xl shadow-slate-200"
                >
                  {processing ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
                  Finalize Invoice
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : activeTab === 'pending' ? (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <h3 className="font-black text-slate-900 uppercase tracking-tight flex items-center gap-2">
                <Truck className="w-5 h-5 text-blue-600" />
                Loads Ready for Invoicing
              </h3>
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-3">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Terms for New Invoices:</span>
                  <select
                    className="bg-white border border-slate-200 rounded-xl px-4 py-2 text-[10px] font-bold uppercase tracking-widest outline-none focus:ring-2 focus:ring-blue-500 transition-all cursor-pointer shadow-sm"
                    value={paymentTerms}
                    onChange={(e) => setPaymentTerms(e.target.value)}
                  >
                    <option value="Due on Receipt">Due on Receipt</option>
                    <option value="Net 15">Net 15</option>
                    <option value="Net 30">Net 30</option>
                    <option value="Net 45">Net 45</option>
                    <option value="Net 60">Net 60</option>
                    <option value="Net 90">Net 90</option>
                  </select>
                </div>
                <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-[10px] font-black uppercase tracking-widest">
                  {pendingTickets.length} Pending
                </span>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/50 text-slate-500 text-[10px] font-black uppercase tracking-widest border-b border-slate-100">
                    <th className="px-8 py-5">Date / BOL</th>
                    <th className="px-8 py-5">Buyer / Destination</th>
                    <th className="px-8 py-5">Weight</th>
                    <th className="px-8 py-5">Est. Value</th>
                    <th className="px-8 py-5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {pendingTickets.map((ticket) => (
                    <tr key={ticket.id} className="hover:bg-blue-50/30 transition-all group">
                      <td className="px-8 py-6">
                        <div className="flex items-center gap-4">
                          <div className="p-3 bg-slate-100 rounded-2xl text-slate-500 group-hover:bg-blue-100 group-hover:text-blue-600 transition-all">
                            <Calendar className="w-5 h-5" />
                          </div>
                          <div>
                            <p className="text-sm font-black text-slate-900 uppercase tracking-tight">
                              {new Date(ticket.timestamp).toLocaleDateString()}
                            </p>
                            <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest">
                              BOL: {ticket.bolNumber || 'N/A'}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-8 py-6">
                        <p className="text-sm font-bold text-slate-700 uppercase tracking-tight">{ticket.destination}</p>
                        <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest">
                          Driver: {ticket.driver}
                        </p>
                      </td>
                      <td className="px-8 py-6">
                        <p className="text-sm font-black text-slate-900">{(ticket.totalWeight || 0).toLocaleString()} lb</p>
                        <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest">
                          {ticket.materials.length} Materials
                        </p>
                      </td>
                      <td className="px-8 py-6">
                        <p className="text-sm font-black text-blue-600">${(ticket.totalValue || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                      </td>
                      <td className="px-8 py-6 text-right">
                        <button 
                          onClick={() => handleCreateInvoice(ticket)}
                          disabled={processing}
                          className="px-6 py-3 bg-slate-900 text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-slate-800 transition-all flex items-center gap-2 ml-auto disabled:opacity-50"
                        >
                          {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                          Create Invoice
                        </button>
                      </td>
                    </tr>
                  ))}
                  {pendingTickets.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-8 py-20 text-center">
                        <div className="max-w-xs mx-auto space-y-3">
                          <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto">
                            <CheckCircle2 className="w-8 h-8 text-slate-200" />
                          </div>
                          <p className="text-slate-900 font-bold">All caught up!</p>
                          <p className="text-sm text-slate-500">No pending loads waiting for invoices.</p>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 text-[10px] font-black uppercase tracking-widest border-b border-slate-100">
                    <th className="w-10 px-4 py-5"></th>
                    <th className="px-6 py-5">Invoice #</th>
                    <th className="px-6 py-5">Date</th>
                    <th className="px-6 py-5">Buyer</th>
                    <th className="px-6 py-5">Amount</th>
                    <th className="px-6 py-5">Status</th>
                    <th className="px-6 py-5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {invoices.map((invoice) => {
                    const isExpanded = !!expandedInvoiceIds[invoice.id];
                    return (
                      <React.Fragment key={invoice.id}>
                        <tr className="hover:bg-blue-50/30 transition-all group">
                          <td className="pl-6 py-6 w-10">
                            <button
                              onClick={() => setExpandedInvoiceIds(prev => ({ ...prev, [invoice.id]: !prev[invoice.id] }))}
                              className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-slate-100 rounded-xl transition-all"
                              title={isExpanded ? "Collapse materials" : "Expand material line items"}
                            >
                              <ChevronRight className={cn("w-5 h-5 transition-transform duration-200", isExpanded && "rotate-90 text-blue-600")} />
                            </button>
                          </td>
                          <td className="px-6 py-6">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-black text-slate-900">{invoice.invoiceNumber}</p>
                              {invoice.inventoryDeducted ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black bg-emerald-50 text-emerald-700 border border-emerald-200 uppercase tracking-wider" title="Inventory deducted">
                                  <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                  Deducted
                                </span>
                              ) : (
                                invoice.status === 'paid' && invoice.invoiceNumber === 'INV-810117' && (
                                  <button
                                    onClick={() => handleRunBackfill(invoice)}
                                    disabled={processing}
                                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-[10px] font-black bg-amber-50 text-amber-800 border border-amber-300 hover:bg-amber-100 uppercase tracking-wider transition-all shadow-sm"
                                    title="Run Inventory Backfill — INV-810117"
                                  >
                                    <Package className="w-3 h-3 text-amber-600" />
                                    Run Inventory Backfill — INV-810117
                                  </button>
                                )
                              )}
                            </div>
                          </td>
                          <td className="px-6 py-6">
                            <p className="text-sm font-bold text-slate-700">{new Date(invoice.date).toLocaleDateString()}</p>
                            {invoice.createdByName && (
                              <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest mt-1">
                                By: {invoice.createdByName}
                              </p>
                            )}
                          </td>
                          <td className="px-6 py-6">
                            <p className="text-sm font-bold text-slate-700 uppercase tracking-tight">{invoice.buyerName}</p>
                          </td>
                          <td className="px-6 py-6">
                            <p className="text-sm font-black text-blue-600">${invoice.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                          </td>
                          <td className="px-6 py-6">
                            <span className={cn(
                              "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border",
                              invoice.status === 'paid' ? "bg-emerald-50 text-emerald-600 border-emerald-100" :
                              invoice.status === 'sent' ? "bg-blue-50 text-blue-600 border-blue-100" :
                              "bg-slate-50 text-slate-500 border-slate-100"
                            )}>
                              {invoice.status}
                            </span>
                          </td>
                          <td className="px-6 py-6 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button 
                                onClick={() => {
                                  setSelectedInvoice(invoice);
                                  setIsEditing(false);
                                  setShowInvoicePreview(true);
                                }}
                                className="p-3 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-2xl transition-all"
                                title="View Invoice"
                              >
                                <ChevronRight className="w-6 h-6" />
                              </button>
                              <button
                                onClick={() => handleDeleteInvoice(invoice.id, invoice.tripTicketId)}
                                disabled={processing}
                                className="p-3 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-2xl transition-all disabled:opacity-50"
                                title="Delete Invoice"
                              >
                                <Trash2 className="w-5 h-5" />
                              </button>
                            </div>
                          </td>
                        </tr>

                        {isExpanded && (
                          <tr className="bg-slate-50/60">
                            <td colSpan={7} className="px-8 py-4 border-t border-b border-slate-100">
                              <div className="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm space-y-3">
                                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                                  <div className="flex items-center gap-2">
                                    <Package className="w-4 h-4 text-blue-600" />
                                    <h4 className="text-xs font-black uppercase tracking-wider text-slate-700">
                                      Material Line Items ({invoice.materials?.length || 0})
                                    </h4>
                                  </div>
                                  {invoice.inventoryDeducted ? (
                                    <span className="inline-flex items-center gap-1.5 text-[10px] font-black text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200 uppercase tracking-wider">
                                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                                      Inventory Deducted
                                    </span>
                                  ) : (
                                    invoice.status === 'paid' && invoice.invoiceNumber === 'INV-810117' && (
                                      <button
                                        onClick={() => handleRunBackfill(invoice)}
                                        disabled={processing}
                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-black bg-amber-50 text-amber-800 border border-amber-300 hover:bg-amber-100 uppercase tracking-wider transition-all shadow-sm"
                                        title="Run Inventory Backfill — INV-810117"
                                      >
                                        <Package className="w-4 h-4 text-amber-600" />
                                        Run Inventory Backfill — INV-810117
                                      </button>
                                    )
                                  )}
                                </div>
                                <div className="divide-y divide-slate-100">
                                  {invoice.materials && invoice.materials.length > 0 ? (
                                    invoice.materials.map((item, idx) => {
                                      const mat = materials.find(m => m.id === item.materialId);
                                      const matName = mat ? `${mat.name} (${mat.code})` : (item.customName || item.materialId || 'Unknown Material');
                                      const weight = Number(item.weight) || 0;
                                      const price = Number(item.salePrice) || 0;
                                      const lineTotal = weight * price;
                                      return (
                                        <div key={idx} className="py-2.5 flex items-center justify-between text-xs">
                                          <div className="flex items-center gap-3">
                                            <span className="w-6 h-6 rounded-lg bg-slate-100 font-black text-slate-500 text-[10px] flex items-center justify-center">
                                              #{idx + 1}
                                            </span>
                                            <div>
                                              <p className="font-bold text-slate-900">{matName}</p>
                                              {item.boxNumber && (
                                                <p className="text-[10px] text-slate-400 font-semibold">{item.boxNumber}</p>
                                              )}
                                            </div>
                                          </div>
                                          <div className="flex items-center gap-8 text-right">
                                            <div>
                                              <span className="font-black text-slate-800">{weight.toLocaleString()} lbs</span>
                                              <span className="text-[10px] text-slate-400 ml-2">@ ${price.toFixed(2)}/lb</span>
                                            </div>
                                            <span className="font-black text-blue-600 min-w-[90px]">
                                              ${lineTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                            </span>
                                          </div>
                                        </div>
                                      );
                                    })
                                  ) : (
                                    <p className="py-2 text-slate-400 text-xs italic">No line items on this invoice.</p>
                                  )}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                  {invoices.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-8 py-20 text-center">
                        <div className="max-w-xs mx-auto space-y-3">
                          <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto">
                            <FileText className="w-8 h-8 text-slate-200" />
                          </div>
                          <p className="text-slate-900 font-bold">No invoice history</p>
                          <p className="text-sm text-slate-500">Invoices will appear here once generated.</p>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      </div>

      {/* Invoice Preview Modal */}
      {showInvoicePreview && selectedInvoice && (
        <div 
          className="fixed inset-0 bg-slate-900/80 z-[100] flex items-start justify-center p-4 backdrop-blur-sm overflow-y-auto print:bg-transparent print:backdrop-blur-none print:p-0 print:static print:overflow-visible"
        >
          <div className="bg-white rounded-[2.5rem] w-full max-w-5xl my-auto overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200 flex flex-col print:rounded-none print:shadow-none print:max-w-none print:w-full print:m-0">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50 no-print">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-slate-900 rounded-2xl text-white">
                  <FileText className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-xl font-black text-slate-900 uppercase tracking-tight">Invoice Preview</h2>
                  <p className="text-xs text-slate-500 font-black uppercase tracking-widest">{selectedInvoice.invoiceNumber} {isEditing && '• EDITING'}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {isEditing ? (
                  <button 
                    onClick={handleSaveEditedInvoice}
                    disabled={processing}
                    className="px-6 py-3 bg-blue-600 text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-blue-700 transition-all flex items-center gap-2 shadow-lg shadow-blue-200 disabled:opacity-50"
                  >
                    {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    Save Changes
                  </button>
                ) : (
                  <button 
                    onClick={() => setIsEditing(true)}
                    className="px-6 py-3 bg-white border border-slate-200 text-slate-600 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-slate-50 transition-all flex items-center gap-2"
                  >
                    <Edit2 className="w-4 h-4" />
                    Edit Invoice
                  </button>
                )}
                
                {!isEditing && selectedInvoice.status !== 'paid' && (
                  <button 
                    onClick={() => handleUpdateInvoiceStatus(selectedInvoice.id, 'paid')}
                    className="px-6 py-3 bg-emerald-600 text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-emerald-700 transition-all flex items-center gap-2 shadow-lg shadow-emerald-200"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    Mark as Paid
                  </button>
                )}
                
                {!isEditing && (
                  <button 
                    onClick={() => handleDeleteInvoice(selectedInvoice.id, selectedInvoice.tripTicketId)}
                    disabled={processing}
                    className="px-6 py-3 bg-red-50 text-red-600 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-red-100 transition-all flex items-center gap-2 shadow-sm disabled:opacity-50"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete
                  </button>
                )}

                <button 
                  onClick={() => {
                    if (!settings.debugPrintMode) window.print();
                    else console.log('DEBUG PRINT: window.print() bypassed.');
                  }}
                  className="px-6 py-3 bg-slate-100 text-slate-600 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-slate-200 transition-all flex items-center gap-2 disabled:opacity-50"
                  disabled={isEditing}
                >
                  <Printer className="w-4 h-4" />
                  Print / Save to PDF
                </button>
                <button 
                  onClick={() => setShowInvoicePreview(false)}
                  className="p-3 hover:bg-slate-200 rounded-2xl transition-colors"
                >
                  <X className="w-6 h-6 text-slate-500" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-12 bg-slate-100 no-scrollbar print:p-0 print:bg-transparent">
              {/* Landscape Invoice Container */}
              <div id="printable-invoice" className="bg-white shadow-2xl mx-auto w-full max-w-[1000px] min-h-[650px] print:shadow-none print:max-w-none print:w-full print:m-0 font-sans text-slate-900 relative flex flex-col overflow-visible">
                {isEditing ? (
                  <div className="p-16 space-y-12 no-print">
                    <div className="absolute top-0 left-0 w-full h-2 bg-slate-900" />
                    {/* Simplified Header for Editor */}
                    <div className="flex justify-between items-start mb-8">
                       <h2 className="text-2xl font-black uppercase text-slate-900 tracking-tight">Editing Invoice</h2>
                       <BrandLogo className="h-10 opacity-20" grayscale />
                    </div>

                  <div className="text-center space-y-1 mb-4 border-y border-slate-100 py-2">
                    <div className="flex items-center justify-center gap-8 text-[10px] font-bold uppercase tracking-[0.4em] text-slate-300">
                      <span>Industrial Scrap Solutions</span>
                      <div className="w-2 h-2 rounded-full bg-slate-100" />
                      <span>Global Logistics</span>
                      <div className="w-2 h-2 rounded-full bg-slate-100" />
                      <span>Commercial Recycling</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-8 mb-6 text-left">
                    <div className="space-y-8">
                      <div className="space-y-2">
                        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Bill To</p>
                        <div className="space-y-3">
                          <input 
                            type="text"
                            value={selectedInvoice.buyerName}
                            onChange={(e) => updateInvoiceField('buyerName', e.target.value)}
                            className="w-full text-2xl font-black text-slate-900 uppercase tracking-tight bg-slate-50 border border-slate-200 px-3 py-2 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
                          />
                          <textarea
                            value={selectedInvoice.buyerAddress || ''}
                            onChange={(e) => updateInvoiceField('buyerAddress', e.target.value)}
                            placeholder="Buyer Address"
                            className="w-full text-sm text-slate-500 bg-slate-50 border border-slate-200 px-3 py-2 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 min-h-[80px]"
                          />
                          <input
                            type="text"
                            value={selectedInvoice.buyerPhone || ''}
                            onChange={(e) => updateInvoiceField('buyerPhone', e.target.value)}
                            placeholder="Buyer Phone"
                            className="w-full text-sm text-slate-500 bg-slate-50 border border-slate-200 px-3 py-2 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                      </div>
                    </div>
                    <div className="space-y-8 text-right">
                      <div className="grid grid-cols-2 gap-8 justify-items-end">
                        <div className="space-y-1 text-right">
                          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Invoice #</p>
                          <p className="text-sm font-bold">{selectedInvoice.invoiceNumber}</p>
                        </div>
                        <div className="space-y-1 text-right">
                          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Date</p>
                          <input 
                            type="date"
                            value={selectedInvoice.date.split('T')[0]}
                            onChange={(e) => updateInvoiceField('date', new Date(e.target.value + 'T12:00:00Z').toISOString())}
                            className="bg-slate-50 border border-slate-200 px-2 py-1 rounded text-sm text-right outline-none"
                          />
                        </div>
                        <div className="space-y-1 text-right">
                          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Due Date</p>
                          <input 
                            type="date"
                            value={selectedInvoice.dueDate.split('T')[0]}
                            onChange={(e) => updateInvoiceField('dueDate', new Date(e.target.value + 'T12:00:00Z').toISOString())}
                            className="bg-slate-50 border border-slate-200 px-2 py-1 rounded text-sm text-right outline-none"
                          />
                        </div>
                        <div className="space-y-1 text-right">
                          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Terms</p>
                          <select
                            className="bg-slate-50 border border-slate-200 px-2 py-1 rounded text-sm text-right outline-none"
                            value={selectedInvoice.paymentTerms || 'Net 30'}
                            onChange={(e) => updateInvoiceField('paymentTerms', e.target.value)}
                          >
                            <option value="Due on Receipt">Due on Receipt</option>
                            <option value="Via Check on Receipt">Via Check on Receipt</option>
                            <option value="Via ACH on Receipt">Via ACH on Receipt</option>
                            <option value="Net 15">Net 15</option>
                            <option value="Net 30">Net 30</option>
                            <option value="Net 45">Net 45</option>
                            <option value="Net 60">Net 60</option>
                            <option value="Net 90">Net 90</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Table */}
                  <div className="flex-1">
                    <table className="w-full border-collapse">
                      <thead>
                        <tr className="border-b-2 border-slate-900">
                          <th className="py-4 text-left text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Description</th>
                          <th className="py-4 text-right text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Quantity</th>
                          <th className="py-4 text-right text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Unit Price</th>
                          <th className="py-4 text-right text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 font-sans">
                        {selectedInvoice.materials.map((item, idx) => {
                          const material = materials.find(m => m.id === item.materialId);
                          return (
                            <tr key={idx} className="group border-b border-slate-100 last:border-none">
                              <td className="py-3 text-left space-y-2">
                                <div className="flex items-center gap-2">
                                  <input 
                                    type="text"
                                    value={item.boxNumber || ''}
                                    onChange={(e) => updateInvoiceMaterial(idx, 'boxNumber', e.target.value)}
                                    placeholder="Box #"
                                    className="w-20 text-xs font-black text-slate-900 bg-slate-50 border border-slate-200 px-2 py-1 rounded outline-none"
                                  />
                                  <select
                                    className="w-28 text-xs font-bold text-slate-700 bg-slate-50 border border-slate-200 px-2 py-1 rounded outline-none"
                                    value={item.slotIndex !== undefined ? item.slotIndex : ''}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      updateInvoiceMaterial(idx, 'slotIndex', val === '' ? undefined : Number(val));
                                    }}
                                  >
                                    <option value="">No Match</option>
                                    {Array.from({ length: 8 }).map((_, sIdx) => (
                                      <option key={sIdx} value={sIdx}>Slot {sIdx + 1}</option>
                                    ))}
                                  </select>
                                  <SearchableMaterialSelector
                                    value={item.materialId}
                                    onChange={(val) => updateInvoiceMaterial(idx, 'materialId', val)}
                                    materials={materials}
                                    className="w-36"
                                  />
                                </div>
                                <input 
                                  type="text"
                                  value={item.customName || ''}
                                  onChange={(e) => updateInvoiceMaterial(idx, 'customName', e.target.value)}
                                  placeholder={material ? `Rename material (default: ${material.name})` : "Enter custom description..."}
                                  className="w-full text-xs font-medium text-slate-600 bg-slate-50 border border-slate-200 px-2 py-1.5 rounded outline-none"
                                />
                              </td>
                              <td className="py-3 text-right">
                                <div className="flex flex-col items-end gap-1.5">
                                  <div className="flex items-center gap-1">
                                    <span className="text-[10px] text-slate-400 font-bold">G:</span>
                                    <input 
                                      type="number"
                                      value={item.grossWeight || ''}
                                      onChange={(e) => updateInvoiceMaterial(idx, 'grossWeight', e.target.value)}
                                      placeholder="Gross"
                                      className="w-16 bg-slate-50 border border-slate-200 px-1.5 py-1 rounded text-xs text-right outline-none"
                                    />
                                  </div>
                                  <div className="flex items-center gap-1">
                                    <span className="text-[10px] text-slate-400 font-bold">T:</span>
                                    <input 
                                      type="number"
                                      step="0.5"
                                      value={item.tareWeight || ''}
                                      onChange={(e) => updateInvoiceMaterial(idx, 'tareWeight', e.target.value)}
                                      placeholder="Tare"
                                      className="w-16 bg-slate-50 border border-slate-200 px-1.5 py-1 rounded text-xs text-right outline-none"
                                    />
                                  </div>
                                  <div className="text-[11px] font-black text-slate-900">
                                    Net: {item.weight} lb
                                  </div>
                                </div>
                              </td>
                              <td className="py-3 text-right">
                                <div className="inline-flex items-center gap-1">
                                  <span className="text-slate-400 text-xs">$</span>
                                  <input 
                                    type="number"
                                    step="0.01"
                                    value={item.salePrice}
                                    onChange={(e) => updateInvoiceMaterial(idx, 'salePrice', e.target.value)}
                                    disabled={profile?.role !== 'manager'}
                                    className="w-20 bg-slate-50 border border-slate-200 px-1.5 py-1 rounded text-xs text-right outline-none disabled:opacity-60 disabled:cursor-not-allowed"
                                  />
                                </div>
                              </td>
                              <td className="py-3 text-right">
                                <p className="text-xs font-black text-slate-900">${(item.weight * item.salePrice).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="mt-4 pt-4 border-t-2 border-slate-900 flex justify-between items-start text-left">
                    <div className="flex-1 max-w-xl space-y-2">
                      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Notes & Instructions</p>
                      <textarea
                        value={selectedInvoice.notes || ''}
                        onChange={(e) => updateInvoiceField('notes', e.target.value)}
                        placeholder="Additional notes..."
                        className="w-full text-xs text-slate-500 bg-slate-50 border border-slate-200 px-3 py-2 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 min-h-[60px]"
                      />
                    </div>
                    <div className="w-80 space-y-4 text-right">
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-400 font-bold uppercase tracking-widest text-right">Subtotal</span>
                        <span className="font-bold font-sans">${selectedInvoice.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                      </div>
                      <div className="flex justify-between items-center pt-4 border-t border-slate-100">
                        <span className="text-lg font-black uppercase tracking-[0.2em]">Total</span>
                        <span className="text-3xl font-black text-blue-600 font-sans">${selectedInvoice.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <InvoiceDocument invoice={selectedInvoice} materials={materials} />
              )}
            </div>
          </div>
        </div>
      </div>
    )}
    </div>
  );
}
