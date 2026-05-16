import { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, onSnapshot, addDoc, doc, getDoc, updateDoc, increment, query, where, limit, setDoc, orderBy } from 'firebase/firestore';
import { Material, Customer, BuyTicket, BuyTicketMaterial, DoNotBuyEntry, InventoryItem, UserProfile } from '../types';
import { 
  Plus, 
  Search, 
  Scale, 
  User, 
  Users,
  DollarSign, 
  CheckCircle2, 
  Loader2, 
  AlertCircle, 
  Package, 
  Truck, 
  BarChart3, 
  ArrowUpRight, 
  X, 
  UserPlus, 
  ShieldAlert, 
  Printer,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  ShieldCheck,
  FileText
} from 'lucide-react';
import { cn } from '../lib/utils';
import { Link } from 'react-router-dom';
import ManagerPinModal from '../components/ManagerPinModal';
import BuyTicketModal from '../components/BuyTicketModal';
import { CameraCapture } from '../components/CameraCapture';
import { ScaleCaptureButton } from '../components/ScaleCaptureButton';
import SignaturePad from '../components/SignaturePad';
import { useSettings } from '../context/SettingsContext';
import { useIDScanner } from '../hooks/useIDScanner';
import { Scan } from 'lucide-react';
import { COMPANY_NAME, handleImageError } from '../constants';
import { BrandLogo } from '../components/BrandLogo';

import { handleFirestoreError, OperationType } from '../lib/firestore-errors';

interface DashboardProps {
  profile: UserProfile | null;
}

export default function Dashboard({ profile }: DashboardProps) {
  const { settings } = useSettings();
  const { scan, isScanning } = useIDScanner();

  const [materials, setMaterials] = useState<Material[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [buyTickets, setBuyTickets] = useState<BuyTicket[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [doNotBuyList, setDoNotBuyList] = useState<DoNotBuyEntry[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Quick Ticket State
  const [showQuickTicket, setShowQuickTicket] = useState(false);
  const [showFullTicket, setShowFullTicket] = useState(false);
  const [step, setStep] = useState(1);
  const [qtCustomer, setQtCustomer] = useState<Customer | null>(null);
  const [qtNewCustomer, setQtNewCustomer] = useState({ 
    name: '', 
    phone: '', 
    address: '',
    idNumber: '',
    idType: '',
    idExpiration: ''
  });
  const [qtItems, setQtItems] = useState<{ id: string, material: Material | null, gross: number, tare: number, deduction: number, overridePrice?: number, materialSearch?: string, isDropdownOpen?: boolean, photoUrl?: string }[]>([
    { id: Math.random().toString(36).substr(2, 9), material: null, gross: 0, tare: 0, deduction: 0, materialSearch: '', isDropdownOpen: false, photoUrl: '' }
  ]);
  const [qtProcessing, setQtProcessing] = useState(false);
  const [showPrintPreview, setShowPrintPreview] = useState(false);
  const [qtSuccess, setQtSuccess] = useState(false);
  const [isPreviewOnly, setIsPreviewOnly] = useState(false);
  const [qtCustomerPhotoUrl, setQtCustomerPhotoUrl] = useState('');
  const [qtVehiclePhotoUrl, setQtVehiclePhotoUrl] = useState('');
  const [qtSignatureUrl, setQtSignatureUrl] = useState('');
  const [idCheckResult, setIdCheckResult] = useState<{ prohibited: boolean, reason?: string } | null>(null);
  const [showPinModal, setShowPinModal] = useState(false);

  // Auto-print effect for Quick Ticket
  useEffect(() => {
    if (qtSuccess && settings.autoPrint) {
      setShowPrintPreview(true);
      const timer = setTimeout(() => {
        if (!settings.debugPrintMode) window.print();
        // Automatically close after auto-print starts
        setTimeout(() => {
          if (!settings.debugPrintMode) {
            setShowQuickTicket(false);
            resetQuickTicket();
          }
        }, 500);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [qtSuccess, settings.autoPrint, settings.debugPrintMode]);

  useEffect(() => {
    const unsubMaterials = onSnapshot(collection(db, 'materials'), (snapshot) => {
      setMaterials(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Material[]);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'materials'));

    const unsubCustomers = onSnapshot(collection(db, 'customers'), (snapshot) => {
      setCustomers(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Customer[]);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'customers'));

    // Only fetch last 30 days of tickets for dashboard stats
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const q = query(
      collection(db, 'buyTickets'), 
      where('timestamp', '>=', thirtyDaysAgo.toISOString()),
      orderBy('timestamp', 'desc')
    );

    const unsubTickets = onSnapshot(q, (snapshot) => {
      setBuyTickets(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as BuyTicket[]);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'buyTickets'));

    const unsubInventory = onSnapshot(collection(db, 'inventory'), (snapshot) => {
      setInventory(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as InventoryItem[]);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'inventory'));

    const unsubDNB = onSnapshot(collection(db, 'doNotBuyList'), (snapshot) => {
      setDoNotBuyList(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as DoNotBuyEntry[]);
      setLoading(false);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'doNotBuyList'));

    return () => {
      unsubMaterials();
      unsubCustomers();
      unsubTickets();
      unsubInventory();
      unsubDNB();
    };
  }, []);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayIso = today.toISOString();
  const todayTickets = buyTickets.filter(t => t.timestamp >= todayIso && t.status !== 'voided' && t.status !== 'cancelled');

  const totalSpent = todayTickets.reduce((sum, t) => sum + t.totalAmount, 0);
  const totalWeight = todayTickets.reduce((sum, t) => {
    const weight = (t.materials || []).reduce((mSum, m) => mSum + m.netWeight, 0);
    return sum + weight;
  }, 0);

  const qtTotals = qtItems.reduce((acc, item) => {
    const physicalNet = Math.max(0, item.gross - item.tare);
    const paidWeight = Math.max(0, physicalNet - (item.deduction || 0));
    const price = item.overridePrice !== undefined ? item.overridePrice : (item.material?.buyPrice || 0);
    const amount = paidWeight * price;
    return {
      netWeight: acc.netWeight + physicalNet,
      totalAmount: acc.totalAmount + amount
    };
  }, { netWeight: 0, totalAmount: 0 });

  const netWeight = qtTotals.netWeight;
  const totalAmount = qtTotals.totalAmount;

  const handleIDScan = async () => {
    const result = await scan();
    if (result.success) {
      const existing = customers.find(c => c.idNumber === result.idNumber);
      if (existing) {
        setQtCustomer(existing);
        setQtNewCustomer({ name: '', phone: '', address: '', idNumber: '', idType: '', idExpiration: '' });
      } else {
        setQtCustomer(null);
        setQtNewCustomer({
          name: result.name || '',
          address: result.address || '',
          phone: '',
          idNumber: result.idNumber || '',
          idType: result.idType || '',
          idExpiration: result.idExpiration || ''
        });
      }
    }
  };

  const handleQuickTicketSubmit = async () => {
    if (qtItems.some(item => !item.material || (item.gross - item.tare) <= 0) || (!qtCustomer && !qtNewCustomer.name)) return;

    // Check for price overrides
    const hasOverrides = qtItems.some(item => 
      item.overridePrice !== undefined && 
      item.overridePrice !== item.material?.buyPrice
    );

    if (hasOverrides && profile?.role === 'cashier') {
      setShowPinModal(true);
      return;
    }

    await saveQuickTicket();
  };

  const saveQuickTicket = async () => {
    setQtProcessing(true);
    try {
      let customerId = qtCustomer?.id;

      // Create new customer if needed
      if (!customerId && qtNewCustomer.name) {
        try {
          const custRef = await addDoc(collection(db, 'customers'), {
            name: qtNewCustomer.name || '',
            phone: qtNewCustomer.phone || '',
            address: qtNewCustomer.address || '',
            idNumber: qtNewCustomer.idNumber || '',
            idType: qtNewCustomer.idType || '',
            idExpiration: qtNewCustomer.idExpiration || '',
            businessName: '',
            photoUrl: qtCustomerPhotoUrl || '',
            createdAt: new Date().toISOString()
          });
          customerId = custRef.id;
        } catch (error) {
          handleFirestoreError(error, OperationType.CREATE, 'customers');
        }
      }

      if (!customerId) throw new Error("Customer ID missing");

      const ticketMaterials: BuyTicketMaterial[] = qtItems.map(item => {
        const physicalNet = Math.max(0, item.gross - item.tare);
        const paidWeight = Math.max(0, physicalNet - (item.deduction || 0));
        const price = item.overridePrice !== undefined ? item.overridePrice : item.material!.buyPrice;
        return {
          materialId: item.material!.id,
          grossWeight: item.gross,
          tareWeight: item.tare,
          netWeight: physicalNet, // Store physical net (Gross - Tare)
          pricePerUnit: price,
          totalAmount: paidWeight * price,
          deductionWeight: item.deduction || 0,
          photoUrl: item.photoUrl || ''
        };
      });

      const ticketData: Omit<BuyTicket, 'id'> = {
        customerId,
        materials: ticketMaterials,
        totalAmount: totalAmount || 0,
        status: 'completed',
        timestamp: new Date().toISOString(),
        vehiclePlate: '',
        vehicleType: '',
        paymentMethod: 'cash',
        notes: '',
        customerPhotoUrl: qtCustomerPhotoUrl || '',
        vehiclePhotoUrl: qtVehiclePhotoUrl || '',
        signatureUrl: qtSignatureUrl || ''
      };

      try {
        await addDoc(collection(db, 'buyTickets'), ticketData);
        
        // Update customer photo if one was taken
        if (qtCustomerPhotoUrl) {
          await updateDoc(doc(db, 'customers', customerId), {
            photoUrl: qtCustomerPhotoUrl
          });
        }
      } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, 'buyTickets');
      }

      // Update Inventory for each material
      for (const item of ticketMaterials) {
        const invRef = doc(db, 'inventory', item.materialId);
        try {
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
        } catch (error) {
          handleFirestoreError(error, OperationType.WRITE, `inventory/${item.materialId}`);
        }
      }

      setQtSuccess(true);
      
      // Print handling moved to useEffect for better reliability
    } catch (error) {
      console.error('Error creating quick ticket:', error);
    } finally {
      setQtProcessing(false);
    }
  };

  const resetQuickTicket = () => {
    setShowQuickTicket(false);
    setStep(1);
    setQtCustomer(null);
    setQtNewCustomer({ name: '', phone: '', address: '', idNumber: '', idType: '', idExpiration: '' });
    setQtItems([{ id: Math.random().toString(36).substr(2, 9), material: null, gross: 0, tare: 0, deduction: 0, materialSearch: '', isDropdownOpen: false, photoUrl: '' }]);
    setQtCustomerPhotoUrl('');
    setQtVehiclePhotoUrl('');
    setQtSignatureUrl('');
    setQtSuccess(false);
    setIdCheckResult(null);
  };

  const checkDoNotBuy = () => {
    const nameToCheck = qtCustomer?.name || qtNewCustomer.name;
    const match = doNotBuyList.find(entry => 
      entry.name.toLowerCase() === nameToCheck.toLowerCase()
    );
    
    if (match) {
      setIdCheckResult({ prohibited: true, reason: match.reason });
    } else {
      setIdCheckResult({ prohibited: false });
    }
    setStep(4);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <main className={cn("space-y-8", settings.compactMode && "space-y-4")}>
      {/* Brand Header */}
      <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm flex flex-col items-center justify-center text-center space-y-4 animate-in fade-in slide-in-from-top-4 duration-500 overflow-hidden relative group">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(184,115,51,0.02),transparent)] pointer-events-none" />
        <div className="w-full max-w-[240px] aspect-[2/1] flex items-center justify-center overflow-hidden relative">
          <BrandLogo className="w-full h-full object-contain" />
        </div>
        <div className="flex flex-col items-center">
          <p className="text-slate-400 font-bold text-[9px] uppercase tracking-[0.3em]">Professional Yard Management System</p>
          <div className="mt-2 flex items-center gap-1.5 opacity-20">
            <div className="h-px w-6 bg-slate-400" />
            <div className="w-1 h-1 rounded-full bg-slate-400" />
            <div className="h-px w-6 bg-slate-400" />
          </div>
        </div>
      </div>

      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className={cn("text-3xl font-black text-slate-900 font-display tracking-tight", settings.theme === 'dark' && "text-white")}>Yard Dashboard</h1>
          <p className="text-slate-500 font-medium">Welcome back. Here's what's happening today.</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => setShowQuickTicket(true)}
            aria-label="Create Quick Ticket"
            className="flex items-center justify-center gap-2 px-6 py-4 bg-slate-900 text-white rounded-2xl font-bold hover:bg-slate-800 transition-all shadow-lg shadow-slate-200 active:scale-95 outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2"
          >
            <Plus className="w-5 h-5" aria-hidden="true" />
            Quick Ticket
          </button>
          <button
            onClick={() => setShowFullTicket(true)}
            aria-label="Create Full Buy Ticket"
            className="flex items-center justify-center gap-2 px-6 py-4 bg-blue-600 text-white rounded-2xl font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-200 active:scale-95 outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
          >
            <FileText className="w-5 h-5" aria-hidden="true" />
            Full Buy Ticket
          </button>
        </div>
      </header>

      {/* Stats Overview */}
      <section className={cn("grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6", settings.compactMode && "gap-4")} aria-label="Daily Statistics">
        <div className={cn("bg-white p-6 rounded-xl border border-slate-200 shadow-sm", settings.theme === 'dark' && "bg-slate-900 border-slate-800", settings.compactMode && "p-4")}>
          <div className="flex items-center justify-between mb-4">
            <div className="p-2 bg-blue-50 rounded-lg">
              <DollarSign className="w-5 h-5 text-blue-600" aria-hidden="true" />
            </div>
            <ArrowUpRight className="w-4 h-4 text-green-500" aria-hidden="true" />
          </div>
          <p className="text-sm font-black text-slate-400 uppercase tracking-widest">Today's Payouts</p>
          <p className={cn("text-3xl font-black text-slate-900 mt-1 font-display tracking-tight", settings.theme === 'dark' && "text-white")}>${totalSpent.toLocaleString()}</p>
        </div>
        <div className={cn("bg-white p-6 rounded-xl border border-slate-200 shadow-sm", settings.theme === 'dark' && "bg-slate-900 border-slate-800", settings.compactMode && "p-4")}>
          <div className="flex items-center justify-between mb-4">
            <div className="p-2 bg-green-50 rounded-lg">
              <Package className="w-5 h-5 text-green-600" aria-hidden="true" />
            </div>
            <ArrowUpRight className="w-4 h-4 text-green-500" aria-hidden="true" />
          </div>
          <p className="text-sm font-black text-slate-400 uppercase tracking-widest">Today's Volume</p>
          <p className={cn("text-3xl font-black text-slate-900 mt-1 font-display tracking-tight", settings.theme === 'dark' && "text-white")}>
            {totalWeight.toLocaleString()} <span className="text-sm font-bold text-slate-400">lb</span>
          </p>
        </div>
        <div className={cn("bg-white p-6 rounded-xl border border-slate-200 shadow-sm", settings.theme === 'dark' && "bg-slate-900 border-slate-800", settings.compactMode && "p-4")}>
          <div className="flex items-center justify-between mb-4">
            <div className="p-2 bg-purple-50 rounded-lg">
              <Users className="w-5 h-5 text-purple-600" aria-hidden="true" />
            </div>
          </div>
          <p className="text-sm font-black text-slate-400 uppercase tracking-widest">Customers</p>
          <p className={cn("text-3xl font-black text-slate-900 mt-1 font-display tracking-tight", settings.theme === 'dark' && "text-white")}>{customers.length}</p>
        </div>
        <div className={cn("bg-white p-6 rounded-xl border border-slate-200 shadow-sm", settings.theme === 'dark' && "bg-slate-900 border-slate-800", settings.compactMode && "p-4")}>
          <div className="flex items-center justify-between mb-4">
            <div className="p-2 bg-amber-50 rounded-lg">
              <BarChart3 className="w-5 h-5 text-amber-600" aria-hidden="true" />
            </div>
          </div>
          <p className="text-sm font-black text-slate-400 uppercase tracking-widest">Today's Tickets</p>
          <p className={cn("text-3xl font-black text-slate-900 mt-1 font-display tracking-tight", settings.theme === 'dark' && "text-white")}>
            {todayTickets.length}
          </p>
        </div>
      </section>

      <div className={cn("grid grid-cols-1 lg:grid-cols-2 gap-8", settings.compactMode && "gap-4")}>
        {/* Recent Activity */}
        <section className={cn("bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden", settings.theme === 'dark' && "bg-slate-900 border-slate-800")} aria-label="Recent Activity">
          <div className={cn("p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50", settings.theme === 'dark' && "bg-slate-800 border-slate-700")}>
            <h3 className={cn("font-black text-slate-900 uppercase tracking-widest text-xs", settings.theme === 'dark' && "text-white")}>Recent Buy Tickets</h3>
            <Link to="/buy-tickets" className="text-xs font-black text-blue-600 hover:text-blue-700 uppercase tracking-widest outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded-md px-1">View All</Link>
          </div>
          <div className="divide-y divide-slate-50 dark:divide-slate-800">
            {buyTickets.slice(0, settings.compactMode ? 3 : 5).map((ticket) => (
              <div key={ticket.id} className="p-4 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center text-slate-400">
                    <User className="w-5 h-5" aria-hidden="true" />
                  </div>
                  <div>
                    <p className={cn("text-sm font-bold text-slate-900", settings.theme === 'dark' && "text-white")}>
                      {customers.find(c => c.id === ticket.customerId)?.name || 'Unknown'}
                    </p>
                    <p className="text-xs text-slate-500">
                      {(ticket.materials || []).length > 1 ? `${ticket.materials.length} Materials` : materials.find(m => m.id === (ticket.materials || [])[0]?.materialId)?.name} • {(ticket.materials || []).reduce((sum, m) => sum + m.netWeight, 0)} lb
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className={cn("text-sm font-bold text-slate-900", settings.theme === 'dark' && "text-white")}>${ticket.totalAmount.toFixed(2)}</p>
                  <p className="text-[10px] text-slate-400 uppercase">{new Date(ticket.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                </div>
              </div>
            ))}
            {buyTickets.length === 0 && (
              <div className="p-12 text-center text-slate-400">
                <p>No tickets recorded today.</p>
              </div>
            )}
          </div>
        </section>

        {/* Inventory Summary */}
        <section className={cn("bg-white rounded-3xl border border-slate-200 shadow-sm p-6", settings.theme === 'dark' && "bg-slate-900 border-slate-800")} aria-label="Inventory Summary">
          <h3 className={cn("font-black text-slate-900 uppercase tracking-widest text-xs mb-6", settings.theme === 'dark' && "text-white")}>Inventory Overview</h3>
          <div className={cn("space-y-6", settings.compactMode && "space-y-4")}>
            {materials.slice(0, settings.compactMode ? 3 : 5).map((material) => {
              const invWeight = buyTickets.reduce((sum, t) => {
                const weight = (t.materials || []).filter(m => m.materialId === material.id).reduce((mSum, m) => mSum + m.netWeight, 0);
                return sum + weight;
              }, 0);
              const percentage = Math.min((invWeight / 5000) * 100, 100);
              
              return (
                <div key={material.id} className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className={cn("font-medium text-slate-700", settings.theme === 'dark' && "text-slate-300")}>{material.name}</span>
                    <span className="text-slate-500 font-bold">{invWeight.toLocaleString()} lb</span>
                  </div>
                  <div className={cn("h-2 bg-slate-100 rounded-full overflow-hidden", settings.theme === 'dark' && "bg-slate-800")} role="progressbar" aria-valuenow={percentage} aria-valuemin={0} aria-valuemax={100}>
                    <div 
                      className={cn(
                        "h-full rounded-full transition-all duration-500",
                        invWeight < 500 ? "bg-amber-500" : "bg-blue-600"
                      )}
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-8">
            <Link to="/inventory" className={cn("block text-center py-3 bg-slate-50 text-slate-600 rounded-lg text-sm font-bold hover:bg-slate-100 transition-all outline-none focus-visible:ring-2 focus-visible:ring-slate-400", settings.theme === 'dark' && "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white")}>
              Full Inventory Report
            </Link>
          </div>
        </section>
      </div>

      {/* Quick Ticket Modal */}
      {showQuickTicket && (
        <div 
          className="fixed inset-0 bg-slate-900/60 z-[100] flex items-start justify-center p-4 backdrop-blur-sm overflow-y-auto"
          onClick={(e) => {
            if (e.target === e.currentTarget) resetQuickTicket();
          }}
        >
          <div className="bg-white rounded-[2.5rem] w-full max-w-4xl my-auto overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="bg-slate-900 p-6 text-white flex items-center justify-between">
              <div>
                <h2 className="text-xl font-black font-display tracking-tight">Quick Ticket Flow</h2>
                <p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest mt-1">Step {step} of 4 • {
                  step === 1 ? 'Material & Weight' : 
                  step === 2 ? 'Customer Info' : 
                  step === 3 ? 'ID Verification' : 'Final Review'
                }</p>
              </div>
              <button 
                onClick={resetQuickTicket} 
                className="p-3 hover:bg-white/10 rounded-full transition-colors outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                aria-label="Close modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-8">
              {qtSuccess ? (
                <div className="py-12 text-center space-y-4">
                  <div className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-6">
                    <CheckCircle2 className="w-10 h-10" />
                  </div>
                  <h3 className="text-2xl font-bold text-slate-900">Ticket Completed!</h3>
                  <p className="text-slate-500">The payout has been recorded and inventory updated.</p>
                  <div className="pt-8 flex justify-center gap-3">
                    <button 
                      onClick={() => setShowPrintPreview(true)}
                      className="px-8 py-4 border border-slate-900 text-slate-900 rounded-xl font-bold hover:bg-slate-50 transition-all outline-none focus-visible:ring-2 focus-visible:ring-slate-400 flex items-center gap-2"
                    >
                      <Printer className="w-5 h-5" />
                      Print Ticket
                    </button>
                    <button 
                      onClick={resetQuickTicket} 
                      className="px-8 py-4 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800 transition-all outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2"
                    >
                      Close Window
                    </button>
                  </div>
                </div>
              ) : (
                <div className="min-h-[400px] flex flex-col">
                  {/* Step 1: Material & Weight */}
                  {step === 1 && (
                    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                      <div className="flex items-center justify-between">
                        <h4 className="font-bold text-slate-900 flex items-center gap-2">
                          <Package className="w-4 h-4 text-blue-600" />
                          Materials & Weights
                        </h4>
                        <span className="text-xs font-bold text-slate-500 uppercase">{qtItems.length} / 15 Items</span>
                      </div>

                      <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                        {qtItems.map((item, index) => (
                          <div key={item.id} className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-4 relative group">
                            {qtItems.length > 1 && (
                              <button 
                                onClick={() => setQtItems(prev => prev.filter(i => i.id !== item.id))}
                                className="absolute -right-3 -top-3 w-10 h-10 bg-red-100 text-red-600 rounded-full flex items-center justify-center hover:bg-red-200 transition-colors shadow-md z-10 active:scale-90"
                                title="Remove item"
                              >
                                <X className="w-5 h-5" />
                              </button>
                            )}
                            
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                              <div className="sm:col-span-1 space-y-1.5 relative">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Material</label>
                                <div className="relative">
                                  <input
                                    type="text"
                                    autoFocus={index > 0 && index === qtItems.length - 1}
                                    className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all text-sm font-bold shadow-sm placeholder:text-slate-400 placeholder:font-normal"
                                    placeholder="Type code or name..."
                                    value={item.material ? `${item.material.code} - ${item.material.name}` : (item.materialSearch || '')}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      // If they had a material selected and start typing, clear it
                                      if (item.material && !val.includes(item.material.code)) {
                                        setQtItems(prev => prev.map(i => i.id === item.id ? { ...i, material: null, materialSearch: val, isDropdownOpen: true } : i));
                                      } else {
                                        setQtItems(prev => prev.map(i => i.id === item.id ? { ...i, materialSearch: val, isDropdownOpen: true } : i));
                                      }
                                    }}
                                    onFocus={() => setQtItems(prev => prev.map(i => i.id === item.id ? { ...i, isDropdownOpen: true } : i))}
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
                                          setQtItems(prev => prev.map(i => i.id === item.id ? { 
                                            ...i, 
                                            material: m, 
                                            overridePrice: m.buyPrice,
                                            isDropdownOpen: false,
                                            materialSearch: ''
                                          } : i));
                                          if (e.key === 'Enter') e.preventDefault();
                                        }
                                      }
                                      if (e.key === 'Escape') {
                                        setQtItems(prev => prev.map(i => i.id === item.id ? { ...i, isDropdownOpen: false } : i));
                                      }
                                    }}
                                  />
                                  <ChevronDown className={cn("absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 transition-transform pointer-events-none", item.isDropdownOpen && "rotate-180")} />

                                  {item.isDropdownOpen && (item.materialSearch || '').length > 0 && (
                                    <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-[110] overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                                      <div className="max-h-[200px] overflow-y-auto custom-scrollbar">
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
                                              type="button"
                                              onMouseDown={(e) => {
                                                // Use onMouseDown to prevent blur before click
                                                e.preventDefault();
                                                setQtItems(prev => prev.map(i => i.id === item.id ? { 
                                                  ...i, 
                                                  material: m, 
                                                  overridePrice: m.buyPrice,
                                                  isDropdownOpen: false,
                                                  materialSearch: ''
                                                } : i));
                                              }}
                                              className="w-full px-3 py-2 text-left hover:bg-blue-50 transition-colors flex flex-col gap-0.5 border-b border-slate-50 last:border-0"
                                            >
                                              <div className="flex items-center justify-between gap-2">
                                                <span className="text-xs font-bold text-slate-900">{m.code} - {m.name}</span>
                                                <span className="text-[10px] font-bold text-blue-600">${m.buyPrice.toFixed(2)}</span>
                                              </div>
                                              <span className="text-[10px] text-slate-400 uppercase tracking-wider">{m.category}</span>
                                            </button>
                                          ))}
                                        {materials.filter(m => {
                                          const search = (item.materialSearch || '').toLowerCase();
                                          return m.name.toLowerCase().includes(search) || m.code.toLowerCase().includes(search);
                                        }).length === 0 && (
                                          <div className="p-4 text-center text-xs text-slate-400 italic">
                                            No materials found
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 sm:col-span-2">
                                <div className="space-y-2">
                                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Gross (lb)</label>
                                  <input 
                                    type="number"
                                    className="w-full px-4 py-3.5 bg-white border border-slate-200 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none transition-all text-sm font-black shadow-sm"
                                    value={item.gross || ''}
                                    onChange={(e) => setQtItems(prev => prev.map(i => i.id === item.id ? { ...i, gross: Number(e.target.value) } : i))}
                                    placeholder="0"
                                  />
                                </div>
                                <div className="space-y-2">
                                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Tare (lb)</label>
                                  <input 
                                    type="number"
                                    className="w-full px-4 py-3.5 bg-white border border-slate-200 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none transition-all text-sm font-black shadow-sm"
                                    value={item.tare || ''}
                                    onChange={(e) => setQtItems(prev => prev.map(i => i.id === item.id ? { ...i, tare: Number(e.target.value) } : i))}
                                    placeholder="0"
                                  />
                                </div>
                                <div className="space-y-2">
                                  <label className="text-[10px] font-black text-red-400 uppercase tracking-widest">Deduc (lb)</label>
                                  <input 
                                    type="number"
                                    className="w-full px-4 py-3.5 bg-red-50 border border-red-100 rounded-2xl focus:ring-2 focus:ring-red-500 outline-none transition-all text-sm font-black text-red-600 shadow-sm"
                                    value={item.deduction || ''}
                                    onChange={(e) => setQtItems(prev => prev.map(i => i.id === item.id ? { ...i, deduction: Number(e.target.value) } : i))}
                                    placeholder="0"
                                  />
                                </div>
                                <div className="space-y-2">
                                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Price ($/lb)</label>
                                  <input 
                                    type="number"
                                    step="0.01"
                                    className="w-full px-4 py-3.5 bg-white border border-slate-200 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none transition-all text-sm font-black text-blue-600 shadow-sm"
                                    value={item.overridePrice !== undefined ? item.overridePrice : (item.material?.buyPrice || '')}
                                    onChange={(e) => setQtItems(prev => prev.map(i => i.id === item.id ? { ...i, overridePrice: Number(e.target.value) } : i))}
                                    placeholder="0.00"
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter' && index === qtItems.length - 1 && qtItems.length < 15) {
                                        e.preventDefault();
                                        setQtItems(prev => [...prev, { 
                                          id: Math.random().toString(36).substr(2, 9), 
                                          material: null, 
                                          gross: 0, 
                                          tare: 0, 
                                          deduction: 0,
                                          materialSearch: '', 
                                          isDropdownOpen: true 
                                        }]);
                                      }
                                    }}
                                  />
                                </div>
                              </div>
                            </div>
                            
                            <div className="flex items-center justify-between text-xs pt-2 border-t border-slate-200">
                              <div className="flex items-center gap-3">
                                <div className="flex items-center gap-2">
                                  <ScaleCaptureButton 
                                    onCapture={(weight, photoUrl) => setQtItems(prev => prev.map(i => i.id === item.id ? { ...i, gross: weight, photoUrl } : i))} 
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
                                <div className="flex gap-4 border-l border-slate-200 pl-3">
                                  <span className="text-slate-500">Net: <span className="font-bold text-slate-900">{Math.max(0, item.gross - item.tare)} lb</span></span>
                                  <span className="text-slate-500">Unit Price: <span className="font-bold text-slate-900">${(item.overridePrice !== undefined ? item.overridePrice : (item.material?.buyPrice || 0)).toFixed(2)}</span></span>
                                </div>
                              </div>
                              <span className="font-black text-blue-600 text-sm">Subtotal: ${((Math.max(0, item.gross - item.tare - (item.deduction || 0))) * (item.overridePrice !== undefined ? item.overridePrice : (item.material?.buyPrice || 0))).toFixed(2)}</span>
                            </div>
                          </div>
                        ))}
                      </div>

                      {qtItems.length < 15 && (
                        <button 
                          onClick={() => setQtItems(prev => [...prev, { id: Math.random().toString(36).substr(2, 9), material: null, gross: 0, tare: 0, deduction: 0, materialSearch: '', isDropdownOpen: false }])}
                          className="w-full py-3 border-2 border-dashed border-slate-200 rounded-2xl text-slate-500 font-bold flex items-center justify-center gap-2 hover:bg-slate-50 hover:border-blue-300 hover:text-blue-600 transition-all"
                        >
                          <Plus className="w-4 h-4" />
                          Add Another Material
                        </button>
                      )}

                      <div className="bg-blue-600 p-6 rounded-2xl flex items-center justify-between text-white shadow-lg shadow-blue-100">
                        <div>
                          <p className="text-[10px] font-bold uppercase text-blue-100">Total Net Weight</p>
                          <p className="text-2xl font-black">{netWeight} lb</p>
                        </div>
                        <div className="text-right">
                          <p className="text-[10px] font-bold uppercase text-blue-100">Estimated Total Payout</p>
                          <p className="text-3xl font-black">${totalAmount.toFixed(2)}</p>
                        </div>
                      </div>
                    </div>
                  )}

                    {step === 2 && (
                      <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                        <div className="space-y-4">
                          <h4 className="font-bold text-slate-900 flex items-center gap-2">
                            <Search className="w-4 h-4 text-blue-600" />
                            Select Existing Customer
                          </h4>
                          <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                            <select 
                              className="w-full pl-10 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all appearance-none font-bold"
                              value={qtCustomer?.id || ''}
                              onChange={(e) => {
                                const c = customers.find(cust => cust.id === e.target.value);
                                setQtCustomer(c || null);
                                if (c) setQtNewCustomer({ name: '', phone: '', address: '', idNumber: '', idType: '', idExpiration: '' });
                              }}
                            >
                              <option value="">Search customers...</option>
                              {customers.map(c => (
                                <option key={c.id} value={c.id}>{c.name} ({c.phone || 'No phone'})</option>
                              ))}
                            </select>
                            <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                              <ChevronDown className="w-5 h-5" />
                            </div>
                          </div>
                        </div>

                        <div className="relative py-4">
                          <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-100"></div></div>
                          <div className="relative flex justify-center text-xs uppercase"><span className="bg-white px-2 text-slate-400 font-bold tracking-[0.2em]">Or Register New</span></div>
                        </div>

                        {settings.scannerEnabled && (
                          <button 
                            onClick={handleIDScan}
                            disabled={isScanning}
                            className={cn(
                              "w-full py-4 bg-slate-900 text-white rounded-2xl font-black text-xs uppercase tracking-[0.2em] hover:bg-slate-800 transition-all flex items-center justify-center gap-3 shadow-xl shadow-slate-200 group relative overflow-hidden",
                              isScanning && "opacity-80"
                            )}
                          >
                            <div className={cn(
                              "absolute inset-0 bg-gradient-to-r from-blue-600/20 to-indigo-600/20 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000",
                              isScanning && "animate-shimmer"
                            )} />
                            {isScanning ? (
                              <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
                            ) : (
                              <Scan className="w-4 h-4 text-blue-400" />
                            )}
                            <span className="relative z-10">Scan Driver's License to Auto-Fill</span>
                          </button>
                        )}

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="space-y-1">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Full Name</label>
                            <input 
                              className="w-full px-4 py-4 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all font-bold placeholder:font-normal"
                              value={qtNewCustomer.name}
                              onChange={(e) => {
                                setQtNewCustomer(prev => ({ ...prev, name: e.target.value }));
                                if (e.target.value) setQtCustomer(null);
                              }}
                              placeholder="Legal Name from ID"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Phone Number</label>
                            <input 
                              className="w-full px-4 py-4 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all font-bold placeholder:font-normal"
                              value={qtNewCustomer.phone}
                              onChange={(e) => setQtNewCustomer(prev => ({ ...prev, phone: e.target.value }))}
                              placeholder="(000) 000-0000"
                            />
                          </div>
                          <div className="sm:col-span-2 space-y-1">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Physical Address</label>
                            <input 
                              className="w-full px-4 py-4 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all font-bold placeholder:font-normal"
                              value={qtNewCustomer.address}
                              onChange={(e) => setQtNewCustomer(prev => ({ ...prev, address: e.target.value }))}
                              placeholder="123 Main St, City, ST 12345"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">ID Number</label>
                            <input 
                              className="w-full px-4 py-4 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all font-bold placeholder:font-normal"
                              value={qtNewCustomer.idNumber}
                              onChange={(e) => setQtNewCustomer(prev => ({ ...prev, idNumber: e.target.value }))}
                              placeholder="Drivers License #"
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                             <div className="space-y-1">
                              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">ID Type</label>
                              <input 
                                className="w-full px-3 py-4 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all text-xs font-bold"
                                value={qtNewCustomer.idType}
                                onChange={(e) => setQtNewCustomer(prev => ({ ...prev, idType: e.target.value }))}
                                placeholder="DL / State"
                              />
                            </div>
                            <div className="space-y-1">
                              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Expires</label>
                              <input 
                                className="w-full px-3 py-4 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all text-xs font-bold"
                                value={qtNewCustomer.idExpiration}
                                onChange={(e) => setQtNewCustomer(prev => ({ ...prev, idExpiration: e.target.value }))}
                                placeholder="MM/DD/YYYY"
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                  {/* Step 3: ID Check */}
                  {step === 3 && (
                    <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-300 flex flex-col items-center justify-center py-12">
                      <div className="w-24 h-24 bg-slate-100 rounded-full flex items-center justify-center text-slate-400 mb-6">
                        <ShieldAlert className="w-12 h-12" />
                      </div>
                      <div className="text-center space-y-2">
                        <h3 className="text-2xl font-bold text-slate-900">ID Verification</h3>
                        <p className="text-slate-500">Running background check against Do-Not-Buy list for:</p>
                        <p className="text-lg font-black text-blue-600">{qtCustomer?.name || qtNewCustomer.name}</p>
                      </div>
                      <div className="pt-8 w-full max-w-xs">
                        <button 
                          onClick={checkDoNotBuy}
                          className="w-full py-4 bg-slate-900 text-white rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-slate-800 transition-all outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2"
                        >
                          Verify Identity
                          <ChevronRight className="w-5 h-5" />
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Step 4: Review */}
                  {step === 4 && (
                    <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                      {idCheckResult?.prohibited ? (
                        <div className="bg-red-50 border border-red-200 rounded-2xl p-6 flex gap-4 items-start">
                          <ShieldAlert className="w-8 h-8 text-red-600 shrink-0" />
                          <div>
                            <h4 className="text-red-900 font-black text-lg uppercase tracking-tight">Prohibited Seller Detected</h4>
                            <p className="text-red-700 mt-1">This individual is on the Do-Not-Buy list. Reason: {idCheckResult.reason || 'Not specified'}</p>
                            <button 
                              onClick={resetQuickTicket} 
                              className="mt-4 px-6 py-3 bg-red-600 text-white rounded-xl font-bold text-sm hover:bg-red-700 transition-all outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-2"
                            >
                              Cancel Ticket
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-6">
                          <div className="bg-green-50 border border-green-200 rounded-2xl p-4 flex gap-3 items-center text-green-700 font-bold">
                            <CheckCircle2 className="w-5 h-5" />
                            ID Check Passed: Clear to Buy
                          </div>

                          {((qtItems.some(item => !item.material || (item.gross - item.tare) <= 0)) || (!qtCustomer && !qtNewCustomer.name)) && (
                            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex gap-3 items-start text-amber-800">
                              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                              <div className="text-sm">
                                <p className="font-bold">Missing Information</p>
                                <p>Please complete all fields before finalizing the ticket.</p>
                              </div>
                            </div>
                          )}

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 lg:gap-8">
                            <div className="grid grid-cols-1 gap-6">
                              <div className="p-6 bg-slate-50 rounded-3xl border border-slate-200 shadow-sm flex flex-col">
                                <h5 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Customer Photo (Required)</h5>
                                <div className="flex-1">
                                  <CameraCapture 
                                    label="Take Customer Photo"
                                    onCapture={(url) => setQtCustomerPhotoUrl(url)}
                                    networkUrl={settings.useSwannCams ? settings.swannCams.customer : undefined}
                                    className="h-full"
                                  />
                                </div>
                              </div>
                              
                              <div className="p-6 bg-slate-50 rounded-3xl border border-slate-200 shadow-sm flex flex-col">
                                <h5 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Vehicle/Entrance Photo (Optional)</h5>
                                <div className="flex-1">
                                  <CameraCapture 
                                    label="Capture Vehicle"
                                    onCapture={(url) => setQtVehiclePhotoUrl(url)}
                                    networkUrl={settings.useSwannCams ? settings.swannCams.entrance : undefined}
                                    className="h-full"
                                  />
                                </div>
                              </div>
                              
                              <div className="p-6 bg-slate-50 rounded-3xl border border-slate-200 shadow-sm flex flex-col">
                                <h5 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Digital Signature</h5>
                                <div className="flex-1">
                                  <SignaturePad 
                                    onCapture={(url) => setQtSignatureUrl(url)}
                                    onClear={() => setQtSignatureUrl('')}
                                    className="h-full"
                                  />
                                </div>
                              </div>
                            </div>

                            <div className="space-y-6">
                              <div className={cn("p-6 bg-white rounded-3xl border border-slate-200 shadow-sm transition-colors", (!qtCustomer && !qtNewCustomer.name) && "bg-red-50 ring-1 ring-red-200")}>
                                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Customer</p>
                                <p className={cn("text-2xl font-black", (qtCustomer || qtNewCustomer.name) ? "text-slate-900" : "text-red-500 italic")}>
                                  {qtCustomer?.name || qtNewCustomer.name || 'Missing Customer'}
                                </p>
                              </div>

                              <div className="p-6 bg-white rounded-3xl border border-slate-200 shadow-sm space-y-4">
                                <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Materials Summary</p>
                                <div className="space-y-2 max-h-[200px] overflow-y-auto pr-2 custom-scrollbar">
                                  {qtItems.map((item, idx) => (
                                    <div key={item.id} className={cn(
                                      "flex items-center justify-between p-3 rounded-xl border transition-all",
                                      (!item.material || (item.gross - item.tare) <= 0) ? "bg-red-50 border-red-200" : "bg-white border-slate-100"
                                    )}>
                                      <div className="flex items-center gap-3">
                                        <span className="w-6 h-6 bg-slate-100 text-slate-500 rounded-full flex items-center justify-center text-[10px] font-bold">
                                          {idx + 1}
                                        </span>
                                        <div>
                                          <p className={cn("font-bold text-sm", !item.material && "text-red-500 italic")}>
                                            {item.material?.name || 'Missing Material'}
                                          </p>
                                          <p className="text-[10px] text-slate-400">
                                            {Math.max(0, item.gross - item.tare)} lb @ ${(item.overridePrice !== undefined ? item.overridePrice : (item.material?.buyPrice || 0)).toFixed(2)}/lb
                                          </p>
                                        </div>
                                      </div>
                                      <p className="font-black text-slate-900">
                                        ${((Math.max(0, item.gross - item.tare - (item.deduction || 0))) * (item.material?.buyPrice || 0)).toFixed(2)}
                                      </p>
                                    </div>
                                  ))}
                                </div>

                                <div className="pt-8 border-t border-slate-200 flex justify-between items-center">
                                  <div>
                                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Total Net Weight</p>
                                    <p className="text-2xl font-black text-slate-900">{netWeight} lb</p>
                                  </div>
                                  <div className="text-right">
                                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Total Payout</p>
                                    <p className="text-4xl font-black text-blue-600">${totalAmount.toFixed(2)}</p>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Navigation Buttons */}
                  {!qtSuccess && step !== 3 && (
                    <div className="mt-auto pt-8 flex gap-4">
                      {step > 1 && (
                        <button 
                          onClick={() => setStep(prev => prev - 1)}
                          className="px-6 py-4 border border-slate-200 rounded-xl font-bold text-slate-600 flex items-center gap-2 hover:bg-slate-50 transition-all outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                        >
                          <ChevronLeft className="w-5 h-5" />
                          Back
                        </button>
                      )}
                      <div className="flex-1" />
                      {step < 4 ? (
                        <button 
                          onClick={() => setStep(prev => prev + 1)}
                          disabled={step === 1 && (qtItems.length === 0 || qtItems.some(item => !item.material || (item.gross - item.tare) <= 0))}
                          className="px-8 py-4 bg-slate-900 text-white rounded-xl font-bold flex items-center gap-2 hover:bg-slate-800 transition-all outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:opacity-50"
                        >
                          Continue
                          <ChevronRight className="w-5 h-5" />
                        </button>
                      ) : (
                        !idCheckResult?.prohibited && (
                          <div className="flex gap-3">
                            <button 
                              onClick={() => {
                                setIsPreviewOnly(true);
                                setShowPrintPreview(true);
                              }}
                              className="px-6 py-4 border border-slate-900 rounded-xl font-bold text-slate-900 flex items-center gap-2 hover:bg-slate-50 transition-all outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                            >
                              <Printer className="w-5 h-5" />
                              Print Preview
                            </button>
                            <button 
                              onClick={handleQuickTicketSubmit}
                              disabled={qtProcessing || qtItems.some(item => !item.material || (item.gross - item.tare) <= 0) || (!qtCustomer && !qtNewCustomer.name) || netWeight <= 0}
                              className="px-8 py-4 bg-blue-600 text-white rounded-xl font-bold flex items-center gap-2 hover:bg-blue-700 shadow-lg shadow-blue-200 disabled:opacity-50 transition-all outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                            >
                              {qtProcessing ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
                              Complete & Save
                            </button>
                          </div>
                        )
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Print Preview Modal */}
      {showPrintPreview && (
        <div 
          className="fixed inset-0 bg-slate-900/80 z-[110] flex items-start justify-center p-4 backdrop-blur-sm overflow-y-auto"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowPrintPreview(false);
          }}
        >
          <div className="bg-white rounded-2xl w-full max-w-lg my-auto overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <Printer className="w-5 h-5 text-slate-600" />
                <h2 className="font-bold text-slate-900">Print Preview</h2>
              </div>
              <button 
                onClick={() => setShowPrintPreview(false)}
                className="p-2 hover:bg-slate-200 rounded-lg transition-colors"
                aria-label="Close preview"
              >
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-8 bg-slate-100">
              <div className="bg-white p-8 shadow-sm border border-slate-200 mx-auto max-w-[400px] font-mono text-sm">
                <div className="text-center border-b border-slate-900 pb-4 mb-6">
                  <h1 className="text-xl font-black uppercase tracking-tighter">Preferred Metals & Recycling</h1>
                  <p className="text-[10px] text-slate-500 mt-1 uppercase">Official Buy Ticket</p>
                  <p className="text-[10px] text-slate-500">{new Date().toLocaleString()}</p>
                </div>
                
                <div className="space-y-3">
                  <div className="flex justify-between gap-4">
                    <span className="text-slate-500 uppercase text-[10px] font-bold">Customer</span>
                    <span className="text-right font-bold">{qtCustomer?.name || qtNewCustomer.name || 'N/A'}</span>
                  </div>
                  
                  <div className="border-t border-slate-100 pt-3 space-y-2">
                    <p className="text-[10px] font-bold text-slate-400 uppercase">Items</p>
                    {qtItems.map((item, idx) => (
                      <div key={item.id} className="flex justify-between gap-4 text-[11px]">
                        <div className="flex gap-2">
                          <span className="text-slate-400">{idx + 1}.</span>
                          <span>{item.material?.name || 'N/A'}</span>
                        </div>
                        <div className="text-right">
                          <span>{Math.max(0, item.gross - item.tare)} lb @ ${item.material?.buyPrice.toFixed(2) || '0.00'}</span>
                          <p className="font-bold">${((Math.max(0, item.gross - item.tare)) * (item.material?.buyPrice || 0)).toFixed(2)}</p>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="flex justify-between gap-4 text-base border-t border-slate-900 pt-3 mt-4">
                    <span className="font-black uppercase">Total Net Weight</span>
                    <span className="font-black">{netWeight} lb</span>
                  </div>
                  <div className="flex justify-between gap-4 text-xl border-t-2 border-slate-900 pt-4 mt-4">
                    <span className="font-black uppercase">Total Payout</span>
                    <span className="font-black">${totalAmount.toFixed(2)}</span>
                  </div>
                </div>
                
                <div className="mt-8 pt-6 border-t border-slate-200 space-y-4">
                  <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                    <p className="text-[8px] leading-tight text-slate-500 text-center italic">
                      I, the undersigned, certify that I am the sole owner of the material described on this ticket and have the full legal right to sell it. I further certify that this material was not obtained through theft or any other illegal means.
                    </p>
                  </div>
                  <div className="pt-2 border-slate-300 w-full flex flex-col items-center">
                    {qtSignatureUrl ? (
                      <img src={qtSignatureUrl} alt="Signature" className="h-16 object-contain" />
                    ) : (
                      <div className="pt-8 border-b border-slate-300 w-full"></div>
                    )}
                  </div>
                  <p className="text-[9px] font-bold text-slate-400 uppercase text-center mt-1">Seller Signature</p>
                </div>
                
                <div className="mt-12 pt-8 border-t border-dashed border-slate-300 text-center space-y-2">
                  <p className="text-[10px] text-slate-400">Thank you for your business.</p>
                  <p className="text-[10px] font-bold text-slate-900">TICKET ID: {Math.random().toString(36).substr(2, 9).toUpperCase()}</p>
                  <div className="flex justify-center gap-1 pt-2">
                    {[...Array(20)].map((_, i) => (
                      <div key={i} className="w-1 h-4 bg-slate-900" style={{ opacity: Math.random() * 0.5 + 0.5 }}></div>
                    ))}
                  </div>
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
                      setShowQuickTicket(false);
                      resetQuickTicket();
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

      {/* Hidden Print Template */}
      <div className="print-template">
        <div className="text-center border-b-2 border-black pb-4 mb-6">
          <h1 className="text-2xl font-black uppercase">Preferred Metals & Recycling</h1>
          <p className="text-sm">Official Buy Ticket • {new Date().toLocaleString()}</p>
        </div>
        <div className="space-y-4">
          <div className="flex justify-between">
            <span className="font-bold">Customer:</span>
            <span>{qtCustomer?.name || qtNewCustomer.name}</span>
          </div>
          
          <div className="border-t border-black pt-4 space-y-2">
            <p className="text-xs font-bold uppercase">Items</p>
            {qtItems.map((item, idx) => {
              const physicalNet = Math.max(0, item.gross - item.tare);
              const paidWeight = Math.max(0, physicalNet - (item.deduction || 0));
              const price = item.overridePrice !== undefined ? item.overridePrice : (item.material?.buyPrice || 0);
              return (
                <div key={item.id} className="flex justify-between text-sm">
                  <span>{idx + 1}. {item.material?.name}</span>
                  <div className="text-right">
                    <span>{paidWeight} lb @ ${price.toFixed(2)}</span>
                    <p className="font-bold">${(paidWeight * price).toFixed(2)}</p>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex justify-between text-xl border-t-2 border-black pt-4 mt-4">
            <span className="font-black">TOTAL WEIGHT:</span>
            <span className="font-black">
              {qtItems.reduce((sum, item) => sum + Math.max(0, (item.gross - item.tare) - (item.deduction || 0)), 0)} lb
            </span>
          </div>
          <div className="flex justify-between text-2xl border-t-2 border-black pt-4">
            <span className="font-black">TOTAL PAYOUT:</span>
            <span className="font-black">${totalAmount.toFixed(2)}</span>
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-black space-y-6">
          <div className="bg-slate-50 p-4 rounded border border-slate-200">
            <p className="text-[10px] leading-relaxed text-slate-700 italic text-center">
              I, the undersigned, certify that I am the sole owner of the material described on this ticket and have the full legal right to sell it. I further certify that this material was not obtained through theft or any other illegal means.
            </p>
          </div>
          <div className="pt-12 border-b-2 border-black w-full"></div>
          <p className="text-xs font-bold uppercase text-center">Seller Signature</p>
        </div>

        <div className="mt-12 pt-12 border-t border-dashed border-slate-300 text-center text-xs">
          <p>Thank you for your business.</p>
          <p>Ticket ID: {Math.random().toString(36).substr(2, 9).toUpperCase()}</p>
        </div>
      </div>
      {/* Manager PIN Modal */}
      <ManagerPinModal 
        isOpen={showPinModal}
        onClose={() => setShowPinModal(false)}
        onSuccess={() => saveQuickTicket()}
      />

      <BuyTicketModal 
        isOpen={showFullTicket}
        onClose={() => setShowFullTicket(false)}
        profile={profile}
      />
    </main>
  );
}
