import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { auth, db } from '../firebase';
import { useSettings } from '../context/SettingsContext';
import { collection, onSnapshot, addDoc, doc, getDoc, updateDoc, increment, setDoc, query, orderBy, writeBatch } from 'firebase/firestore';
import { Material, TripTicket, TripTicketMaterial, Invoice, UserProfile } from '../types';
import { COMPANY_NAME, COMPANY_ADDRESS, COMPANY_PHONE, COMPANY_EMAIL, COMPANY_WEBSITE, handleImageError } from '../constants';
import { BrandLogo } from '../components/BrandLogo';
import { 
  Truck, 
  Plus, 
  Search, 
  Package, 
  CheckCircle2, 
  Loader2, 
  AlertCircle, 
  X, 
  History, 
  FileText, 
  ChevronRight, 
  Calendar, 
  MapPin, 
  User, 
  Hash, 
  ShieldCheck,
  ExternalLink,
  ArrowUpRight,
  Printer,
  Ban,
  Trash2
} from 'lucide-react';
import { cn, generateTicketId } from '../lib/utils';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';
import { logAuditEvent } from '../lib/audit';
import ManagerPinModal from '../components/ManagerPinModal';

export default function TripTickets({ profile }: { profile: UserProfile | null }) {
  const { settings } = useSettings();
  const [activeTab, setActiveTab] = useState<'new' | 'history'>('new');
  const [materials, setMaterials] = useState<Material[]>([]);
  const [tripTickets, setTripTickets] = useState<TripTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMaterials, setSelectedMaterials] = useState<TripTicketMaterial[]>([]);
  
  // Form State
  const [destination, setDestination] = useState('');
  const [driver, setDriver] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [carrier, setCarrier] = useState('');
  const [trailerNumber, setTrailerNumber] = useState('');
  const [sealNumber, setSealNumber] = useState('');
  const [bolNumber, setBolNumber] = useState('');
  const [buyerAddress, setBuyerAddress] = useState('');
  const [buyerPhone, setBuyerPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [linkedInvoiceId, setLinkedInvoiceId] = useState<string | null>(null);
  
  const [materialSearch, setMaterialSearch] = useState('');
  const [processing, setProcessing] = useState(false);
  const [success, setSuccess] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState<TripTicket | null>(null);
  const [showPrintPreview, setShowPrintPreview] = useState(false);
  const [lastCreatedTicket, setLastCreatedTicket] = useState<TripTicket| null>(null);
  const [confirmAction, setConfirmAction] = useState<{ type: 'void' | 'delete', ticket: TripTicket } | null>(null);
  const [notification, setNotification] = useState<{ type: 'success' | 'error', message: string } | null>(null);
  const [showPinModal, setShowPinModal] = useState(false);
  const [pendingAction, setPendingAction] = useState<{ type: 'void' | 'delete', ticket: TripTicket } | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [showLinkInvoice, setShowLinkInvoice] = useState(false);
  const [invoiceSearch, setInvoiceSearch] = useState('');

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

    const unsubMaterials = onSnapshot(collection(db, 'materials'), (snapshot) => {
      setMaterials(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Material[]);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'materials'));

    const unsubTrips = onSnapshot(
      query(collection(db, 'tripTickets'), orderBy('timestamp', 'desc')), 
      (snapshot) => {
        setTripTickets(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as TripTicket[]);
        setLoading(false);
      }, 
      (error) => handleFirestoreError(error, OperationType.LIST, 'tripTickets')
    );

    const unsubInvoices = onSnapshot(
      query(collection(db, 'invoices'), orderBy('date', 'desc')),
      (snapshot) => {
        setInvoices(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Invoice[]);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'invoices')
    );

    return () => {
      try { unsubMaterials(); } catch (e) { console.warn('unsubMaterials error', e); }
      try { unsubTrips(); } catch (e) { console.warn('unsubTrips error', e); }
      try { unsubInvoices(); } catch (e) { console.warn('unsubInvoices error', e); }
    };
  }, [profile]);

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

  const handleLinkInvoice = async (invoiceId: string) => {
    if (selectedTicket) {
      // Linking to existing ticket
      setProcessing(true);
      try {
        await updateDoc(doc(db, 'tripTickets', selectedTicket.id), {
          invoiceId,
          invoiceStatus: 'invoiced'
        });
        
        await updateDoc(doc(db, 'invoices', invoiceId), {
          tripTicketId: selectedTicket.id
        });

        setSelectedTicket(prev => prev ? { ...prev, invoiceId, invoiceStatus: 'invoiced' } : null);
        setShowLinkInvoice(false);
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `tripTickets/${selectedTicket.id}`);
      } finally {
        setProcessing(false);
      }
    } else {
      // Pulling from invoice for NEW ticket
      const invoice = invoices.find(inv => inv.id === invoiceId);
      if (invoice) {
        setDestination(invoice.buyerName);
        setBuyerAddress(invoice.buyerAddress || '');
        setBuyerPhone(invoice.buyerPhone || '');
        setSelectedMaterials(invoice.materials);
        setLinkedInvoiceId(invoice.id);
        setShowLinkInvoice(false);
      }
    }
  };

  const handleVoidTicket = async (ticket: TripTicket) => {
    if (!profile || profile.role !== 'manager') return;
    
    setProcessing(true);
    try {
      const batch = writeBatch(db);
      
      // Update ticket status
      batch.update(doc(db, 'tripTickets', ticket.id), { status: 'voided' });
      
      // Reverse inventory (Add back)
      for (const item of ticket.materials) {
        const invRef = doc(db, 'inventory', item.materialId);
        batch.set(invRef, {
          materialId: item.materialId,
          currentWeight: increment(item.weight),
          lastUpdated: new Date().toISOString()
        }, { merge: true });
      }
      
      await batch.commit();
      setSelectedTicket(null);
      setConfirmAction(null);
      setNotification({ type: 'success', message: 'Trip ticket voided. Inventory restored.' });
    } catch (error) {
      console.error('Error voiding ticket:', error);
      setNotification({ type: 'error', message: 'Failed to void trip ticket. Check permissions.' });
      handleFirestoreError(error, OperationType.UPDATE, 'tripTickets');
    } finally {
      setProcessing(false);
    }
  };

  const handleDeleteTicket = async (ticket: TripTicket) => {
    if (!profile || profile.role !== 'manager') return;

    setProcessing(true);
    try {
      const batch = writeBatch(db);
      
      // Reverse inventory (Add back) if not already voided
      if (ticket.status !== 'voided') {
        for (const item of ticket.materials) {
          const invRef = doc(db, 'inventory', item.materialId);
          batch.set(invRef, {
            materialId: item.materialId,
            currentWeight: increment(item.weight),
            lastUpdated: new Date().toISOString()
          }, { merge: true });
        }
      }
      
      // Delete ticket
      batch.delete(doc(db, 'tripTickets', ticket.id));
      
      await batch.commit();
      setSelectedTicket(null);
      setConfirmAction(null);
      setNotification({ type: 'success', message: 'Trip ticket permanently deleted.' });
    } catch (error) {
      console.error('Error deleting ticket:', error);
      setNotification({ type: 'error', message: 'Failed to delete trip ticket. Check permissions.' });
      handleFirestoreError(error, OperationType.DELETE, 'tripTickets');
    } finally {
      setProcessing(false);
    }
  };

  const handleSubmit = async () => {
    if (!destination || !driver || !vehicle || selectedMaterials.length === 0) return;

    setProcessing(true);
    try {
      const totalWeight = selectedMaterials.reduce((sum, m) => sum + m.weight, 0);
      const totalValue = selectedMaterials.reduce((sum, m) => sum + (m.weight * m.salePrice), 0);

      const ticketData: Omit<TripTicket, 'id'> = {
        destination,
        driver,
        vehicle,
        carrier,
        trailerNumber,
        sealNumber,
        bolNumber,
        buyerAddress,
        buyerPhone,
        notes,
        materials: selectedMaterials,
        status: 'in-transit',
        timestamp: new Date().toISOString(),
        invoiceStatus: linkedInvoiceId ? 'invoiced' : 'pending',
        totalWeight,
        totalValue,
        createdBy: profile?.uid || '',
        createdByName: profile?.displayName || profile?.email || 'System'
      };

      if (linkedInvoiceId) {
        ticketData.invoiceId = linkedInvoiceId;
      }

      try {
        const ticketId = generateTicketId('TRIP');
        const docRef = doc(db, 'tripTickets', ticketId);
        await setDoc(docRef, ticketData);
        
        // Log trip ticket creation
        await logAuditEvent(
          'tripTicket',
          docRef.id,
          'create',
          { after: ticketData },
          `Trip Ticket created for destination: ${destination}`
        );
        
        // If linked to an invoice, update the invoice too
        if (linkedInvoiceId) {
          await updateDoc(doc(db, 'invoices', linkedInvoiceId), {
            tripTicketId: docRef.id
          });
        }

        setLastCreatedTicket({ id: docRef.id, ...ticketData });
        setSelectedTicket({ id: docRef.id, ...ticketData });
        setShowPrintPreview(true);
        
        // Automatically trigger print
        setTimeout(() => {
          if (!settings.debugPrintMode) window.print();
          // Automatically close after auto-print starts
          setTimeout(() => {
            if (!settings.debugPrintMode) {
              setShowPrintPreview(false);
              setSelectedTicket(null);
            }
            // Reset form
            setDestination('');
            setDriver('');
            setVehicle('');
            setCarrier('');
            setTrailerNumber('');
            setSealNumber('');
            setBolNumber('');
            setNotes('');
            setSelectedMaterials([]);
            setLinkedInvoiceId(null);
          }, 500);
        }, 1000);
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, 'tripTickets');
      }

      // Update Inventory (Deduct)
      for (const item of selectedMaterials) {
        const invRef = doc(db, 'inventory', item.materialId);
        try {
          const invDoc = await getDoc(invRef);
          if (invDoc.exists()) {
            const oldWeight = invDoc.data().currentWeight;
            await updateDoc(invRef, {
              currentWeight: increment(-item.weight),
              lastUpdated: new Date().toISOString()
            });

            // Log inventory update
            await logAuditEvent(
              'inventory',
              item.materialId,
              'update',
              {
                before: { weight: oldWeight },
                after: { weight: oldWeight - item.weight }
              },
              `Inventory deducted via Trip Ticket ${lastCreatedTicket?.id || 'new'}`
            );
          } else {
            await setDoc(invRef, {
              materialId: item.materialId,
              currentWeight: -item.weight,
              lastUpdated: new Date().toISOString()
            });

            // Log inventory creation (negative)
            await logAuditEvent(
              'inventory',
              item.materialId,
              'create',
              { after: { weight: -item.weight } },
              `Initial inventory created (negative) via Trip Ticket ${lastCreatedTicket?.id || 'new'}`
            );
          }
        } catch (error) {
          handleFirestoreError(error, OperationType.WRITE, `inventory/${item.materialId}`);
        }
      }

      setSuccess(true);
      setTimeout(() => {
        setSuccess(false);
        setDestination('');
        setDriver('');
        setVehicle('');
        setCarrier('');
        setTrailerNumber('');
        setSealNumber('');
        setBolNumber('');
        setBuyerAddress('');
        setBuyerPhone('');
        setNotes('');
        setLinkedInvoiceId(null);
        setSelectedMaterials([]);
      }, 10000);
    } catch (error) {
      console.error('Error creating trip ticket:', error);
    } finally {
      setProcessing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <div className={cn("space-y-8", showPrintPreview && "print:hidden")}>
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
        message={`A Manager PIN is required to ${pendingAction?.type === 'void' ? 'void' : 'permanently delete'} this load.`}
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
                {confirmAction.type === 'void' ? 'Void Load?' : 'Delete Load?'}
              </h3>
              <p className="text-sm text-slate-500 font-medium leading-relaxed px-4">
                {confirmAction.type === 'void' 
                  ? 'This will return materials to inventory but keep a historical record. This action is permanent.' 
                  : 'CRITICAL: This will return inventory AND permanently remove the load record. This cannot be undone.'}
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
                {processing ? <Loader2 className="w-5 h-5 animate-spin" /> : (confirmAction.type === 'void' ? 'Void Load' : 'Delete Permanently')}
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

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="text-4xl font-black text-slate-900 tracking-tight font-display">Logistics & Shipments</h1>
          <p className="text-slate-500 font-medium mt-1">Manage outbound loads, BOLs, and prepare for invoicing.</p>
        </div>
        <nav className="flex bg-slate-100 p-1.5 rounded-2xl" aria-label="Trip Ticket Tabs">
          <button
            onClick={() => setActiveTab('new')}
            className={cn(
              "px-6 py-3 rounded-xl text-sm font-black uppercase tracking-widest transition-all flex items-center gap-2",
              activeTab === 'new' ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
            )}
          >
            <Plus className="w-4 h-4" />
            New Load
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

      {activeTab === 'new' ? (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-300">
          {success && (
            <div className="mb-8 bg-green-50 border border-green-200 rounded-2xl p-6 flex flex-col md:flex-row items-center justify-between gap-4 text-green-800 animate-in fade-in slide-in-from-top-4">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-6 h-6 text-green-600" />
                <div>
                  <p className="font-bold">Trip Ticket created! Inventory deducted and load logged.</p>
                  <p className="text-sm opacity-75">The load has been dispatched and is now in transit.</p>
                </div>
              </div>
              <button
                onClick={() => {
                  setSelectedTicket(lastCreatedTicket);
                  setShowPrintPreview(true);
                }}
                className="px-6 py-3 bg-green-600 text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-green-700 transition-all flex items-center gap-2 shadow-lg shadow-green-200"
              >
                <Printer className="w-4 h-4" />
                Print BOL
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 space-y-8">
              {/* Logistics Details */}
              <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm space-y-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-50 rounded-xl text-blue-600">
                      <Truck className="w-5 h-5" />
                    </div>
                    <h3 className="font-black text-slate-900 uppercase tracking-tight">Logistics Details</h3>
                  </div>
                  <button
                    onClick={() => {
                      setSelectedTicket(null);
                      setShowLinkInvoice(true);
                    }}
                    className="px-4 py-2 bg-slate-100 text-slate-600 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-blue-50 hover:text-blue-600 transition-all flex items-center gap-2"
                  >
                    <FileText className="w-3 h-3" />
                    Pull from Invoice
                  </button>
                </div>
                
                {linkedInvoiceId && (
                  <div className="p-4 bg-blue-50 border border-blue-100 rounded-2xl flex items-center justify-between animate-in fade-in slide-in-from-top-2">
                    <div className="flex items-center gap-3">
                      <ShieldCheck className="w-5 h-5 text-blue-600" />
                      <div>
                        <p className="text-xs font-black text-blue-900 uppercase tracking-tight">Linked to Invoice</p>
                        <p className="text-[10px] text-blue-600 font-bold">
                          {invoices.find(i => i.id === linkedInvoiceId)?.invoiceNumber}
                        </p>
                      </div>
                    </div>
                    <button 
                      onClick={() => {
                        setLinkedInvoiceId(null);
                        setDestination('');
                        setSelectedMaterials([]);
                      }}
                      className="p-2 hover:bg-blue-100 rounded-lg text-blue-400 transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Destination</label>
                    <input
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all font-bold text-slate-900"
                      placeholder="Buyer or Yard Name"
                      value={destination}
                      onChange={(e) => setDestination(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Carrier / Trucking Co.</label>
                    <input
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all font-bold text-slate-900"
                      placeholder="Company Name"
                      value={carrier}
                      onChange={(e) => setCarrier(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Driver Name</label>
                    <input
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all font-bold text-slate-900"
                      placeholder="Full Name"
                      value={driver}
                      onChange={(e) => setDriver(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Truck / Fleet ID</label>
                    <input
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all font-bold text-slate-900"
                      placeholder="Vehicle ID"
                      value={vehicle}
                      onChange={(e) => setVehicle(e.target.value)}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Trailer #</label>
                    <input
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all font-bold text-slate-900"
                      placeholder="Trailer ID"
                      value={trailerNumber}
                      onChange={(e) => setTrailerNumber(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Seal #</label>
                    <input
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all font-bold text-slate-900"
                      placeholder="Security Seal"
                      value={sealNumber}
                      onChange={(e) => setSealNumber(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">BOL #</label>
                    <input
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all font-bold text-slate-900"
                      placeholder="Bill of Lading"
                      value={bolNumber}
                      onChange={(e) => setBolNumber(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              {/* Material Selection */}
              <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm space-y-6">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-indigo-50 rounded-xl text-indigo-600">
                      <Package className="w-5 h-5" />
                    </div>
                    <h3 className="font-black text-slate-900 uppercase tracking-tight">Load Contents</h3>
                  </div>
                  <div className="relative flex-1 max-w-[240px]">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder="Search materials..."
                      value={materialSearch}
                      onChange={(e) => setMaterialSearch(e.target.value)}
                    />
                  </div>
                </div>
                
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                  {materials
                    .filter(m => {
                      const search = materialSearch.toLowerCase();
                      return m.name.toLowerCase().includes(search) || m.code.toLowerCase().includes(search);
                    })
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
                    .map(m => (
                    <button
                      key={m.id}
                      onClick={() => handleAddMaterial(m.id)}
                      className={cn(
                        "p-4 rounded-2xl border transition-all text-left group relative outline-none focus-visible:ring-2 focus-visible:ring-indigo-500",
                        selectedMaterials.some(sm => sm.materialId === m.id)
                          ? "bg-indigo-50 border-indigo-200"
                          : "bg-white border-slate-200 hover:border-indigo-300 hover:bg-slate-50"
                      )}
                    >
                      <p className="font-bold text-slate-900 truncate text-sm">{m.name}</p>
                      <p className="text-[10px] mt-1 uppercase text-slate-400 font-black tracking-widest">
                        Unit: {m.unit}
                      </p>
                      {selectedMaterials.some(sm => sm.materialId === m.id) && (
                        <div className="absolute top-2 right-2">
                          <CheckCircle2 className="w-4 h-4 text-indigo-600" />
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-8">
              {/* Load Summary */}
              <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm space-y-6 sticky top-8">
                <h3 className="font-black text-slate-900 uppercase tracking-tight">Load Summary</h3>
                
                <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
                  {selectedMaterials.length === 0 ? (
                    <div className="text-center py-12 text-slate-400 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                      <Package className="w-10 h-10 mx-auto mb-3 opacity-20" />
                      <p className="text-xs font-bold uppercase tracking-widest">Empty Load</p>
                    </div>
                  ) : (
                    selectedMaterials.map((item) => {
                      const material = materials.find(m => m.id === item.materialId);
                      return (
                        <div key={item.materialId} className="space-y-2 p-4 bg-slate-50 rounded-2xl border border-slate-100 group">
                          <div className="flex items-center justify-between gap-4">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-bold text-slate-900 truncate">{material?.name}</p>
                              <p className="text-[10px] text-slate-500 font-black uppercase tracking-widest">Sale: ${item.salePrice}/{material?.unit}</p>
                            </div>
                            <button 
                              onClick={() => handleRemoveMaterial(item.materialId)}
                              className="p-2 text-slate-300 hover:text-red-500 rounded-xl transition-colors"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                          <div className="relative">
                            <input
                              type="number"
                              className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-sm font-black focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                              placeholder="Enter Weight"
                              value={item.weight || ''}
                              onChange={(e) => handleWeightChange(item.materialId, Number(e.target.value))}
                            />
                            <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[10px] font-black text-slate-400 uppercase">{material?.unit}</span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Internal Notes</label>
                  <textarea
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500 min-h-[100px] resize-none"
                    placeholder="Add any special instructions or load notes..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </div>

                <div className="pt-4 border-t border-slate-100 space-y-2">
                  <div className="flex justify-between text-xs font-black text-slate-400 uppercase tracking-widest">
                    <span>Total Weight</span>
                    <span className="text-slate-900">{selectedMaterials.reduce((sum, m) => sum + m.weight, 0).toLocaleString()} lb</span>
                  </div>
                  <div className="flex justify-between text-xs font-black text-slate-400 uppercase tracking-widest">
                    <span>Estimated Value</span>
                    <span className="text-blue-600">${selectedMaterials.reduce((sum, m) => sum + (m.weight * m.salePrice), 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                </div>

                <button
                  onClick={handleSubmit}
                  disabled={!destination || !driver || !vehicle || selectedMaterials.length === 0 || processing}
                  className="w-full py-5 bg-slate-900 text-white rounded-2xl font-black text-lg uppercase tracking-widest hover:bg-slate-800 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3 shadow-xl shadow-slate-200 outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2"
                >
                  {processing ? (
                    <Loader2 className="w-6 h-6 animate-spin" />
                  ) : (
                    <>
                      <Truck className="w-6 h-6" />
                      Dispatch Load
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="animate-in fade-in slide-in-from-bottom-4 duration-300 space-y-6">
          {/* History List */}
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 text-[10px] font-black uppercase tracking-widest border-b border-slate-100">
                    <th className="px-8 py-5">Date / BOL</th>
                    <th className="px-8 py-5">Destination</th>
                    <th className="px-8 py-5">Carrier / Driver</th>
                    <th className="px-8 py-5">Weight</th>
                    <th className="px-8 py-5">Status</th>
                    <th className="px-8 py-5">Invoice</th>
                    <th className="px-8 py-5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {tripTickets.map((ticket) => (
                    <tr 
                      key={ticket.id} 
                      className="hover:bg-blue-50/50 transition-all group cursor-pointer"
                      onClick={() => setSelectedTicket(ticket)}
                    >
                      <td className="px-8 py-6">
                        <div className="flex items-center gap-4">
                          <div className="p-3 bg-slate-100 rounded-2xl text-slate-500 group-hover:bg-blue-100 group-hover:text-blue-600 transition-all">
                            <Calendar className="w-5 h-5" />
                          </div>
                          <div>
                            <p className="text-sm font-black text-slate-900 uppercase tracking-tight">
                              {new Date(ticket.timestamp).toLocaleDateString()}
                            </p>
                            <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest flex items-center gap-1">
                              <span>BOL: {ticket.bolNumber || 'N/A'}</span>
                              {ticket.createdByName && (
                                <>
                                  <span className="opacity-30">•</span>
                                  <span className="text-indigo-500/70">{ticket.createdByName}</span>
                                </>
                              )}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-8 py-6">
                        <div className="flex items-center gap-3">
                          <MapPin className="w-4 h-4 text-slate-300" />
                          <p className="text-sm font-bold text-slate-700 uppercase tracking-tight">{ticket.destination}</p>
                        </div>
                      </td>
                      <td className="px-8 py-6">
                        <div className="space-y-1">
                          <p className="text-sm font-bold text-slate-700 uppercase tracking-tight">{ticket.carrier || 'Internal'}</p>
                          <div className="flex items-center gap-2 text-[10px] text-slate-400 font-black uppercase tracking-widest">
                            <User className="w-3 h-3" />
                            {ticket.driver}
                          </div>
                        </div>
                      </td>
                      <td className="px-8 py-6">
                        <p className="text-sm font-black text-slate-900">{(ticket.totalWeight || 0).toLocaleString()} lb</p>
                        <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest">
                          {ticket.materials.length} Materials
                        </p>
                      </td>
                      <td className="px-8 py-6">
                        <span className={cn(
                          "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border",
                          ticket.status === 'in-transit' ? "bg-blue-50 text-blue-600 border-blue-100" :
                          ticket.status === 'delivered' ? "bg-green-50 text-green-600 border-green-100" :
                          "bg-slate-50 text-slate-500 border-slate-100"
                        )}>
                          {ticket.status}
                        </span>
                      </td>
                      <td className="px-8 py-6">
                        <span className={cn(
                          "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border",
                          ticket.invoiceStatus === 'invoiced' ? "bg-indigo-50 text-indigo-600 border-indigo-100" :
                          ticket.invoiceStatus === 'matched' ? "bg-emerald-50 text-emerald-600 border-emerald-100" :
                          ticket.invoiceStatus === 'disputed' ? "bg-red-50 text-red-600 border-red-100" :
                          "bg-amber-50 text-amber-600 border-amber-100"
                        )}>
                          {ticket.invoiceStatus || 'pending'}
                        </span>
                      </td>
                      <td className="px-8 py-6 text-right">
                        <button className="p-3 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-2xl transition-all">
                          <ChevronRight className="w-6 h-6" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {tripTickets.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-8 py-20 text-center">
                        <div className="max-w-xs mx-auto space-y-3">
                          <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto">
                            <Truck className="w-8 h-8 text-slate-200" />
                          </div>
                          <p className="text-slate-900 font-bold">No trip history found</p>
                          <p className="text-sm text-slate-500">Outbound loads will appear here once dispatched.</p>
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

      {/* Ticket Details Modal */}
      {selectedTicket && (
        <div 
          className="fixed inset-0 bg-slate-900/60 z-[100] flex items-start justify-center p-4 backdrop-blur-sm overflow-y-auto"
        >
          <div className="bg-white rounded-[2.5rem] w-full max-w-3xl my-auto overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="p-8 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-slate-900 rounded-2xl text-white">
                  <FileText className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-xl font-black text-slate-900 uppercase tracking-tight">Load Details</h2>
                  <p className="text-xs text-slate-500 font-black uppercase tracking-widest">BOL: {selectedTicket.bolNumber || 'NOT ASSIGNED'}</p>
                </div>
              </div>
              <button 
                onClick={() => setSelectedTicket(null)}
                className="p-3 hover:bg-slate-200 rounded-2xl transition-colors"
              >
                <X className="w-6 h-6 text-slate-500" />
              </button>
            </div>

            <div className="p-10 space-y-10">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                <div className="space-y-6">
                  <div className="space-y-1">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Destination</p>
                    <p className="text-2xl font-black text-slate-900">{selectedTicket.destination}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-1">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Carrier</p>
                      <p className="text-sm font-bold text-slate-700">{selectedTicket.carrier || 'Internal'}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Driver</p>
                      <p className="text-sm font-bold text-slate-700">{selectedTicket.driver}</p>
                    </div>
                  </div>
                </div>
                <div className="space-y-6 text-right">
                  <div className="space-y-1">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Date Dispatched</p>
                    <p className="text-xl font-black text-slate-900">{new Date(selectedTicket.timestamp).toLocaleString()}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-1">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Truck ID</p>
                      <p className="text-sm font-bold text-slate-700">{selectedTicket.vehicle}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Trailer #</p>
                      <p className="text-sm font-bold text-slate-700">{selectedTicket.trailerNumber || 'N/A'}</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-slate-50 rounded-3xl p-8 border border-slate-100 space-y-6">
                <div className="flex items-center justify-between">
                  <h4 className="font-black text-slate-900 uppercase tracking-tight flex items-center gap-2">
                    <Package className="w-5 h-5 text-blue-600" />
                    Load Breakdown
                  </h4>
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{selectedTicket.materials.length} Items</span>
                </div>
                <div className="space-y-3">
                  {selectedTicket.materials.map((item, idx) => {
                    const material = materials.find(m => m.id === item.materialId);
                    return (
                      <div key={idx} className="flex items-center justify-between p-4 bg-white rounded-2xl border border-slate-100 shadow-sm">
                        <div className="flex items-center gap-4">
                          <span className="w-8 h-8 bg-slate-50 rounded-full flex items-center justify-center text-xs font-black text-slate-400">{idx + 1}</span>
                          <div>
                            <p className="text-sm font-black text-slate-900">{material?.name || 'Unknown Material'}</p>
                            <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest">Sale Price: ${item.salePrice.toFixed(2)}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-black text-slate-900">{item.weight.toLocaleString()} lb</p>
                          <p className="text-[10px] text-blue-600 font-black uppercase tracking-widest">${(item.weight * item.salePrice).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Invoice Prep Section */}
              <div className={cn(
                "rounded-3xl p-8 border space-y-6",
                selectedTicket.invoiceStatus === 'invoiced' ? "bg-indigo-50 border-indigo-100" : "bg-amber-50 border-amber-100"
              )}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      "p-2 rounded-xl",
                      selectedTicket.invoiceStatus === 'invoiced' ? "bg-indigo-100 text-indigo-600" : "bg-amber-100 text-amber-600"
                    )}>
                      <ShieldCheck className="w-5 h-5" />
                    </div>
                    <h4 className={cn(
                      "font-black uppercase tracking-tight",
                      selectedTicket.invoiceStatus === 'invoiced' ? "text-indigo-900" : "text-amber-900"
                    )}>Invoice Reconciliation</h4>
                  </div>
                  <span className={cn(
                    "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border",
                    selectedTicket.invoiceStatus === 'invoiced' ? "bg-indigo-100 text-indigo-700 border-indigo-200" :
                    selectedTicket.invoiceStatus === 'matched' ? "bg-emerald-100 text-emerald-700 border-emerald-200" : 
                    "bg-amber-100 text-amber-700 border-amber-200"
                  )}>
                    {selectedTicket.invoiceStatus || 'pending'}
                  </span>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <p className={cn(
                      "text-sm font-bold",
                      selectedTicket.invoiceStatus === 'invoiced' ? "text-indigo-900" : "text-amber-900"
                    )}>
                      {selectedTicket.invoiceStatus === 'invoiced' ? 'Invoice Generated' : 'Match to Invoice'}
                    </p>
                    <p className={cn(
                      "text-xs leading-relaxed",
                      selectedTicket.invoiceStatus === 'invoiced' ? "text-indigo-700" : "text-amber-700"
                    )}>
                      {selectedTicket.invoiceStatus === 'invoiced' 
                        ? 'An invoice has been generated for this load. You can view and manage it in the Invoicing section.'
                        : 'This load is ready for invoice matching. Once an invoice is imported, you can link it here to reconcile weights and values.'}
                    </p>
                  </div>
                  <div className="flex items-center justify-end">
                    {selectedTicket.invoiceStatus === 'invoiced' ? (
                      <Link 
                        to="/invoices"
                        className="px-6 py-3 bg-indigo-600 text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200 flex items-center gap-2"
                      >
                        <FileText className="w-4 h-4" /> View Invoices
                      </Link>
                    ) : (
                      <button 
                        onClick={() => setShowLinkInvoice(true)}
                        className="px-6 py-3 bg-amber-600 text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-amber-700 transition-all shadow-lg shadow-amber-200 flex items-center gap-2"
                      >
                        <Plus className="w-4 h-4" /> Link Invoice
                      </button>
                    )}
                  </div>
                </div>
              </div>



              {selectedTicket.notes && (
                <div className="space-y-2">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Load Notes</p>
                  <p className="text-sm text-slate-600 bg-slate-50 p-6 rounded-3xl border border-slate-100 italic">
                    "{selectedTicket.notes}"
                  </p>
                </div>
              )}

              <div className="pt-10 border-t border-slate-100 flex items-center justify-between">
                <div className="space-y-1">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Handled By</p>
                  <p className="text-sm font-black text-indigo-600 uppercase">{selectedTicket.createdByName || 'System'}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Total Load Weight</p>
                  <p className="text-3xl font-black text-slate-900">{(selectedTicket.totalWeight || 0).toLocaleString()} lb</p>
                </div>
                <div className="text-right space-y-1">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Estimated Value</p>
                  <p className="text-4xl font-black text-blue-600">${(selectedTicket.totalValue || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                </div>
              </div>
            </div>

            <div className="p-8 bg-slate-50 border-t border-slate-100 flex flex-wrap gap-4">
              <button 
                onClick={() => {
                  setSelectedTicket(null);
                  setShowPrintPreview(false);
                }}
                className="px-6 py-4 border border-slate-200 rounded-2xl font-black text-slate-600 uppercase tracking-widest hover:bg-white transition-all active:scale-95"
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
                      className="flex items-center gap-2 px-6 py-4 bg-amber-50 text-amber-600 border border-amber-200 rounded-2xl font-black uppercase tracking-widest hover:bg-amber-100 transition-all active:scale-95 disabled:opacity-50"
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
                      className="flex items-center gap-2 px-6 py-4 bg-red-50 text-red-600 border border-red-200 rounded-2xl font-black uppercase tracking-widest hover:bg-red-100 transition-all active:scale-95 disabled:opacity-50"
                    >
                      <Trash2 className="w-5 h-5" />
                      Delete
                    </button>
                  )}
                </div>
              )}

              <button 
                onClick={() => setShowPrintPreview(true)}
                className="flex-1 py-4 bg-slate-900 text-white rounded-2xl font-black uppercase tracking-widest flex items-center justify-center gap-2 hover:bg-slate-800 transition-all shadow-xl shadow-slate-200 active:scale-95"
              >
                <Printer className="w-5 h-5" />
                Print BOL
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Link Invoice Modal */}
      {showLinkInvoice && (
        <div className="fixed inset-0 bg-slate-900/60 z-[120] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-[2rem] w-full max-w-md overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <h3 className="font-black text-slate-900 uppercase tracking-tight">
                {selectedTicket ? 'Link to Invoice' : 'Pull from Invoice'}
              </h3>
              <button onClick={() => setShowLinkInvoice(false)} className="p-2 hover:bg-slate-200 rounded-lg transition-colors">
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="relative group">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-blue-600 transition-colors" />
                <input
                  type="text"
                  className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                  placeholder="Search invoices..."
                  value={invoiceSearch}
                  onChange={(e) => setInvoiceSearch(e.target.value)}
                />
              </div>
              <div className="max-h-[300px] overflow-y-auto space-y-2 pr-2 no-scrollbar">
                {invoices
                  .filter(inv => 
                    inv.invoiceNumber.toLowerCase().includes(invoiceSearch.toLowerCase()) ||
                    inv.buyerName.toLowerCase().includes(invoiceSearch.toLowerCase())
                  )
                  .map((inv) => (
                    <button
                      key={inv.id}
                      onClick={() => handleLinkInvoice(inv.id)}
                      className="w-full p-4 rounded-2xl border border-slate-100 hover:border-blue-200 hover:bg-blue-50/30 transition-all text-left group"
                    >
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="text-sm font-black text-slate-900">{inv.invoiceNumber}</p>
                          <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest">{inv.buyerName}</p>
                        </div>
                        <p className="text-xs font-black text-blue-600">${inv.totalAmount.toLocaleString()}</p>
                      </div>
                    </button>
                  ))}
                {invoices.length === 0 && (
                  <div className="py-8 text-center text-slate-400 italic text-xs">
                    No invoices found.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      </div>

      {/* Print Preview Modal */}
      {showPrintPreview && selectedTicket && (
        <div 
          className="fixed inset-0 bg-slate-900/80 z-[110] flex items-start justify-center p-4 backdrop-blur-sm overflow-y-auto print:bg-transparent print:backdrop-blur-none print:p-0 print:static print:overflow-visible"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white rounded-[2.5rem] w-full max-w-5xl my-auto overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200 flex flex-col print:rounded-none print:shadow-none print:max-w-none print:w-full print:m-0">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50 no-print">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-slate-900 rounded-2xl text-white">
                  <Printer className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-xl font-black text-slate-900 uppercase tracking-tight">Bill of Lading Preview</h2>
                  <p className="text-xs text-slate-500 font-black uppercase tracking-widest">Load Dispatch Ticket</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button 
                  onClick={() => {
                    if (!settings.debugPrintMode) window.print();
                    if (!settings.debugPrintMode) {
                      setShowPrintPreview(false);
                      if (success) {
                        setSelectedTicket(null);
                        // Reset form
                        setDestination('');
                        setDriver('');
                        setVehicle('');
                        setCarrier('');
                        setTrailerNumber('');
                        setSealNumber('');
                        setBolNumber('');
                        setNotes('');
                        setSelectedMaterials([]);
                        setLinkedInvoiceId(null);
                      }
                    } else {
                      console.log('DEBUG PRINT: window.print() and reset bypassed.');
                    }
                  }}
                  className="px-6 py-3 bg-blue-600 text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-blue-700 transition-all flex items-center gap-2 shadow-lg shadow-blue-200"
                >
                  <Printer className="w-4 h-4" />
                  Print BOL
                </button>
                <button 
                  onClick={() => setShowPrintPreview(false)}
                  className="p-3 hover:bg-slate-200 rounded-2xl transition-colors"
                >
                  <X className="w-6 h-6 text-slate-500" />
                </button>
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto p-12 bg-slate-100 no-scrollbar print:p-0 print:bg-transparent">
              {/* Landscape BOL Container */}
              <div className="bg-white shadow-2xl mx-auto w-full max-w-[1100px] min-h-[770px] p-16 font-serif text-slate-900 bol-container relative flex flex-col overflow-visible">
                <div className="flex justify-between items-start mb-12">
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

                <div className="text-center space-y-2 mb-12 border-y border-slate-100 py-4">
                  <div className="flex items-center justify-center gap-8 text-[10px] font-bold uppercase tracking-[0.3em] text-slate-400">
                    <span>Official Bill of Lading</span>
                    <div className="w-1.5 h-1.5 rounded-full bg-slate-200" />
                    <span>Dispatch Ticket</span>
                    <div className="w-1.5 h-1.5 rounded-full bg-slate-200" />
                    <span>{new Date(selectedTicket.timestamp).toLocaleString()}</span>
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-20 mb-12">
                  <div className="space-y-8">
                    <div className="space-y-1">
                      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Destination</p>
                      <p className="text-2xl font-black text-slate-900 uppercase tracking-tight">{selectedTicket.destination}</p>
                      {selectedTicket.buyerAddress && (
                        <p className="text-sm text-slate-500">{selectedTicket.buyerAddress}</p>
                      )}
                      {selectedTicket.buyerPhone && (
                        <p className="text-sm text-slate-500">{selectedTicket.buyerPhone}</p>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-8">
                      <div className="space-y-1">
                        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Carrier</p>
                        <p className="text-sm font-bold uppercase">{selectedTicket.carrier || 'Internal'}</p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Driver</p>
                        <p className="text-sm font-bold uppercase">{selectedTicket.driver}</p>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-8 text-right">
                    <div className="grid grid-cols-2 gap-8">
                      <div className="space-y-1">
                        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">BOL #</p>
                        <p className="text-sm font-bold">{selectedTicket.bolNumber || 'N/A'}</p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Truck ID</p>
                        <p className="text-sm font-bold uppercase">{selectedTicket.vehicle}</p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Trailer #</p>
                        <p className="text-sm font-bold uppercase">{selectedTicket.trailerNumber || 'N/A'}</p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Seal #</p>
                        <p className="text-sm font-bold uppercase">{selectedTicket.sealNumber || 'N/A'}</p>
                      </div>
                    </div>
                  </div>
                </div>
                
                <div className="flex-1">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="border-b-2 border-slate-900">
                        <th className="py-4 text-left text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Material Description</th>
                        <th className="py-4 text-right text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Weight (lb)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {selectedTicket.materials.map((item, idx) => {
                        const material = materials.find(m => m.id === item.materialId);
                        return (
                          <tr key={idx}>
                            <td className="py-6">
                              <p className="font-bold text-slate-900 uppercase tracking-tight">{material?.name || 'N/A'}</p>
                              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">Code: {material?.code || 'N/A'}</p>
                            </td>
                            <td className="py-6 text-right font-black text-slate-900 text-lg">
                              {item.weight.toLocaleString()}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="mt-8 pt-8 border-t-2 border-slate-900 flex justify-between items-end">
                  <div className="space-y-6">
                    {selectedTicket.notes && (
                      <div className="max-w-md space-y-2">
                        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Notes</p>
                        <p className="text-xs text-slate-500 italic">{selectedTicket.notes}</p>
                      </div>
                    )}
                    <div className="pt-8 space-y-2">
                      <div className="w-64 border-b border-slate-300"></div>
                      <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Authorized Signature</p>
                    </div>
                  </div>
                  <div className="text-right space-y-2">
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Total Load Weight</p>
                    <p className="text-5xl font-black text-slate-900">{(selectedTicket.totalWeight || 0).toLocaleString()} <span className="text-xl text-slate-400">lb</span></p>
                  </div>
                </div>

                <div className="mt-12 pt-8 flex justify-between items-end border-t border-slate-100">
                  <div className="text-[10px] font-bold text-slate-300 uppercase tracking-[0.3em]">
                    {COMPANY_NAME}
                  </div>
                  <div className="text-[10px] font-bold text-slate-300 uppercase tracking-[0.3em]">
                    TICKET ID: {selectedTicket.id.toUpperCase()}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
