import { useState, useEffect, useMemo } from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip } from 'recharts';
import { auth, db } from '../firebase';
import { collection, onSnapshot, addDoc, doc, getDoc, getDocFromCache, updateDoc, increment, query, where, limit, setDoc, orderBy, deleteDoc, getDocs } from 'firebase/firestore';
import { Material, Customer, BuyTicket, BuyTicketMaterial, DoNotBuyEntry, InventoryItem, UserProfile, DailySnapshot, PricingSnapshot } from '../types';
import { 
  Plus, 
  Search, 
  Scale, 
  User, 
  Users,
  DollarSign, 
  CheckCircle2, 
  Database,
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
  FileText,
  TrendingUp,
  Fingerprint,
  Check,
  ExternalLink,
  Copy
} from 'lucide-react';
import { cn, generateTicketId } from '../lib/utils';
import { Link } from 'react-router-dom';
import ManagerPinModal from '../components/ManagerPinModal';
import BuyTicketModal from '../components/BuyTicketModal';
import { CameraCapture } from '../components/CameraCapture';
import { ScaleCaptureButton } from '../components/ScaleCaptureButton';
import SignaturePad from '../components/SignaturePad';
import { useSettings } from '../context/SettingsContext';
import { useIDScanner } from '../hooks/useIDScanner';
import { Scan, QrCode } from 'lucide-react';
import { roundNetWeight } from '../lib/weightUtils';
import { COMPANY_NAME, COMPANY_ADDRESS, COMPANY_PHONE, COMPANY_WEBSITE, handleImageError, APP_VERSION } from '../constants';
import { BrandLogo } from '../components/BrandLogo';
import { printTicket } from '../lib/printTicket';
import { BuyTicketPrint } from '../components/BuyTicketPrint';
import { logAuditEvent } from '../lib/audit';
import USBBarcodeScannerModal from '../components/USBBarcodeScannerModal';

import { useToast } from '../context/ToastContext';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';

const normalizeName = (name: string) =>
  name.toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();

const namesMatch = (a: string, b: string) => {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (na === nb) return true;
  // Check reversed first/last name
  const partsA = na.split(' ');
  const partsB = nb.split(' ');
  if (partsA.length >= 2 && partsB.length >= 2) {
    const reversedA = [...partsA].reverse().join(' ');
    if (reversedA === nb) return true;
  }
  return false;
};

interface IdImageThumbnailProps {
  imageUrl: string;
  onViewFull: (url: string) => void;
}

function IdImageThumbnail({ imageUrl, onViewFull }: IdImageThumbnailProps) {
  const [hasError, setHasError] = useState(false);

  if (hasError) {
    return (
      <div className="w-[120px] h-[80px] bg-rose-50 border border-rose-200 rounded-lg flex items-center justify-center p-2 text-center text-[10px] text-rose-600 font-bold">
        ID image unavailable — re-scan required
      </div>
    );
  }

  return (
    <div 
      onClick={(e) => {
        e.stopPropagation();
        onViewFull(imageUrl);
      }}
      className="relative w-[120px] h-[80px] border border-slate-200 rounded-lg overflow-hidden cursor-pointer group shadow-sm hover:ring-2 hover:ring-blue-500 hover:ring-offset-1 transition-all bg-white"
    >
      <img
        src={imageUrl}
        alt="Customer ID Copy"
        referrerPolicy="no-referrer"
        onError={() => setHasError(true)}
        className="w-full h-full object-cover transition-transform duration-350 group-hover:scale-105"
      />
      <div className="absolute inset-0 bg-black/0 hover:bg-black/10 transition-colors flex items-center justify-center">
        <span className="opacity-0 group-hover:opacity-100 bg-black/60 text-white text-[9px] font-black uppercase px-1.5 py-0.5 rounded tracking-wider transition-opacity">
          View Full
        </span>
      </div>
    </div>
  );
}

interface DashboardProps {
  profile: UserProfile | null;
}

export default function Dashboard({ profile }: DashboardProps) {
  const { firestore, error: toastError } = useToast();
  const { settings } = useSettings();
  const { scan, isScanning } = useIDScanner();

  const [materials, setMaterials] = useState<Material[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [buyTickets, setBuyTickets] = useState<BuyTicket[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [doNotBuyList, setDoNotBuyList] = useState<DoNotBuyEntry[]>([]);
  const [dailySnapshots, setDailySnapshots] = useState<DailySnapshot[]>([]);
  const [pricingSnapshots, setPricingSnapshots] = useState<PricingSnapshot[]>([]);
  const [chartMode, setChartMode] = useState<'financial' | 'volume'>('financial');
  const [loading, setLoading] = useState(true);
  
  // Quick Ticket State
  const [showQuickTicket, setShowQuickTicket] = useState(false);
  const [showFullTicket, setShowFullTicket] = useState(false);
  const [isCustomerLookupOpen, setIsCustomerLookupOpen] = useState(false);
  const [customerSearch, setCustomerSearch] = useState('');
  const [step, setStep] = useState(1);
  const [qtCustomer, setQtCustomer] = useState<Customer | null>(null);
  const [qtNewCustomer, setQtNewCustomer] = useState({ 
    name: '', 
    phone: '', 
    secondaryPhone: '',
    email: '',
    address: '',
    businessName: '',
    idNumber: '',
    idType: "Driver's License",
    idExpiration: ''
  });
  const [isQtNewCustomer, setIsQtNewCustomer] = useState(false);
  const [qtItems, setQtItems] = useState<{ id: string, material: Material | null, gross: number, tare: number, deduction: number, overridePrice?: number, materialSearch?: string, isDropdownOpen?: boolean, photoUrl?: string }[]>([
    { id: Math.random().toString(36).substr(2, 9), material: null, gross: 0, tare: 0, deduction: 0, materialSearch: '', isDropdownOpen: false, photoUrl: '' }
  ]);
  const [qtProcessing, setQtProcessing] = useState(false);
  const [showPrintPreview, setShowPrintPreview] = useState(false);
  const [qtSuccess, setQtSuccess] = useState(false);
  const [qtVerificationStatus, setQtVerificationStatus] = useState<'idle' | 'verifying' | 'verified' | 'failed' | 'offline-saved'>('idle');
  const [qtCreatedTicketId, setQtCreatedTicketId] = useState<string>('');
  const [isPreviewOnly, setIsPreviewOnly] = useState(false);
  const [qtCustomerPhotoUrl, setQtCustomerPhotoUrl] = useState('');
  const [qtVehiclePhotoUrl, setQtVehiclePhotoUrl] = useState('');
  const [qtIdImageUrl, setQtIdImageUrl] = useState('');
  const [qtIdImageSource, setQtIdImageSource] = useState<'new' | 'on_file' | 'updated'>('new');
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [qtVehiclePlate, setQtVehiclePlate] = useState('');
  const [qtVehicleType, setQtVehicleType] = useState('');
  const [showQtIdConfirm, setShowQtIdConfirm] = useState(false);
  const [showQtVehicleConfirm, setShowQtVehicleConfirm] = useState(false);
  const [qtIdBypassed, setQtIdBypassed] = useState(false);
  const [qtVehicleBypassed, setQtVehicleBypassed] = useState(false);
  const [qtSignatureUrl, setQtSignatureUrl] = useState('');
  const [qtOhioDatabaseStatus, setQtOhioDatabaseStatus] = useState<'not_checked' | 'cleared' | 'flagged'>('not_checked');
  const [idCheckResult, setIdCheckResult] = useState<{ prohibited: boolean, reason?: string } | null>(null);
  const [showPinModal, setShowPinModal] = useState(false);
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [drafts, setDrafts] = useState<any[]>([]);
  const [resumeDraftId, setResumeDraftId] = useState<string | null>(null);
  const [isReadingID, setIsReadingID] = useState(false);
  const [isUSBScannerOpen, setIsUSBScannerOpen] = useState(false);
  const [usbScanFeedback, setUsbScanFeedback] = useState<{ type: 'success' | 'new', message: string } | null>(null);

  const handleQuickUSBScanSuccess = (result: {
    name: string;
    idNumber: string;
    address: string;
    idType: string;
    idExpiration: string;
  }) => {
    const existing = customers.find(c => c.idNumber && c.idNumber.replace(/[^A-Za-z0-9]/g, '').toUpperCase() === result.idNumber.replace(/[^A-Za-z0-9]/g, '').toUpperCase());
    
    if (existing) {
      setQtCustomer(existing);
      setQtNewCustomer({ name: '', phone: '', secondaryPhone: '', email: '', address: '', businessName: '', idNumber: '', idType: "Driver's License", idExpiration: '' });
      setIsQtNewCustomer(false);
      setUsbScanFeedback({
        type: 'success',
        message: `Selected existing customer: ${existing.name}`
      });
    } else {
      setQtCustomer(null);
      setQtNewCustomer({
        name: result.name,
        phone: '',
        secondaryPhone: '',
        email: '',
        address: result.address,
        businessName: '',
        idNumber: result.idNumber,
        idType: "Driver's License",
        idExpiration: result.idExpiration
      });
      setIsQtNewCustomer(true);
      setUsbScanFeedback({
        type: 'new',
        message: `Scanned DL for new customer: ${result.name}. Review fields below!`
      });
    }

    setTimeout(() => {
      setUsbScanFeedback(null);
    }, 6000);
  };

  const handleReadIDFromPhoto = async (imageUrl: string) => {
    setIsReadingID(true);
    try {
      const response = await fetch("/api/read-id", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idImageUrl: imageUrl }),
      });
      if (!response.ok) {
        throw new Error("Failed to read ID from photo");
      }
      const resData = await response.json();
      if (resData.success && resData.data) {
        const result = resData.data;
        if (qtCustomer) {
          // If a customer is already selected, do NOT overwrite the customer selection!
          // We can merge the OCR details if they are missing
          setQtCustomer(prev => {
            if (!prev) return null;
            return {
              ...prev,
              idNumber: prev.idNumber || result.idNumber || '',
              idType: prev.idType || result.idType || "Driver's License",
              idExpiration: prev.idExpiration || result.idExpiration || '',
              address: prev.address || result.address || '',
            };
          });
        } else {
          const existing = result.idNumber ? customers.find(c => c.idNumber === result.idNumber) : null;
          if (existing) {
            setQtCustomer(existing);
            setQtNewCustomer({ name: '', phone: '', secondaryPhone: '', email: '', address: '', businessName: '', idNumber: '', idType: "Driver's License", idExpiration: '' });
            setIsQtNewCustomer(false);
          } else {
            setQtCustomer(null);
            setQtNewCustomer({
              name: result.name || '',
              phone: result.phone || '',
              secondaryPhone: '',
              email: '',
              address: result.address || '',
              businessName: '',
              idNumber: result.idNumber || '',
              idType: result.idType || "Driver's License",
              idExpiration: result.idExpiration || ''
            });
            setIsQtNewCustomer(true);
          }
        }
      }
    } catch (error) {
      console.error("Error performing AI OCR on ID in Dashboard.tsx:", error);
    } finally {
      setIsReadingID(false);
    }
  };
  const [isCheckingOhioPortal, setIsCheckingOhioPortal] = useState(false);
  const [ohioCheckMessage, setOhioCheckMessage] = useState<string | null>(null);

  const runQtOhioCheck = async (customerName?: string, idNum?: string) => {
    const nameToCheck = customerName || qtCustomer?.name || qtNewCustomer.name || '';
    if (!nameToCheck || nameToCheck.trim() === '') return;

    setIsCheckingOhioPortal(true);
    setOhioCheckMessage(null);
    try {
      const response = await fetch("/api/check-ohio-db", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: nameToCheck,
          idNumber: idNum || qtCustomer?.idNumber || qtNewCustomer.idNumber || '',
          username: settings.ohioScrapUsername,
          password: settings.ohioScrapPassword
        })
      });

      if (!response.ok) {
        throw new Error("Portal check API responded with an error");
      }

      const res = await response.json();
      if (res.success) {
        setQtOhioDatabaseStatus(res.status);
        setOhioCheckMessage(`${res.message} (${res.source === 'state_portal' ? 'Live State Database' : 'Local Offline Database Sync'})`);
      }
    } catch (err) {
      console.error("Error executing auto Ohio check in Dashboard:", err);
      const localMatch = doNotBuyList.find(entry => namesMatch(entry.name, nameToCheck));
      if (localMatch) {
        setQtOhioDatabaseStatus('flagged');
        setOhioCheckMessage(`Connection failed. Local offline fallback match found: ${localMatch.reason}`);
      } else {
        setQtOhioDatabaseStatus('cleared');
        setOhioCheckMessage("Connection failed. Cleared against local offline Do-Not-Buy database.");
      }
    } finally {
      setIsCheckingOhioPortal(false);
    }
  };

  // Automatically trigger Ohio Homeland Security check when customer is selected or name is updated
  useEffect(() => {
    const activeName = qtCustomer?.name || qtNewCustomer.name;
    if (activeName && activeName.trim() !== '') {
      const activeId = qtCustomer?.idNumber || qtNewCustomer.idNumber;
      
      const timer = setTimeout(() => {
        if (qtOhioDatabaseStatus === 'not_checked') {
          runQtOhioCheck(activeName, activeId);
        }
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [qtCustomer?.id, qtNewCustomer.name, qtOhioDatabaseStatus]);

  // Automatically reset check status when customer changes
  useEffect(() => {
    setQtOhioDatabaseStatus('not_checked');
    setOhioCheckMessage(null);
  }, [qtCustomer?.id, qtNewCustomer.name]);

  // Recall last vehicle and other profile data for Quick Ticket when customer is selected
  useEffect(() => {
    if (qtCustomer) {
      // First, populate instantly from the selected customer's profile if fields exist
      if (qtCustomer.vehiclePlate) setQtVehiclePlate(qtCustomer.vehiclePlate);
      if (qtCustomer.vehicleType) setQtVehicleType(qtCustomer.vehicleType);
      if (qtCustomer.vehiclePhotoUrl) setQtVehiclePhotoUrl(qtCustomer.vehiclePhotoUrl);
      if (qtCustomer.photoUrl) setQtCustomerPhotoUrl(qtCustomer.photoUrl);
      if (qtCustomer.idImageUrl) {
        setQtIdImageUrl(qtCustomer.idImageUrl);
        setQtIdImageSource('on_file');
      } else {
        setQtIdImageUrl('');
        setQtIdImageSource('new');
      }

      // Now query historical tickets to backfill or get the most recent vehicle used
      const fetchLastVehicle = async () => {
        try {
          const ticketsRef = collection(db, 'buyTickets');
          const q = query(
            ticketsRef,
            where('customerId', '==', qtCustomer.id)
          );
          const querySnapshot = await getDocs(q);
          
          let vehiclePlate = qtCustomer.vehiclePlate || '';
          let vehicleType = qtCustomer.vehicleType || '';
          let vehiclePhotoUrl = qtCustomer.vehiclePhotoUrl || '';
          let customerPhotoUrl = qtCustomer.photoUrl || '';
          let idImageUrl = qtCustomer.idImageUrl || '';

          if (!querySnapshot.empty) {
            // Sort in-memory to prevent requiring composite index creation in Firestore
            const tickets = querySnapshot.docs
              .map(doc => doc.data() as BuyTicket)
              .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
            
            for (const ticket of tickets) {
              if (!vehiclePlate && ticket.vehiclePlate) vehiclePlate = ticket.vehiclePlate;
              if (!vehicleType && ticket.vehicleType) vehicleType = ticket.vehicleType;
              if (!vehiclePhotoUrl && ticket.vehiclePhotoUrl) vehiclePhotoUrl = ticket.vehiclePhotoUrl;
              if (!customerPhotoUrl && ticket.customerPhotoUrl) customerPhotoUrl = ticket.customerPhotoUrl;
              if (!idImageUrl && ticket.idImageUrl) idImageUrl = ticket.idImageUrl;
            }
          }

          if (vehiclePlate) setQtVehiclePlate(vehiclePlate);
          if (vehicleType) setQtVehicleType(vehicleType);
          if (vehiclePhotoUrl) setQtVehiclePhotoUrl(vehiclePhotoUrl);
          if (customerPhotoUrl) setQtCustomerPhotoUrl(customerPhotoUrl);
          if (idImageUrl) {
            setQtIdImageUrl(idImageUrl);
            setQtIdImageSource('on_file');
          }

        } catch (error) {
          console.error("Error fetching last vehicle for Quick Ticket:", error);
        }
      };
      fetchLastVehicle();
    } else {
      // Clear fields if no customer selected
      setQtVehiclePlate('');
      setQtVehicleType('');
      setQtVehiclePhotoUrl('');
      setQtCustomerPhotoUrl('');
      setQtIdImageUrl('');
      setQtIdImageSource('new');
    }
  }, [qtCustomer?.id]);

  const [dbHistoryAlert, setDbHistoryAlert] = useState<{
    isOpen: boolean;
    ticketId: string;
    customerName: string;
    totalAmount: number;
    timestamp: string;
  } | null>(null);

  const qtTotals = qtItems.reduce((acc, item) => {
    const physicalNet = roundNetWeight(Math.max(0, item.gross - item.tare));
    const paidWeight = Math.max(0, physicalNet - (item.deduction || 0));
    const price = item.overridePrice !== undefined ? item.overridePrice : (item.material?.buyPrice || 0);
    const amount = Math.round((paidWeight * price) * 100) / 100;
    return {
      netWeight: acc.netWeight + physicalNet,
      totalAmount: acc.totalAmount + amount
    };
  }, { netWeight: 0, totalAmount: 0 });

  const netWeight = qtTotals.netWeight;
  const totalAmount = qtTotals.totalAmount;

  // Auto-print effect for Quick Ticket
  useEffect(() => {
    if (qtSuccess && settings.autoPrint) {
      setShowPrintPreview(true);
    }
  }, [qtSuccess, settings.autoPrint]);

  useEffect(() => {
    if (!auth.currentUser) return;

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

    const unsubDailySnapshots = onSnapshot(
      query(collection(db, 'dailySnapshots'), orderBy('timestamp', 'desc')),
      (snapshot) => {
        setDailySnapshots(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as DailySnapshot[]);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'dailySnapshots')
    );

    const unsubPricingSnapshots = onSnapshot(
      query(collection(db, 'pricingSnapshots'), orderBy('timestamp', 'desc')),
      (snapshot) => {
        setPricingSnapshots(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as PricingSnapshot[]);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'pricingSnapshots')
    );

    const unsubDrafts = onSnapshot(query(
      collection(db, 'ticketDrafts'),
      where('userId', '==', auth.currentUser.uid)
    ), (snapshot) => {
      setDrafts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'ticketDrafts'));

    return () => {
      try { unsubMaterials(); } catch (e) { console.warn('unsubMaterials error', e); }
      try { unsubCustomers(); } catch (e) { console.warn('unsubCustomers error', e); }
      try { unsubTickets(); } catch (e) { console.warn('unsubTickets error', e); }
      try { unsubInventory(); } catch (e) { console.warn('unsubInventory error', e); }
      try { unsubDNB(); } catch (e) { console.warn('unsubDNB error', e); }
      try { unsubDailySnapshots(); } catch (e) { console.warn('unsubDailySnapshots error', e); }
      try { unsubPricingSnapshots(); } catch (e) { console.warn('unsubPricingSnapshots error', e); }
      try { unsubDrafts(); } catch (e) { console.warn('unsubDrafts error', e); }
    };
  }, [profile]);

  const resumeQuickDraft = async (draftId: string) => {
    try {
      const docRef = doc(db, 'ticketDrafts', draftId);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        const draft = docSnap.data();
        setStep(draft.step || 1);
        setIsQtNewCustomer(draft.isNewCustomer || false);
        if (draft.selectedCustomer) {
          setQtCustomer(draft.selectedCustomer);
        } else {
          setQtCustomer(null);
        }
        if (draft.newCustomer) {
          setQtNewCustomer({
            name: draft.newCustomer.name || '',
            phone: draft.newCustomer.phone || '',
            secondaryPhone: draft.newCustomer.secondaryPhone || '',
            email: draft.newCustomer.email || '',
            address: draft.newCustomer.address || '',
            businessName: draft.newCustomer.businessName || '',
            idNumber: draft.newCustomer.idNumber || '',
            idType: draft.newCustomer.idType || "Driver's License",
            idExpiration: draft.newCustomer.idExpiration || ''
          });
        }
        if (draft.items && materials.length > 0) {
          setQtItems(draft.items.map((i: any) => ({
            id: Math.random().toString(36).substr(2, 9),
            materialId: i.materialId || '',
            material: materials.find(m => m.id === i.materialId) || null,
            gross: i.grossWeight || 0,
            tare: i.tareWeight || 0,
            deduction: i.deduction || 0,
            overridePrice: i.overridePrice || undefined,
            materialSearch: materials.find(m => m.id === i.materialId)?.name || '',
            isDropdownOpen: false,
            photoUrl: i.photoUrl || ''
          })));
        }
        if (draft.ticketDetails) {
          setQtVehiclePlate(draft.ticketDetails.vehiclePlate || '');
          setQtVehicleType(draft.ticketDetails.vehicleType || '');
          setQtCustomerPhotoUrl(draft.ticketDetails.customerPhotoUrl || '');
          setQtIdImageUrl(draft.ticketDetails.idImageUrl || '');
          setQtVehiclePhotoUrl(draft.ticketDetails.vehiclePhotoUrl || '');
          setQtSignatureUrl(draft.ticketDetails.signatureUrl || '');
          setQtIdBypassed(draft.ticketDetails.idBypassed || false);
          setQtVehicleBypassed(draft.ticketDetails.vehicleBypassed || false);
        }
        setActiveDraftId(draftId);
        setSaveStatus('saved');
        setShowQuickTicket(true);
      }
    } catch (err) {
      console.error("Error resuming quick draft:", err);
    }
  };

  const saveQuickDraftToFirestore = async () => {
    if (!auth.currentUser || !showQuickTicket) return;
    const hasCustomer = qtCustomer || isQtNewCustomer || qtNewCustomer.name;
    const hasMaterials = qtItems.some(i => i.material || i.gross > 0);
    const hasVehicle = qtVehiclePlate || qtVehicleType;
    if (!hasCustomer && !hasMaterials && !hasVehicle) {
      return;
    }

    setSaveStatus('saving');
    try {
      const draftData = {
        userId: auth.currentUser.uid,
        createdByEmail: auth.currentUser.email || '',
        createdByName: profile?.displayName || '',
        timestamp: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
        type: 'quick',
        step,
        selectedCustomer: qtCustomer ? {
          id: qtCustomer.id,
          name: qtCustomer.name,
          phone: qtCustomer.phone || '',
          secondaryPhone: qtCustomer.secondaryPhone || '',
          email: qtCustomer.email || '',
          address: qtCustomer.address || '',
          businessName: qtCustomer.businessName || '',
          idType: qtCustomer.idType || '',
          idNumber: qtCustomer.idNumber || '',
          idExpiration: qtCustomer.idExpiration || ''
        } : null,
        isNewCustomer: isQtNewCustomer,
        newCustomer: qtNewCustomer,
        items: qtItems.map(i => ({
          materialId: i.material?.id || '',
          grossWeight: i.gross || 0,
          tareWeight: i.tare || 0,
          deduction: i.deduction || 0,
          overridePrice: i.overridePrice || 0,
          photoUrl: i.photoUrl || ''
        })),
        ticketDetails: {
          vehiclePlate: qtVehiclePlate || '',
          vehicleType: qtVehicleType || '',
          customerPhotoUrl: qtCustomerPhotoUrl || '',
          idImageUrl: qtIdImageUrl || '',
          vehiclePhotoUrl: qtVehiclePhotoUrl || '',
          signatureUrl: qtSignatureUrl || '',
          idBypassed: qtIdBypassed,
          vehicleBypassed: qtVehicleBypassed
        }
      };

      let draftId = activeDraftId;
      if (draftId) {
        await setDoc(doc(db, 'ticketDrafts', draftId), draftData);
      } else {
        const docRef = await addDoc(collection(db, 'ticketDrafts'), draftData);
        draftId = docRef.id;
        setActiveDraftId(draftId);
      }
      setSaveStatus('saved');
    } catch (err) {
      console.error("Error saving quick draft:", err);
      setSaveStatus('error');
    }
  };

  useEffect(() => {
    if (loading || qtSuccess || qtProcessing || !showQuickTicket) return;

    const hasCustomer = qtCustomer || isQtNewCustomer || qtNewCustomer.name;
    const hasMaterials = qtItems.some(i => i.material || i.gross > 0);
    const hasVehicle = qtVehiclePlate || qtVehicleType;
    if (!hasCustomer && !hasMaterials && !hasVehicle) {
      if (activeDraftId) {
        deleteDoc(doc(db, 'ticketDrafts', activeDraftId)).catch(console.error);
        setActiveDraftId(null);
      }
      return;
    }

    const timer = setTimeout(() => {
      saveQuickDraftToFirestore();
    }, 3000);

    return () => clearTimeout(timer);
  }, [step, qtCustomer, qtNewCustomer, qtItems, qtVehiclePlate, qtVehicleType, showQuickTicket]);

  const todayLocalDateString = new Date().toLocaleDateString('en-CA'); // "YYYY-MM-DD" timezone-safe
  const todayTickets = buyTickets.filter(t => {
    if (!t.timestamp) return false;
    const ticketLocalDate = new Date(t.timestamp).toLocaleDateString('en-CA');
    return ticketLocalDate === todayLocalDateString && t.status !== 'voided' && t.status !== 'cancelled';
  });

  // Helper to determine the historical sell price of a material on a specific day / timestamp
  const getSellPriceForDay = (materialId: string, timestamp: string): number => {
    if (!timestamp) return materials.find(m => m.id === materialId)?.salePrice || 0;
    const ticketDateStr = timestamp.split('T')[0]; // e.g. YYYY-MM-DD
    
    // 1. Check Daily Snapshots for that exact date
    const dailySnap = dailySnapshots.find(s => s.date === ticketDateStr);
    if (dailySnap) {
      const mat = dailySnap.materials?.find(m => m.id === materialId);
      if (mat && typeof mat.salePrice === 'number' && mat.salePrice > 0) {
        return mat.salePrice;
      }
    }

    // 2. Check Pricing Snapshots on or before the ticket's timestamp
    const sortedPricingSnaps = [...pricingSnapshots].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    const snapOnOrBefore = sortedPricingSnaps.find(s => s.timestamp <= timestamp);
    if (snapOnOrBefore) {
      const priceObj = snapOnOrBefore.prices?.find(p => p.materialId === materialId);
      if (priceObj && typeof priceObj.salePrice === 'number' && priceObj.salePrice > 0) {
        return priceObj.salePrice;
      }
    }

    // 3. Fallback to current material sale price
    const currentMat = materials.find(m => m.id === materialId);
    return currentMat?.salePrice || 0;
  };

  const totalSpent = todayTickets.reduce((sum, t) => sum + t.totalAmount, 0);
  const totalWeight = todayTickets.reduce((sum, t) => {
    const weight = (t.materials || []).reduce((mSum, m) => mSum + m.netWeight, 0);
    return sum + weight;
  }, 0);

  const todayEstResale = useMemo(() => {
    return todayTickets.reduce((sum, t) => {
      const ticketResale = (t.materials || []).reduce((mSum, m) => {
        const histSellPrice = getSellPriceForDay(m.materialId, t.timestamp);
        return mSum + (histSellPrice * m.netWeight);
      }, 0);
      return sum + ticketResale;
    }, 0);
  }, [todayTickets, dailySnapshots, pricingSnapshots, materials]);

  const todayEstProfit = Math.max(0, todayEstResale - totalSpent);
  const todayProfitMargin = todayEstResale > 0 ? (todayEstProfit / todayEstResale) * 100 : 0;

  const avgTicketValue = todayTickets.length > 0 ? totalSpent / todayTickets.length : 0;

  const todayHourlyData = useMemo(() => {
    const hourly: Record<string, { hour: string, sales: number, weight: number, count: number, revenue: number, profit: number }> = {};
    
    // Initialize standard yard business hours (7 AM to 6 PM)
    for (let i = 7; i <= 18; i++) {
      const hourStr = `${i === 12 ? 12 : i > 12 ? i - 12 : i} ${i >= 12 ? 'PM' : 'AM'}`;
      hourly[hourStr] = { hour: hourStr, sales: 0, weight: 0, count: 0, revenue: 0, profit: 0 };
    }

    todayTickets.forEach(ticket => {
      const ticketDate = new Date(ticket.timestamp);
      const h = ticketDate.getHours();
      const hourStr = `${h === 0 ? 12 : h > 12 ? h - 12 : h} ${h >= 12 ? 'PM' : 'AM'}`;
      if (!hourly[hourStr]) {
        hourly[hourStr] = { hour: hourStr, sales: 0, weight: 0, count: 0, revenue: 0, profit: 0 };
      }
      hourly[hourStr].sales += ticket.totalAmount;
      const ticketWeight = (ticket.materials || []).reduce((sum, m) => sum + m.netWeight, 0);
      hourly[hourStr].weight += ticketWeight;
      hourly[hourStr].count += 1;

      const ticketResale = (ticket.materials || []).reduce((mSum, m) => {
        const histSellPrice = getSellPriceForDay(m.materialId, ticket.timestamp);
        return mSum + (histSellPrice * m.netWeight);
      }, 0);
      hourly[hourStr].revenue += ticketResale;
      hourly[hourStr].profit += Math.max(0, ticketResale - ticket.totalAmount);
    });

    return Object.values(hourly);
  }, [todayTickets, dailySnapshots, pricingSnapshots, materials]);

  const isTicketToday = (timestamp?: string) => {
    if (!timestamp) return false;
    const ticketLocalDate = new Date(timestamp).toLocaleDateString('en-CA');
    return ticketLocalDate === todayLocalDateString;
  };

  const formatTicketTime = (timestamp?: string) => {
    if (!timestamp) return '';
    const dateObj = new Date(timestamp);
    const timeStr = dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (isTicketToday(timestamp)) {
      return timeStr;
    } else {
      const dateStr = dateObj.toLocaleDateString([], { month: 'short', day: 'numeric' });
      return `${dateStr} ${timeStr}`;
    }
  };

  // Derived state: materials transacted today
  const activeMaterials = (() => {
    // Calculate weights for today
    const weightsToday: { [materialId: string]: number } = {};
    todayTickets.forEach(ticket => {
      (ticket.materials || []).forEach(tm => {
        if (!tm.materialId) return;
        weightsToday[tm.materialId] = (weightsToday[tm.materialId] || 0) + tm.netWeight;
      });
    });

    const activeToday = materials
      .map(m => ({
        material: m,
        weight: weightsToday[m.id] || 0,
        isToday: true
      }))
      .filter(item => item.weight > 0)
      .sort((a, b) => b.weight - a.weight);

    return {
      items: activeToday,
      title: "Active Today",
      description: "Materials transacted today by highest volume"
    };
  })();

  const handleIDScan = async () => {
    const result = await scan();
    if (result.success) {
      const existing = customers.find(c => c.idNumber === result.idNumber);
      if (existing) {
        setQtCustomer(existing);
        setQtNewCustomer({ name: '', phone: '', secondaryPhone: '', email: '', address: '', businessName: '', idNumber: '', idType: "Driver's License", idExpiration: '' });
      } else {
        setQtCustomer(null);
        setQtNewCustomer({
          name: result.name || '',
          phone: '',
          secondaryPhone: '',
          email: '',
          address: result.address || '',
          businessName: '',
          idNumber: result.idNumber || '',
          idType: result.idType || "Driver's License",
          idExpiration: result.idExpiration || ''
        });
      }
    }
  };

  const handleQuickTicketSubmit = async () => {
    if (qtItems.some(item => !item.material || (item.gross - item.tare) <= 0) || (!qtCustomer && !qtNewCustomer.name)) return;

    // ── COMPLIANCE HARD BLOCK: Ohio ORC 4737.04 ──────────────────────────
    // ID card image is REQUIRED. No bypass permitted.
    // A missing ID image produces error code 116 and rejects the Ohio upload.
    if (!qtIdImageUrl) {
      toastError('Ohio Compliance Error 116', "Ohio ORC 4737.04 Compliance: Government ID photo copy is REQUIRED. Transaction blocked until ID photo is captured.");
      alert("Ohio Compliance Error 116: Government ID photo copy is REQUIRED by Ohio law (ORC 4737.04). Transaction blocked until ID photo is captured.");
      return; // hard stop — cannot proceed without ID image
    }

    // Seller photo is REQUIRED. No bypass permitted.
    // A missing seller photo produces error code 117 and rejects the Ohio upload.
    if (!qtCustomerPhotoUrl) {
      toastError('Ohio Compliance Error 117', "Ohio ORC 4737.04 Compliance: Customer face photo is REQUIRED. Transaction blocked until customer photo is captured.");
      alert("Ohio Compliance Error 117: Customer face photo is REQUIRED by Ohio law (ORC 4737.04). Transaction blocked until seller photo is captured.");
      return; // hard stop — cannot proceed without customer photo
    }
    // ─────────────────────────────────────────────────────────────────────

    // Ohio DPS database check compliance block
    if (qtOhioDatabaseStatus === 'not_checked') {
      alert('Ohio DPS check has not been run for this seller. The database check is required before completing a transaction. Please wait for the check to complete or run it manually.');
      return;
    }

    if (qtOhioDatabaseStatus === 'flagged') {
      return; // hard stop — UI shows flagged state
    }

    if ((!qtVehiclePlate || !qtVehiclePhotoUrl || !qtVehicleType) && !qtVehicleBypassed) {
      setShowQtVehicleConfirm(true);
      return;
    }

    // Check for price overrides
    const hasOverrides = qtItems.some(item => {
      if (item.overridePrice === undefined) return false;
      const originalPrice = item.material?.buyPrice || 0;
      const newPrice = item.overridePrice;
      const diff = Math.abs(newPrice - originalPrice);
      // Only require manager pin if override is more than 12% of material's price
      return originalPrice === 0 ? (diff > 0) : (diff / originalPrice > 0.12);
    });

    const anyAdjustments = qtItems.some(item => {
      if (item.overridePrice === undefined) return false;
      return item.overridePrice !== (item.material?.buyPrice || 0);
    });

    const restrictRetroactive = profile?.role === 'cashier' && !profile?.permissions?.canRetroactivePriceAdjustments;

    if ((hasOverrides || (restrictRetroactive && anyAdjustments)) && profile?.role === 'cashier') {
      setShowPinModal(true);
      return;
    }

    await saveQuickTicket();
  };

  const saveQuickTicket = async () => {
    setQtProcessing(true);
    setQtVerificationStatus('verifying');
    setQtCreatedTicketId('');
    try {
      let customerId = qtCustomer?.id;

      // Create new customer if needed
      if (!customerId && qtNewCustomer.name) {
        try {
          const custRef = await addDoc(collection(db, 'customers'), {
            name: qtNewCustomer.name || '',
            phone: qtNewCustomer.phone || '',
            secondaryPhone: qtNewCustomer.secondaryPhone || '',
            email: qtNewCustomer.email || '',
            address: qtNewCustomer.address || '',
            businessName: qtNewCustomer.businessName || '',
            idNumber: qtNewCustomer.idNumber || '',
            idType: qtNewCustomer.idType || "Driver's License",
            idExpiration: qtNewCustomer.idExpiration || '',
            photoUrl: qtCustomerPhotoUrl || '',
            idImageUrl: qtIdImageUrl || '',
            idImageUpdatedAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          });
          customerId = custRef.id;
        } catch (error) {
          handleFirestoreError(error, OperationType.CREATE, 'customers');
        }
      }

      if (!customerId) throw new Error("Customer ID missing");

      const ticketMaterials: BuyTicketMaterial[] = qtItems.map(item => {
        const physicalNet = roundNetWeight(Math.max(0, item.gross - item.tare));
        const paidWeight = Math.max(0, physicalNet - (item.deduction || 0));
        const price = item.overridePrice !== undefined ? item.overridePrice : item.material!.buyPrice;
        return {
          materialId: item.material!.id,
          grossWeight: item.gross,
          tareWeight: item.tare,
          netWeight: physicalNet, // Store physical net (Gross - Tare)
          pricePerUnit: price,
          totalAmount: Math.round((paidWeight * price) * 100) / 100,
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
        vehiclePlate: qtVehiclePlate || '',
        vehicleType: qtVehicleType || '',
        paymentMethod: 'cash',
        notes: '',
        customerPhotoUrl: qtCustomerPhotoUrl || '',
        vehiclePhotoUrl: qtVehiclePhotoUrl || '',
        idImageUrl: qtIdImageUrl || '',
        signatureUrl: qtSignatureUrl || '',
        ohioDatabaseStatus: qtOhioDatabaseStatus || 'not_checked',
        createdBy: profile?.uid || '',
        createdByName: profile?.displayName || profile?.email || 'System'
      };

      const ticketId = generateTicketId('BUY');
      const docRef = doc(db, 'buyTickets', ticketId);
      await setDoc(docRef, ticketData);
      setQtCreatedTicketId(docRef.id);
      
      // Log ticket creation
      await logAuditEvent(
        'buyTicket',
        docRef.id,
        'create',
        { after: ticketData },
        `Buy Ticket created (Quick Ticket) for ${qtCustomer?.name || qtNewCustomer.name || 'Customer'}`
      );

      // Check and log price overrides
      for (const item of ticketMaterials) {
        const mat = materials.find(m => m.id === item.materialId);
        if (mat && item.pricePerUnit !== mat.buyPrice) {
          await logAuditEvent(
            'buyTicket',
            docRef.id,
            'override',
            {
              before: { price: mat.buyPrice },
              after: { price: item.pricePerUnit }
            },
            `Price override approved for ${mat.name} in Buy Ticket #${docRef.id.toUpperCase()} (Quick Ticket): $${mat.buyPrice.toFixed(2)}/lb to $${item.pricePerUnit.toFixed(2)}/lb`
          );
        }
      }

      // Update customer profile with any and all annotated data from this ticket (photos, vehicle info, and profile info)
      const customerUpdate: any = {};
      if (qtCustomerPhotoUrl) customerUpdate.photoUrl = qtCustomerPhotoUrl;
      if (qtIdImageUrl) {
        customerUpdate.idImageUrl = qtIdImageUrl;
        if (qtIdImageSource === 'updated') {
          customerUpdate.idImageUpdatedAt = ticketData.timestamp;
        }
      }
      if (qtVehiclePlate) customerUpdate.vehiclePlate = qtVehiclePlate;
      if (qtVehicleType) customerUpdate.vehicleType = qtVehicleType;
      if (qtVehiclePhotoUrl) customerUpdate.vehiclePhotoUrl = qtVehiclePhotoUrl;

      if (qtCustomer) {
        customerUpdate.phone = qtCustomer.phone || '';
        customerUpdate.secondaryPhone = qtCustomer.secondaryPhone || '';
        customerUpdate.email = qtCustomer.email || '';
        customerUpdate.address = qtCustomer.address || '';
        customerUpdate.businessName = qtCustomer.businessName || '';
        customerUpdate.idType = qtCustomer.idType || '';
        customerUpdate.idNumber = qtCustomer.idNumber || '';
        customerUpdate.idExpiration = qtCustomer.idExpiration || '';
        if (qtCustomer.idImageUpdatedAt && !customerUpdate.idImageUpdatedAt) {
          customerUpdate.idImageUpdatedAt = qtCustomer.idImageUpdatedAt;
        }
      }

      if (Object.keys(customerUpdate).length > 0) {
        await updateDoc(doc(db, 'customers', customerId), {
          ...customerUpdate,
          updatedAt: new Date().toISOString()
        });
      }

      // Update Inventory for each material
      for (const item of ticketMaterials) {
        const invRef = doc(db, 'inventory', item.materialId);
        let exists = false;
        let oldWeight = 0;

        try {
          const fetchPromise = getDoc(invRef);
          const timeoutPromise = new Promise<null>((_, reject) => setTimeout(() => reject(new Error('timeout')), 1200));
          const invDoc = await Promise.race([fetchPromise, timeoutPromise]) as any;
          if (invDoc && invDoc.exists()) {
            exists = true;
            oldWeight = invDoc.data().currentWeight || 0;
          }
        } catch (err) {
          console.warn(`Could not fetch inventory from server, checking local cache:`, err);
          try {
            const cachedDoc = await getDocFromCache(invRef);
            if (cachedDoc.exists()) {
              exists = true;
              oldWeight = cachedDoc.data().currentWeight || 0;
            }
          } catch (cacheErr) {
            console.warn(`Inventory not found in local cache:`, cacheErr);
          }
        }

        // Perform write/merge locally - sets or merges currentWeight increment atomically
        await setDoc(invRef, {
          materialId: item.materialId,
          currentWeight: increment(item.netWeight),
          lastUpdated: new Date().toISOString()
        }, { merge: true });

        // Log the audit event with the available information
        await logAuditEvent(
          'inventory',
          item.materialId,
          exists ? 'update' : 'create',
          { 
            before: { weight: exists ? oldWeight : 0, isOfflineFallback: !exists },
            after: { weight: oldWeight + item.netWeight }
          },
          exists 
            ? `Inventory updated via Buy Ticket ${docRef.id} (Quick Ticket)`
            : `Initial inventory created via Buy Ticket ${docRef.id} (Quick Ticket)`
        );
      }

      // Verification Step: read back the document to ensure it's in the DB/local cache
      let isVerified = false;
      let isOfflineMode = false;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          if (typeof navigator !== 'undefined' && !navigator.onLine) {
            isOfflineMode = true;
            const cachedSnap = await getDocFromCache(doc(db, 'buyTickets', docRef.id));
            if (cachedSnap.exists()) {
              isVerified = true;
              break;
            }
          } else {
            const fetchPromise = getDoc(doc(db, 'buyTickets', docRef.id));
            const timeoutPromise = new Promise<null>((_, reject) => setTimeout(() => reject(new Error('timeout')), 1000));
            const docSnap = await Promise.race([fetchPromise, timeoutPromise]) as any;
            if (docSnap && docSnap.exists()) {
              isVerified = true;
              break;
            }
          }
        } catch (err) {
          console.warn(`Firestore verification attempt ${attempt} failed, checking cache:`, err);
          try {
            const cachedSnap = await getDocFromCache(doc(db, 'buyTickets', docRef.id));
            if (cachedSnap.exists()) {
              isVerified = true;
              break;
            }
          } catch (cacheErr) {
            // ignore
          }
        }
        await new Promise(resolve => setTimeout(resolve, 300));
      }

      const statusValue = isVerified 
        ? ((typeof navigator !== 'undefined' && !navigator.onLine) || isOfflineMode ? 'offline-saved' : 'verified')
        : 'failed';

      setQtVerificationStatus(statusValue);
      if (activeDraftId) {
        await deleteDoc(doc(db, 'ticketDrafts', activeDraftId));
        setActiveDraftId(null);
      }
      setQtSuccess(true);
      
      // Immediately trigger the print dialogue automatically for the quick ticket flow
      const tempTicket: BuyTicket = {
        id: docRef.id,
        customerId,
        materials: ticketMaterials,
        totalAmount: totalAmount || 0,
        status: 'completed',
        timestamp: ticketData.timestamp,
        paymentMethod: 'cash',
        customerPhotoUrl: qtCustomerPhotoUrl || '',
        vehiclePhotoUrl: qtVehiclePhotoUrl || '',
        idImageUrl: qtIdImageUrl || '',
        vehiclePlate: qtVehiclePlate || '',
        vehicleType: qtVehicleType || '',
        signatureUrl: qtSignatureUrl || ''
      };

      try {
        await printTicket(
          <BuyTicketPrint 
            ticket={tempTicket} 
            customerName={qtCustomer?.name || qtNewCustomer.name || 'N/A'} 
            materials={materials} 
            format={settings.receiptFormat}
          />,
          { format: settings.receiptFormat, debugMode: settings.debugPrintMode }
        );
      } catch (printErr) {
        console.error('Auto-print from Quick Ticket failed:', printErr);
      }

      firestore(
        'Ticket Saved & Printed',
        `Quick Ticket #${docRef.id.toUpperCase()} successfully written to Firestore and sent to printer.`
      );

      // Automatically close the quick ticket and reset all state to save a click or two!
      setShowQuickTicket(false);
      resetQuickTicket();
    } catch (error: any) {
      console.error('Error creating quick ticket:', error);
      setQtVerificationStatus('failed');
      toastError('Save Failed', `Failed to save Quick Ticket: ${error.message || error}`);
      handleFirestoreError(error, OperationType.CREATE, 'buyTickets');
    } finally {
      setQtProcessing(false);
    }
  };

  const resetQuickTicket = () => {
    if (activeDraftId) {
      deleteDoc(doc(db, 'ticketDrafts', activeDraftId)).catch(console.error);
      setActiveDraftId(null);
    }
    setShowQuickTicket(false);
    setStep(1);
    setQtCustomer(null);
    setQtNewCustomer({ name: '', phone: '', secondaryPhone: '', email: '', address: '', businessName: '', idNumber: '', idType: "Driver's License", idExpiration: '' });
    setIsQtNewCustomer(false);
    setQtItems([{ id: Math.random().toString(36).substr(2, 9), material: null, gross: 0, tare: 0, deduction: 0, materialSearch: '', isDropdownOpen: false, photoUrl: '' }]);
    setQtCustomerPhotoUrl('');
    setQtVehiclePhotoUrl('');
    setQtIdImageUrl('');
    setQtIdImageSource('new');
    setQtVehiclePlate('');
    setQtVehicleType('');
    setShowQtIdConfirm(false);
    setShowQtVehicleConfirm(false);
    setQtIdBypassed(false);
    setQtVehicleBypassed(false);
    setQtSignatureUrl('');
    setQtOhioDatabaseStatus('not_checked');
    setQtSuccess(false);
    setQtVerificationStatus('idle');
    setQtCreatedTicketId('');
    setIdCheckResult(null);
  };

  const checkDoNotBuy = () => {
    const nameToCheck = qtCustomer?.name || qtNewCustomer.name;
    const match = doNotBuyList.find(entry => namesMatch(entry.name, nameToCheck));
    
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

      {/* Pending Ticket Area */}
      {drafts.length > 0 && (
        <section className="bg-amber-50/70 border border-amber-200 rounded-3xl p-6 space-y-4 animate-in fade-in slide-in-from-top-4 duration-300">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-black text-amber-800 uppercase tracking-wider flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-amber-600" />
                Pending & Unfinished Tickets Drawer
              </h2>
              <p className="text-xs text-amber-700/80 mt-1">
                A laptop closure or battery loss was detected, auto-saving your draft. Choose robust or quick ticket to resume:
              </p>
            </div>
            <span className="px-3 py-1 bg-amber-100 text-amber-800 text-[10px] font-black uppercase tracking-widest rounded-full">
              {drafts.length} Pending
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {drafts.map((d) => (
              <div key={d.id} className="bg-white p-5 rounded-2xl border border-amber-200/60 shadow-sm flex flex-col justify-between space-y-4 hover:shadow-md transition-all">
                <div>
                  <div className="flex justify-between items-start">
                    <span className="px-2.5 py-1 bg-amber-50 text-amber-800 text-[10px] font-black uppercase tracking-widest rounded-lg">
                      {d.type === 'quick' ? 'Quick Buy' : 'Full Buy'} (Step {d.step || 1})
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">
                      {d.timestamp ? new Date(d.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                    </span>
                  </div>
                  <h3 className="font-bold text-slate-800 text-sm mt-3">
                    {d.selectedCustomer?.name || d.newCustomer?.name || 'Walk-in Customer'}
                  </h3>
                  <div className="mt-1 flex items-center gap-4 text-xs text-slate-400">
                    <span>{d.items?.length || 0} Materials</span>
                    {d.ticketDetails?.vehiclePlate && (
                      <span className="flex items-center gap-1 font-mono">
                        <Truck className="w-3 h-3" /> {d.ticketDetails.vehiclePlate}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex gap-2 pt-2 border-t border-slate-100">
                  <button
                    onClick={() => {
                      if (d.type === 'quick') {
                        resumeQuickDraft(d.id);
                      } else {
                        setResumeDraftId(d.id);
                        setShowFullTicket(true);
                      }
                    }}
                    className="flex-grow py-2.5 bg-slate-900 text-white rounded-xl text-xs font-bold hover:bg-slate-800 transition-all text-center"
                  >
                    Resume Ticket
                  </button>
                  <button
                    onClick={async () => {
                      if (confirm("Discard this ticket draft?")) {
                        await deleteDoc(doc(db, 'ticketDrafts', d.id));
                        if (activeDraftId === d.id) {
                          setActiveDraftId(null);
                        }
                      }
                    }}
                    className="p-2.5 border border-slate-200 hover:border-red-200 hover:text-red-500 rounded-xl transition-all"
                    title="Discard Draft"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

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
              <TrendingUp className="w-5 h-5 text-purple-600" aria-hidden="true" />
            </div>
            {todayTickets.length > 0 && <ArrowUpRight className="w-4 h-4 text-purple-500" aria-hidden="true" />}
          </div>
          <p className="text-sm font-black text-slate-400 uppercase tracking-widest">Est. Sales (Revenue)</p>
          <p className={cn("text-3xl font-black text-slate-900 mt-1 font-display tracking-tight", settings.theme === 'dark' && "text-white")}>
            ${todayEstResale.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        </div>
        <div className={cn("bg-white p-6 rounded-xl border border-slate-200 shadow-sm", settings.theme === 'dark' && "bg-slate-900 border-slate-800", settings.compactMode && "p-4")}>
          <div className="flex items-center justify-between mb-4">
            <div className="p-2 bg-emerald-50 rounded-lg">
              <CheckCircle2 className="w-5 h-5 text-emerald-600" aria-hidden="true" />
            </div>
            <span className="text-[10px] font-black px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded-md">
              {todayProfitMargin.toFixed(1)}% Spread
            </span>
          </div>
          <p className="text-sm font-black text-slate-400 uppercase tracking-widest">Est. Spread Profit</p>
          <p className={cn("text-3xl font-black text-emerald-600 mt-1 font-display tracking-tight")}>
            ${todayEstProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
        </div>
      </section>

      {/* Today's Sales Performance & Hourly Granularity Chart */}
      <section className={cn("bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-6", settings.theme === 'dark' && "bg-slate-900 border-slate-800")} aria-label="Today's Sales Velocity">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className={cn("font-black text-slate-900 uppercase tracking-widest text-xs", settings.theme === 'dark' && "text-white")}>Today's Performance Velocity</h3>
            <p className="text-xs text-slate-400 font-medium mt-0.5">
              {chartMode === 'financial' ? "Hourly distribution of purchases, est. resale value, and spread profit." : "Hourly distribution of scrap volume received in pounds."}
            </p>
          </div>
          
          <div className="flex flex-wrap items-center gap-4">
            {/* Toggle controls */}
            <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
              <button
                onClick={() => setChartMode('financial')}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-wider transition-all",
                  chartMode === 'financial' 
                    ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white" 
                    : "text-slate-500 hover:text-slate-800 dark:text-slate-400"
                )}
              >
                Financial Spread
              </button>
              <button
                onClick={() => setChartMode('volume')}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-wider transition-all",
                  chartMode === 'volume' 
                    ? "bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white" 
                    : "text-slate-500 hover:text-slate-800 dark:text-slate-400"
                )}
              >
                Volume (lb)
              </button>
            </div>

            {/* Custom Legend */}
            <div className="flex items-center gap-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">
              {chartMode === 'financial' ? (
                <>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 bg-blue-600 rounded-full"></span>
                    <span>Payout (Cost)</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 bg-purple-500 rounded-full"></span>
                    <span>Est. Resale</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 bg-emerald-500 rounded-full"></span>
                    <span>Spread Profit</span>
                  </div>
                </>
              ) : (
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 bg-amber-500 rounded-full"></span>
                  <span>Scrap Volume (lb)</span>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="h-64 w-full">
          {todayTickets.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={todayHourlyData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#2563eb" stopOpacity={0.15}/>
                    <stop offset="95%" stopColor="#2563eb" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#a855f7" stopOpacity={0.15}/>
                    <stop offset="95%" stopColor="#a855f7" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorProfit" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.15}/>
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorWeight" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.15}/>
                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <XAxis 
                  dataKey="hour" 
                  stroke="#94a3b8" 
                  fontSize={10} 
                  fontWeight="bold"
                  tickLine={false} 
                  axisLine={false}
                />
                <YAxis 
                  stroke="#94a3b8" 
                  fontSize={10} 
                  fontWeight="bold"
                  tickLine={false} 
                  axisLine={false}
                  tickFormatter={(v) => chartMode === 'financial' ? `$${v}` : `${v}lb`}
                />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: settings.theme === 'dark' ? '#1e293b' : '#ffffff', 
                    borderRadius: '12px', 
                    border: '1px solid #e2e8f0',
                    fontSize: '11px',
                    fontWeight: 'bold'
                  }} 
                />
                {chartMode === 'financial' ? (
                  <>
                    <Area 
                      type="monotone" 
                      dataKey="revenue" 
                      stroke="#a855f7" 
                      strokeWidth={2.5}
                      fillOpacity={1} 
                      fill="url(#colorRevenue)" 
                      name="Est. Resale ($)"
                    />
                    <Area 
                      type="monotone" 
                      dataKey="sales" 
                      stroke="#2563eb" 
                      strokeWidth={2}
                      fillOpacity={1} 
                      fill="url(#colorSales)" 
                      name="Payout Cost ($)"
                    />
                    <Area 
                      type="monotone" 
                      dataKey="profit" 
                      stroke="#10b981" 
                      strokeWidth={2}
                      fillOpacity={1} 
                      fill="url(#colorProfit)" 
                      name="Spread Profit ($)"
                    />
                  </>
                ) : (
                  <Area 
                    type="monotone" 
                    dataKey="weight" 
                    stroke="#f59e0b" 
                    strokeWidth={2.5}
                    fillOpacity={1} 
                    fill="url(#colorWeight)" 
                    name="Volume (lb)"
                  />
                )}
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-full w-full flex flex-col items-center justify-center text-slate-400 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700">
              <BarChart3 className="w-8 h-8 text-slate-300 mb-2 animate-pulse" />
              <p className="text-xs font-bold uppercase tracking-wider">No Sales Velocity Data Yet</p>
              <p className="text-[10px] text-slate-400 mt-1">Transactions logged today will populate this real-time hourly graph.</p>
            </div>
          )}
        </div>
      </section>

      <div className={cn("grid grid-cols-1 lg:grid-cols-2 gap-8", settings.compactMode && "gap-4")}>
        {/* Recent Activity */}
        <section className={cn("bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden", settings.theme === 'dark' && "bg-slate-900 border-slate-800")} aria-label="Recent Activity">
          <div className={cn("p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50", settings.theme === 'dark' && "bg-slate-800 border-slate-700")}>
            <h3 className={cn("font-black text-slate-900 uppercase tracking-widest text-xs", settings.theme === 'dark' && "text-white")}>Today's Transactions</h3>
            <Link to="/buy-tickets" className="text-xs font-black text-blue-600 hover:text-blue-700 uppercase tracking-widest outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded-md px-1">View All</Link>
          </div>
          <div className="divide-y divide-slate-50 dark:divide-slate-800">
            {todayTickets.slice(0, settings.compactMode ? 3 : 5).map((ticket) => (
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
                  <p className="text-[10px] text-slate-400 uppercase font-semibold">{formatTicketTime(ticket.timestamp)}</p>
                </div>
              </div>
            ))}
            {todayTickets.length === 0 && (
              <div className="p-12 text-center text-slate-400">
                <p>No transactions recorded today.</p>
              </div>
            )}
          </div>
        </section>

        {/* Inventory Summary */}
        <section className={cn("bg-white rounded-3xl border border-slate-200 shadow-sm p-6", settings.theme === 'dark' && "bg-slate-900 border-slate-800")} aria-label="Inventory Summary">
          <div className="flex flex-col mb-6">
            <h3 className={cn("font-black text-slate-900 uppercase tracking-widest text-xs", settings.theme === 'dark' && "text-white")}>{activeMaterials.title}</h3>
            <span className="text-[10px] text-slate-400 font-bold uppercase mt-0.5">{activeMaterials.description}</span>
          </div>
          <div className={cn("space-y-6", settings.compactMode && "space-y-4")}>
            {activeMaterials.items.slice(0, settings.compactMode ? 3 : 5).map((item) => {
              // Calculate relative progress bar width based on the highest weight in activeMaterials.items (with a min denominator of 500 lb)
              const maxWeightInGroup = Math.max(...activeMaterials.items.map(i => i.weight), 500);
              const percentage = Math.min((item.weight / maxWeightInGroup) * 100, 100);
              
              return (
                <div key={item.material.id} className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className={cn("font-semibold text-slate-700", settings.theme === 'dark' && "text-slate-300")}>{item.material.name}</span>
                    <span className="text-slate-500 font-bold">{item.weight.toLocaleString()} lb</span>
                  </div>
                  <div className={cn("h-2 bg-slate-100 rounded-full overflow-hidden", settings.theme === 'dark' && "bg-slate-800")} role="progressbar" aria-valuenow={percentage} aria-valuemin={0} aria-valuemax={100}>
                    <div 
                      className={cn(
                        "h-full rounded-full transition-all duration-500",
                        item.weight < 500 ? "bg-amber-500" : "bg-blue-600"
                      )}
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                </div>
              );
            })}
            {activeMaterials.items.length === 0 && (
              <div className="py-8 text-center text-slate-400 text-sm font-medium">
                No active material transactions to show.
              </div>
            )}
          </div>
          <div className="mt-8">
            <Link to="/inventory" className={cn("block text-center py-3 bg-slate-50 text-slate-600 rounded-lg text-sm font-bold hover:bg-slate-100 transition-all outline-none focus-visible:ring-2 focus-visible:ring-slate-400", settings.theme === 'dark' && "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white")}>
              Full Inventory Report
            </Link>
          </div>
        </section>
      </div>

      {/* Version Footer */}
      <footer id="dashboard-version-footer" className="text-center pt-10 pb-4">
        <p className={cn("text-xs font-semibold text-slate-400 tracking-wider uppercase", settings.theme === 'dark' && "text-slate-600")}>
          {COMPANY_NAME} • Build V{APP_VERSION}
        </p>
      </footer>

      {/* Quick Ticket Modal */}
      {showQuickTicket && (
        <div 
          className="fixed inset-0 bg-slate-900/60 z-[100] flex items-start justify-center p-4 backdrop-blur-sm overflow-y-auto"
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
                <div className="py-12 text-center space-y-6">
                  <div className={cn(
                    "w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4 animate-bounce",
                    qtVerificationStatus === 'offline-saved'
                      ? "bg-amber-100 text-amber-655 font-bold"
                      : "bg-green-100 text-green-600"
                  )}>
                    <CheckCircle2 className="w-10 h-10" />
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-2xl font-black text-slate-900 tracking-tight">
                      {qtVerificationStatus === 'offline-saved' ? 'Saved Locally!' : 'Ticket Completed!'}
                    </h3>
                    <p className="text-slate-500 max-w-md mx-auto text-sm">
                      {qtVerificationStatus === 'offline-saved'
                        ? "Saved to local offline queue. Once internet connection is restored, this ticket will automatically synchronize with cloud servers."
                        : "The payout has been recorded, inventory has been recalculated, and the transaction was securely written and verified."
                      }
                    </p>
                  </div>

                  <div className="max-w-md mx-auto bg-slate-50 border border-slate-200 rounded-2xl p-5 text-left space-y-4 shadow-sm">
                    <div className="flex items-center justify-between border-b border-slate-200 pb-2.5">
                      <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Database Integrity &amp; Sync</span>
                      {qtVerificationStatus === 'verifying' && (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-black bg-amber-100 text-amber-800 rounded-full">
                          <Loader2 className="w-3 animate-spin" /> VERIFYING Sync...
                        </span>
                      )}
                      {qtVerificationStatus === 'verified' && (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-black bg-green-100 text-green-800 rounded-full">
                          <div className="w-1.5 h-1.5 bg-green-600 rounded-full" /> SECURELY STORED
                        </span>
                      )}
                      {qtVerificationStatus === 'offline-saved' && (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-black bg-amber-100 text-amber-800 rounded-full border border-amber-200">
                          <div className="w-1.5 h-1.5 bg-amber-600 rounded-full inline-block animate-pulse" /> OFFLINE SAVED
                        </span>
                      )}
                      {qtVerificationStatus === 'failed' && (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-black bg-red-100 text-red-800 rounded-full">
                          UNCONFIRMED
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-y-3 text-sm">
                      <span className="text-slate-400">Verifying Ticket ID:</span>
                      <span className="font-mono font-bold text-right text-slate-800 break-all">{qtCreatedTicketId || 'Writing...'}</span>
                      
                      <span className="text-slate-400">Customer:</span>
                      <span className="font-bold text-right text-slate-800">{qtCustomer?.name || qtNewCustomer.name || 'Unknown'}</span>
                      
                      <span className="text-slate-400">Total Net Weight:</span>
                      <span className="font-bold text-right text-slate-800">{netWeight} lb</span>
                      
                      <span className="text-slate-400">Total Payout:</span>
                      <span className="font-mono font-black text-right text-green-600">${totalAmount.toFixed(2)}</span>
                    </div>
                  </div>

                  <div className="pt-4 flex justify-center gap-3">
                    <button 
                      onClick={() => setShowPrintPreview(true)}
                      className="px-8 py-4 border-2 border-slate-900 text-slate-900 rounded-2xl font-bold hover:bg-slate-50 transition-all outline-none focus-visible:ring-2 focus-visible:ring-slate-400 flex items-center gap-2"
                    >
                      <Printer className="w-5 h-5" />
                      Print Ticket Receipt
                    </button>
                    <button 
                      onClick={resetQuickTicket} 
                      className="px-8 py-4 bg-slate-900 text-white rounded-2xl font-bold hover:bg-slate-800 transition-all outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2"
                    >
                      Close Window & Reset
                    </button>
                  </div>
                </div>
              ) : (
                <div className="min-h-[400px] flex flex-col">
                  {/* Ohio DB Banner */}
                  {step >= 2 && (qtCustomer || qtNewCustomer.name) && (
                    <div className="mb-6 space-y-3">
                      {qtOhioDatabaseStatus === 'flagged' && (
                        <div className="p-4 bg-red-100 border-2 border-red-500 rounded-xl text-red-800 animate-in fade-in duration-200">
                          <p className="font-black text-xs flex items-center gap-2">
                            <span>⛔ TRANSACTION BLOCKED — This seller is on the Ohio Do-Not-Buy list. You are prohibited from purchasing from this individual under Ohio ORC 4737.04. Do not proceed.</span>
                          </p>
                          {(() => {
                            const dnbMatch = doNotBuyList.find(entry => namesMatch(entry.name, qtCustomer?.name || qtNewCustomer.name || ''));
                            const dnbReason = dnbMatch?.reason || ohioCheckMessage || '';
                            return dnbReason ? (
                              <p className="text-[10px] font-bold text-red-700 mt-2 bg-red-50 p-2 rounded-lg border border-red-200">
                                DNB Reason: {dnbReason}
                              </p>
                            ) : null;
                          })()}
                        </div>
                      )}
                      {qtOhioDatabaseStatus === 'not_checked' && (
                        <div className="p-4 bg-amber-50 border border-amber-300 rounded-xl text-amber-800 font-bold text-xs flex items-center gap-2 animate-pulse">
                          <span className="w-2 h-2 bg-amber-500 rounded-full animate-ping" />
                          <span>Ohio DPS check in progress — please wait before continuing.</span>
                        </div>
                      )}
                      {qtOhioDatabaseStatus === 'cleared' && (
                        <div className="p-4 bg-emerald-50 border border-emerald-300 rounded-xl text-emerald-800 font-bold text-xs flex items-center gap-2">
                          <span className="w-2 h-2 bg-emerald-500 rounded-full" />
                          <span>Ohio DPS check cleared — seller is not on the Do-Not-Buy list.</span>
                        </div>
                      )}
                    </div>
                  )}

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

                                          return aCode.localeCompare(bCode, undefined, { numeric: true, sensitivity: 'base' });
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
                                            return aCode.localeCompare(bCode, undefined, { numeric: true, sensitivity: 'base' });
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
                                    step="0.5"
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
                                  <span className="text-slate-500">Net: <span className="font-bold text-slate-900">{roundNetWeight(Math.max(0, item.gross - item.tare))} lb</span></span>
                                  <span className="text-slate-500">Unit Price: <span className="font-bold text-slate-900">${(item.overridePrice !== undefined ? item.overridePrice : (item.material?.buyPrice || 0)).toFixed(2)}</span></span>
                                </div>
                              </div>
                              <span className="font-black text-blue-600 text-sm">Subtotal: ${(() => {
                                const physicalNet = roundNetWeight(Math.max(0, item.gross - item.tare));
                                const paidWeight = Math.max(0, physicalNet - (item.deduction || 0));
                                const price = item.overridePrice !== undefined ? item.overridePrice : (item.material?.buyPrice || 0);
                                return (paidWeight * price).toFixed(2);
                              })()}</span>
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
                        {(!qtCustomer && !isQtNewCustomer) ? (
                          <div className="flex flex-col items-center justify-center py-10 px-4 bg-slate-50 border-2 border-dashed border-slate-200 rounded-[2rem] text-center space-y-5 animate-in fade-in duration-200">
                            <div className="w-14 h-14 bg-blue-50 rounded-full flex items-center justify-center text-blue-600 shadow-inner">
                              <User className="w-7 h-7" />
                            </div>
                            <div className="max-w-xs space-y-1">
                              <h4 className="font-black text-slate-900 text-base">No Seller / Customer Selected</h4>
                              <p className="text-xs text-slate-500 font-semibold leading-relaxed">
                                Search previous customers in our registry directory or create a new seller profile.
                              </p>
                            </div>
                            <div className="flex flex-col sm:flex-row gap-3 w-full max-w-sm pt-1">
                              <button
                                type="button"
                                onClick={() => setIsCustomerLookupOpen(true)}
                                className="flex-1 px-5 py-3.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-black uppercase tracking-wider shadow-sm transition-all active:scale-95 flex items-center justify-center gap-1.5"
                              >
                                <Search className="w-4 h-4" />
                                Search Previous
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setQtNewCustomer({
                                    name: 'New Seller',
                                    phone: '',
                                    secondaryPhone: '',
                                    email: '',
                                    address: '',
                                    businessName: '',
                                    idNumber: '',
                                    idType: "Driver's License",
                                    idExpiration: ''
                                  });
                                  setIsQtNewCustomer(true);
                                }}
                                className="flex-1 px-5 py-3.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-xl text-xs font-black uppercase tracking-wider transition-all active:scale-95 flex items-center justify-center gap-1.5"
                              >
                                <Plus className="w-4 h-4" />
                                Add New Seller
                              </button>
                            </div>

                            <div className="relative py-2 w-full max-w-sm">
                              <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-slate-200"></div></div>
                              <div className="relative flex justify-center text-[9px] uppercase"><span className="bg-slate-50 px-2 text-slate-400 font-extrabold tracking-[0.2em]">Or Scan ID</span></div>
                            </div>

                            <div className="flex flex-col gap-2 w-full max-w-sm">
                              <button 
                                type="button"
                                onClick={() => setIsUSBScannerOpen(true)}
                                className="w-full py-3 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-black text-[10px] uppercase tracking-wider transition-all flex items-center justify-center gap-2 shadow-sm"
                              >
                                <QrCode className="w-3.5 h-3.5 text-blue-400" />
                                <span>Scan DL Barcode (USB)</span>
                              </button>

                              {settings.scannerEnabled && (
                                <button 
                                  onClick={handleIDScan}
                                  disabled={isScanning}
                                  className={cn(
                                    "w-full py-3 bg-slate-800 hover:bg-slate-700 text-white rounded-xl font-black text-[10px] uppercase tracking-wider transition-all flex items-center justify-center gap-2 shadow-sm relative overflow-hidden",
                                    isScanning && "opacity-80"
                                  )}
                                >
                                  <div className={cn(
                                    "absolute inset-0 bg-gradient-to-r from-blue-600/20 to-indigo-600/20 translate-x-[-100%] hover:translate-x-[100%] transition-transform duration-1000",
                                    isScanning && "animate-shimmer"
                                  )} />
                                  {isScanning ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
                                  ) : (
                                    <Scan className="w-3.5 h-3.5 text-blue-400" />
                                  )}
                                  <span>Scan ID (Gemalto)</span>
                                </button>
                              )}
                            </div>

                            {usbScanFeedback && (
                              <div className={cn(
                                "p-3 rounded-xl border flex gap-2.5 items-center text-[11px] font-bold animate-in fade-in slide-in-from-top-2 duration-300 w-full max-w-sm",
                                usbScanFeedback.type === 'success' 
                                  ? "bg-emerald-50 border-emerald-100 text-emerald-800" 
                                  : "bg-blue-50 border-blue-100 text-blue-800"
                              )}>
                                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-500" />
                                <div>
                                  <p>{usbScanFeedback.message}</p>
                                </div>
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="bg-slate-50 border border-slate-200/60 rounded-[2rem] p-6 space-y-6">
                            <div className="flex items-center justify-between border-b border-slate-200 pb-4">
                              <div>
                                <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                                  {(!qtCustomer && isQtNewCustomer) ? 'New Customer Profile' : 'Active Customer Profile'}
                                </h4>
                                <p className="text-lg font-black text-slate-800 mt-0.5">
                                  {(!qtCustomer && isQtNewCustomer) ? (qtNewCustomer.name || 'Registering New Seller') : qtCustomer?.name}
                                </p>
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  setQtCustomer(null);
                                  setQtNewCustomer({
                                    name: '',
                                    phone: '',
                                    secondaryPhone: '',
                                    email: '',
                                    address: '',
                                    businessName: '',
                                    idNumber: '',
                                    idType: "Driver's License",
                                    idExpiration: ''
                                  });
                                  setIsQtNewCustomer(false);
                                }}
                                className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 text-[10px] font-black uppercase rounded-xl transition-all"
                              >
                                Change Customer
                              </button>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                              {/* General / Contact Details Section */}
                              <div className="space-y-4">
                                <h5 className="text-[10px] font-black text-blue-600 uppercase tracking-widest flex items-center gap-2">
                                  <User className="w-3.5 h-3.5" /> General & Contact Details
                                </h5>

                                {(!qtCustomer && isQtNewCustomer) && (
                                  <div className="space-y-1">
                                    <label htmlFor="qt-cust-name-input" className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Full Name</label>
                                    <input
                                      id="qt-cust-name-input"
                                      className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-bold text-sm"
                                      value={qtNewCustomer.name}
                                      onChange={e => setQtNewCustomer(prev => ({ ...prev, name: e.target.value }))}
                                      placeholder="Full name of seller..."
                                    />
                                  </div>
                                )}

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                  <div className="space-y-1">
                                    <label htmlFor="qt-cust-phone-input" className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Primary Phone</label>
                                    <input
                                      id="qt-cust-phone-input"
                                      className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-bold text-sm"
                                      value={(!qtCustomer && isQtNewCustomer) ? qtNewCustomer.phone : (qtCustomer?.phone || '')}
                                      onChange={e => {
                                        const val = e.target.value;
                                        if (!qtCustomer && isQtNewCustomer) {
                                          setQtNewCustomer(prev => ({ ...prev, phone: val }));
                                        } else {
                                          setQtCustomer(prev => prev ? ({ ...prev, phone: val }) : null);
                                        }
                                      }}
                                      placeholder="(555) 000-0000"
                                    />
                                  </div>

                                  <div className="space-y-1">
                                    <label htmlFor="qt-cust-sec-phone-input" className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Secondary Phone</label>
                                    <input
                                      id="qt-cust-sec-phone-input"
                                      className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-bold text-sm"
                                      value={(!qtCustomer && isQtNewCustomer) ? qtNewCustomer.secondaryPhone : (qtCustomer?.secondaryPhone || '')}
                                      onChange={e => {
                                        const val = e.target.value;
                                        if (!qtCustomer && isQtNewCustomer) {
                                          setQtNewCustomer(prev => ({ ...prev, secondaryPhone: val }));
                                        } else {
                                          setQtCustomer(prev => prev ? ({ ...prev, secondaryPhone: val }) : null);
                                        }
                                      }}
                                      placeholder="Backup phone number..."
                                    />
                                  </div>
                                </div>

                                <div className="space-y-1">
                                  <label htmlFor="qt-cust-email-input" className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Email Address</label>
                                  <input
                                    id="qt-cust-email-input"
                                    type="email"
                                    className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-bold text-sm"
                                    value={(!qtCustomer && isQtNewCustomer) ? qtNewCustomer.email : (qtCustomer?.email || '')}
                                    onChange={e => {
                                      const val = e.target.value;
                                      if (!qtCustomer && isQtNewCustomer) {
                                        setQtNewCustomer(prev => ({ ...prev, email: val }));
                                      } else {
                                        setQtCustomer(prev => prev ? ({ ...prev, email: val }) : null);
                                      }
                                    }}
                                    placeholder="email@example.com"
                                  />
                                </div>

                                <div className="space-y-1">
                                  <label htmlFor="qt-cust-address-input" className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Street Address</label>
                                  <input
                                    id="qt-cust-address-input"
                                    className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-bold text-sm"
                                    value={(!qtCustomer && isQtNewCustomer) ? qtNewCustomer.address : (qtCustomer?.address || '')}
                                    onChange={e => {
                                      const val = e.target.value;
                                      if (!qtCustomer && isQtNewCustomer) {
                                        setQtNewCustomer(prev => ({ ...prev, address: val }));
                                      } else {
                                        setQtCustomer(prev => prev ? ({ ...prev, address: val }) : null);
                                      }
                                    }}
                                    placeholder="Street, City, State, Zip"
                                  />
                                </div>

                                <div className="space-y-1">
                                  <label htmlFor="qt-cust-business-input" className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Business / Commercial Entity</label>
                                  <input
                                    id="qt-cust-business-input"
                                    className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-bold text-sm"
                                    value={(!qtCustomer && isQtNewCustomer) ? qtNewCustomer.businessName : (qtCustomer?.businessName || '')}
                                    onChange={e => {
                                      const val = e.target.value;
                                      if (!qtCustomer && isQtNewCustomer) {
                                        setQtNewCustomer(prev => ({ ...prev, businessName: val }));
                                      } else {
                                        setQtCustomer(prev => prev ? ({ ...prev, businessName: val }) : null);
                                      }
                                    }}
                                    placeholder="Optional business name..."
                                  />
                                </div>
                              </div>

                              {/* ID & Compliance Details Section */}
                              <div className="space-y-4">
                                <h5 className="text-[10px] font-black text-emerald-600 uppercase tracking-widest flex items-center gap-2">
                                  <ShieldCheck className="w-3.5 h-3.5" /> Compliance & ID Verification
                                </h5>

                                <div className="space-y-1">
                                  <label htmlFor="qt-cust-idtype-input" className="text-[10px] font-black text-slate-400 uppercase tracking-wider">ID Document Type</label>
                                  <select
                                    id="qt-cust-idtype-input"
                                    className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-bold text-sm"
                                    value={(!qtCustomer && isQtNewCustomer) ? qtNewCustomer.idType : (qtCustomer?.idType || '')}
                                    onChange={e => {
                                      const val = e.target.value;
                                      if (!qtCustomer && isQtNewCustomer) {
                                        setQtNewCustomer(prev => ({ ...prev, idType: val }));
                                      } else {
                                        setQtCustomer(prev => prev ? ({ ...prev, idType: val }) : null);
                                      }
                                    }}
                                  >
                                    <option value="">Select ID Type...</option>
                                    <option value="Driver's License">Driver's License</option>
                                    <option value="State ID">State ID</option>
                                    <option value="Passport">Passport</option>
                                    <option value="Military ID">Military ID</option>
                                    <option value="Other">Other Government ID</option>
                                  </select>
                                </div>

                                <div className="space-y-1">
                                  <label htmlFor="qt-cust-idnumber-input" className="text-[10px] font-black text-slate-400 uppercase tracking-wider">ID Card / DL Number</label>
                                  <input
                                    id="qt-cust-idnumber-input"
                                    className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-bold text-sm font-mono"
                                    value={(!qtCustomer && isQtNewCustomer) ? qtNewCustomer.idNumber : (qtCustomer?.idNumber || '')}
                                    onChange={e => {
                                      const val = e.target.value;
                                      if (!qtCustomer && isQtNewCustomer) {
                                        setQtNewCustomer(prev => ({ ...prev, idNumber: val }));
                                      } else {
                                        setQtCustomer(prev => prev ? ({ ...prev, idNumber: val }) : null);
                                      }
                                    }}
                                    placeholder="e.g. AA123456"
                                  />
                                </div>

                                <div className="space-y-1">
                                  <label htmlFor="qt-cust-idexpiration-input" className="text-[10px] font-black text-slate-400 uppercase tracking-wider">ID Expiration Date</label>
                                  <input
                                    id="qt-cust-idexpiration-input"
                                    type="date"
                                    className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-bold text-sm font-mono"
                                    value={(!qtCustomer && isQtNewCustomer) ? qtNewCustomer.idExpiration : (qtCustomer?.idExpiration || '')}
                                    onChange={e => {
                                      const val = e.target.value;
                                      if (!qtCustomer && isQtNewCustomer) {
                                        setQtNewCustomer(prev => ({ ...prev, idExpiration: val }));
                                      } else {
                                        setQtCustomer(prev => prev ? ({ ...prev, idExpiration: val }) : null);
                                      }
                                    }}
                                  />
                                </div>

                                {qtCustomer?.idImageUpdatedAt && (() => {
                                  const scanDate = new Date(qtCustomer.idImageUpdatedAt);
                                  const today = new Date();
                                  const diffTime = Math.abs(today.getTime() - scanDate.getTime());
                                  const daysSinceScan = Math.floor(diffTime / (1000 * 60 * 60 * 24));
                                  const isExpiredOrStale = daysSinceScan > 365;

                                  if (isExpiredOrStale) {
                                    return (
                                      <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-2xl flex flex-col gap-1 text-xs text-amber-800 font-bold animate-in fade-in duration-200">
                                        <div className="flex items-center gap-2">
                                          <span className="w-2 h-2 bg-amber-500 rounded-full animate-pulse shrink-0" />
                                          <span>Compliance Warning: ID scanned more than 1 year ago.</span>
                                        </div>
                                        <p className="text-[10px] text-amber-700 font-medium pl-4">
                                          Last scanned: {scanDate.toLocaleDateString()} ({daysSinceScan} days ago). Please re-scan modern ID copy.
                                        </p>
                                      </div>
                                    );
                                  }

                                  return (
                                    <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-2xl flex flex-col gap-1 text-xs text-slate-700 font-semibold animate-in fade-in duration-200">
                                      <div className="flex items-center gap-2">
                                        <span className="w-2 h-2 bg-emerald-500 rounded-full shrink-0" />
                                        <span>ID copy on file: Active & Compliant.</span>
                                      </div>
                                      <p className="text-[10px] text-slate-500 font-medium pl-4">
                                        Last scanned: {scanDate.toLocaleDateString()} ({daysSinceScan} days ago).
                                      </p>
                                    </div>
                                  );
                                })()}

                                <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-2xl text-[11px] text-emerald-800 font-medium leading-relaxed space-y-1">
                                  <p className="font-bold uppercase tracking-wider text-[9px] text-emerald-700">Database Sync Active (Quick Ticket)</p>
                                  <p>Compliance fields verified here will automatically synchronize with Google Cloud Firestore upon completing this ticket.</p>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
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
                          disabled={qtOhioDatabaseStatus === 'not_checked' || qtOhioDatabaseStatus === 'flagged'}
                          className="w-full py-4 bg-slate-900 text-white rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-slate-800 disabled:opacity-50 transition-all outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2"
                        >
                          Verify Identity
                          <ChevronRight className="w-5 h-5" />
                        </button>
                      </div>

                      {/* Ohio Dept of Homeland Security Scrap Database Check */}
                      <div className="w-full max-w-xl mt-8 pt-8 border-t border-slate-100 space-y-4 text-left">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2.5">
                            <div className="p-1.5 bg-amber-100 text-amber-700 rounded-lg">
                              <Fingerprint className="w-4 h-4" />
                            </div>
                            <div>
                              <h4 className="text-xs font-black text-slate-900 uppercase tracking-tight">Ohio Homeland Security Check</h4>
                              <p className="text-[10px] text-slate-500 font-medium">Verify seller against the state scrap database</p>
                            </div>
                          </div>
                          {qtOhioDatabaseStatus === 'cleared' ? (
                            <span className="px-2.5 py-1 bg-emerald-100 text-emerald-800 text-[9px] font-black uppercase rounded-full border border-emerald-200 flex items-center gap-1 font-sans">
                              <Check className="w-3 h-3" /> Cleared
                            </span>
                          ) : qtOhioDatabaseStatus === 'flagged' ? (
                            <span className="px-2.5 py-1 bg-red-100 text-red-800 text-[9px] font-black uppercase rounded-full border border-red-200 flex items-center gap-1 font-sans">
                              <AlertCircle className="w-3 h-3 animate-pulse" /> Flagged / Hold
                            </span>
                          ) : (
                            <span className="px-2.5 py-1 bg-amber-100 text-amber-800 text-[9px] font-black uppercase rounded-full border border-amber-200 font-sans">
                              Pending Check
                            </span>
                          )}
                        </div>

                        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                          {/* Copy info helper */}
                          <div className="space-y-2">
                            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Seller Details (Click to copy)</p>
                            <div className="grid grid-cols-1 gap-1.5 text-xs">
                              <button
                                type="button"
                                onClick={() => {
                                  const name = qtCustomer?.name || qtNewCustomer.name || '';
                                  navigator.clipboard.writeText(name);
                                }}
                                className="flex items-center justify-between px-3 py-2 bg-white hover:bg-slate-50 rounded-xl border border-slate-200 text-left font-bold transition-all text-slate-700 w-full"
                              >
                                <span className="truncate">Name: <span className="text-slate-900 font-mono">{qtCustomer?.name || qtNewCustomer.name || 'N/A'}</span></span>
                                <Copy className="w-3.5 h-3.5 text-slate-400 shrink-0 ml-2" />
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  const addressStr = qtCustomer?.address || qtNewCustomer.address || '';
                                  navigator.clipboard.writeText(addressStr);
                                }}
                                className="flex items-center justify-between px-3 py-2 bg-white hover:bg-slate-50 rounded-xl border border-slate-200 text-left font-bold transition-all text-slate-700 w-full"
                              >
                                <span className="truncate">Address: <span className="text-slate-900 font-mono font-normal">{qtCustomer?.address || qtNewCustomer.address || 'N/A'}</span></span>
                                <Copy className="w-3.5 h-3.5 text-slate-400 shrink-0 ml-2" />
                              </button>
                            </div>
                          </div>

                          {/* Credentials helper */}
                          <div className="space-y-2 border-t md:border-t-0 md:border-l border-slate-200 md:pl-4 pt-4 md:pt-0">
                            <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Portal Credentials (Click to copy)</p>
                            <div className="grid grid-cols-1 gap-1.5 text-xs">
                              <div className="flex items-center justify-between px-3 py-2 bg-white rounded-xl border border-slate-200 text-[11px] font-semibold text-slate-700">
                                <span className="truncate">User: <span className="font-mono font-bold text-slate-900">{settings.ohioScrapUsername || 'Not Configured'}</span></span>
                                {settings.ohioScrapUsername && (
                                  <button
                                    type="button"
                                    onClick={() => navigator.clipboard.writeText(settings.ohioScrapUsername)}
                                    className="p-1 hover:bg-slate-100 rounded-lg border border-slate-200 text-slate-500 hover:text-slate-700 transition-all shrink-0 ml-2"
                                    title="Copy Username"
                                  >
                                    <Copy className="w-3 h-3" />
                                  </button>
                                )}
                              </div>
                              <div className="flex items-center justify-between px-3 py-2 bg-white rounded-xl border border-slate-200 text-[11px] font-semibold text-slate-700">
                                <span className="truncate">Pass: <span className="font-mono font-bold text-slate-900">{settings.ohioScrapPassword ? '••••••••' : 'Not Configured'}</span></span>
                                {settings.ohioScrapPassword && (
                                  <button
                                    type="button"
                                    onClick={() => navigator.clipboard.writeText(settings.ohioScrapPassword)}
                                    className="p-1 hover:bg-slate-100 rounded-lg border border-slate-200 text-slate-500 hover:text-slate-700 transition-all shrink-0 ml-2"
                                    title="Copy Password"
                                  >
                                    <Copy className="w-3 h-3" />
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2 pt-2">
                          <button
                            type="button"
                            onClick={() => runQtOhioCheck()}
                            disabled={isCheckingOhioPortal}
                            className="px-4 py-2.5 bg-amber-600 hover:bg-amber-700 disabled:bg-amber-400 text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-1.5"
                          >
                            {isCheckingOhioPortal ? (
                              <>
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                Checking...
                              </>
                            ) : (
                              <>
                                <Fingerprint className="w-3.5 h-3.5" />
                                Run Automated Check
                              </>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => window.open(settings.ohioScrapPortalUrl, '_blank')}
                            className="px-4 py-2.5 bg-slate-900 hover:bg-blue-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-1.5"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            Open Ohio Portal
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setQtOhioDatabaseStatus('cleared');
                              setOhioCheckMessage("Manually marked as CLEARED.");
                            }}
                            className={`px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all ${
                              qtOhioDatabaseStatus === 'cleared'
                                ? 'bg-emerald-100 border-emerald-200 text-emerald-800'
                                : 'bg-white hover:bg-emerald-50 border-slate-200 text-slate-700 hover:text-emerald-700'
                            }`}
                          >
                            Mark Cleared
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setQtOhioDatabaseStatus('flagged');
                              setOhioCheckMessage("Manually marked as FLAGGED / HOLD.");
                            }}
                            className={`px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all ${
                              qtOhioDatabaseStatus === 'flagged'
                                ? 'bg-red-100 border-red-200 text-red-800'
                                : 'bg-white hover:bg-red-50 border-slate-200 text-slate-700 hover:text-red-700'
                            }`}
                          >
                            Mark Flagged
                          </button>
                        </div>

                        {ohioCheckMessage && (
                          <div className={`p-3.5 rounded-xl border text-[11px] font-semibold flex items-start gap-2 ${
                            qtOhioDatabaseStatus === 'flagged'
                              ? 'bg-rose-50 border-rose-200 text-rose-800'
                              : qtOhioDatabaseStatus === 'cleared'
                              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                              : 'bg-amber-50 border-amber-200 text-amber-800'
                          }`}>
                            <div className="flex-1">
                              <p className="font-extrabold uppercase text-[9px] tracking-wider mb-0.5">Ohio Portal Check Status</p>
                              <p className="leading-relaxed font-mono">{ohioCheckMessage}</p>
                            </div>
                          </div>
                        )}
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

                          {showQtVehicleConfirm && (
                            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex gap-3 items-center text-amber-800 text-xs animate-in slide-in-from-top duration-200" role="alert">
                              <AlertCircle className="w-5 h-5 text-amber-600 shrink-0" />
                              <div className="flex-1">
                                <p className="font-extrabold text-amber-900">Missing Vehicle Details</p>
                                <p className="font-medium text-amber-700">Vehicle tracking (license plate text & gate entrance photo) is required to prevent compliance issues. Click Bypass to ignore.</p>
                              </div>
                              <button 
                                type="button"
                                onClick={() => {
                                  setQtVehicleBypassed(true);
                                  setShowQtVehicleConfirm(false); 
                                }}
                                className="px-3.5 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-bold transition-all shadow-md shadow-amber-200"
                              >
                                Bypass Transport Rule
                              </button>
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

                              <div className="p-6 bg-slate-50 rounded-3xl border border-slate-200 shadow-sm flex flex-col gap-4">
                                <h5 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                                  <span>Government ID Photo</span>
                                </h5>
                                <p className="text-[10px] text-slate-500 font-medium -mt-2">Copy of seller's valid state driver's license (Ohio Compliance ORC 4737.04).</p>
                                
                                <div className="space-y-3">
                                  {(!qtIdImageUrl || qtIdImageSource === 'new') && !qtIdImageUrl && (
                                    <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-center gap-2.5 text-xs text-rose-800 font-bold animate-in fade-in duration-200">
                                      <span className="w-2.5 h-2.5 bg-rose-500 rounded-full shrink-0" />
                                      <span>ID required — scan or photograph seller's state-issued ID.</span>
                                    </div>
                                  )}

                                  {qtIdImageSource === 'on_file' && qtIdImageUrl && (
                                    <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl flex flex-col gap-3 text-xs text-amber-800 font-bold animate-in fade-in duration-200">
                                      <div className="flex items-center gap-2.5">
                                        <span className="w-2.5 h-2.5 bg-amber-500 rounded-full animate-pulse shrink-0" />
                                        <span>ID on file — verify this matches today's ID. Re-scan if expired or changed.</span>
                                      </div>
                                      
                                      <div className="flex flex-col gap-1.5 pt-1 pl-5">
                                        <span className="text-[10px] text-amber-900 font-extrabold uppercase tracking-wider">
                                          Seller Profile: {qtCustomer?.name || 'Repeat Customer'}
                                        </span>
                                        <IdImageThumbnail 
                                          imageUrl={qtIdImageUrl} 
                                          onViewFull={(url) => setLightboxUrl(url)} 
                                        />
                                      </div>

                                      <div className="pl-5 pt-1">
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setQtIdImageUrl('');
                                            setQtIdImageSource('new');
                                          }}
                                          className="px-2.5 py-1 text-[11px] font-bold bg-amber-100 hover:bg-amber-200 text-amber-900 rounded-lg border border-amber-300 transition-colors cursor-pointer whitespace-nowrap w-fit"
                                        >
                                          Re-scan ID
                                        </button>
                                      </div>
                                    </div>
                                  )}

                                  {qtIdImageSource === 'updated' && qtIdImageUrl && (
                                    <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex flex-col gap-3 text-xs text-emerald-800 font-bold animate-in fade-in duration-200">
                                      <div className="flex items-center gap-2.5">
                                        <span className="w-2.5 h-2.5 bg-emerald-500 rounded-full shrink-0" />
                                        <span>New ID scanned and saved to customer profile.</span>
                                      </div>
                                      <div className="pt-1 pl-5">
                                        <IdImageThumbnail 
                                          imageUrl={qtIdImageUrl} 
                                          onViewFull={(url) => setLightboxUrl(url)} 
                                        />
                                      </div>
                                    </div>
                                  )}
                                </div>

                                <div className="flex-1">
                                  <CameraCapture 
                                    label="Capture ID Document"
                                    onCapture={(url) => {
                                      setQtIdImageUrl(url);
                                      setShowQtIdConfirm(false); 
                                      setQtIdBypassed(false);
                                      if (url) {
                                        setQtIdImageSource('updated');
                                        handleReadIDFromPhoto(url);
                                      }
                                    }}
                                    networkUrl={settings.useSwannCams ? settings.swannCams.customer : undefined}
                                    className="h-full"
                                  />
                                  {isReadingID && (
                                    <div className="p-3 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-2xl flex items-center gap-2.5 animate-pulse mt-3">
                                      <Loader2 className="w-4.5 h-4.5 animate-spin text-blue-600 shrink-0" />
                                      <div className="flex-1">
                                        <p className="text-[10px] font-extrabold text-blue-900 uppercase tracking-wider">AI OCR Reading ID...</p>
                                        <p className="text-[9px] text-blue-600 font-medium">Extracting customer information and auto-filling...</p>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                              
                              <div className="p-6 bg-slate-50 rounded-3xl border border-slate-200 shadow-sm flex flex-col gap-4">
                                <div>
                                  <h5 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                                    <span>Vehicle/Entrance Photo</span>
                                    {qtVehiclePhotoUrl ? (
                                      <span className="text-[8px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-black uppercase">Captured</span>
                                    ) : (
                                      <span className="text-[8px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-black uppercase">Optional</span>
                                    )}
                                  </h5>
                                  <CameraCapture 
                                    label="Capture Vehicle"
                                    onCapture={(url) => {
                                      setQtVehiclePhotoUrl(url);
                                      if (url && qtVehiclePlate && qtVehicleType) {
                                        setShowQtVehicleConfirm(false);
                                        setQtVehicleBypassed(false);
                                      }
                                    }}
                                    networkUrl={settings.useSwannCams ? settings.swannCams.entrance : undefined}
                                    className="h-full"
                                  />
                                </div>
                                <div className="grid grid-cols-2 gap-4 pt-3 border-t border-slate-200">
                                  <div className="space-y-1">
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">License Plate</label>
                                    <input 
                                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all font-bold text-xs"
                                      value={qtVehiclePlate}
                                      onChange={(e) => {
                                        const val = e.target.value;
                                        setQtVehiclePlate(val);
                                        if (val && qtVehiclePhotoUrl && qtVehicleType) {
                                          setShowQtVehicleConfirm(false);
                                          setQtVehicleBypassed(false);
                                        }
                                      }}
                                      placeholder="Plate #"
                                    />
                                  </div>
                                  <div className="space-y-1">
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Vehicle Type</label>
                                    <input 
                                      className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all font-bold text-xs"
                                      value={qtVehicleType}
                                      onChange={(e) => {
                                        const val = e.target.value;
                                        setQtVehicleType(val);
                                        if (val && qtVehiclePhotoUrl && qtVehiclePlate) {
                                          setShowQtVehicleConfirm(false);
                                          setQtVehicleBypassed(false);
                                        }
                                      }}
                                      placeholder="e.g. Pickup"
                                    />
                                  </div>
                                </div>
                              </div>
                              
                              <div className="p-6 bg-slate-50 rounded-3xl border border-slate-200 shadow-sm flex flex-col">
                                <h5 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Digital Signature</h5>
                                
                                <div className="mb-4 p-4 bg-white rounded-2xl border border-slate-200 text-left space-y-2">
                                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block">SMS Communication Consent</span>
                                  <p className="text-[10px] text-slate-500 font-medium leading-relaxed">
                                    Do you agree to receive text messages from Preferred Metals & Recycling? Message frequency varies. Message and data rates may apply. Reply STOP to opt out and HELP for help. No mobile information will be shared with third parties or affiliates for marketing or promotional purposes. All OPT-IN requests include text messaging originator opt-in data and consent; this information will not be shared with third parties.
                                  </p>
                                  <div className="flex items-center gap-2 pt-1">
                                    <span className="text-xs font-bold text-slate-900">Customer:</span>
                                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-green-50 text-green-700 text-[10px] font-black uppercase rounded-md border border-green-200">
                                      <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                                      Yes
                                    </span>
                                  </div>
                                </div>

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
                                            {roundNetWeight(Math.max(0, item.gross - item.tare))} lb @ ${(item.overridePrice !== undefined ? item.overridePrice : (item.material?.buyPrice || 0)).toFixed(2)}/lb
                                          </p>
                                        </div>
                                      </div>
                                      <p className="font-black text-slate-900">
                                        ${(() => {
                                          const physicalNet = roundNetWeight(Math.max(0, item.gross - item.tare));
                                          const paidWeight = Math.max(0, physicalNet - (item.deduction || 0));
                                          const price = item.overridePrice !== undefined ? item.overridePrice : (item.material?.buyPrice || 0);
                                          return (paidWeight * price).toFixed(2);
                                        })()}
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
                  {!qtSuccess && (
                    <div className="mt-auto pt-8 flex gap-4">
                      {step > 1 && (
                        <button 
                          onClick={() => {
                            setShowQtVehicleConfirm(false);
                            setShowQtIdConfirm(false);
                            setStep(prev => prev - 1);
                          }}
                          className="px-6 py-4 border border-slate-200 rounded-xl font-bold text-slate-600 flex items-center gap-2 hover:bg-slate-50 transition-all outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                        >
                          <ChevronLeft className="w-5 h-5" />
                          Back
                        </button>
                      )}
                      <div className="flex-1" />
                      {step === 3 ? null : step < 4 ? (
                        <button 
                          onClick={() => setStep(prev => prev + 1)}
                          disabled={
                            (step === 1 && (qtItems.length === 0 || qtItems.some(item => !item.material || (item.gross - item.tare) <= 0))) ||
                            (step === 2 && (
                              (!qtCustomer && !qtNewCustomer.name) ||
                              qtOhioDatabaseStatus === 'not_checked' ||
                              qtOhioDatabaseStatus === 'flagged'
                            ))
                          }
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
                              disabled={qtProcessing || qtItems.some(item => !item.material || (item.gross - item.tare) <= 0) || (!qtCustomer && !qtNewCustomer.name) || netWeight <= 0 || showQtIdConfirm || showQtVehicleConfirm || qtOhioDatabaseStatus === 'not_checked' || qtOhioDatabaseStatus === 'flagged'}
                              className="px-8 py-4 bg-blue-600 text-white rounded-xl font-bold flex items-center gap-2 hover:bg-blue-700 shadow-lg shadow-blue-200 disabled:opacity-50 transition-all outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                            >
                              {qtProcessing ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
                              {(showQtIdConfirm || showQtVehicleConfirm) ? 'Acknowledge Warning Above' : 'Complete & Save'}
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

              <div className="bg-white p-8 shadow-sm border border-slate-200 mx-auto max-w-[400px] font-mono text-sm">
                <div className="text-center border-b border-slate-900 pb-4 mb-6">
                  <h1 className="text-xl font-black uppercase tracking-tighter">{COMPANY_NAME}</h1>
                  <p className="text-[10px] text-slate-400 font-medium tracking-wide mt-0.5">{COMPANY_WEBSITE}</p>
                  <p className="text-[10px] text-slate-500 font-bold mt-1">{COMPANY_ADDRESS}</p>
                  <p className="text-[10px] text-slate-500">{COMPANY_PHONE}</p>
                  <div className="mt-2 pt-2 border-t border-slate-100">
                    <p className="text-[10px] text-slate-500 mt-1 uppercase">Official Buy Ticket</p>
                    <p className="text-[10px] text-slate-500">{new Date().toLocaleString()}</p>
                  </div>
                </div>
                
                <div className="space-y-3">
                  <div className="flex justify-between gap-4">
                    <span className="text-slate-500 uppercase text-[10px] font-bold">Customer</span>
                    <span className="text-right font-bold">{qtCustomer?.name || qtNewCustomer.name || 'N/A'}</span>
                  </div>
                  
                  <div className="border-t border-slate-100 pt-3 space-y-2">
                    <p className="text-[10px] font-bold text-slate-400 uppercase">Items</p>
                    {qtItems.map((item, idx) => {
                      const physicalNet = Math.max(0, item.gross - item.tare);
                      const paidWeight = Math.max(0, physicalNet - (item.deduction || 0));
                      const finalPrice = item.overridePrice !== undefined ? item.overridePrice : (item.material?.buyPrice || 0);
                      const itemTotal = paidWeight * finalPrice;
                      return (
                        <div key={item.id} className="space-y-1 border-b border-slate-50 pb-2 last:border-0" id={`print-item-${item.id}`}>
                          <div className="flex justify-between gap-4 text-[11px]">
                            <div className="flex gap-2">
                              <span className="text-slate-400">{idx + 1}.</span>
                              <span className="font-bold">{item.material?.name || 'N/A'}</span>
                            </div>
                            <div className="text-right font-bold">
                              ${itemTotal.toFixed(2)}
                            </div>
                          </div>
                          <div className="flex justify-between text-[9px] text-slate-500 pl-5">
                            <span>{paidWeight} lb</span>
                            <span>@ ${finalPrice.toFixed(2)}/lb</span>
                          </div>
                          {item.deduction ? (
                            <p className="text-[9px] text-red-500 pl-5">Deduction: -{item.deduction} lb</p>
                          ) : null}
                        </div>
                      );
                    })}
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
                onClick={async () => {
                  setShowPrintPreview(false);
                  await new Promise(r => setTimeout(r, 150));
                  const tempTicket: BuyTicket = {
                    id: qtCreatedTicketId || 'QUICK',
                    customerId: qtCustomer?.id || 'new',
                    materials: qtItems.map(item => {
                      const physicalNet = Math.max(0, item.gross - item.tare);
                      const paidWeight = Math.max(0, physicalNet - (item.deduction || 0));
                      const price = item.overridePrice !== undefined ? item.overridePrice : (item.material?.buyPrice || 0);
                      return {
                        materialId: item.material?.id || '',
                        grossWeight: item.gross,
                        tareWeight: item.tare,
                        netWeight: physicalNet,
                        pricePerUnit: price,
                        totalAmount: paidWeight * price,
                        deductionWeight: item.deduction || 0
                      };
                    }),
                    totalAmount: totalAmount || 0,
                    status: 'completed',
                    timestamp: new Date().toISOString(),
                    paymentMethod: 'cash',
                    customerPhotoUrl: qtCustomerPhotoUrl || '',
                    vehiclePhotoUrl: qtVehiclePhotoUrl || '',
                    idImageUrl: qtIdImageUrl || '',
                    vehiclePlate: qtVehiclePlate || '',
                    vehicleType: qtVehicleType || '',
                    signatureUrl: qtSignatureUrl || ''
                  };

                  await printTicket(
                    <BuyTicketPrint 
                      ticket={tempTicket} 
                      customerName={qtCustomer?.name || qtNewCustomer.name || 'N/A'} 
                      materials={materials} 
                      format={settings.receiptFormat}
                    />,
                    { format: settings.receiptFormat, debugMode: settings.debugPrintMode }
                  );
                  if (!isPreviewOnly) {
                    setShowQuickTicket(false);
                    resetQuickTicket();
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
          <h1 className="text-2xl font-black uppercase">{COMPANY_NAME}</h1>
          <p className="text-sm font-bold">{COMPANY_WEBSITE}</p>
          <p className="text-xs">{COMPANY_ADDRESS} • {COMPANY_PHONE}</p>
          <p className="text-sm mt-1">Official Buy Ticket • {new Date().toLocaleString()}</p>
        </div>
        <div className="space-y-4">
          <div className="flex justify-between">
            <span className="font-bold">Customer:</span>
            <span>{qtCustomer?.name || qtNewCustomer.name}</span>
          </div>
          
          <div className="border-t border-black pt-4 space-y-2">
            <p className="text-xs font-bold uppercase">Items</p>
            {qtItems.map((item, idx) => {
              const physicalNet = roundNetWeight(Math.max(0, item.gross - item.tare));
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
              {qtItems.reduce((sum, item) => {
                const physicalNet = roundNetWeight(Math.max(0, item.gross - item.tare));
                const paidWeight = Math.max(0, physicalNet - (item.deduction || 0));
                return sum + paidWeight;
              }, 0)} lb
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
        onClose={() => {
          setShowFullTicket(false);
          setResumeDraftId(null);
        }}
        profile={profile}
        resumeDraftId={resumeDraftId}
      />

      {dbHistoryAlert && dbHistoryAlert.isOpen && (
        <div id="db-history-alert-modal" className="fixed inset-0 bg-slate-900/80 z-[200] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-3xl w-full max-w-sm p-6 shadow-2xl border-2 border-green-500 animate-in zoom-in-95 duration-200 text-center space-y-6">
            <div className="w-16 h-16 bg-green-50 text-green-600 rounded-full flex items-center justify-center mx-auto">
              <Database className="w-8 h-8 animate-pulse text-green-600" />
            </div>
            <div className="space-y-2">
              <h3 className="text-xl font-extrabold text-slate-900">Stored in History</h3>
              <p className="text-sm text-slate-500">
                This ticket has been successfully stored in the Firestore database history.
              </p>
            </div>
            
            <div className="bg-slate-50 rounded-2xl p-4 text-left border border-slate-100 text-xs font-mono space-y-2">
              <div className="flex justify-between">
                <span className="text-slate-400">STATUS:</span>
                <span className="text-green-600 font-bold">WRITTEN &amp; VERIFIED</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">TICKET ID:</span>
                <span className="text-slate-900 font-black break-all">{dbHistoryAlert.ticketId}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">CUSTOMER:</span>
                <span className="text-slate-900 font-bold">{dbHistoryAlert.customerName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">PAYOUT:</span>
                <span className="text-green-600 font-bold">${dbHistoryAlert.totalAmount.toFixed(2)}</span>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                id="btn-confirm-alert-ok"
                onClick={() => {
                  setDbHistoryAlert(null);
                  if (settings.autoPrint) {
                    setShowPrintPreview(true);
                  }
                }}
                className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition-all shadow-md active:scale-95 text-sm"
              >
                Close &amp; OK
              </button>
              <button
                id="btn-confirm-alert-print"
                onClick={async () => {
                  setDbHistoryAlert(null);
                  await new Promise(r => setTimeout(r, 100));
                  setShowPrintPreview(true);
                }}
                className="px-4 py-3 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl transition-all text-sm flex items-center justify-center gap-1.5"
              >
                <Printer className="w-4 h-4" /> Print
              </button>
            </div>
          </div>
        </div>
      )}
      {isUSBScannerOpen && (
        <USBBarcodeScannerModal 
          isOpen={isUSBScannerOpen}
          onClose={() => setIsUSBScannerOpen(false)}
          onScanSuccess={handleQuickUSBScanSuccess}
        />
      )}

      {/* Customer Lookup Directory Modal */}
      {isCustomerLookupOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[300] p-4 animate-in fade-in duration-200" role="dialog" aria-modal="true">
          <div className="bg-white rounded-[2rem] border border-slate-200 shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-xl font-black text-slate-900 uppercase tracking-tight font-display flex items-center gap-2">
                  <Search className="w-5 h-5 text-blue-600" />
                  Previous Customers Directory
                </h3>
                <p className="text-xs text-slate-500 font-semibold">Select a customer from database list or type to filter</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsCustomerLookupOpen(false);
                  setCustomerSearch('');
                }}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-all"
                aria-label="Close"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* Search Input (No Autocomplete or Dropdown) */}
            <div className="p-6 bg-slate-50 border-b border-slate-100">
              <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search by name, phone, or business name..."
                  className="w-full pl-11 pr-11 py-4 bg-white border border-slate-200 rounded-2xl focus:ring-2 focus:ring-blue-500 outline-none transition-all font-bold text-slate-900"
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                  autoFocus
                />
                {customerSearch && (
                  <button
                    type="button"
                    onClick={() => setCustomerSearch('')}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1 bg-slate-200 rounded-full transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Scrollable Customer List */}
            <div className="flex-1 overflow-y-auto p-6 space-y-3 custom-scrollbar">
              {(() => {
                const search = customerSearch.toLowerCase().trim();
                const filtered = customers.filter(c => {
                  if (!search) return true; // Show all by default in the modal directory
                  return (
                    c.name.toLowerCase().includes(search) ||
                    (c.phone || '').includes(search) ||
                    (c.businessName || '').toLowerCase().includes(search)
                  );
                });

                if (filtered.length === 0) {
                  return (
                    <div className="py-12 text-center space-y-4">
                      <p className="text-slate-500 font-semibold text-sm">No customers found matching "{customerSearch}"</p>
                      <button
                        type="button"
                        onClick={() => {
                          setQtNewCustomer({
                            name: customerSearch || 'New Seller',
                            phone: '',
                            secondaryPhone: '',
                            email: '',
                            address: '',
                            businessName: '',
                            idNumber: '',
                            idType: "Driver's License",
                            idExpiration: ''
                          });
                          setIsQtNewCustomer(true);
                          setIsCustomerLookupOpen(false);
                          setCustomerSearch('');
                        }}
                        className="px-5 py-2.5 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-2xl text-xs font-black uppercase tracking-wider transition-colors inline-flex items-center gap-2"
                      >
                        <Plus className="w-4 h-4" /> Register "{customerSearch}" as New Customer
                      </button>
                    </div>
                  );
                }

                return filtered.map(c => (
                  <div
                    key={c.id}
                    className="p-4 border border-slate-100 hover:border-slate-200 rounded-2xl hover:bg-slate-50 flex items-center justify-between transition-all"
                  >
                    <div>
                      <h4 className="font-black text-slate-900 text-sm">{c.name}</h4>
                      <p className="text-xs text-slate-500 font-semibold mt-0.5">
                        {c.phone || 'No Phone'} {c.address ? `• ${c.address}` : ''}
                      </p>
                      {c.businessName && (
                        <div className="mt-1.5">
                          <span className="px-2 py-0.5 bg-slate-100 text-slate-600 text-[9px] font-black uppercase rounded border border-slate-200">
                            {c.businessName}
                          </span>
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setQtCustomer(c);
                        setQtNewCustomer({
                          name: '',
                          phone: '',
                          secondaryPhone: '',
                          email: '',
                          address: '',
                          businessName: '',
                          idNumber: '',
                          idType: "Driver's License",
                          idExpiration: ''
                        });
                        setIsQtNewCustomer(false);
                        setIsCustomerLookupOpen(false);
                        setCustomerSearch('');
                      }}
                      className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-black uppercase tracking-widest transition-all active:scale-95 shadow-sm"
                    >
                      Select
                    </button>
                  </div>
                ));
              })()}
            </div>
          </div>
        </div>
      )}
      {lightboxUrl && (
        <div 
          className="fixed inset-0 z-[9999] bg-black/80 flex items-center justify-center p-4 animate-in fade-in duration-200"
          onClick={() => setLightboxUrl(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh] bg-slate-900 rounded-2xl overflow-hidden shadow-2xl flex flex-col items-center">
            <button
              onClick={() => setLightboxUrl(null)}
              className="absolute top-4 right-4 p-2 bg-black/40 hover:bg-black/60 text-white rounded-full transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
            <div className="p-4 max-h-[80vh] overflow-auto flex items-center justify-center bg-slate-950">
              <img
                src={lightboxUrl}
                alt="Full size ID"
                referrerPolicy="no-referrer"
                className="max-w-full max-h-[70vh] object-contain rounded-lg"
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
