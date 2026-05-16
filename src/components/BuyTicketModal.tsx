import React, { useState, useEffect } from 'react';
import { 
  X, 
  Search, 
  User, 
  UserPlus, 
  Package, 
  Scale, 
  DollarSign, 
  CheckCircle2, 
  Loader2, 
  AlertCircle, 
  Plus, 
  ChevronRight, 
  ChevronLeft, 
  Truck, 
  CreditCard, 
  FileText,
  ShieldAlert,
  ShieldCheck,
  ChevronDown,
  Printer,
  AlertTriangle
} from 'lucide-react';
import { db } from '../firebase';
import { collection, onSnapshot, addDoc, doc, getDoc, updateDoc, increment, setDoc, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import { Material, Customer, BuyTicket, BuyTicketMaterial, DoNotBuyEntry, UserProfile } from '../types';
import { COMPANY_NAME, COMPANY_ADDRESS, COMPANY_PHONE, handleImageError } from '../constants';
import { BrandLogo } from './BrandLogo';
import { cn } from '../lib/utils';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';
import { useSettings } from '../context/SettingsContext';
import ManagerPinModal from './ManagerPinModal';
import { ScaleCaptureButton } from './ScaleCaptureButton';
import { CameraCapture } from './CameraCapture';
import SignaturePad from './SignaturePad';

interface BuyTicketModalProps {
  isOpen: boolean;
  onClose: () => void;
  profile: UserProfile | null;
}

export default function BuyTicketModal({ isOpen, onClose, profile }: BuyTicketModalProps) {
  const [step, setStep] = useState(1);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [doNotBuyList, setDoNotBuyList] = useState<DoNotBuyEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // Ticket State
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [newCustomer, setNewCustomer] = useState({ name: '', phone: '', address: '', businessName: '' });
  const [isNewCustomer, setIsNewCustomer] = useState(false);
  
  const [items, setItems] = useState<(BuyTicketMaterial & { id: string, material: Material | null, materialSearch?: string, isDropdownOpen?: boolean })[]>([
    { id: Math.random().toString(36).substr(2, 9), materialId: '', material: null, grossWeight: 0, tareWeight: 0, netWeight: 0, pricePerUnit: 0, totalAmount: 0, materialSearch: '', isDropdownOpen: false, photoUrl: '' }
  ]);

  const [ticketDetails, setTicketDetails] = useState({
    vehiclePlate: '',
    vehicleType: '',
    paymentMethod: 'cash' as 'cash' | 'check' | 'other',
    notes: '',
    customerPhotoUrl: '',
    signatureUrl: ''
  });

  const [processing, setQtProcessing] = useState(false);
  const [success, setQtSuccess] = useState(false);
  const [lastCreatedTicket, setLastCreatedTicket] = useState<BuyTicket | null>(null);
  const [showPrintPreview, setShowPrintPreview] = useState(false);
  const [isPreviewOnly, setIsPreviewOnly] = useState(false);
  const [idCheckResult, setIdCheckResult] = useState<{ prohibited: boolean, reason?: string } | null>(null);
  const [showPinModal, setShowPinModal] = useState(false);
  const [showVehicleConfirm, setShowVehicleConfirm] = useState(false);
  const { settings } = useSettings();

  // Auto-print effect
  useEffect(() => {
    if (success && settings.autoPrint) {
      setShowPrintPreview(true);
      const timer = setTimeout(() => {
        if (!settings.debugPrintMode) window.print();
        // Automatically close after auto-print starts
        setTimeout(() => {
          if (!settings.debugPrintMode) {
            onClose();
            reset();
          }
        }, 500);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [success, settings.autoPrint, settings.debugPrintMode]);

  useEffect(() => {
    if (!isOpen) return;

    const unsubMaterials = onSnapshot(collection(db, 'materials'), (snapshot) => {
      setMaterials(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Material[]);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'materials'));

    const unsubCustomers = onSnapshot(collection(db, 'customers'), (snapshot) => {
      setCustomers(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Customer[]);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'customers'));

    const unsubDNB = onSnapshot(collection(db, 'doNotBuyList'), (snapshot) => {
      setDoNotBuyList(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as DoNotBuyEntry[]);
      setLoading(false);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'doNotBuyList'));

    return () => {
      unsubMaterials();
      unsubCustomers();
      unsubDNB();
    };
  }, [isOpen]);

  // Recall last vehicle for customer
  useEffect(() => {
    if (selectedCustomer && isOpen) {
      const fetchLastVehicle = async () => {
        try {
          const ticketsRef = collection(db, 'buyTickets');
          const q = query(
            ticketsRef, 
            where('customerId', '==', selectedCustomer.id), 
            orderBy('timestamp', 'desc'), 
            limit(1)
          );
          const querySnapshot = await getDocs(q);
          if (!querySnapshot.empty) {
            const lastTicket = querySnapshot.docs[0].data() as BuyTicket;
            if (lastTicket.vehiclePlate || lastTicket.vehicleType) {
              setTicketDetails(prev => ({
                ...prev,
                vehiclePlate: lastTicket.vehiclePlate || '',
                vehicleType: lastTicket.vehicleType || ''
              }));
            }
          }
        } catch (error) {
          console.error("Error fetching last vehicle:", error);
        }
      };
      fetchLastVehicle();
    }
  }, [selectedCustomer, isOpen]);

  const handlePrintPreview = () => {
    const previewTicket: BuyTicket = {
      id: 'PREVIEW',
      customerId: selectedCustomer?.id || 'NEW',
      materials: items.map(item => ({
        materialId: item.materialId,
        grossWeight: item.grossWeight,
        tareWeight: item.tareWeight,
        netWeight: item.netWeight,
        pricePerUnit: item.pricePerUnit,
        totalAmount: item.totalAmount,
        deductionWeight: item.deductionWeight,
        deductionReason: item.deductionReason,
        notes: item.notes
      })),
      totalAmount,
      status: 'completed',
      timestamp: new Date().toISOString(),
      ...ticketDetails
    };
    setLastCreatedTicket(previewTicket);
    setIsPreviewOnly(true);
    setShowPrintPreview(true);
  };

  const calculateItem = (item: typeof items[0]) => {
    const physicalNet = Math.max(0, item.grossWeight - item.tareWeight);
    const paidWeight = Math.max(0, physicalNet - (item.deductionWeight || 0));
    const total = paidWeight * item.pricePerUnit;
    return { ...item, netWeight: physicalNet, totalAmount: total };
  };

  const addItem = () => {
    setItems(prev => [...prev, { 
      id: Math.random().toString(36).substr(2, 9), 
      materialId: '', 
      material: null, 
      grossWeight: 0, 
      tareWeight: 0, 
      netWeight: 0, 
      pricePerUnit: 0, 
      totalAmount: 0,
      materialSearch: '',
      isDropdownOpen: false
    }]);
  };

  const removeItem = (id: string) => {
    if (items.length > 1) {
      setItems(prev => prev.filter(i => i.id !== id));
    }
  };

  const updateItem = (id: string, updates: Partial<typeof items[0]>) => {
    setItems(prev => prev.map(i => {
      if (i.id === id) {
        const updated = { ...i, ...updates };
        // If material changed, update price
        if (updates.material) {
          updated.materialId = updates.material.id;
          updated.pricePerUnit = updates.material.buyPrice;
        }
        return calculateItem(updated);
      }
      return i;
    }));
  };

  const totalAmount = items.reduce((sum, i) => sum + i.totalAmount, 0);
  const totalWeight = items.reduce((sum, i) => sum + i.netWeight, 0);

  const handleNext = () => {
    if (step === 1) {
      if (!selectedCustomer && (!isNewCustomer || !newCustomer.name)) return;
      // Check DNB
      const nameToCheck = selectedCustomer?.name || newCustomer.name;
      const match = doNotBuyList.find(entry => entry.name.toLowerCase() === nameToCheck.toLowerCase());
      if (match) {
        setIdCheckResult({ prohibited: true, reason: match.reason });
      } else {
        setIdCheckResult({ prohibited: false });
      }
      setStep(2);
    } else if (step === 2) {
      if (items.some(i => !i.material || i.netWeight <= 0)) return;
      setStep(3);
    } else if (step === 3) {
      // Check for vehicle details
      if (!ticketDetails.vehiclePlate && !ticketDetails.vehicleType && !showVehicleConfirm) {
        setShowVehicleConfirm(true);
        return;
      }
      setShowVehicleConfirm(false);
      setStep(4);
    }
  };

  const handleBack = () => {
    if (step > 1) setStep(step - 1);
  };

  const handleSubmit = async () => {
    // Check for price overrides
    const hasOverrides = items.some(item => 
      item.pricePerUnit !== item.material?.buyPrice
    );

    if (hasOverrides && profile?.role === 'cashier') {
      setShowPinModal(true);
      return;
    }

    await saveTicket();
  };

  const saveTicket = async () => {
    setQtProcessing(true);
    try {
      let customerId = selectedCustomer?.id;

      if (isNewCustomer && !customerId) {
        const custRef = await addDoc(collection(db, 'customers'), {
          ...newCustomer,
          createdAt: new Date().toISOString()
        });
        customerId = custRef.id;
      }

      if (!customerId) throw new Error("Customer ID missing");

      const ticketMaterials: BuyTicketMaterial[] = items.map(item => {
        const material: BuyTicketMaterial = {
          materialId: item.materialId,
          grossWeight: item.grossWeight,
          tareWeight: item.tareWeight,
          netWeight: item.netWeight,
          pricePerUnit: item.pricePerUnit,
          totalAmount: item.totalAmount
        };
        
        if (item.deductionWeight !== undefined) material.deductionWeight = item.deductionWeight;
        if (item.deductionReason !== undefined) material.deductionReason = item.deductionReason;
        if (item.notes !== undefined) material.notes = item.notes;
        if (item.photoUrl !== undefined) material.photoUrl = item.photoUrl;
        
        return material;
      });

      const ticketData: Omit<BuyTicket, 'id'> = {
        customerId,
        materials: ticketMaterials,
        totalAmount,
        status: 'completed',
        timestamp: new Date().toISOString(),
        vehiclePlate: ticketDetails.vehiclePlate || '',
        vehicleType: ticketDetails.vehicleType || '',
        paymentMethod: ticketDetails.paymentMethod || 'cash',
        notes: ticketDetails.notes || '',
        customerPhotoUrl: ticketDetails.customerPhotoUrl || '',
        signatureUrl: ticketDetails.signatureUrl || '',
        createdBy: profile?.uid,
        createdByName: profile?.displayName || profile?.email || 'System'
      };

      const docRef = await addDoc(collection(db, 'buyTickets'), ticketData);
      
      // Update customer photo if one was taken
      if (ticketDetails.customerPhotoUrl) {
        await updateDoc(doc(db, 'customers', customerId), {
          photoUrl: ticketDetails.customerPhotoUrl
        });
      }
      setLastCreatedTicket({ id: docRef.id, ...ticketData });

      // Update Inventory
      for (const item of ticketMaterials) {
        const invRef = doc(db, 'inventory', item.materialId);
        const invDoc = await getDoc(invRef);
        if (invDoc.exists()) {
          await updateDoc(invRef, {
            currentWeight: increment(item.netWeight),
            lastUpdated: new Date().toISOString()
          });
        } else {
          await setDoc(invRef, {
            materialId: item.materialId,
            currentWeight: item.netWeight,
            lastUpdated: new Date().toISOString()
          });
        }
      }

      setQtSuccess(true);
      
      // Print handled by useEffect
    } catch (error) {
      console.error('Error creating ticket:', error);
      handleFirestoreError(error, OperationType.CREATE, 'buyTickets');
    } finally {
      setQtProcessing(false);
    }
  };

  const reset = () => {
    setStep(1);
    setSelectedCustomer(null);
    setNewCustomer({ name: '', phone: '', address: '', businessName: '' });
    setIsNewCustomer(false);
    setItems([{ id: Math.random().toString(36).substr(2, 9), materialId: '', material: null, grossWeight: 0, tareWeight: 0, netWeight: 0, pricePerUnit: 0, totalAmount: 0, materialSearch: '', isDropdownOpen: false }]);
    setTicketDetails({ vehiclePlate: '', vehicleType: '', paymentMethod: 'cash', notes: '', customerPhotoUrl: '', signatureUrl: '' });
    setQtSuccess(false);
    setLastCreatedTicket(null);
    setShowPrintPreview(false);
    setIdCheckResult(null);
  };

  const getCustomerName = (id: string) => {
    const customer = customers.find(c => c.id === id);
    return customer?.name || 'Unknown Customer';
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/60 z-[100] flex items-center justify-center p-4 backdrop-blur-sm">
      <div className="bg-white rounded-3xl w-full max-w-3xl overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="bg-slate-900 p-6 text-white flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-xl font-bold">Robust Buy Ticket</h2>
            <p className="text-slate-400 text-xs mt-1">
              Step {step} of 4 • {
                step === 1 ? 'Customer Selection' : 
                step === 2 ? 'Materials & Weights' : 
                step === 3 ? 'Ticket Details' : 'Final Review'
              }
            </p>
          </div>
          <button 
            onClick={() => { onClose(); reset(); }} 
            className="w-11 h-11 flex items-center justify-center hover:bg-white/10 rounded-full transition-all outline-none focus-visible:ring-2 focus-visible:ring-blue-400 active:scale-95"
            aria-label="Close modal"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Body */}
        <div className="p-8 overflow-y-auto flex-1 custom-scrollbar">
          {success ? (
            <div className="py-12 text-center space-y-4">
              <div className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-6">
                <CheckCircle2 className="w-10 h-10" />
              </div>
              <h3 className="text-2xl font-bold text-slate-900">Ticket Completed!</h3>
              <p className="text-slate-500">The payout has been recorded and inventory updated.</p>
              
              <div className="flex flex-col sm:flex-row gap-3 justify-center pt-6">
                <button
                  onClick={() => setShowPrintPreview(true)}
                  className="px-8 py-3 bg-slate-900 text-white rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-slate-800 transition-all shadow-lg"
                >
                  <Printer className="w-5 h-5" />
                  Print Ticket
                </button>
                <button
                  onClick={() => { onClose(); reset(); }}
                  className="px-8 py-3 border border-slate-200 text-slate-600 rounded-xl font-bold hover:bg-slate-50 transition-all"
                >
                  Done
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-8">
              {/* Step 1: Customer */}
              {step === 1 && (
                <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold text-slate-900 flex items-center gap-2">
                      <User className="w-4 h-4 text-blue-600" />
                      Customer Information
                    </h4>
                    <button 
                      onClick={() => setIsNewCustomer(!isNewCustomer)}
                      className="text-xs font-bold text-blue-600 hover:underline flex items-center gap-1"
                    >
                      {isNewCustomer ? 'Select Existing' : 'Add New Customer'}
                    </button>
                  </div>

                  {isNewCustomer ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-6 bg-slate-50 rounded-2xl border border-slate-200">
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-slate-500 uppercase">Full Name</label>
                        <input 
                          className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                          value={newCustomer.name}
                          onChange={e => setNewCustomer({...newCustomer, name: e.target.value})}
                          placeholder="John Doe"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-slate-500 uppercase">Business Name (Optional)</label>
                        <input 
                          className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                          value={newCustomer.businessName}
                          onChange={e => setNewCustomer({...newCustomer, businessName: e.target.value})}
                          placeholder="Acme Scrap"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-slate-500 uppercase">Phone</label>
                        <input 
                          className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                          value={newCustomer.phone}
                          onChange={e => setNewCustomer({...newCustomer, phone: e.target.value})}
                          placeholder="(555) 000-0000"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-slate-500 uppercase">Address</label>
                        <input 
                          className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500"
                          value={newCustomer.address}
                          onChange={e => setNewCustomer({...newCustomer, address: e.target.value})}
                          placeholder="123 Main St"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                        <select 
                          className="w-full pl-10 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none transition-all appearance-none font-bold text-slate-900"
                          value={selectedCustomer?.id || ''}
                          onChange={(e) => setSelectedCustomer(customers.find(c => c.id === e.target.value) || null)}
                        >
                          <option value="">Select an existing customer...</option>
                          {customers.map(c => (
                            <option key={c.id} value={c.id}>{c.name} {c.businessName ? `(${c.businessName})` : ''}</option>
                          ))}
                        </select>
                        <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 pointer-events-none" />
                      </div>
                      {selectedCustomer && (
                        <div className="p-4 bg-blue-50 border border-blue-100 rounded-xl flex items-center gap-4">
                          <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center text-blue-600 shadow-sm">
                            <User className="w-6 h-6" />
                          </div>
                          <div>
                            <p className="font-bold text-blue-900">{selectedCustomer.name}</p>
                            <p className="text-xs text-blue-600">{selectedCustomer.phone || 'No phone'} • {selectedCustomer.address || 'No address'}</p>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Step 2: Materials */}
              {step === 2 && (
                <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                  <div className="flex items-center justify-between">
                    <h4 className="font-bold text-slate-900 flex items-center gap-2">
                      <Package className="w-4 h-4 text-blue-600" />
                      Materials & Granular Weights
                    </h4>
                    <button 
                      onClick={addItem}
                      className="px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg text-xs font-bold hover:bg-blue-100 transition-colors flex items-center gap-1"
                    >
                      <Plus className="w-3 h-3" /> Add Item
                    </button>
                  </div>

                  {idCheckResult?.prohibited ? (
                    <div className="p-4 bg-red-50 border border-red-100 rounded-xl flex gap-3 items-start animate-pulse">
                      <ShieldAlert className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-bold text-red-900 uppercase tracking-tight">Security Alert: Prohibited Seller</p>
                        <p className="text-xs text-red-700 mt-1">Reason: {idCheckResult.reason}</p>
                      </div>
                    </div>
                  ) : idCheckResult?.prohibited === false && (
                    <div className="p-3 bg-green-50 border border-green-100 rounded-xl flex gap-3 items-center">
                      <ShieldCheck className="w-4 h-4 text-green-600 shrink-0" />
                      <p className="text-[10px] font-bold text-green-800 uppercase tracking-wider">Security Check Passed: Seller is clear</p>
                    </div>
                  )}

                  <div className="space-y-4">
                    {items.map((item, index) => (
                      <div key={item.id} className="p-6 bg-slate-50 rounded-2xl border border-slate-200 space-y-6 relative group">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Item #{index + 1}</span>
                        {items.length > 1 && (
                          <button 
                            onClick={() => removeItem(item.id)}
                            className="w-10 h-10 bg-red-50 text-red-500 rounded-full flex items-center justify-center hover:bg-red-100 transition-colors active:scale-90"
                            aria-label={`Remove item ${index + 1}`}
                          >
                            <X className="w-5 h-5" />
                          </button>
                        )}
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          {/* Material Selection */}
                          <div className="space-y-1 relative">
                            <label className="text-[10px] font-bold text-slate-500 uppercase">Material</label>
                            <div className="relative">
                              <input
                                type="text"
                                autoFocus={index > 0 && index === items.length - 1}
                                className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all text-sm font-bold shadow-sm placeholder:text-slate-400 placeholder:font-normal"
                                placeholder="Type code or name..."
                                value={item.material ? `${item.material.code} - ${item.material.name}` : (item.materialSearch || '')}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  if (item.material && !val.includes(item.material.code)) {
                                    updateItem(item.id, { material: null, materialSearch: val, isDropdownOpen: true });
                                  } else {
                                    updateItem(item.id, { materialSearch: val, isDropdownOpen: true });
                                  }
                                }}
                                onFocus={() => updateItem(item.id, { isDropdownOpen: true })}
                                onKeyDown={(e) => {
                                  if (e.key === 'Tab' || e.key === 'Enter') {
                                    const search = (item.materialSearch || '').toLowerCase();
                                    const filtered = materials.filter(m => 
                                      m.name.toLowerCase().includes(search) || 
                                      m.code.toLowerCase().includes(search)
                                    ).sort((a, b) => {
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
                                    });
                                    
                                    if (filtered.length > 0) {
                                      const m = filtered[0];
                                      updateItem(item.id, { 
                                        material: m, 
                                        isDropdownOpen: false,
                                        materialSearch: '',
                                        pricePerUnit: m.buyPrice
                                      });
                                      if (e.key === 'Enter') e.preventDefault();
                                    }
                                  }
                                  if (e.key === 'Escape') {
                                    updateItem(item.id, { isDropdownOpen: false });
                                  }
                                }}
                              />
                              <ChevronDown className={cn("absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 transition-transform pointer-events-none", item.isDropdownOpen && "rotate-180")} />

                              {item.isDropdownOpen && (item.materialSearch || '').length > 0 && (
                                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-[110] overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                                  <div className="max-h-48 overflow-y-auto custom-scrollbar">
                                    {materials
                                      .filter(m => {
                                        const search = (item.materialSearch || '').toLowerCase();
                                        return m.name.toLowerCase().includes(search) || m.code.toLowerCase().includes(search);
                                      })
                                      .sort((a, b) => {
                                        const search = (item.materialSearch || '').toLowerCase();
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
                                      .map(m => (
                                        <button
                                          key={m.id}
                                          onMouseDown={(e) => {
                                            e.preventDefault();
                                            updateItem(item.id, { material: m, isDropdownOpen: false, materialSearch: '', pricePerUnit: m.buyPrice });
                                          }}
                                          className="w-full px-4 py-2 text-left text-xs hover:bg-blue-50 transition-colors flex items-center justify-between group"
                                        >
                                          <div>
                                            <span className="font-bold text-slate-900">{m.code}</span>
                                            <span className="mx-2 text-slate-300">|</span>
                                            <span className="text-slate-600">{m.name}</span>
                                          </div>
                                          <span className="text-[10px] font-bold text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity">
                                            ${m.buyPrice.toFixed(2)}
                                          </span>
                                        </button>
                                      ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="space-y-1.5">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Gross (lb)</label>
                            <input 
                              type="number"
                              className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-black shadow-sm"
                              value={item.grossWeight || ''}
                              onChange={e => updateItem(item.id, { grossWeight: Number(e.target.value) })}
                              placeholder="0"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                          <div className="space-y-1.5">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Tare (lb)</label>
                            <input 
                              type="number"
                              className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-black shadow-sm"
                              value={item.tareWeight || ''}
                              onChange={e => updateItem(item.id, { tareWeight: Number(e.target.value) })}
                              placeholder="0"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-[10px] font-black text-red-400 uppercase tracking-widest">Deduction (lb)</label>
                            <input 
                              type="number"
                              className="w-full px-4 py-3 bg-red-50 border border-red-100 rounded-xl outline-none focus:ring-2 focus:ring-red-500 font-black text-red-600 shadow-sm"
                              value={item.deductionWeight || ''}
                              onChange={e => updateItem(item.id, { deductionWeight: Number(e.target.value) })}
                              placeholder="0"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] font-bold text-slate-500 uppercase">Price per lb</label>
                            <div className="relative">
                              <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                              <input 
                                type="number"
                                step="0.01"
                                className="w-full pl-9 pr-4 py-3 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-bold disabled:bg-slate-50 disabled:text-slate-400"
                                value={item.pricePerUnit || ''}
                                onChange={e => updateItem(item.id, { pricePerUnit: Number(e.target.value) })}
                                readOnly={!profile?.permissions?.canManagePrices}
                                disabled={!profile?.permissions?.canManagePrices}
                              />
                            </div>
                          </div>
                        </div>

                        {/* Granular: Deduction Reason & Item Notes */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="space-y-1">
                            <label className="text-[10px] font-bold text-slate-500 uppercase">Deduction Reason</label>
                            <input 
                              className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-xs"
                              value={item.deductionReason || ''}
                              onChange={e => updateItem(item.id, { deductionReason: e.target.value })}
                              placeholder="Dirt, moisture, etc."
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] font-bold text-slate-500 uppercase">Item Notes</label>
                            <input 
                              className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-xs"
                              value={item.notes || ''}
                              onChange={e => updateItem(item.id, { notes: e.target.value })}
                              placeholder="Specific details about this item..."
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && index === items.length - 1) {
                                  e.preventDefault();
                                  addItem();
                                }
                              }}
                            />
                          </div>
                        </div>

                        <div className="pt-4 border-t border-slate-200 flex justify-between items-center">
                          <div className="flex items-center gap-3">
                            <div className="flex items-center gap-2">
                              <ScaleCaptureButton 
                                onCapture={(weight, photoUrl) => updateItem(item.id, { grossWeight: weight, photoUrl })} 
                              />
                              {item.photoUrl && (
                                <div className="w-8 h-8 rounded-lg border border-slate-200 overflow-hidden shadow-sm hover:scale-[3] transition-transform cursor-zoom-in z-20 bg-white origin-left">
                                  <img 
                                    src={item.photoUrl} 
                                    alt="Material" 
                                    className="w-full h-full object-cover"
                                    referrerPolicy="no-referrer"
                                    onError={handleImageError}
                                  />
                                </div>
                              )}
                            </div>
                            <span className="text-xs font-medium text-slate-500 uppercase border-l border-slate-200 pl-3">Net: <span className="text-slate-900 font-bold">{item.netWeight} lb</span></span>
                          </div>
                          <span className="text-sm font-black text-blue-600">${item.totalAmount.toFixed(2)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Step 3: Ticket Details */}
              {step === 3 && (
                <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-300">
                  <h4 className="font-bold text-slate-900 flex items-center gap-2">
                    <Truck className="w-4 h-4 text-blue-600" />
                    Additional Ticket Details
                  </h4>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <div className="space-y-4">
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-slate-500 uppercase">Vehicle Plate</label>
                        <div className="relative">
                          <Truck className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                          <input 
                            className="w-full pl-9 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-bold uppercase"
                            value={ticketDetails.vehiclePlate}
                            onChange={e => setTicketDetails({...ticketDetails, vehiclePlate: e.target.value})}
                            placeholder="ABC-1234"
                          />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-slate-500 uppercase">Vehicle Type</label>
                        <input 
                          className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
                          value={ticketDetails.vehicleType}
                          onChange={e => setTicketDetails({...ticketDetails, vehicleType: e.target.value})}
                          placeholder="F-150, Silverado, etc."
                        />
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-slate-500 uppercase">Payment Method</label>
                        <div className="grid grid-cols-3 gap-2">
                          {(['cash', 'check', 'other'] as const).map(method => (
                            <button
                              key={method}
                              onClick={() => setTicketDetails({...ticketDetails, paymentMethod: method})}
                              className={cn(
                                "py-3 rounded-xl border text-xs font-bold capitalize transition-all",
                                ticketDetails.paymentMethod === method 
                                  ? "bg-blue-600 border-blue-600 text-white shadow-md" 
                                  : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                              )}
                            >
                              {method}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-slate-500 uppercase">Ticket Notes</label>
                        <textarea 
                          className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-sm h-24 resize-none"
                          value={ticketDetails.notes}
                          onChange={e => setTicketDetails({...ticketDetails, notes: e.target.value})}
                          placeholder="General notes for this transaction..."
                        />
                      </div>
                    </div>
                  </div>

                  {showVehicleConfirm && (
                    <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl flex gap-3 items-center animate-in zoom-in-95 duration-200">
                      <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
                      <div className="flex-1">
                        <p className="text-sm font-bold text-amber-900">Missing Transportation Details</p>
                        <p className="text-xs text-amber-700">Vehicle information is recommended for compliance. Are you sure you want to proceed without it?</p>
                      </div>
                      <button 
                        onClick={() => {
                          setShowVehicleConfirm(false);
                          setStep(4);
                        }}
                        className="px-4 py-2 bg-amber-600 text-white text-xs font-bold rounded-lg hover:bg-amber-700 transition-colors"
                      >
                        Yes, Proceed
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Step 4: Final Review */}
              {step === 4 && (
                <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-bold text-slate-900 flex items-center gap-2">
                      <FileText className="w-4 h-4 text-blue-600" />
                      Final Review
                    </h4>
                    <button
                      onClick={handlePrintPreview}
                      className="text-xs font-bold text-slate-600 hover:text-slate-900 flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 rounded-lg transition-colors"
                    >
                      <Printer className="w-3.5 h-3.5" />
                      Preview Ticket
                    </button>
                  </div>

                  <div className="p-6 bg-blue-600 rounded-3xl text-white shadow-xl shadow-blue-200 flex items-center justify-between">
                    <div>
                      <p className="text-blue-100 text-xs font-bold uppercase tracking-widest">Total Payout</p>
                      <h3 className="text-4xl font-black">${totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</h3>
                    </div>
                    <div className="text-right">
                      <p className="text-blue-100 text-xs font-bold uppercase tracking-widest">Total Weight</p>
                      <h3 className="text-2xl font-bold">{totalWeight.toLocaleString()} lb</h3>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <div className="space-y-4">
                      <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200">
                        <h5 className="text-[10px] font-bold text-slate-400 uppercase mb-2">Customer</h5>
                        <p className="font-bold text-slate-900">{selectedCustomer?.name || newCustomer.name}</p>
                        <p className="text-xs text-slate-500">{selectedCustomer?.phone || newCustomer.phone || 'No phone'}</p>
                      </div>
                      <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 relative overflow-hidden">
                        {(!ticketDetails.vehiclePlate && !ticketDetails.vehicleType) && (
                          <div className="absolute top-0 right-0 p-1 bg-amber-500 text-white rounded-bl-lg">
                            <AlertTriangle className="w-3 h-3" />
                          </div>
                        )}
                        <h5 className="text-[10px] font-bold text-slate-400 uppercase mb-2">Logistics</h5>
                        <div className="flex justify-between text-xs">
                          <span className="text-slate-500">Vehicle:</span>
                          <span className={cn("font-bold", !ticketDetails.vehiclePlate && !ticketDetails.vehicleType ? "text-amber-600 italic" : "text-slate-900")}>
                            {ticketDetails.vehiclePlate || ticketDetails.vehicleType ? `${ticketDetails.vehiclePlate || ''} ${ticketDetails.vehicleType ? `(${ticketDetails.vehicleType})` : ''}` : 'Not Entered'}
                          </span>
                        </div>
                        <div className="flex justify-between text-xs mt-1">
                          <span className="text-slate-500">Payment:</span>
                          <span className="font-bold text-slate-900 capitalize">{ticketDetails.paymentMethod}</span>
                        </div>
                      </div>
                    </div>

                    <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 h-full">
                      <h5 className="text-[10px] font-bold text-slate-400 uppercase mb-2">Customer Photo (Required)</h5>
                      <CameraCapture 
                        label="Take Customer Photo"
                        onCapture={(url) => setTicketDetails({ ...ticketDetails, customerPhotoUrl: url })}
                        className="h-full"
                      />
                    </div>
                  </div>

                  <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200">
                    <h5 className="text-[10px] font-bold text-slate-400 uppercase mb-2">Digital Signature</h5>
                    <SignaturePad 
                      onCapture={(url) => setTicketDetails({ ...ticketDetails, signatureUrl: url })}
                      onClear={() => setTicketDetails({ ...ticketDetails, signatureUrl: '' })}
                      className="min-h-[160px]"
                    />
                  </div>

                  <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200">
                    <h5 className="text-[10px] font-bold text-slate-400 uppercase mb-2">Items Summary</h5>
                    <div className="space-y-2 max-h-32 overflow-y-auto custom-scrollbar">
                      {items.map(item => (
                        <div key={item.id} className="flex justify-between text-xs border-b border-slate-100 pb-1">
                          <span className="text-slate-600">{item.material?.name}</span>
                          <span className="font-bold text-slate-900">{item.netWeight} lb @ ${item.pricePerUnit.toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {!success && (
          <div className="p-6 bg-slate-50 border-t border-slate-100 flex items-center justify-between shrink-0">
            <button
              onClick={handleBack}
              disabled={step === 1 || processing}
              className="px-6 py-3 text-slate-600 font-bold hover:bg-slate-200 rounded-xl transition-all disabled:opacity-0"
            >
              Back
            </button>
            <div className="flex gap-3">
              {step < 4 ? (
                <button
                  onClick={handleNext}
                  disabled={
                    (step === 1 && !selectedCustomer && (!isNewCustomer || !newCustomer.name)) ||
                    (step === 2 && items.some(i => !i.material || i.netWeight <= 0))
                  }
                  className="px-8 py-3 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800 transition-all shadow-lg shadow-slate-200 flex items-center gap-2 disabled:opacity-50"
                >
                  Continue <ChevronRight className="w-4 h-4" />
                </button>
              ) : (
                <button
                  onClick={handleSubmit}
                  disabled={processing}
                  className="px-10 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-200 flex items-center gap-2 disabled:opacity-50"
                >
                  {processing ? <Loader2 className="w-5 h-5 animate-spin" /> : <><DollarSign className="w-5 h-5" /> Complete Ticket</>}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <ManagerPinModal 
        isOpen={showPinModal}
        onClose={() => setShowPinModal(false)}
        onSuccess={() => saveTicket()}
      />

      {/* Print Preview Modal */}
      {showPrintPreview && lastCreatedTicket && (
        <div className="fixed inset-0 bg-slate-900/80 z-[200] flex items-center justify-center p-4 backdrop-blur-md animate-in fade-in duration-300">
          <div className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl flex flex-col max-h-[95vh]">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <h3 className="font-bold text-slate-900">{isPreviewOnly ? 'Ticket Preview' : 'Print Preview'}</h3>
              <button 
                onClick={() => {
                  setShowPrintPreview(false);
                  if (isPreviewOnly) {
                    setIsPreviewOnly(false);
                    if (!success) setLastCreatedTicket(null);
                  }
                }}
                className="p-2 hover:bg-slate-200 rounded-full transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-8 overflow-y-auto flex-1 bg-slate-50">
              {isPreviewOnly && (
                <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-xl text-center">
                  <p className="text-[10px] font-bold text-amber-800 uppercase tracking-widest">Draft Preview Only - Not Saved</p>
                </div>
              )}
              <div className="bg-white p-8 shadow-sm border border-slate-200 rounded-xl print-ticket mx-auto w-full max-w-sm md:max-w-none relative">
                {isPreviewOnly && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-[0.03] rotate-[-35deg]">
                    <span className="text-6xl font-black uppercase">Preview</span>
                  </div>
                )}
                <div className="text-center border-b border-slate-100 pb-4 mb-6">
                  <div className="flex justify-center mb-3">
                    <BrandLogo className="h-10 w-auto object-contain grayscale" grayscale />
                  </div>
                  <h1 className="text-xl font-black uppercase tracking-tight">{COMPANY_NAME}</h1>
                  <p className="text-[10px] text-slate-500 font-bold">{COMPANY_ADDRESS}</p>
                  <p className="text-[10px] text-slate-500">{COMPANY_PHONE}</p>
                  <div className="mt-2 pt-2 border-t border-slate-50">
                    <p className="text-[10px] text-slate-500 mt-1 uppercase font-bold tracking-widest">Official Buy Ticket</p>
                    <p className="text-[10px] text-slate-400 mt-1">{new Date(lastCreatedTicket.timestamp).toLocaleString()}</p>
                  </div>
                </div>
                
                <div className="space-y-3">
                  <div className="flex justify-between gap-4">
                    <span className="text-slate-500 uppercase text-[10px] font-bold">Customer</span>
                    <span className="text-right font-bold">{getCustomerName(lastCreatedTicket.customerId)}</span>
                  </div>

                  {(lastCreatedTicket.vehiclePlate || lastCreatedTicket.vehicleType) && (
                    <div className="flex justify-between gap-4">
                      <span className="text-slate-500 uppercase text-[10px] font-bold">Vehicle</span>
                      <span className="text-right font-bold">{lastCreatedTicket.vehiclePlate} {lastCreatedTicket.vehicleType ? `(${lastCreatedTicket.vehicleType})` : ''}</span>
                    </div>
                  )}

                  <div className="flex justify-between gap-4">
                    <span className="text-slate-500 uppercase text-[10px] font-bold">Payment</span>
                    <span className="text-right font-bold capitalize">{lastCreatedTicket.paymentMethod || 'Cash'}</span>
                  </div>
                  
                  <div className="border-t border-slate-100 pt-3 space-y-2">
                    <p className="text-[10px] font-bold text-slate-400 uppercase">Items</p>
                    {(lastCreatedTicket.materials || []).map((item, idx) => {
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
                            <span>{(item.netWeight - (item.deductionWeight || 0))} lb</span>
                            <span>@ ${item.pricePerUnit.toFixed(2)}/lb</span>
                          </div>
                          {item.notes && (
                            <p className="text-[9px] text-slate-400 italic pl-5">Note: {item.notes}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex justify-between gap-4 text-base border-t border-slate-900 pt-3 mt-4">
                    <span className="font-black uppercase">Total Weight</span>
                    <span className="font-black">
                      {(lastCreatedTicket.materials || []).reduce((sum, m) => sum + (m.netWeight - (m.deductionWeight || 0)), 0)} lb
                    </span>
                  </div>
                </div>
                
                <div className="mt-8 pt-6 border-t border-slate-200 space-y-4">
                  <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                    <p className="text-[8px] leading-tight text-slate-500 text-center italic">
                      I, the undersigned, certify that I am the sole owner of the material described on this ticket and have the full legal right to sell it.
                    </p>
                  </div>
                  <div className="pt-2 border-slate-300 w-full flex flex-col items-center">
                    {lastCreatedTicket.signatureUrl ? (
                      <img src={lastCreatedTicket.signatureUrl} alt="Signature" className="h-16 object-contain" />
                    ) : (
                      <div className="pt-8 border-b border-slate-300 w-full"></div>
                    )}
                  </div>
                  <p className="text-[9px] font-bold text-slate-400 uppercase text-center">Seller Signature</p>
                </div>
                
                <div className="mt-8 text-center">
                  <p className="text-[10px] font-bold text-slate-900">TICKET ID: {lastCreatedTicket.id.toUpperCase()}</p>
                </div>
              </div>
            </div>
            
            <div className="p-4 bg-white border-t border-slate-100 flex gap-3">
              <button 
                onClick={() => setShowPrintPreview(false)}
                className="flex-1 py-3 border border-slate-200 rounded-xl font-bold text-slate-600 hover:bg-slate-50 transition-all"
              >
                Cancel
              </button>
              <button 
                onClick={() => {
                  if (!settings.debugPrintMode) window.print();
                  if (!settings.debugPrintMode) {
                    setShowPrintPreview(false);
                    if (!isPreviewOnly) {
                      onClose();
                      reset();
                    }
                  } else {
                    console.log('DEBUG PRINT: window.print() and reset bypassed.');
                  }
                }}
                className="flex-1 py-3 bg-slate-900 text-white rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-slate-800 transition-all shadow-lg shadow-slate-200"
              >
                <Printer className="w-5 h-5" />
                Print Now
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Print Styles */}
      <style>{`
        @media print {
          @page {
            size: letter;
            margin: 0.5in;
          }
          body * { visibility: hidden; }
          .print-ticket, .print-ticket * { visibility: visible; }
          .print-ticket { 
            position: absolute; 
            left: 0; 
            top: 0; 
            right: 0;
            width: 100% !important; 
            height: auto !important;
            max-height: 10.5in;
            padding: 0;
            box-shadow: none !important;
            border: none !important;
            margin: 0 !important;
          }
          .no-print { display: none !important; }
          
          /* Force single page */
          html, body {
            height: 100%;
            overflow: hidden;
          }
        }
      `}</style>
    </div>
  );
}
