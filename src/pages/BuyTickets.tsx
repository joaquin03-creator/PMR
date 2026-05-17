import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { db } from '../firebase';
import { collection, onSnapshot, addDoc, doc, getDoc, updateDoc, increment, setDoc, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import { Material, Customer, BuyTicket, BuyTicketMaterial, InventoryItem, UserProfile, DoNotBuyEntry } from '../types';
import { COMPANY_NAME, handleImageError } from '../constants';
import { BrandLogo } from '../components/BrandLogo';
import { 
  Search, 
  Scale, 
  User, 
  DollarSign, 
  CheckCircle2, 
  Loader2, 
  AlertCircle, 
  Package, 
  ShieldCheck, 
  Plus, 
  X, 
  ChevronRight, 
  ChevronLeft, 
  Truck, 
  CreditCard, 
  FileText,
  ShieldAlert,
  ChevronDown,
  Printer,
  RotateCcw,
  AlertTriangle,
  ArrowRightLeft
} from 'lucide-react';
import { cn } from '../lib/utils';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';
import { logAuditEvent } from '../lib/audit';
import ManagerPinModal from '../components/ManagerPinModal';
import { ScaleCaptureButton } from '../components/ScaleCaptureButton';
import { CameraCapture } from '../components/CameraCapture';
import SignaturePad from '../components/SignaturePad';
import { useIDScanner } from '../hooks/useIDScanner';
import { useSettings } from '../context/SettingsContext';
import { Scan } from 'lucide-react';

interface BuyTicketsProps {
  profile: UserProfile | null;
}

export default function BuyTickets({ profile }: BuyTicketsProps) {
  const [step, setStep] = useState(1);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [doNotBuyList, setDoNotBuyList] = useState<DoNotBuyEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // Ticket State
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [newCustomer, setNewCustomer] = useState({ 
    name: '', 
    phone: '', 
    address: '', 
    businessName: '',
    idType: '',
    idNumber: '',
    idExpiration: ''
  });
  const [isNewCustomer, setIsNewCustomer] = useState(false);
  
  const [items, setItems] = useState<(BuyTicketMaterial & { id: string, material: Material | null, materialSearch?: string, isDropdownOpen?: boolean })[]>([
    { id: Math.random().toString(36).substr(2, 9), materialId: '', material: null, grossWeight: 0, tareWeight: 0, netWeight: 0, pricePerUnit: 0, totalAmount: 0, materialSearch: '', isDropdownOpen: false, photoUrl: '' }
  ]);

  const [ticketDetails, setTicketDetails] = useState({
    vehiclePlate: '',
    vehicleType: '',
    vehicleYear: '',
    vehicleMake: '',
    vehicleModel: '',
    paymentMethod: 'cash' as 'cash' | 'check' | 'eft' | 'other',
    notes: '',
    customerPhotoUrl: '',
    idImageUrl: '',
    vehiclePhotoUrl: '',
    signatureUrl: '',
    sellerAffirmed: false
  });

  const { settings } = useSettings();
  const { scan, isScanning } = useIDScanner();

  const handleIDScan = async () => {
    const result = await scan();
    if (result.success) {
      if (isNewCustomer) {
        setNewCustomer(prev => ({
          ...prev,
          name: result.name || prev.name,
          address: result.address || prev.address,
          idType: result.idType || prev.idType,
          idNumber: result.idNumber || prev.idNumber,
          idExpiration: result.idExpiration || prev.idExpiration
        }));
      } else {
        const existing = customers.find(c => c.idNumber === result.idNumber);
        if (existing) {
          setSelectedCustomer(existing);
        } else {
          setIsNewCustomer(true);
          setNewCustomer(prev => ({
            ...prev,
            name: result.name || prev.name,
            address: result.address || prev.address,
            idType: result.idType || prev.idType,
            idNumber: result.idNumber || prev.idNumber,
            idExpiration: result.idExpiration || prev.idExpiration
          }));
        }
      }
      
      if (result.photoUrl) {
        setTicketDetails(prev => ({ ...prev, idImageUrl: result.photoUrl || prev.idImageUrl }));
      }
    }
  };

  const [processing, setProcessing] = useState(false);
  const [success, setSuccess] = useState(false);
  const [lastCreatedTicket, setLastCreatedTicket] = useState<BuyTicket | null>(null);
  const [showPrintPreview, setShowPrintPreview] = useState(false);
  const [isPreviewOnly, setIsPreviewOnly] = useState(false);
  const [idCheckResult, setIdCheckResult] = useState<{ prohibited: boolean, reason?: string } | null>(null);
  const [showPinModal, setShowPinModal] = useState(false);
  const [showVehicleConfirm, setShowVehicleConfirm] = useState(false);

  // Auto-print effect
  useEffect(() => {
    if (success && settings.autoPrint) {
      setShowPrintPreview(true);
      const timer = setTimeout(() => {
        if (!settings.debugPrintMode) window.print();
        // Automatically reset after auto-print starts
        setTimeout(() => {
          if (!settings.debugPrintMode) {
            setShowPrintPreview(false);
            reset();
          }
        }, 500);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [success, settings.autoPrint]);

  const totalAmount = items.reduce((sum, i) => sum + i.totalAmount, 0);
  const totalWeight = items.reduce((sum, i) => sum + i.netWeight, 0);

  useEffect(() => {
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
  }, []);

  // Recall last vehicle for customer
  useEffect(() => {
    if (selectedCustomer) {
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
  }, [selectedCustomer]);

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
        if (updates.material) {
          updated.materialId = updates.material.id;
          updated.pricePerUnit = updates.material.buyPrice;
        }
        return calculateItem(updated);
      }
      return i;
    }));
  };

  const handleNext = () => {
    if (step === 1) {
      if (!selectedCustomer && (!isNewCustomer || !newCustomer.name)) return;
      const nameToCheck = selectedCustomer?.name || newCustomer.name;
      const match = doNotBuyList.find(entry => entry.name.toLowerCase() === nameToCheck.toLowerCase());
      
      if (match) {
        setIdCheckResult({ prohibited: true, reason: match.reason });
        return; // Block proceeding if prohibited
      }
      
      setIdCheckResult({ prohibited: false });
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

  const handleSubmit = async () => {
    const hasOverrides = items.some(item => item.pricePerUnit !== item.material?.buyPrice);
    if (hasOverrides && profile?.role === 'cashier') {
      setShowPinModal(true);
      return;
    }
    await saveTicket();
  };

  const saveTicket = async () => {
    setProcessing(true);
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
        vehicleYear: ticketDetails.vehicleYear || '',
        vehicleMake: ticketDetails.vehicleMake || '',
        vehicleModel: ticketDetails.vehicleModel || '',
        paymentMethod: ticketDetails.paymentMethod || 'cash',
        notes: ticketDetails.notes || '',
        customerPhotoUrl: ticketDetails.customerPhotoUrl || '',
        idImageUrl: ticketDetails.idImageUrl || '',
        vehiclePhotoUrl: ticketDetails.vehiclePhotoUrl || '',
        signatureUrl: ticketDetails.signatureUrl || '',
        sellerAffirmed: ticketDetails.sellerAffirmed
      };

      const docRef = await addDoc(collection(db, 'buyTickets'), ticketData);
      
      // Log ticket creation
      await logAuditEvent(
        'buyTicket',
        docRef.id,
        'create',
        { after: ticketData },
        `Buy Ticket created for ${selectedCustomer?.name || 'Customer'}`
      );
      
      // Update customer photo if one was taken
      if (ticketDetails.customerPhotoUrl) {
        await updateDoc(doc(db, 'customers', customerId), {
          photoUrl: ticketDetails.customerPhotoUrl
        });
      }
      setLastCreatedTicket({ id: docRef.id, ...ticketData });

      for (const item of ticketMaterials) {
        const invRef = doc(db, 'inventory', item.materialId);
        const invDoc = await getDoc(invRef);
        if (invDoc.exists()) {
          const oldWeight = invDoc.data().currentWeight;
          await updateDoc(invRef, {
            currentWeight: increment(item.netWeight),
            lastUpdated: new Date().toISOString()
          });

          // Log inventory update
          await logAuditEvent(
            'inventory',
            item.materialId,
            'update',
            { 
              before: { weight: oldWeight },
              after: { weight: oldWeight + item.netWeight }
            },
            `Inventory updated via Buy Ticket ${docRef.id}`
          );
        } else {
          await setDoc(invRef, {
            materialId: item.materialId,
            currentWeight: item.netWeight,
            lastUpdated: new Date().toISOString()
          });

          // Log inventory creation
          await logAuditEvent(
            'inventory',
            item.materialId,
            'create',
            { after: { weight: item.netWeight } },
            `Initial inventory created via Buy Ticket ${docRef.id}`
          );
        }
      }

      setSuccess(true);
      setShowPrintPreview(true);
      
      // Print handling moved to useEffect for reliability
      
      // Don't reset immediately, let them print
    } catch (error) {
      console.error('Error creating ticket:', error);
      handleFirestoreError(error, OperationType.CREATE, 'buyTickets');
    } finally {
      setProcessing(false);
    }
  };

  const reset = () => {
    setStep(1);
    setSelectedCustomer(null);
    setNewCustomer({ name: '', phone: '', address: '', businessName: '', idType: '', idNumber: '', idExpiration: '' });
    setIsNewCustomer(false);
    setItems([{ id: Math.random().toString(36).substr(2, 9), materialId: '', material: null, grossWeight: 0, tareWeight: 0, netWeight: 0, pricePerUnit: 0, totalAmount: 0, materialSearch: '', isDropdownOpen: false, photoUrl: '' }]);
    setTicketDetails({ 
      vehiclePlate: '', 
      vehicleType: '', 
      vehicleYear: '',
      vehicleMake: '',
      vehicleModel: '',
      paymentMethod: 'cash', 
      notes: '', 
      customerPhotoUrl: '', 
      idImageUrl: '',
      vehiclePhotoUrl: '',
      signatureUrl: '',
      sellerAffirmed: false 
    });
    setSuccess(false);
    setLastCreatedTicket(null);
    setShowPrintPreview(false);
    setIdCheckResult(null);
  };

  const getCustomerName = (id: string) => {
    const customer = customers.find(c => c.id === id);
    return customer?.name || 'Unknown Customer';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <main className="max-w-5xl mx-auto space-y-8">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-6">
          <div className="w-20 h-10 flex items-center justify-center overflow-hidden shrink-0">
            <BrandLogo className="w-full h-full object-contain" />
          </div>
          <div>
            <h1 className="text-4xl font-black text-slate-900 tracking-tight font-display">Robust Buy Ticket</h1>
            <p className="text-slate-500 font-medium mt-1">Full-featured yard purchase process with granular controls.</p>
          </div>
        </div>
        <nav className="flex items-center gap-2 bg-slate-200/50 p-1.5 rounded-2xl" aria-label="Progress">
          {[1, 2, 3, 4].map(s => (
            <div 
              key={s}
              aria-current={step === s ? "step" : undefined}
              className={cn(
                "w-10 h-10 rounded-xl flex items-center justify-center text-sm font-black transition-all",
                step === s ? "bg-blue-600 text-white shadow-xl shadow-blue-200 scale-110" : "text-slate-400"
              )}
            >
              <span className="sr-only">Step </span>{s}
            </div>
          ))}
        </nav>
      </header>

      {success && (
        <div className="bg-green-50 border border-green-200 rounded-2xl p-6 flex items-center justify-between animate-in fade-in slide-in-from-top-4">
          <div className="flex items-center gap-4 text-green-800">
            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center text-green-600">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div>
              <p className="font-bold text-lg">Ticket Created Successfully!</p>
              <p className="text-sm opacity-80">Inventory has been updated and the transaction is recorded.</p>
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setShowPrintPreview(true)}
              className="px-6 py-3 bg-slate-900 text-white rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-slate-800 transition-all shadow-lg"
            >
              <Printer className="w-5 h-5" />
              Print Ticket
            </button>
            <button
              onClick={reset}
              className="px-6 py-3 border border-slate-200 text-slate-600 rounded-xl font-bold hover:bg-slate-50 transition-all"
            >
              New Ticket
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          {/* Step 1: Customer */}
          {step === 1 && (
            <section className="bg-white p-8 rounded-[2rem] border border-slate-200 shadow-sm space-y-8 animate-in fade-in slide-in-from-left-4" aria-labelledby="step1-title">
              <div className="flex items-center justify-between">
                <h3 id="step1-title" className="text-xl font-black text-slate-900 flex items-center gap-3 font-display uppercase tracking-tight">
                  <div className="p-2.5 bg-blue-50 rounded-2xl" aria-hidden="true">
                    <User className="w-6 h-6 text-blue-600" />
                  </div>
                  Customer Selection
                </h3>
                    <div className="flex gap-2">
                      {settings.scannerEnabled && (
                        <button 
                          onClick={handleIDScan}
                          disabled={isScanning}
                          className="px-4 py-2 bg-slate-900 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-800 transition-all active:scale-95 flex items-center gap-2 disabled:opacity-50"
                        >
                          {isScanning ? <Loader2 className="w-3 h-3 animate-spin" /> : <Scan className="w-3 h-3" />}
                          Scan ID (Gemalto)
                        </button>
                      )}
                      <button 
                        onClick={() => setIsNewCustomer(!isNewCustomer)}
                        className="px-5 py-2.5 bg-slate-100 text-slate-600 rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-slate-200 transition-all active:scale-95 outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                      >
                        {isNewCustomer ? 'Select Existing' : 'Add New Customer'}
                      </button>
                    </div>
              </div>

              {isNewCustomer ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label htmlFor="new-cust-name" className="text-xs font-black text-slate-400 uppercase tracking-widest">Full Name</label>
                    <input 
                      id="new-cust-name"
                      className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 font-bold"
                      value={newCustomer.name}
                      onChange={e => setNewCustomer({...newCustomer, name: e.target.value})}
                      placeholder="Enter full name..."
                    />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="new-cust-business" className="text-xs font-black text-slate-400 uppercase tracking-widest">Business Name</label>
                    <input 
                      id="new-cust-business"
                      className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 font-bold"
                      value={newCustomer.businessName}
                      onChange={e => setNewCustomer({...newCustomer, businessName: e.target.value})}
                      placeholder="Optional business name..."
                    />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="new-cust-phone" className="text-xs font-black text-slate-400 uppercase tracking-widest">Phone Number</label>
                    <input 
                      id="new-cust-phone"
                      className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 font-bold"
                      value={newCustomer.phone}
                      onChange={e => setNewCustomer({...newCustomer, phone: e.target.value})}
                      placeholder="(555) 000-0000"
                    />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="new-cust-address" className="text-xs font-black text-slate-400 uppercase tracking-widest">Address</label>
                    <input 
                      id="new-cust-address"
                      className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 font-bold"
                      value={newCustomer.address}
                      onChange={e => setNewCustomer({...newCustomer, address: e.target.value})}
                      placeholder="Street, City, Zip"
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="relative">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-6 h-6 text-slate-400" aria-hidden="true" />
                    <label htmlFor="customer-select" className="sr-only">Search existing customers</label>
                    <select 
                      id="customer-select"
                      className="w-full pl-12 pr-6 py-5 bg-slate-50 border border-slate-200 rounded-3xl focus:ring-2 focus:ring-blue-500 outline-none transition-all appearance-none font-bold text-lg text-slate-900"
                      value={selectedCustomer?.id || ''}
                      onChange={(e) => setSelectedCustomer(customers.find(c => c.id === e.target.value) || null)}
                    >
                      <option value="">Search existing customers...</option>
                      {customers.map(c => (
                        <option key={c.id} value={c.id}>{c.name} {c.businessName ? `(${c.businessName})` : ''}</option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-6 top-1/2 -translate-y-1/2 w-6 h-6 text-slate-400 pointer-events-none" aria-hidden="true" />
                  </div>
                  {selectedCustomer && (
                    <div className="p-6 bg-blue-50 border border-blue-100 rounded-3xl flex items-center gap-6 animate-in zoom-in-95">
                      <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center text-blue-600 shadow-sm" aria-hidden="true">
                        <User className="w-8 h-8" />
                      </div>
                      <div>
                        <p className="text-xl font-black text-blue-900">{selectedCustomer.name}</p>
                        <p className="text-sm text-blue-600 font-medium">{selectedCustomer.phone || 'No phone'} • {selectedCustomer.address || 'No address'}</p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ID Verification Section (ORC 4737.04 Requirement) */}
              <div className="pt-8 border-t border-slate-100 space-y-6">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <h4 className="text-sm font-black text-slate-900 uppercase tracking-widest flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-green-600" />
                      ID Verification
                    </h4>
                    <p className="text-xs text-slate-500 font-medium">Government-issued ID required for all transactions.</p>
                  </div>
                  {ticketDetails.idImageUrl && (
                    <span className="px-3 py-1 bg-green-100 text-green-700 text-[10px] font-black uppercase rounded-full border border-green-200">
                      ID Captured
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div className="p-6 bg-slate-50 rounded-3xl border border-slate-200 space-y-4">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">ID Document Photo</p>
                    <CameraCapture 
                      label="Capture ID"
                      onCapture={(url) => setTicketDetails({ ...ticketDetails, idImageUrl: url })}
                      networkUrl={settings.useSwannCams ? settings.swannCams.customer : undefined}
                      className="aspect-video"
                    />
                  </div>
                  <div className="flex flex-col justify-center space-y-4">
                    <div className="p-4 bg-blue-50 border border-blue-100 rounded-2xl">
                      <p className="text-xs text-blue-800 font-medium leading-relaxed">
                        <strong>Legal Notice:</strong> Ohio ORC 4737.04 requires a clear photograph of the seller's government-issued identification for every transaction.
                      </p>
                    </div>
                    {idCheckResult?.prohibited && (
                      <div className="p-4 bg-red-50 border border-red-100 rounded-2xl flex items-center gap-3 animate-pulse">
                        <ShieldAlert className="w-5 h-5 text-red-600" />
                        <p className="text-xs font-black text-red-700 uppercase">Seller is on Do-Not-Buy List</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* Step 2: Materials */}
          {step === 2 && (
            <section className="space-y-6 animate-in fade-in slide-in-from-left-4" aria-labelledby="step2-title">
              <div className="flex items-center justify-between">
                <h3 id="step2-title" className="text-xl font-black text-slate-900 flex items-center gap-3 font-display uppercase tracking-tight">
                  <div className="p-2.5 bg-blue-50 rounded-2xl" aria-hidden="true">
                    <Package className="w-6 h-6 text-blue-600" />
                  </div>
                  Materials & Weights
                </h3>
                <button 
                  onClick={addItem}
                  className="px-5 py-3 bg-blue-600 text-white rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-blue-700 transition-all flex items-center gap-2 shadow-xl shadow-blue-200 active:scale-95 outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                >
                  <Plus className="w-4 h-4" aria-hidden="true" /> Add Item
                </button>
              </div>

              {idCheckResult?.prohibited ? (
                <div className="p-6 bg-red-50 border border-red-100 rounded-3xl flex gap-4 items-start animate-pulse" role="alert">
                  <ShieldAlert className="w-6 h-6 text-red-600 shrink-0 mt-0.5" aria-hidden="true" />
                  <div>
                    <p className="text-lg font-black text-red-900 uppercase tracking-tight">Security Alert: Prohibited Seller</p>
                    <p className="text-sm text-red-700 mt-1 font-medium">Reason: {idCheckResult.reason}</p>
                  </div>
                </div>
              ) : idCheckResult?.prohibited === false && (
                <div className="p-4 bg-green-50 border border-green-100 rounded-2xl flex gap-3 items-center" role="status">
                  <ShieldCheck className="w-5 h-5 text-green-600 shrink-0" aria-hidden="true" />
                  <p className="text-xs font-bold text-green-800 uppercase tracking-wider">Security Check Passed: Seller is clear</p>
                </div>
              )}

              <div className="space-y-6">
                {items.map((item, index) => (
                  <article key={item.id} className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm space-y-8 relative group" aria-label={`Item ${index + 1}`}>
                    <div className="flex items-center justify-between">
                      <span className="px-3 py-1 bg-slate-100 rounded-full text-[10px] font-black text-slate-500 uppercase tracking-widest">Item #{index + 1}</span>
                      {items.length > 1 && (
                        <button 
                          onClick={() => removeItem(item.id)}
                          aria-label={`Remove item ${index + 1}`}
                          className="w-11 h-11 bg-red-50 text-red-500 rounded-full flex items-center justify-center hover:bg-red-100 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-red-500 active:scale-90"
                        >
                          <X className="w-5 h-5" aria-hidden="true" />
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
                      <div className="md:col-span-2 space-y-2 relative">
                        <label id={`label-material-${item.id}`} className="text-xs font-black text-slate-400 uppercase tracking-widest">Material</label>
                        <div className="relative">
                          <input
                            type="text"
                            autoFocus={index > 0 && index === items.length - 1}
                            aria-labelledby={`label-material-${item.id}`}
                            className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none transition-all text-lg font-bold shadow-sm placeholder:text-slate-400 placeholder:font-normal"
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

                                  // 1. Exact code match
                                  if (aCode === search && bCode !== search) return -1;
                                  if (bCode === search && aCode !== search) return 1;

                                  // 2. Code starts with search
                                  if (aCode.startsWith(search) && !bCode.startsWith(search)) return -1;
                                  if (bCode.startsWith(search) && !aCode.startsWith(search)) return 1;

                                  // 3. Name starts with search
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
                          <ChevronDown className={cn("absolute right-5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 transition-transform pointer-events-none", item.isDropdownOpen && "rotate-180")} aria-hidden="true" />

                          {item.isDropdownOpen && (item.materialSearch || '').length > 0 && (
                            <div 
                              className="absolute top-full left-0 right-0 mt-2 bg-white border border-slate-200 rounded-2xl shadow-2xl z-[110] overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200"
                              role="listbox"
                            >
                              <div className="max-h-64 overflow-y-auto custom-scrollbar">
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
                                      role="option"
                                      aria-selected={item.materialId === m.id}
                                      onMouseDown={(e) => {
                                        e.preventDefault();
                                        updateItem(item.id, { material: m, isDropdownOpen: false, materialSearch: '', pricePerUnit: m.buyPrice });
                                      }}
                                      className="w-full px-6 py-3 text-left hover:bg-blue-50 transition-colors flex items-center justify-between group outline-none focus:bg-blue-50"
                                    >
                                      <div>
                                        <p className="font-black text-slate-900">{m.code}</p>
                                        <p className="text-xs text-slate-500 font-medium">{m.name}</p>
                                      </div>
                                      <span className="text-sm font-black text-blue-600">
                                        ${m.buyPrice.toFixed(2)}
                                      </span>
                                    </button>
                                  ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label htmlFor={`gross-${item.id}`} className="text-xs font-black text-slate-400 uppercase tracking-widest">Gross Weight</label>
                        <input 
                          id={`gross-${item.id}`}
                          type="number"
                          className="w-full px-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 font-black text-xl shadow-sm"
                          value={item.grossWeight || ''}
                          onChange={e => updateItem(item.id, { grossWeight: Number(e.target.value) })}
                        />
                      </div>
                      <div className="space-y-2">
                        <label htmlFor={`tare-${item.id}`} className="text-xs font-black text-slate-400 uppercase tracking-widest">Tare Weight</label>
                        <input 
                          id={`tare-${item.id}`}
                          type="number"
                          className="w-full px-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 font-black text-xl shadow-sm"
                          value={item.tareWeight || ''}
                          onChange={e => updateItem(item.id, { tareWeight: Number(e.target.value) })}
                        />
                      </div>
                      <div className="space-y-2">
                        <label htmlFor={`deduction-${item.id}`} className="text-xs font-black text-red-400 uppercase tracking-widest">Deduction (lb)</label>
                        <input 
                          id={`deduction-${item.id}`}
                          type="number"
                          className="w-full px-6 py-4 bg-red-50 border border-red-100 rounded-2xl outline-none focus:ring-2 focus:ring-red-500 font-black text-xl text-red-600 shadow-sm"
                          value={item.deductionWeight || ''}
                          onChange={e => updateItem(item.id, { deductionWeight: Number(e.target.value) })}
                          placeholder="0"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                      <div className="space-y-2">
                        <label htmlFor={`price-${item.id}`} className="text-xs font-black text-slate-400 uppercase tracking-widest">Price per lb</label>
                        <div className="relative">
                          <DollarSign className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" aria-hidden="true" />
                          <input 
                            id={`price-${item.id}`}
                            type="number"
                            step="0.01"
                            className="w-full pl-12 pr-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 font-black text-lg"
                            value={item.pricePerUnit || ''}
                            onChange={e => updateItem(item.id, { pricePerUnit: Number(e.target.value) })}
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <label htmlFor={`deduction-reason-${item.id}`} className="text-xs font-black text-slate-400 uppercase tracking-widest">Deduction Reason</label>
                        <input 
                          id={`deduction-reason-${item.id}`}
                          className="w-full px-5 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-sm font-medium"
                          value={item.deductionReason || ''}
                          onChange={e => updateItem(item.id, { deductionReason: e.target.value })}
                          placeholder="Why is weight being deducted?"
                        />
                      </div>
                      <div className="space-y-2">
                        <label htmlFor={`notes-${item.id}`} className="text-xs font-black text-slate-400 uppercase tracking-widest">Item Notes</label>
                        <input 
                          id={`notes-${item.id}`}
                          className="w-full px-5 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-sm font-medium"
                          value={item.notes || ''}
                          onChange={e => updateItem(item.id, { notes: e.target.value })}
                          placeholder="Specific details for this item..."
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && index === items.length - 1) {
                              e.preventDefault();
                              addItem();
                            }
                          }}
                        />
                      </div>
                    </div>

                    <div className="pt-6 border-t border-slate-100 flex justify-between items-center bg-slate-50 -mx-8 -mb-8 px-8 py-6 rounded-b-3xl">
                      <div className="flex items-center gap-6">
                        <div className="flex items-center gap-3">
                          <ScaleCaptureButton 
                            onCapture={(weight, photoUrl) => updateItem(item.id, { grossWeight: weight, photoUrl })} 
                          />
                          {item.photoUrl && (
                            <div className="w-10 h-10 rounded-xl border border-slate-200 overflow-hidden shadow-sm hover:scale-[3] transition-transform cursor-zoom-in z-20 bg-white origin-left">
                              <img 
                                src={item.photoUrl} 
                                alt="Captured gross weight scale" 
                                className="w-full h-full object-cover"
                                referrerPolicy="no-referrer"
                                onError={handleImageError}
                              />
                            </div>
                          )}
                        </div>
                        <div className="border-l border-slate-200 pl-6">
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Net Weight</p>
                          <p className="text-xl font-black text-slate-900">{item.netWeight.toLocaleString()} lb</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest">Item Total</p>
                        <p className="text-3xl font-black text-blue-600">${item.totalAmount.toFixed(2)}</p>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}

          {/* Step 3: Ticket Details */}
          {step === 3 && (
            <section className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm space-y-8 animate-in fade-in slide-in-from-left-4" aria-labelledby="step3-title">
              <h3 id="step3-title" className="text-xl font-bold text-slate-900 flex items-center gap-3">
                <div className="p-2 bg-blue-50 rounded-lg" aria-hidden="true">
                  <Truck className="w-5 h-5 text-blue-600" />
                </div>
                Logistics & Payment
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="space-y-6">
                  <div className="space-y-2">
                    <label htmlFor="vehicle-plate" className="text-xs font-black text-slate-400 uppercase tracking-widest">Vehicle Plate</label>
                    <div className="relative">
                      <Truck className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" aria-hidden="true" />
                      <input 
                        id="vehicle-plate"
                        className="w-full pl-12 pr-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 font-black uppercase text-lg"
                        value={ticketDetails.vehiclePlate}
                        onChange={e => setTicketDetails({...ticketDetails, vehiclePlate: e.target.value})}
                        placeholder="PLATE-NO"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <label htmlFor="vehicle-year" className="text-xs font-black text-slate-400 uppercase tracking-widest">Year</label>
                      <input 
                        id="vehicle-year"
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-bold"
                        value={ticketDetails.vehicleYear}
                        onChange={e => setTicketDetails({...ticketDetails, vehicleYear: e.target.value})}
                        placeholder="2020"
                      />
                    </div>
                    <div className="space-y-2">
                      <label htmlFor="vehicle-make" className="text-xs font-black text-slate-400 uppercase tracking-widest">Make</label>
                      <input 
                        id="vehicle-make"
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-bold"
                        value={ticketDetails.vehicleMake}
                        onChange={e => setTicketDetails({...ticketDetails, vehicleMake: e.target.value})}
                        placeholder="Ford"
                      />
                    </div>
                    <div className="space-y-2">
                      <label htmlFor="vehicle-model" className="text-xs font-black text-slate-400 uppercase tracking-widest">Model</label>
                      <input 
                        id="vehicle-model"
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-bold"
                        value={ticketDetails.vehicleModel}
                        onChange={e => setTicketDetails({...ticketDetails, vehicleModel: e.target.value})}
                        placeholder="F-150"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="vehicle-type" className="text-xs font-black text-slate-400 uppercase tracking-widest">Descriptive Details</label>
                    <input 
                      id="vehicle-type"
                      className="w-full px-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 font-bold"
                      value={ticketDetails.vehicleType}
                      onChange={e => setTicketDetails({...ticketDetails, vehicleType: e.target.value})}
                      placeholder="e.g. White Pickup with stickers"
                    />
                  </div>
                  
                  <div className="space-y-4">
                    <div className="p-6 bg-slate-50 border border-slate-200 rounded-3xl space-y-4">
                      <div className="flex items-center justify-between">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Entrance/Vehicle Identity</p>
                        {ticketDetails.vehiclePhotoUrl && <CheckCircle2 className="w-4 h-4 text-green-500" />}
                      </div>
                      <CameraCapture 
                        label="Capture Entrance/Vehicle"
                        onCapture={(url) => setTicketDetails({ ...ticketDetails, vehiclePhotoUrl: url })}
                        networkUrl={settings.useSwannCams ? settings.swannCams.entrance : undefined}
                        className="aspect-video"
                      />
                      <p className="text-[10px] text-slate-400 italic">Optional but recommended for high-value loads.</p>
                    </div>

                    <div className="p-6 bg-blue-50 border border-blue-100 rounded-3xl">
                      <div className="flex items-start gap-3">
                        <ShieldCheck className="w-4 h-4 text-blue-600 mt-1" />
                        <div className="space-y-1">
                          <p className="text-xs font-black text-blue-900 uppercase">Compliance Reminder</p>
                          <p className="text-[10px] text-blue-700 font-medium leading-relaxed">
                            Ohio law requires documentation of the vehicle used for transporting scrap metal. 
                            Clear captures of the vehicle and license plate are mandatory for compliance auditing.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-6">
                  <fieldset className="space-y-2">
                    <div className="flex items-center justify-between">
                      <legend className="text-xs font-black text-slate-400 uppercase tracking-widest">Payment Method</legend>
                      {totalAmount >= 10 && (
                        <span className="text-[10px] font-black text-amber-600 uppercase tracking-widest flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" /> ORC 4737.04 Restricted
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-4 gap-3">
                      {(['cash', 'check', 'eft', 'other'] as const).map(method => {
                        const isRestricted = method === 'cash' && totalAmount >= 10;
                        return (
                          <button
                            key={method}
                            type="button"
                            aria-pressed={ticketDetails.paymentMethod === method}
                            onClick={() => setTicketDetails({...ticketDetails, paymentMethod: method})}
                            className={cn(
                              "py-4 rounded-2xl border text-[10px] font-black uppercase tracking-widest transition-all outline-none focus-visible:ring-2 focus-visible:ring-blue-500 flex flex-col items-center gap-2",
                              ticketDetails.paymentMethod === method 
                                ? "bg-blue-600 border-blue-600 text-white shadow-xl shadow-blue-200" 
                                : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50",
                              isRestricted && ticketDetails.paymentMethod !== method && "border-amber-200 bg-amber-50/30"
                            )}
                          >
                            {method === 'cash' && <DollarSign className="w-4 h-4" />}
                            {method === 'check' && <FileText className="w-4 h-4" />}
                            {method === 'eft' && <ArrowRightLeft className="w-4 h-4" />}
                            {method === 'other' && <CreditCard className="w-4 h-4" />}
                            {method}
                          </button>
                        );
                      })}
                    </div>
                    {totalAmount >= 10 && (
                      <p className="text-[10px] text-slate-500 font-medium italic mt-2">
                        * Transactions ≥ $10 must be paid by check or electronic transfer per Ohio law.
                      </p>
                    )}
                  </fieldset>
                  <div className="space-y-2">
                    <label htmlFor="ticket-notes" className="text-xs font-black text-slate-400 uppercase tracking-widest">Ticket Notes</label>
                    <textarea 
                      id="ticket-notes"
                      className="w-full px-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 text-sm font-medium h-32 resize-none"
                      value={ticketDetails.notes}
                      onChange={e => setTicketDetails({...ticketDetails, notes: e.target.value})}
                      placeholder="Any general notes for this ticket..."
                    />
                  </div>
                </div>
              </div>

              {showVehicleConfirm && (
                <div className="p-6 bg-amber-50 border border-amber-200 rounded-3xl flex gap-4 items-center animate-in zoom-in-95 duration-200" role="alert">
                  <div className="p-3 bg-amber-100 rounded-2xl" aria-hidden="true">
                    <AlertTriangle className="w-6 h-6 text-amber-600" />
                  </div>
                  <div className="flex-1">
                    <p className="text-base font-black text-amber-900">Missing Transportation Details</p>
                    <p className="text-sm text-amber-700 font-medium">Vehicle information is recommended for compliance. Are you sure you want to proceed without it?</p>
                  </div>
                  <button 
                    onClick={() => {
                      setShowVehicleConfirm(false);
                      setStep(4);
                    }}
                    className="px-6 py-3 bg-amber-600 text-white text-sm font-black rounded-xl hover:bg-amber-700 transition-all shadow-lg shadow-amber-200 outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
                  >
                    Yes, Proceed
                  </button>
                </div>
              )}
            </section>
          )}

          {/* Step 4: Review */}
          {step === 4 && (
            <section className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm space-y-8 animate-in fade-in slide-in-from-left-4" aria-labelledby="step4-title">
              <div className="flex items-center justify-between">
                <h3 id="step4-title" className="text-xl font-bold text-slate-900 flex items-center gap-3">
                  <div className="p-2 bg-blue-50 rounded-lg" aria-hidden="true">
                    <FileText className="w-5 h-5 text-blue-600" />
                  </div>
                  Final Review
                </h3>
                <button
                  onClick={handlePrintPreview}
                  className="px-4 py-2 bg-slate-100 text-slate-600 rounded-xl text-sm font-bold hover:bg-slate-200 transition-all flex items-center gap-2 outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                >
                  <Printer className="w-4 h-4" aria-hidden="true" /> Preview Ticket
                </button>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="p-6 bg-slate-50 rounded-3xl border border-slate-200 space-y-4">
                      <h5 className="text-xs font-black text-slate-400 uppercase tracking-widest">Customer Details</h5>
                      <div>
                        <p className="text-xl font-black text-slate-900">{selectedCustomer?.name || newCustomer.name}</p>
                        <p className="text-sm text-slate-500 font-medium">{selectedCustomer?.phone || newCustomer.phone || 'No phone'}</p>
                        <p className="text-sm text-slate-500 font-medium">{selectedCustomer?.address || newCustomer.address || 'No address'}</p>
                      </div>
                    </div>
                    <div className="p-6 bg-slate-50 rounded-3xl border border-slate-200 space-y-4 relative overflow-hidden">
                      {(!ticketDetails.vehiclePlate && !ticketDetails.vehicleType) && (
                        <div className="absolute top-0 right-0 p-1.5 bg-amber-500 text-white rounded-bl-xl">
                          <AlertTriangle className="w-4 h-4" />
                        </div>
                      )}
                      <h5 className="text-xs font-black text-slate-400 uppercase tracking-widest">Logistics</h5>
                      <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-500 font-medium">Vehicle:</span>
                          <span className={cn("font-black text-right", !ticketDetails.vehiclePlate && !ticketDetails.vehicleType ? "text-amber-600 italic text-xs leading-tight" : "text-slate-900")}>
                            {ticketDetails.vehiclePlate || ticketDetails.vehicleType ? `${ticketDetails.vehiclePlate || ''} ${ticketDetails.vehicleType ? `(${ticketDetails.vehicleType})` : ''}` : 'Not Entered'}
                          </span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-500 font-medium">Payment:</span>
                          <span className="font-black text-slate-900 capitalize">{ticketDetails.paymentMethod}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="p-6 bg-slate-50 rounded-[2rem] border border-slate-200 flex flex-col">
                      <h5 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4">Customer Photo</h5>
                      <div className="flex-1 min-h-[160px]">
                        <CameraCapture 
                          label="Take Customer Photo"
                          onCapture={(url) => setTicketDetails({ ...ticketDetails, customerPhotoUrl: url })}
                          networkUrl={settings.useSwannCams ? settings.swannCams.customer : undefined}
                          className="h-full"
                        />
                      </div>
                    </div>

                    <div className="p-6 bg-slate-50 rounded-[2rem] border border-slate-200 flex flex-col">
                      <h5 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4">Digitized Signature</h5>
                      <div className="flex-1">
                        <SignaturePad 
                          onCapture={(url) => setTicketDetails({ ...ticketDetails, signatureUrl: url })}
                          onClear={() => setTicketDetails({ ...ticketDetails, signatureUrl: '' })}
                          className="h-full"
                        />
                      </div>
                    </div>

                    <div className="p-6 bg-slate-50 rounded-[2rem] border border-slate-200 space-y-4">
                      <h5 className="text-xs font-black text-slate-400 uppercase tracking-widest">Compliance</h5>
                      <label className="flex items-start gap-3 p-4 bg-white rounded-2xl border border-slate-200 cursor-pointer hover:border-blue-500 transition-all group">
                        <input
                          type="checkbox"
                          className="mt-1 h-5 w-5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                          checked={ticketDetails.sellerAffirmed}
                          onChange={e => setTicketDetails({...ticketDetails, sellerAffirmed: e.target.checked})}
                        />
                        <div className="text-sm">
                          <span className="font-black text-slate-900 block group-hover:text-blue-600">ORC 4737.04 Affirmation</span>
                          <span className="text-[10px] text-slate-500 font-medium leading-tight block">I affirm I am the lawful owner (or authorized seller) of this scrap metal.</span>
                        </div>
                      </label>
                    </div>
                  </div>
                </div>

                <div className="p-6 bg-slate-50 rounded-3xl border border-slate-200 space-y-4">
                  <h5 className="text-xs font-black text-slate-400 uppercase tracking-widest">Items Summary</h5>
                  <div className="space-y-3 max-h-[400px] overflow-y-auto custom-scrollbar pr-2">
                    {items.map(item => (
                      <div key={item.id} className="flex justify-between items-start border-b border-slate-200 pb-3">
                        <div className="flex gap-3">
                          {item.photoUrl && (
                            <div className="w-12 h-12 rounded-lg border border-slate-200 overflow-hidden shrink-0">
                              <img src={item.photoUrl} alt="Item" className="w-full h-full object-cover" onError={handleImageError} />
                            </div>
                          )}
                          <div>
                            <p className="font-black text-slate-900 text-sm">{item.material?.name}</p>
                            <p className="text-[10px] text-slate-500 font-bold uppercase">{item.netWeight.toLocaleString()} lb @ ${item.pricePerUnit.toFixed(2)}</p>
                          </div>
                        </div>
                        <p className="font-black text-blue-600 text-sm whitespace-nowrap">${item.totalAmount.toFixed(2)}</p>
                      </div>
                    ))}
                  </div>
                  <div className="pt-4 border-t border-slate-200 flex justify-between items-center">
                    <p className="text-xs font-black text-slate-400 uppercase">Total Payout</p>
                    <p className="text-3xl font-black text-blue-600">${totalAmount.toFixed(2)}</p>
                  </div>
                </div>
              </div>
              </section>
            )}
        </div>

        {/* Sidebar Summary */}
        <div className="space-y-6">
          <div className="bg-slate-900 rounded-3xl p-8 text-white shadow-2xl shadow-slate-200 sticky top-8">
            <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-8">Ticket Summary</h4>
            
            <div className="space-y-8">
              <div className="space-y-1">
                <p className="text-slate-400 text-xs font-bold uppercase">Total Weight</p>
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-black">{totalWeight.toLocaleString()}</span>
                  <span className="text-slate-400 font-bold">lb</span>
                </div>
              </div>

              <div className="space-y-1">
                <p className="text-slate-400 text-xs font-bold uppercase">Total Payout</p>
                <div className="flex items-baseline gap-1">
                  <span className="text-slate-400 text-2xl font-bold">$</span>
                  <span className="text-5xl font-black text-blue-400">{totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                </div>
              </div>

              <div className="pt-8 border-t border-slate-800 space-y-4">
                {step < 4 ? (
                  <button
                    onClick={handleNext}
                    disabled={
                      (step === 1 && !selectedCustomer && (!isNewCustomer || !newCustomer.name)) ||
                      (step === 2 && items.some(i => !i.material || i.netWeight <= 0))
                    }
                    className="w-full py-5 bg-blue-600 text-white rounded-2xl font-black text-lg hover:bg-blue-700 transition-all shadow-xl shadow-blue-900/20 flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Continue <ChevronRight className="w-5 h-5" />
                  </button>
                ) : (
                  <button
                    onClick={handleSubmit}
                    disabled={processing}
                    className="w-full py-5 bg-green-600 text-white rounded-2xl font-black text-lg hover:bg-green-700 transition-all shadow-xl shadow-green-900/20 flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {processing ? <Loader2 className="w-6 h-6 animate-spin" /> : <><DollarSign className="w-6 h-6" /> Complete Ticket</>}
                  </button>
                )}
                
                {step > 1 && (
                  <button
                    onClick={() => setStep(step - 1)}
                    disabled={processing}
                    className="w-full py-4 bg-slate-800 text-slate-300 rounded-2xl font-bold hover:bg-slate-700 transition-all flex items-center justify-center gap-2"
                  >
                    <ChevronLeft className="w-4 h-4" /> Back to Step {step - 1}
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-4">
            <h5 className="text-xs font-black text-slate-400 uppercase tracking-widest">Quick Actions</h5>
            <button 
              onClick={reset}
              className="w-full py-3 border border-slate-200 text-slate-600 rounded-xl text-sm font-bold hover:bg-slate-50 transition-all flex items-center justify-center gap-2"
            >
              <RotateCcw className="w-4 h-4" /> Reset Form
            </button>
          </div>
        </div>
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
                <div className="text-center border-b border-slate-100 pb-6 mb-6">
                  <h1 className="text-xl font-black uppercase tracking-tight">Preferred Metals & Recycling</h1>
                  <p className="text-[10px] text-slate-500 mt-1 uppercase font-bold tracking-widest">Official Buy Ticket</p>
                  <p className="text-[10px] text-slate-400 mt-1">{new Date(lastCreatedTicket.timestamp).toLocaleString()}</p>
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
                      reset();
                    }
                  } else {
                    console.log('DEBUG PRINT: window.print() bypassed, state reset bypassed.');
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

      {/* Print Styles moved to index.css */}
    </main>
  );
}
