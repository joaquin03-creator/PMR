import { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, onSnapshot, addDoc, doc, updateDoc, query, orderBy, getDoc, deleteDoc } from 'firebase/firestore';
import { Material, TripTicket, Invoice, TripTicketMaterial, Customer, UserProfile } from '../types';
import { COMPANY_NAME, COMPANY_ADDRESS, COMPANY_PHONE, COMPANY_EMAIL, COMPANY_WEBSITE, handleImageError } from '../constants';
import { BrandLogo } from '../components/BrandLogo';
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
  Save
} from 'lucide-react';
import { cn } from '../lib/utils';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';

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
          <p className="text-sm text-slate-500 font-bold">{COMPANY_ADDRESS}</p>
          <p className="text-sm text-slate-500">{COMPANY_PHONE} | {COMPANY_EMAIL}</p>
          <p className="text-sm text-slate-500">{COMPANY_WEBSITE}</p>
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
              return (
                <tr key={idx} className="group">
                  <td className="py-2 text-left">
                    <p className="text-sm font-black text-slate-900 uppercase tracking-tight">{item.customName || material?.name || 'Unknown Material'}</p>
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">{material?.code || '-'}</p>
                  </td>
                  <td className="py-2 text-right">
                    <p className="text-sm font-bold text-slate-900">{item.weight.toLocaleString()} {material?.unit || 'lb'}</p>
                  </td>
                  <td className="py-2 text-right">
                    <p className="text-sm font-bold text-slate-500">${item.salePrice.toFixed(2)}</p>
                  </td>
                  <td className="py-2 text-right">
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
  const [activeTab, setActiveTab] = useState<'pending' | 'history' | 'create'>('create');
  const [materials, setMaterials] = useState<Material[]>([]);
  const [tripTickets, setTripTickets] = useState<TripTicket[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
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

  const [selectedTicket, setSelectedTicket] = useState<TripTicket | null>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [showInvoicePreview, setShowInvoicePreview] = useState(false);
  const [autoPrint, setAutoPrint] = useState(false);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
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

    return () => {
      unsubMaterials();
      unsubTrips();
      unsubInvoices();
      unsubCustomers();
    };
  }, []);

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
    try {
      await updateDoc(doc(db, 'invoices', invoiceId), { status });
      if (selectedInvoice && selectedInvoice.id === invoiceId) {
        setSelectedInvoice({ ...selectedInvoice, status });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `invoices/${invoiceId}`);
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
    newMaterials[index] = { 
      ...newMaterials[index], 
      [field]: (field === 'weight' || field === 'salePrice') ? (Number(value) || 0) : value 
    };
    
    // Recalculate totals
    const totalWeight = newMaterials.reduce((sum, m) => sum + m.weight, 0);
    const totalAmount = newMaterials.reduce((sum, m) => sum + (m.weight * m.salePrice), 0);
    
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
    if (selectedMaterials.some(m => m.materialId === materialId)) return;

    setSelectedMaterials(prev => [...prev, {
      materialId,
      weight: 0,
      salePrice: material.salePrice
    }]);
  };

  const handleRemoveMaterial = (materialId: string) => {
    setSelectedMaterials(prev => prev.filter(m => m.materialId !== materialId));
  };

  const handleWeightChange = (materialId: string, weight: number) => {
    setSelectedMaterials(prev => prev.map(m => 
      m.materialId === materialId ? { ...m, weight } : m
    ));
  };

  const calculateDueDate = (date: string, terms: string) => {
    const baseDate = new Date(date);
    let days = 30;
    if (terms === 'Due on Receipt') days = 0;
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
        createdBy: profile?.uid,
        createdByName: profile?.displayName || profile?.email || 'System'
      };

      const docRef = await addDoc(collection(db, 'invoices'), invoiceData);
      
      // Reset Form
      setBuyerName('');
      setBuyerAddress('');
      setBuyerPhone('');
      setSelectedBuyerId('');
      setSelectedMaterials([]);
      setNotes('');
      
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
        createdBy: profile?.uid,
        createdByName: profile?.displayName || profile?.email || 'System'
      };

      const docRef = await addDoc(collection(db, 'invoices'), invoiceData);
      
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
    if (!window.confirm('Are you sure you want to delete this invoice? This action cannot be undone.')) return;
    
    setProcessing(true);
    try {
      await deleteDoc(doc(db, 'invoices', invoiceId));
      
      // If it was linked to a trip ticket, update the ticket status back to pending
      if (tripTicketId) {
        await updateDoc(doc(db, 'tripTickets', tripTicketId), {
          invoiceId: null,
          invoiceStatus: 'pending'
        });
      }
      
      setShowInvoicePreview(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'invoices');
    } finally {
      setProcessing(false);
    }
  };

  const pendingTickets = tripTickets.filter(t => t.invoiceStatus !== 'invoiced' && t.status !== 'cancelled' && t.status !== 'voided');

  return (
    <div className="max-w-7xl mx-auto space-y-8">
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
              <div className="flex items-center gap-4">
                <div className="p-4 bg-blue-600 rounded-2xl text-white shadow-lg shadow-blue-200">
                  <FileText className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-2xl font-black text-slate-900 uppercase tracking-tight">Invoice Details</h2>
                  <p className="text-xs text-slate-500 font-black uppercase tracking-widest">Create a standalone invoice</p>
                </div>
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
                      <option value="Net 15">Net 15</option>
                      <option value="Net 30">Net 30</option>
                      <option value="Net 45">Net 45</option>
                      <option value="Net 60">Net 60</option>
                      <option value="Net 90">Net 90</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between px-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Materials & Weights</label>
                  <span className="text-[10px] font-black text-blue-600 uppercase tracking-widest bg-blue-50 px-2 py-1 rounded-md">
                    {selectedMaterials.length} Items Selected
                  </span>
                </div>
                
                <div className="space-y-3">
                  {selectedMaterials.length === 0 ? (
                    <div className="py-12 border-2 border-dashed border-slate-100 rounded-[2rem] text-center space-y-3">
                      <div className="w-12 h-12 bg-slate-50 rounded-full flex items-center justify-center mx-auto">
                        <Plus className="w-6 h-6 text-slate-300" />
                      </div>
                      <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">No materials added yet</p>
                    </div>
                  ) : (
                    selectedMaterials.map((item, idx) => {
                      const material = materials.find(m => m.id === item.materialId);
                      return (
                        <div key={idx} className="flex items-center gap-4 p-4 bg-slate-50 rounded-2xl border border-slate-100 group animate-in zoom-in-95 duration-200">
                          <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center font-bold text-slate-400 border border-slate-200 shrink-0">
                            {material?.code}
                          </div>
                          <div className="flex-1">
                            <p className="text-sm font-black text-slate-900 uppercase tracking-tight">{material?.name}</p>
                            <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest">Sale Price: ${item.salePrice.toFixed(2)}</p>
                          </div>
                          <div className="w-32 relative">
                            <input
                              type="number"
                              className="w-full pl-4 pr-10 py-2 bg-white border border-slate-200 rounded-xl text-sm font-black outline-none focus:ring-2 focus:ring-blue-500"
                              value={item.weight || ''}
                              onChange={(e) => handleWeightChange(item.materialId, Number(e.target.value))}
                              placeholder="0"
                            />
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-black text-slate-400 uppercase">{material?.unit}</span>
                          </div>
                          <button 
                            onClick={() => handleRemoveMaterial(item.materialId)}
                            className="w-11 h-11 flex items-center justify-center text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all active:scale-95"
                            aria-label="Remove material"
                          >
                            <X className="w-5 h-5" />
                          </button>
                        </div>
                      );
                    })
                  )}
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
                      return aCode.localeCompare(bCode);
                    })
                    .map((material) => (
                      <button
                        key={material.id}
                        onClick={() => handleAddMaterial(material.id)}
                        disabled={selectedMaterials.some(sm => sm.materialId === material.id)}
                        className={cn(
                          "w-full flex items-center gap-4 p-4 rounded-2xl border transition-all text-left group",
                          selectedMaterials.some(sm => sm.materialId === material.id)
                            ? "bg-slate-50 border-slate-100 opacity-50 cursor-not-allowed"
                            : "bg-white border-slate-100 hover:border-blue-200 hover:shadow-md hover:shadow-blue-50"
                        )}
                      >
                        <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center font-bold text-slate-600 border border-slate-200 group-hover:bg-blue-50 group-hover:text-blue-600 group-hover:border-blue-100 transition-all shrink-0">
                          {material.code}
                        </div>
                        <div className="flex-1">
                          <p className="text-xs font-black text-slate-900 uppercase tracking-tight">{material.name}</p>
                          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">${material.salePrice.toFixed(2)} / {material.unit}</p>
                        </div>
                        <Plus className={cn(
                          "w-4 h-4 transition-all",
                          selectedMaterials.some(sm => sm.materialId === material.id) ? "text-slate-300" : "text-blue-600 group-hover:scale-110"
                        )} />
                      </button>
                    ))}
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
                    <th className="px-8 py-5">Invoice #</th>
                    <th className="px-8 py-5">Date</th>
                    <th className="px-8 py-5">Buyer</th>
                    <th className="px-8 py-5">Amount</th>
                    <th className="px-8 py-5">Status</th>
                    <th className="px-8 py-5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {invoices.map((invoice) => (
                    <tr key={invoice.id} className="hover:bg-blue-50/30 transition-all group">
                      <td className="px-8 py-6">
                        <p className="text-sm font-black text-slate-900">{invoice.invoiceNumber}</p>
                      </td>
                      <td className="px-8 py-6">
                        <p className="text-sm font-bold text-slate-700">{new Date(invoice.date).toLocaleDateString()}</p>
                        {invoice.createdByName && (
                          <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest mt-1">
                            By: {invoice.createdByName}
                          </p>
                        )}
                      </td>
                      <td className="px-8 py-6">
                        <p className="text-sm font-bold text-slate-700 uppercase tracking-tight">{invoice.buyerName}</p>
                      </td>
                      <td className="px-8 py-6">
                        <p className="text-sm font-black text-blue-600">${invoice.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                      </td>
                      <td className="px-8 py-6">
                        <span className={cn(
                          "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border",
                          invoice.status === 'paid' ? "bg-emerald-50 text-emerald-600 border-emerald-100" :
                          invoice.status === 'sent' ? "bg-blue-50 text-blue-600 border-blue-100" :
                          "bg-slate-50 text-slate-500 border-slate-100"
                        )}>
                          {invoice.status}
                        </span>
                      </td>
                      <td className="px-8 py-6 text-right">
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
                  ))}
                  {invoices.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-8 py-20 text-center">
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

      {/* Invoice Preview Modal */}
      {showInvoicePreview && selectedInvoice && (
        <div 
          className="fixed inset-0 bg-slate-900/80 z-[100] flex items-start justify-center p-4 backdrop-blur-sm overflow-y-auto"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowInvoicePreview(false);
          }}
        >
          <div className="bg-white rounded-[2.5rem] w-full max-w-5xl my-auto overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200 flex flex-col">
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

            <div className="flex-1 overflow-y-auto p-12 bg-slate-100 no-scrollbar">
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
                            <tr key={idx} className="group">
                              <td className="py-2 text-left">
                                <div className="space-y-1">
                                  <input 
                                    type="text"
                                    value={item.customName || material?.name || ''}
                                    onChange={(e) => updateInvoiceMaterial(idx, 'customName', e.target.value)}
                                    placeholder="Enter custom description..."
                                    className="w-full text-sm font-black text-slate-900 uppercase tracking-tight bg-slate-50 border border-slate-200 px-2 py-1 rounded outline-none focus:ring-2 focus:ring-blue-500"
                                  />
                                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Original Code: {material?.code || '-'}</p>
                                </div>
                              </td>
                              <td className="py-2 text-right">
                                <input 
                                  type="number"
                                  value={item.weight}
                                  onChange={(e) => updateInvoiceMaterial(idx, 'weight', e.target.value)}
                                  className="w-24 bg-slate-50 border border-slate-200 px-2 py-1 rounded text-sm text-right outline-none"
                                />
                              </td>
                              <td className="py-2 text-right">
                                <div className="inline-flex items-center gap-1">
                                  <span className="text-slate-400 text-sm">$</span>
                                  <input 
                                    type="number"
                                    step="0.01"
                                    value={item.salePrice}
                                    onChange={(e) => updateInvoiceMaterial(idx, 'salePrice', e.target.value)}
                                    className="w-24 bg-slate-50 border border-slate-200 px-2 py-1 rounded text-sm text-right outline-none"
                                  />
                                </div>
                              </td>
                              <td className="py-2 text-right">
                                <p className="text-sm font-black text-slate-900">${(item.weight * item.salePrice).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
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
