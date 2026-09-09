import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  X,
  Search,
  User,
  UserPlus,
  Scale,
  DollarSign,
  CheckCircle2,
  Loader2,
  AlertCircle,
  Plus,
  ChevronRight,
  ChevronLeft,
  ShieldCheck,
  Printer,
  AlertTriangle,
  Fingerprint,
  RotateCcw,
  Camera,
  RefreshCw,
  ExternalLink
} from 'lucide-react';
import { auth, db } from '../firebase';
import {
  collection,
  onSnapshot,
  addDoc,
  doc,
  getDoc,
  updateDoc,
  increment,
  setDoc,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  deleteDoc
} from 'firebase/firestore';
import { Material, Customer, BuyTicket, BuyTicketMaterial, DoNotBuyEntry, UserProfile } from '../types';
import { COMPANY_NAME, COMPANY_ADDRESS, COMPANY_PHONE } from '../constants';
import { cn, generateTicketId } from '../lib/utils';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';
import { useSettings } from '../context/SettingsContext';
import { useToast } from '../context/ToastContext';
import ManagerPinModal from './ManagerPinModal';
import { ScaleCaptureButton } from './ScaleCaptureButton';
import { CameraCapture } from './CameraCapture';
import SignaturePad from './SignaturePad';
import { printTicket } from '../lib/printTicket';
import { BuyTicketPrint } from './BuyTicketPrint';
import { logAuditEvent } from '../lib/audit';
import { checkCatalyticConverterLimit } from '../lib/catalyticUtils';
import { calculateMaterialLineItem, isTonMaterial, formatUnitPrice } from '../lib/scrapPricing';
import { Hint } from './Hint';
import { trackOfflineWrite } from '../hooks/useNetworkStatus';
import { PricingUnitBadge } from './PricingUnitBadge';
import USBBarcodeScannerModal from './USBBarcodeScannerModal';
import { useQuickTicket } from '../context/QuickTicketContext';

function filterAndSortMaterials(materials: Material[], rawSearch: string): Material[] {
  if (!rawSearch || !rawSearch.trim()) return [];
  const search = rawSearch.toLowerCase().trim();

  const compareMaterials = (a: Material, b: Material) => {
    const codeA = (a.code || '').trim();
    const codeB = (b.code || '').trim();
    const numA = parseInt(codeA, 10);
    const numB = parseInt(codeB, 10);
    const aIsNum = !isNaN(numA) && String(numA) === codeA;
    const bIsNum = !isNaN(numB) && String(numB) === codeB;

    if (aIsNum && bIsNum) {
      if (numA !== numB) return numA - numB;
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    }
    if (aIsNum && !bIsNum) return -1;
    if (!aIsNum && bIsNum) return 1;

    const codeCompare = codeA.localeCompare(codeB, undefined, { numeric: true, sensitivity: 'base' });
    if (codeCompare !== 0) return codeCompare;
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  };

  const p1ExactCode: Material[] = [];
  const p2CodeStartsWith: Material[] = [];
  const p3CodeContains: Material[] = [];
  const p4NameStartsWith: Material[] = [];
  const p5NameContains: Material[] = [];

  for (const m of materials) {
    const code = (m.code || '').toLowerCase().trim();
    const name = (m.name || '').toLowerCase().trim();

    if (code && code === search) {
      p1ExactCode.push(m);
    } else if (code && code.startsWith(search)) {
      p2CodeStartsWith.push(m);
    } else if (code && code.includes(search)) {
      p3CodeContains.push(m);
    } else if (name.startsWith(search)) {
      p4NameStartsWith.push(m);
    } else if (name.includes(search)) {
      p5NameContains.push(m);
    }
  }

  p1ExactCode.sort(compareMaterials);
  p2CodeStartsWith.sort(compareMaterials);
  p3CodeContains.sort(compareMaterials);
  p4NameStartsWith.sort(compareMaterials);
  p5NameContains.sort(compareMaterials);

  return [
    ...p1ExactCode,
    ...p2CodeStartsWith,
    ...p3CodeContains,
    ...p4NameStartsWith,
    ...p5NameContains,
  ];
}

interface QuickTicketModalProps {
  isOpen: boolean;
  onClose: () => void;
  profile: UserProfile | null;
  initialDraftId?: string | null;
}

export default function QuickTicketModal({
  isOpen,
  onClose,
  profile,
  initialDraftId
}: QuickTicketModalProps) {
  const { settings } = useSettings();
  const { firestore, error: toastError, warning: toastWarning } = useToast();
  const { focusMaterialInputRef } = useQuickTicket();

  const [materials, setMaterials] = useState<Material[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [doNotBuyList, setDoNotBuyList] = useState<DoNotBuyEntry[]>([]);
  const [dnbLoaded, setDnbLoaded] = useState(false);
  const dnbLoadedRef = useRef(false);
  const dnbListRef = useRef<DoNotBuyEntry[]>([]);

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
  const [customerSearch, setCustomerSearch] = useState('');
  const [isCustomerLookupOpen, setIsCustomerLookupOpen] = useState(false);

  const [qtItems, setQtItems] = useState<{
    id: string;
    material: Material | null;
    gross: number;
    tare: number;
    deduction: number;
    overridePrice?: number;
    unit?: 'lb' | 'ton';
    materialSearch?: string;
    isDropdownOpen?: boolean;
    photoUrl?: string;
  }[]>([
    {
      id: Math.random().toString(36).substr(2, 9),
      material: null,
      gross: 0,
      tare: 0,
      deduction: 0,
      materialSearch: '',
      isDropdownOpen: true,
      photoUrl: ''
    }
  ]);

  const [qtProcessing, setQtProcessing] = useState(false);
  const [showPrintPreview, setShowPrintPreview] = useState(false);
  const [qtSuccess, setQtSuccess] = useState(false);
  const [qtVerificationStatus, setQtVerificationStatus] = useState<
    'idle' | 'verifying' | 'verified' | 'failed' | 'offline-saved'
  >('idle');
  const [qtCreatedTicketId, setQtCreatedTicketId] = useState<string>('');

  const [printedTicket, setPrintedTicket] = useState<{
    id: string;
    customerId: string;
    customerName: string;
    materials: BuyTicketMaterial[];
    items: typeof qtItems;
    totalAmount: number;
    netWeight: number;
    timestamp: string;
    paymentMethod: 'cash' | 'check' | 'other' | 'eft';
    vehiclePlate?: string;
    vehicleType?: string;
    signatureUrl?: string;
    sellerAffirmed?: boolean;
    customerPhotoUrl?: string;
    vehiclePhotoUrl?: string;
    loadPhotoUrl?: string;
    idImageUrl?: string;
    ohioDatabaseStatus?: 'not_checked' | 'cleared' | 'flagged';
    idNumber?: string;
  } | null>(null);

  const [isRunningPostDpsCheck, setIsRunningPostDpsCheck] = useState(false);
  const [postDpsResult, setPostDpsResult] = useState<{ status: 'cleared' | 'flagged'; message: string } | null>(null);

  const [qtCustomerPhotoUrl, setQtCustomerPhotoUrl] = useState('');
  const [qtVehiclePhotoUrl, setQtVehiclePhotoUrl] = useState('');
  const [qtLoadPhotoUrl, setQtLoadPhotoUrl] = useState('');
  const [qtIdImageUrl, setQtIdImageUrl] = useState('');
  const [qtIdStatus, setQtIdStatus] = useState<'none' | 'on_file' | 'expired'>('none');
  const [qtVehiclePlate, setQtVehiclePlate] = useState('');
  const [qtVehicleType, setQtVehicleType] = useState('');
  const [showQtVehicleConfirm, setShowQtVehicleConfirm] = useState(false);
  const [qtVehicleBypassed, setQtVehicleBypassed] = useState(false);
  const [qtSignatureUrl, setQtSignatureUrl] = useState('');
  const [qtOhioDatabaseStatus, setQtOhioDatabaseStatus] = useState<'not_checked' | 'cleared' | 'flagged'>(
    'not_checked'
  );
  const [isCheckingOhioPortal, setIsCheckingOhioPortal] = useState(false);
  const [ohioCheckMessage, setOhioCheckMessage] = useState<string | null>(null);

  const [idCheckResult, setIdCheckResult] = useState<{ prohibited: boolean; reason?: string } | null>(null);
  const [showPinModal, setShowPinModal] = useState(false);
  const [activeDraftId, setActiveDraftId] = useState<string | null>(initialDraftId || null);
  const [unconfirmedDraft, setUnconfirmedDraft] = useState<{ id: string; data: any } | null>(null);

  const [isUSBScannerOpen, setIsUSBScannerOpen] = useState(false);
  const [usbScanFeedback, setUsbScanFeedback] = useState<{ type: 'success' | 'new'; message: string } | null>(null);

  // Helper to format draft timestamp for recovery banner
  const formatDraftTime = (timeStr?: string) => {
    if (!timeStr) return 'earlier';
    try {
      const d = new Date(timeStr);
      if (isNaN(d.getTime())) return 'earlier';
      return (
        d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) +
        ' (' +
        d.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
        ')'
      );
    } catch {
      return 'earlier';
    }
  };

  // Clean state reset function
  const resetQuickTicket = (deleteDraft: boolean = false) => {
    if (deleteDraft && activeDraftId) {
      deleteDoc(doc(db, 'ticketDrafts', activeDraftId)).catch(console.error);
      setActiveDraftId(null);
    }
    setUnconfirmedDraft(null);
    setStep(1);
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
    setCustomerSearch('');
    setIsCustomerLookupOpen(false);
    setQtItems([
      {
        id: Math.random().toString(36).substr(2, 9),
        material: null,
        gross: 0,
        tare: 0,
        deduction: 0,
        materialSearch: '',
        isDropdownOpen: true,
        photoUrl: ''
      }
    ]);
    setQtCustomerPhotoUrl('');
    setQtVehiclePhotoUrl('');
    setQtLoadPhotoUrl('');
    setQtIdImageUrl('');
    setQtIdStatus('none');
    setQtVehiclePlate('');
    setQtVehicleType('');
    setShowQtVehicleConfirm(false);
    setQtVehicleBypassed(false);
    setQtSignatureUrl('');
    setQtOhioDatabaseStatus('not_checked');
    setOhioCheckMessage(null);
    setIdCheckResult(null);
    setQtSuccess(false);
    setPrintedTicket(null);
    setQtCreatedTicketId('');
    setQtVerificationStatus('idle');
    setShowPrintPreview(false);
  };

  // Resume a draft and load its full state
  const handleResumeDraft = (draft: { id: string; data: any }) => {
    const d = draft.data;
    setActiveDraftId(draft.id);
    setUnconfirmedDraft(null);

    if (d.qtCustomer) {
      setQtCustomer(d.qtCustomer);
      setIsQtNewCustomer(false);
    } else if (d.selectedCustomer) {
      setQtCustomer(d.selectedCustomer);
      setIsQtNewCustomer(false);
    } else if (d.qtNewCustomer) {
      setQtNewCustomer(d.qtNewCustomer);
      setIsQtNewCustomer(d.isQtNewCustomer ?? true);
    } else if (d.newCustomer) {
      setQtNewCustomer(d.newCustomer);
      setIsQtNewCustomer(d.isNewCustomer ?? true);
    }

    if (d.qtItems && d.qtItems.length > 0) {
      setQtItems(
        d.qtItems.map((it: any) => ({
          ...it,
          id: it.id || Math.random().toString(36).substr(2, 9),
          material: it.material || null,
          gross: it.gross || 0,
          tare: it.tare || 0,
          deduction: it.deduction || 0,
          overridePrice: it.overridePrice !== undefined ? it.overridePrice : it.pricePerUnit,
          unit: it.unit || 'lb',
          materialSearch: '',
          isDropdownOpen: false,
          photoUrl: it.photoUrl || ''
        }))
      );
    } else if (d.items && d.items.length > 0) {
      setQtItems(
        d.items.map((it: any) => ({
          id: it.id || Math.random().toString(36).substr(2, 9),
          material: it.material || null,
          gross: it.grossWeight || it.gross || 0,
          tare: it.tareWeight || it.tare || 0,
          deduction: it.deductionWeight || it.deduction || 0,
          overridePrice: it.pricePerUnit !== undefined ? it.pricePerUnit : it.overridePrice,
          unit: it.unit || 'lb',
          materialSearch: '',
          isDropdownOpen: false,
          photoUrl: it.photoUrl || ''
        }))
      );
    }

    if (d.qtStep || d.step) {
      setStep(d.qtStep || d.step);
    }

    if (d.qtVehiclePlate || d.ticketDetails?.vehiclePlate) setQtVehiclePlate(d.qtVehiclePlate || d.ticketDetails?.vehiclePlate);
    if (d.qtVehicleType || d.ticketDetails?.vehicleType) setQtVehicleType(d.qtVehicleType || d.ticketDetails?.vehicleType);
    if (d.qtCustomerPhotoUrl || d.ticketDetails?.customerPhotoUrl) setQtCustomerPhotoUrl(d.qtCustomerPhotoUrl || d.ticketDetails?.customerPhotoUrl);
    if (d.qtVehiclePhotoUrl || d.ticketDetails?.vehiclePhotoUrl) setQtVehiclePhotoUrl(d.qtVehiclePhotoUrl || d.ticketDetails?.vehiclePhotoUrl);
    if (d.qtLoadPhotoUrl || d.ticketDetails?.loadPhotoUrl) setQtLoadPhotoUrl(d.qtLoadPhotoUrl || d.ticketDetails?.loadPhotoUrl);
    if (d.qtIdImageUrl || d.ticketDetails?.idImageUrl) setQtIdImageUrl(d.qtIdImageUrl || d.ticketDetails?.idImageUrl);
    if (d.qtSignatureUrl || d.ticketDetails?.signatureUrl) setQtSignatureUrl(d.qtSignatureUrl || d.ticketDetails?.signatureUrl);
    if (d.qtOhioDatabaseStatus || d.ticketDetails?.ohioDatabaseStatus) setQtOhioDatabaseStatus(d.qtOhioDatabaseStatus || d.ticketDetails?.ohioDatabaseStatus);
  };

  // Start fresh by deleting the draft document and resetting state
  const handleStartFresh = async (draftId?: string) => {
    const idToDelete = draftId || unconfirmedDraft?.id || activeDraftId;
    if (idToDelete) {
      await deleteDoc(doc(db, 'ticketDrafts', idToDelete)).catch(console.error);
    }
    setActiveDraftId(null);
    setUnconfirmedDraft(null);
    resetQuickTicket(false);
  };

  // Real-time Firestore Subscriptions
  useEffect(() => {
    if (!isOpen) return;

    const unsubMaterials = onSnapshot(collection(db, 'materials'), (snap) => {
      setMaterials(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Material)));
    });
    const unsubCustomers = onSnapshot(collection(db, 'customers'), (snap) => {
      setCustomers(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Customer)));
    });
    const unsubDnb = onSnapshot(collection(db, 'doNotBuy'), (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as DoNotBuyEntry));
      dnbListRef.current = list;
      dnbLoadedRef.current = true;
      setDoNotBuyList(list);
      setDnbLoaded(true);
    });

    return () => {
      unsubMaterials();
      unsubCustomers();
      unsubDnb();
      setDnbLoaded(false);
      dnbLoadedRef.current = false;
    };
  }, [isOpen]);

  // Register focus function in context ref for instant access on touch and click
  useEffect(() => {
    if (focusMaterialInputRef) {
      focusMaterialInputRef.current = () => {
        const input = document.querySelector('[data-material-search]') as HTMLInputElement;
        if (input) {
          input.focus({ preventScroll: false });
          input.click(); // triggers dropdown open on touch
        }
      };
    }
  }, [focusMaterialInputRef]);

  // Fallback useEffect for when isOpen and step === 1 change
  useEffect(() => {
    if (!isOpen || step !== 1 || unconfirmedDraft !== null) return;
    const timer = setTimeout(() => {
      const input = document.querySelector('[data-material-search]') as HTMLInputElement;
      if (input) {
        input.focus({ preventScroll: false });
        input.click();
      }
    }, 300); // slightly longer delay for modal animation to complete
    return () => clearTimeout(timer);
  }, [isOpen, step, unconfirmedDraft]);

  // FIX 2: Check for existing draft on modal open or load initialDraftId
  useEffect(() => {
    if (isOpen) {
      if (initialDraftId) {
        getDoc(doc(db, 'ticketDrafts', initialDraftId))
          .then((snap) => {
            if (snap.exists()) {
              handleResumeDraft({ id: snap.id, data: snap.data() });
            }
          })
          .catch(console.error);
      } else {
        const userEmail = auth.currentUser?.email || profile?.email;
        if (userEmail) {
          const checkUserDraft = async () => {
            try {
              const q = query(
                collection(db, 'ticketDrafts'),
                where('createdBy', '==', userEmail),
                where('status', '==', 'draft'),
                orderBy('updatedAt', 'desc'),
                limit(1)
              );
              const snap = await getDocs(q);
              if (!snap.empty) {
                const docSnap = snap.docs[0];
                setUnconfirmedDraft({ id: docSnap.id, data: docSnap.data() });
              }
            } catch (queryErr) {
              // Fallback query if composite index is building
              try {
                const fallbackQ = query(
                  collection(db, 'ticketDrafts'),
                  where('createdBy', '==', userEmail),
                  limit(10)
                );
                const snap = await getDocs(fallbackQ);
                if (!snap.empty) {
                  const validDrafts = snap.docs
                    .map((d) => ({ id: d.id, data: d.data() }))
                    .filter((d) => d.data.status === 'draft' || !d.data.status)
                    .sort(
                      (a, b) =>
                        new Date(b.data.updatedAt || b.data.lastUpdated || b.data.timestamp || 0).getTime() -
                        new Date(a.data.updatedAt || a.data.lastUpdated || a.data.timestamp || 0).getTime()
                    );
                  if (validDrafts.length > 0) {
                    setUnconfirmedDraft(validDrafts[0]);
                  }
                }
              } catch (e) {
                console.warn('Draft search fallback failed:', e);
              }
            }
          };
          checkUserDraft();
        }
      }
    } else {
      setUnconfirmedDraft(null);
    }
  }, [isOpen, initialDraftId, profile?.email]);

  // FIX 1: Auto-save draft frequently during ticket entry (debounced 1.5s)
  useEffect(() => {
    if (!isOpen || step === 0 || qtSuccess || unconfirmedDraft !== null) return;

    // Only save if there is meaningful data to preserve
    const hasData =
      qtItems.some((i) => i.material || i.gross > 0) ||
      qtCustomer !== null ||
      (qtNewCustomer.name && qtNewCustomer.name.trim() !== '');

    if (!hasData) return;

    const userEmail = auth.currentUser?.email || profile?.email || 'unknown';
    const draftData = {
      userId: auth.currentUser?.uid || 'anonymous',
      createdBy: userEmail,
      createdByEmail: userEmail,
      createdByName: profile?.displayName || auth.currentUser?.displayName || 'Staff',
      type: 'quick',
      step,
      qtStep: step,
      status: 'draft',
      timestamp: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      qtItems,
      qtCustomer,
      qtNewCustomer,
      isQtNewCustomer,
      qtVehiclePlate,
      qtVehicleType,
      qtCustomerPhotoUrl,
      qtVehiclePhotoUrl,
      qtLoadPhotoUrl,
      qtIdImageUrl,
      qtSignatureUrl,
      qtOhioDatabaseStatus,
      selectedCustomer: qtCustomer
        ? {
            id: qtCustomer.id,
            name: qtCustomer.name,
            phone: qtCustomer.phone || '',
            address: qtCustomer.address || '',
            businessName: qtCustomer.businessName || '',
            idType: qtCustomer.idType || '',
            idNumber: qtCustomer.idNumber || '',
            idExpiration: qtCustomer.idExpiration || ''
          }
        : null,
      isNewCustomer: isQtNewCustomer,
      newCustomer: qtNewCustomer,
      items: qtItems.map((i) => ({
        id: i.id,
        material: i.material,
        materialId: i.material?.id || '',
        materialName: i.material?.name || '',
        materialCode: i.material?.code || '',
        grossWeight: i.gross || 0,
        gross: i.gross || 0,
        tareWeight: i.tare || 0,
        tare: i.tare || 0,
        deductionWeight: i.deduction || 0,
        deduction: i.deduction || 0,
        pricePerUnit: i.overridePrice !== undefined ? i.overridePrice : (i.material?.buyPrice || 0),
        overridePrice: i.overridePrice,
        unit: i.unit || 'lb',
        photoUrl: i.photoUrl || ''
      })),
      ticketDetails: {
        vehiclePlate: qtVehiclePlate || '',
        vehicleType: qtVehicleType || '',
        customerPhotoUrl: qtCustomerPhotoUrl || '',
        vehiclePhotoUrl: qtVehiclePhotoUrl || '',
        loadPhotoUrl: qtLoadPhotoUrl || '',
        idImageUrl: qtIdImageUrl || '',
        signatureUrl: qtSignatureUrl || '',
        ohioDatabaseStatus: qtOhioDatabaseStatus || 'not_checked'
      }
    };

    const saveDraft = async () => {
      try {
        if (activeDraftId) {
          await updateDoc(doc(db, 'ticketDrafts', activeDraftId), draftData);
        } else {
          const ref = await addDoc(collection(db, 'ticketDrafts'), draftData);
          setActiveDraftId(ref.id);
        }
      } catch (e) {
        console.warn('Draft auto-save failed:', e);
      }
    };

    const timer = setTimeout(saveDraft, 1500); // debounce 1.5 seconds
    return () => clearTimeout(timer);
  }, [
    isOpen,
    qtSuccess,
    qtItems,
    qtCustomer,
    qtNewCustomer,
    isQtNewCustomer,
    step,
    qtVehiclePlate,
    qtVehicleType,
    qtCustomerPhotoUrl,
    qtVehiclePhotoUrl,
    qtLoadPhotoUrl,
    qtIdImageUrl,
    qtSignatureUrl,
    qtOhioDatabaseStatus,
    activeDraftId,
    unconfirmedDraft,
    profile
  ]);

  // Calculations
  const qtTotals = useMemo(() => {
    return qtItems.reduce(
      (acc, item) => {
        const price = item.overridePrice !== undefined ? item.overridePrice : (item.material?.buyPrice || 0);
        const effectiveUnit = item.unit || item.material?.unit;
        const line = calculateMaterialLineItem(
          item.gross,
          item.tare,
          item.deduction,
          price,
          effectiveUnit,
          item.material?.category,
          item.material?.name
        );
        return {
          netWeight: acc.netWeight + line.netWeight,
          totalAmount: acc.totalAmount + line.totalAmount
        };
      },
      { netWeight: 0, totalAmount: 0 }
    );
  }, [qtItems]);

  const totalNetWeight = qtTotals.netWeight;
  const totalAmount = qtTotals.totalAmount;

  // Auto-fill customer history on selection
  useEffect(() => {
    if (qtCustomer) {
      if (qtCustomer.vehiclePlate) setQtVehiclePlate(qtCustomer.vehiclePlate);
      if (qtCustomer.vehicleType) setQtVehicleType(qtCustomer.vehicleType);
      if (qtCustomer.vehiclePhotoUrl) setQtVehiclePhotoUrl(qtCustomer.vehiclePhotoUrl);
      if (qtCustomer.photoUrl) setQtCustomerPhotoUrl(qtCustomer.photoUrl);
      
      // ID image 365-day expiry verification
      if (qtCustomer.idImageUrl) {
        let isExpired = false;
        if (qtCustomer.idImageUpdatedAt) {
          const scanDate = new Date(qtCustomer.idImageUpdatedAt);
          const daysSinceScan = Math.floor(Math.abs(Date.now() - scanDate.getTime()) / (1000 * 60 * 60 * 24));
          if (daysSinceScan > 365) {
            isExpired = true;
          }
        }
        if (isExpired) {
          setQtIdImageUrl('');
          setQtIdStatus('expired');
        } else {
          setQtIdImageUrl(qtCustomer.idImageUrl);
          setQtIdStatus('on_file');
        }
      } else {
        setQtIdImageUrl('');
        setQtIdStatus('none');
      }

      const qTickets = query(
        collection(db, 'buyTickets'),
        where('customerId', '==', qtCustomer.id),
        orderBy('timestamp', 'desc'),
        limit(1)
      );

      getDocs(qTickets)
        .then((snap) => {
          if (!snap.empty) {
            const lastTicket = snap.docs[0].data();
            if (lastTicket.vehiclePlate && !qtCustomer.vehiclePlate) setQtVehiclePlate(lastTicket.vehiclePlate);
            if (lastTicket.vehicleType && !qtCustomer.vehicleType) setQtVehicleType(lastTicket.vehicleType);
            if (lastTicket.vehiclePhotoUrl && !qtCustomer.vehiclePhotoUrl)
              setQtVehiclePhotoUrl(lastTicket.vehiclePhotoUrl);
            if (lastTicket.customerPhotoUrl && !qtCustomer.photoUrl) setQtCustomerPhotoUrl(lastTicket.customerPhotoUrl);
            if (lastTicket.idImageUrl && !qtCustomer.idImageUrl) {
              const scanDate = lastTicket.timestamp ? new Date(lastTicket.timestamp) : null;
              const daysSinceScan = scanDate ? Math.floor(Math.abs(Date.now() - scanDate.getTime()) / (1000 * 60 * 60 * 24)) : 0;
              if (daysSinceScan > 365) {
                setQtIdImageUrl('');
                setQtIdStatus('expired');
              } else {
                setQtIdImageUrl(lastTicket.idImageUrl);
                setQtIdStatus('on_file');
              }
            }
          }
        })
        .catch((err) => console.warn('Could not load customer history:', err));
    }
  }, [qtCustomer]);

  // Ohio DPS Check & Do-Not-Buy matching
  const namesMatch = (dnbName: string, custName: string) => {
    const cleanDnb = dnbName.toLowerCase().replace(/[^a-z0-9]/g, ' ').trim().split(/\s+/);
    const cleanCust = custName.toLowerCase().replace(/[^a-z0-9]/g, ' ').trim().split(/\s+/);
    if (cleanDnb.length === 0 || cleanCust.length === 0) return false;
    return cleanDnb.every((part) => cleanCust.includes(part));
  };

  // Helper: resolve status purely from the local Do-Not-Buy list. Always sets a definite status.
  const applyLocalResult = (localMatch: DoNotBuyEntry | undefined, nameToCheck: string) => {
    const count = dnbListRef.current.length || doNotBuyList.length;
    if (localMatch) {
      setQtOhioDatabaseStatus('flagged');
      setOhioCheckMessage(`FLAGGED — matches Do-Not-Buy entry: ${localMatch.reason || 'listed'}`);
    } else {
      setQtOhioDatabaseStatus('cleared');
      setOhioCheckMessage(`Cleared against local Do-Not-Buy list (${count} entries). Live state portal unavailable.`);
    }
  };

  // Ohio DPS Check Handler
  const runOhioCheck = async (customerName?: string, idNum?: string) => {
    const nameToCheck = customerName || qtCustomer?.name || qtNewCustomer.name || '';
    if (!nameToCheck || nameToCheck.trim() === '') return;

    setIsCheckingOhioPortal(true);
    setOhioCheckMessage(null);

    // If check is triggered before the list loads, wait and retry once the list is ready
    if (!dnbLoadedRef.current) {
      setOhioCheckMessage("Loading local Do-Not-Buy registry...");
      let attempts = 0;
      while (!dnbLoadedRef.current && attempts < 25) {
        await new Promise((r) => setTimeout(r, 200));
        attempts++;
      }
    }

    // Always run the local Do-Not-Buy check first — this is the reliable source of truth.
    const currentList = dnbListRef.current.length > 0 ? dnbListRef.current : doNotBuyList;
    const localMatch = currentList.find((entry) => namesMatch(entry.name, nameToCheck));

    try {
      const response = await fetch("/api/check-ohio-db", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: nameToCheck,
          idNumber: idNum || qtCustomer?.idNumber || qtNewCustomer.idNumber || ''
        })
      });
      if (!response.ok) throw new Error("Portal responded with an error");
      const res = await response.json();

      if (res.success) {
        // If EITHER the live portal OR the local list flags them, they are flagged.
        if (res.status === 'flagged' || localMatch) {
          setQtOhioDatabaseStatus('flagged');
          setOhioCheckMessage(
            localMatch
              ? `FLAGGED — matches Do-Not-Buy entry: ${localMatch.reason || 'listed'}`
              : (res.message || 'Flagged in state registry')
          );
        } else {
          setQtOhioDatabaseStatus('cleared');
          setOhioCheckMessage(`Cleared — ${res.source === 'state_portal' ? 'live state database' : 'local registry'}`);
        }
      } else {
        // API returned but not success — fall back to local result
        applyLocalResult(localMatch, nameToCheck);
      }
    } catch (err) {
      console.warn("Live Ohio portal unreachable, using local Do-Not-Buy list:", err);
      applyLocalResult(localMatch, nameToCheck);
    } finally {
      setIsCheckingOhioPortal(false);
    }
  };

  // Run Ohio DPS check after ticket finalization
  const runPostTicketOhioCheck = async (ticketId: string, customerName: string, idNum?: string) => {
    if (!ticketId || !customerName) return;
    setIsRunningPostDpsCheck(true);
    try {
      const response = await fetch("/api/check-ohio-db", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: customerName,
          idNumber: idNum || ''
        })
      });
      const res = await response.json();
      if (res.success) {
        const newStatus = res.status as 'cleared' | 'flagged';
        setPostDpsResult({ status: newStatus, message: res.message });
        setQtOhioDatabaseStatus(newStatus);
        
        // Update ticket in Firestore
        const ticketRef = doc(db, 'buyTickets', ticketId);
        await updateDoc(ticketRef, {
          ohioDatabaseStatus: newStatus,
          ohioCheckUpdatedAt: new Date().toISOString()
        });

        if (printedTicket) {
          setPrintedTicket({
            ...printedTicket,
            ohioDatabaseStatus: newStatus
          });
        }

        await logAuditEvent(
          'buyTicket',
          ticketId,
          'update',
          { after: { ohioDatabaseStatus: newStatus } },
          `Post-ticket Ohio DPS check completed: ${newStatus.toUpperCase()} for ${customerName}`
        );
      }
    } catch (err) {
      console.error("Error running post-ticket DPS check:", err);
    } finally {
      setIsRunningPostDpsCheck(false);
    }
  };

  // Automatically trigger Ohio Homeland Security check when Step 3 mounts or customer info updates,
  // gated by dnbLoaded so we never evaluate against an empty/unloaded list.
  useEffect(() => {
    if (step === 3 && dnbLoaded) {
      const activeName = qtCustomer?.name || qtNewCustomer.name;
      if (activeName && activeName.trim() !== '') {
        const activeId = qtCustomer?.idNumber || qtNewCustomer.idNumber;
        const timer = setTimeout(() => {
          if (qtOhioDatabaseStatus === 'not_checked') {
            runOhioCheck(activeName, activeId);
          }
        }, 800);
        return () => clearTimeout(timer);
      }
    }
  }, [step, dnbLoaded, qtCustomer?.id, qtCustomer?.name, qtNewCustomer.name, qtOhioDatabaseStatus]);

  // Automatically reset check status when customer changes
  useEffect(() => {
    setQtOhioDatabaseStatus('not_checked');
    setOhioCheckMessage(null);
  }, [qtCustomer?.id, qtNewCustomer.name]);

  const checkDoNotBuy = () => {
    const nameToCheck = qtCustomer?.name || qtNewCustomer.name;
    const currentList = dnbListRef.current.length > 0 ? dnbListRef.current : doNotBuyList;
    const match = currentList.find((entry) => namesMatch(entry.name, nameToCheck));

    if (match) {
      setIdCheckResult({ prohibited: true, reason: match.reason });
    } else {
      setIdCheckResult({ prohibited: false });
    }
    setStep(4);
  };

  const handleNext = () => {
    // Step 1 -> Step 2: At least one material with valid net weight (gross - tare > 0)
    if (step === 1) {
      const hasValidMaterial = qtItems.some((i) => i.material && (i.gross - i.tare) > 0);
      if (!hasValidMaterial) {
        alert('Please select a material and enter a valid weight (gross - tare > 0) before proceeding.');
        return;
      }
      setStep(2);
    } 
    // Step 2 -> Step 3: Customer selected or new customer first + last name entered
    else if (step === 2) {
      const hasCustomer = qtCustomer || (isQtNewCustomer && qtNewCustomer.name && qtNewCustomer.name.trim().length > 0);
      if (!hasCustomer) {
        alert('Please select an existing customer or enter the new customer name.');
        return;
      }
      setStep(3);
    } 
    // Step 3 -> Step 4: ID photo and seller photo required; DPS flagged prohibited, pending allowed to run after
    else if (step === 3) {
      // Compliance Hard Block 1: Photo ID Image Required (No Bypass)
      if (!qtIdImageUrl) {
        alert('Ohio ORC 4737.04 Compliance: A valid photo ID image is required before this ticket can be completed. Please capture or upload a photo ID.');
        return;
      }

      // Compliance Hard Block 2: Seller Photo Required (No Bypass)
      if (!qtCustomerPhotoUrl) {
        alert('Ohio ORC 4737.04 Compliance: A photograph of the seller is required before this ticket can be completed. Please capture a customer photo before continuing.');
        return;
      }

      // Compliance Hard Block 3: Flagged sellers are prohibited; not_checked must resolve first
      if (qtOhioDatabaseStatus === 'flagged') {
        alert('Ohio DPS Check: This seller is FLAGGED on the Do-Not-Buy registry. Transactions for flagged individuals are prohibited by Ohio law.');
        return;
      }
      if (qtOhioDatabaseStatus === 'not_checked') {
        alert('Ohio DPS Check: Verification against the Do-Not-Buy registry is required before continuing. Please wait for check to complete or click Re-Check Database.');
        return;
      }

      if (!qtVehiclePlate && !qtVehicleType && !qtVehicleBypassed) {
        setShowQtVehicleConfirm(true);
        return;
      }
      checkDoNotBuy();
    }
  };

  // Barcode USB Scanner handling
  const handleQuickUSBScanSuccess = (result: {
    name: string;
    idNumber: string;
    address: string;
    idType: string;
    idExpiration: string;
  }) => {
    const existing = customers.find(
      (c) =>
        c.idNumber &&
        c.idNumber.replace(/[^A-Za-z0-9]/g, '').toUpperCase() ===
          result.idNumber.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
    );

    if (existing) {
      setQtCustomer(existing);
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
        idType: result.idType || "Driver's License",
        idExpiration: result.idExpiration
      });
      setIsQtNewCustomer(true);
      setUsbScanFeedback({
        type: 'new',
        message: `Parsed new driver's license for: ${result.name}`
      });
    }
    setTimeout(() => setUsbScanFeedback(null), 5000);
  };

  // Submission handler
  const handleQuickTicketSubmit = async () => {
    // Compliance Hard Block Validations
    if (!qtSignatureUrl) {
      alert('Seller signature is required before finalizing the ticket.');
      return;
    }
    if (!qtIdImageUrl) {
      alert('Ohio ORC 4737.04 Compliance: A valid photo ID image is required before this ticket can be completed.');
      return;
    }
    if (!qtCustomerPhotoUrl) {
      alert('Ohio ORC 4737.04 Compliance: A photograph of the seller is required before this ticket can be completed.');
      return;
    }
    if (qtOhioDatabaseStatus === 'flagged') {
      alert('Ohio DPS Check: This seller is FLAGGED on the Do-Not-Buy registry. Submission is prohibited.');
      return;
    }
    if (qtOhioDatabaseStatus === 'not_checked') {
      alert('Ohio DPS Check: State and local database verification is required before finalizing this ticket.');
      return;
    }

    const hasOverrides = qtItems.some(
      (i) => i.overridePrice !== undefined && i.overridePrice !== i.material?.buyPrice
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
      const sellerIdNum = isQtNewCustomer ? qtNewCustomer.idNumber || '' : qtCustomer?.idNumber || '';
      const bName = isQtNewCustomer ? qtNewCustomer.businessName || '' : qtCustomer?.businessName || '';

      const catalyticCheck = await checkCatalyticConverterLimit(
        qtItems.map((item) => ({
          materialId: item.material?.id || '',
          material: item.material || undefined,
          grossWeight: item.gross,
          tareWeight: item.tare,
          netWeight: item.gross - item.tare,
          deductionWeight: item.deduction,
          pricePerUnit: item.overridePrice || item.material?.buyPrice || 0,
          totalAmount: 0
        })),
        materials,
        sellerIdNum,
        bName,
        db,
        qtCustomer?.id,
        customers
      );

      if (!catalyticCheck.allowed) {
        alert(catalyticCheck.errorMessage);
        setQtProcessing(false);
        return;
      }

      let customerId = qtCustomer?.id;
      let newCustomerDocPromise: Promise<void> | null = null;
      if (isQtNewCustomer && !customerId) {
        customerId = doc(collection(db, 'customers')).id;
        const newCustomerData = {
          ...qtNewCustomer,
          photoUrl: qtCustomerPhotoUrl || '',
          idImageUrl: qtIdImageUrl || '',
          idImageUpdatedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        newCustomerDocPromise = setDoc(doc(db, 'customers', customerId), newCustomerData);
        trackOfflineWrite(newCustomerDocPromise);
      }

      if (!customerId) throw new Error('Customer ID missing');

      const ticketMaterials: BuyTicketMaterial[] = qtItems.map((item) => {
        const price = item.overridePrice !== undefined ? item.overridePrice : (item.material?.buyPrice || 0);
        const effectiveUnit = item.unit || item.material?.unit;
        const line = calculateMaterialLineItem(
          item.gross,
          item.tare,
          item.deduction,
          price,
          effectiveUnit,
          item.material?.category,
          item.material?.name
        );
        const material: BuyTicketMaterial = {
          materialId: item.material?.id || '',
          grossWeight: item.gross,
          tareWeight: item.tare,
          netWeight: line.netWeight,
          pricePerUnit: price,
          totalAmount: line.totalAmount,
          unit: isTonMaterial(effectiveUnit, item.material?.category, item.material?.name) ? 'ton' : 'lb'
        };

        if (item.deduction > 0) material.deductionWeight = item.deduction;
        if (item.photoUrl) material.photoUrl = item.photoUrl;

        return material;
      });

      const calculatedFinalTotal =
        Math.round(ticketMaterials.reduce((sum, item) => sum + (item.totalAmount || 0), 0) * 100) / 100;

      const ticketData: Omit<BuyTicket, 'id'> & { [key: string]: any } = {
        customerId,
        materials: ticketMaterials,
        totalAmount: calculatedFinalTotal,
        status: 'completed',
        timestamp: new Date().toISOString(),
        paymentMethod: 'cash',
        customerPhotoUrl: qtCustomerPhotoUrl || '',
        vehiclePhotoUrl: qtVehiclePhotoUrl || '',
        loadPhotoUrl: qtLoadPhotoUrl || '',
        idImageUrl: qtIdImageUrl || '',
        vehiclePlate: qtVehiclePlate || '',
        vehicleType: qtVehicleType || '',
        signatureUrl: qtSignatureUrl || '',
        sellerAffirmed: !!qtSignatureUrl,
        createdBy: profile?.uid || '',
        createdByName: profile?.displayName || profile?.email || 'Cashier',
        ohioDatabaseStatus: qtOhioDatabaseStatus || 'not_checked',
        isQuickTicket: true,
        phone: isQtNewCustomer ? qtNewCustomer.phone || '' : qtCustomer?.phone || '',
        address: isQtNewCustomer ? qtNewCustomer.address || '' : qtCustomer?.address || '',
        businessName: isQtNewCustomer ? qtNewCustomer.businessName || '' : qtCustomer?.businessName || '',
        idType: isQtNewCustomer ? qtNewCustomer.idType || '' : qtCustomer?.idType || '',
        idNumber: isQtNewCustomer ? qtNewCustomer.idNumber || '' : qtCustomer?.idNumber || '',
        idExpiration: isQtNewCustomer ? qtNewCustomer.idExpiration || '' : qtCustomer?.idExpiration || ''
      };

      // 1. Locally generated ticket ID
      const ticketId = generateTicketId('BUY');
      const docRef = doc(db, 'buyTickets', ticketId);

      // 2. Write the ticket document with setDoc — do NOT await this for the purposes of printing. Fire it, keep the promise.
      const ticketPromise = setDoc(docRef, ticketData);
      trackOfflineWrite(ticketPromise);

      const customerName = qtCustomer?.name || qtNewCustomer.name || 'Walk-in Customer';

      // 3. Immediately set the printedTicket snapshot, set success state, and if autoPrint is enabled, call printTicket right away. The receipt renders from local state only — no fetches.
      const ticketSnapshot = {
        id: ticketId,
        customerId,
        customerName,
        materials: ticketMaterials,
        items: [...qtItems],
        totalAmount: calculatedFinalTotal,
        netWeight: totalNetWeight,
        timestamp: ticketData.timestamp,
        paymentMethod: 'cash' as const,
        vehiclePlate: qtVehiclePlate || '',
        vehicleType: qtVehicleType || '',
        signatureUrl: qtSignatureUrl || '',
        sellerAffirmed: !!(qtSignatureUrl),
        customerPhotoUrl: qtCustomerPhotoUrl || '',
        vehiclePhotoUrl: qtVehiclePhotoUrl || '',
        loadPhotoUrl: qtLoadPhotoUrl || '',
        idImageUrl: qtIdImageUrl || '',
        ohioDatabaseStatus: qtOhioDatabaseStatus || 'not_checked',
        idNumber: isQtNewCustomer ? qtNewCustomer.idNumber || '' : qtCustomer?.idNumber || ''
      };

      setPrintedTicket(ticketSnapshot);
      setQtCreatedTicketId(ticketId);
      setQtSuccess(true);
      setQtVerificationStatus(typeof navigator !== 'undefined' && !navigator.onLine ? 'offline-saved' : 'verified');

      // Auto-print if enabled immediately without waiting on network
      if (settings.autoPrint) {
        try {
          const tempTicket: BuyTicket = {
            id: ticketId,
            customerId,
            materials: ticketMaterials,
            totalAmount: calculatedFinalTotal,
            status: 'completed',
            timestamp: ticketData.timestamp,
            paymentMethod: 'cash',
            customerPhotoUrl: qtCustomerPhotoUrl || '',
            vehiclePhotoUrl: qtVehiclePhotoUrl || '',
            loadPhotoUrl: qtLoadPhotoUrl || '',
            idImageUrl: qtIdImageUrl || '',
            vehiclePlate: qtVehiclePlate || '',
            vehicleType: qtVehicleType || '',
            signatureUrl: qtSignatureUrl || '',
            sellerAffirmed: !!(qtSignatureUrl)
          };

          await printTicket(
            <BuyTicketPrint
              ticket={tempTicket}
              customerName={customerName}
              materials={materials}
              format={settings.receiptFormat}
            />,
            { format: settings.receiptFormat, debugMode: settings.debugPrintMode }
          );
        } catch (printErr) {
          console.warn('Auto print failed:', printErr);
        }
      }

      // 4. THEN await the remaining writes, each wrapped in its own try/catch so one failure does not abort the others
      let hadOfflineSyncPending = typeof navigator !== 'undefined' && !navigator.onLine;

      // Ticket document write
      try {
        await ticketPromise;
      } catch (ticketErr) {
        console.warn('Ticket write queued locally:', ticketErr);
        hadOfflineSyncPending = true;
      }

      // New customer creation write
      if (newCustomerDocPromise) {
        try {
          await newCustomerDocPromise;
        } catch (custErr) {
          console.warn('New customer doc write queued locally:', custErr);
          hadOfflineSyncPending = true;
        }
      }

      // Customer profile update with photos, ID, and vehicle info
      const customerUpdate: any = {};
      if (qtCustomerPhotoUrl) customerUpdate.photoUrl = qtCustomerPhotoUrl;
      if (qtIdImageUrl) {
        customerUpdate.idImageUrl = qtIdImageUrl;
        customerUpdate.idImageUpdatedAt = ticketData.timestamp;
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
        try {
          const custUpdatePromise = updateDoc(doc(db, 'customers', customerId), {
            ...customerUpdate,
            updatedAt: new Date().toISOString()
          });
          trackOfflineWrite(custUpdatePromise);
          await custUpdatePromise;
        } catch (custUpdateErr) {
          console.warn('Customer update write queued locally:', custUpdateErr);
          hadOfflineSyncPending = true;
        }
      }

      // Atomic inventory increments with merge: true — no prior read required
      for (const item of ticketMaterials) {
        try {
          const invRef = doc(db, 'inventory', item.materialId);
          const invPromise = setDoc(
            invRef,
            {
              materialId: item.materialId,
              currentWeight: increment(item.netWeight),
              lastUpdated: new Date().toISOString()
            },
            { merge: true }
          );
          trackOfflineWrite(invPromise);
          await invPromise;
        } catch (invErr) {
          console.warn(`Inventory increment for ${item.materialId} queued locally:`, invErr);
          hadOfflineSyncPending = true;
        }
      }

      // Audit logs
      try {
        const auditPromise = logAuditEvent(
          'buyTicket',
          ticketId,
          'create',
          { after: ticketData },
          `Quick Ticket created for ${customerName}`
        );
        trackOfflineWrite(auditPromise);
        await auditPromise;
      } catch (auditErr) {
        console.warn('Audit log write queued locally:', auditErr);
      }

      // Override audit logs
      for (const item of qtItems) {
        if (item.material && item.overridePrice !== undefined && item.overridePrice !== item.material.buyPrice) {
          try {
            const overridePromise = logAuditEvent(
              'buyTicket',
              ticketId,
              'override',
              {
                before: { price: item.material.buyPrice },
                after: { price: item.overridePrice }
              },
              `Price override approved for ${item.material.name} in Quick Ticket #${ticketId.toUpperCase()}: $${item.material.buyPrice.toFixed(2)}/lb to $${item.overridePrice.toFixed(2)}/lb`
            );
            trackOfflineWrite(overridePromise);
            await overridePromise;
          } catch (overrideErr) {
            console.warn('Override audit log queued locally:', overrideErr);
          }
        }
      }

      // Clean draft
      if (activeDraftId) {
        try {
          const draftDeletePromise = deleteDoc(doc(db, 'ticketDrafts', activeDraftId));
          trackOfflineWrite(draftDeletePromise);
          await draftDeletePromise;
          setActiveDraftId(null);
        } catch (draftErr) {
          console.warn('Draft cleanup queued locally:', draftErr);
        }
      }

      // 5. If any write is still pending because the device is offline, show a non-blocking amber toast: "Saved on this device — will sync when back online." Do not show an error.
      if (hadOfflineSyncPending || (typeof navigator !== 'undefined' && !navigator.onLine)) {
        toastWarning('Offline Mode', 'Saved on this device — will sync when back online.');
      } else {
        firestore(
          'Quick Ticket Finalized',
          `Ohio Buy Ticket #${ticketId.toUpperCase()} committed for ${customerName}. Total: $${calculatedFinalTotal.toFixed(2)}`
        );
      }
    } catch (err: any) {
      console.error('Error saving Quick Ticket:', err);
      setQtVerificationStatus('failed');
      toastError('Quick Ticket Failed', `Failed to commit ticket: ${err.message || err}`);
      handleFirestoreError(err, OperationType.CREATE, 'buyTickets');
    } finally {
      setQtProcessing(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[120] p-4 sm:p-6 overflow-hidden animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-white w-full sm:min-w-[480px] max-w-4xl rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh] animate-in zoom-in-95 duration-200">
        {/* Modal Header */}
        <div className="p-4 sm:p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/80">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-500 flex items-center justify-center text-slate-950 font-black shadow-lg shadow-amber-500/20">
              QT
            </div>
            <div>
              <h3 className="font-black font-display text-lg text-slate-900 flex items-center gap-2">
                Quick Ticket Flow
                <span className="text-[10px] font-bold px-2 py-0.5 bg-amber-100 text-amber-900 rounded-full">
                  Fast Lane
                </span>
              </h3>
              <p className="text-xs text-slate-500 font-medium">
                Step-by-step compliant cashier transaction
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            {!qtSuccess && (
              <div className="flex flex-wrap items-center gap-1 sm:gap-1.5">
                {[
                  { num: 1, label: 'Materials' },
                  { num: 2, label: 'Customer' },
                  { num: 3, label: 'Verify' },
                  { num: 4, label: 'Sign & Pay' }
                ].map((s) => (
                  <div
                    key={s.num}
                    className={cn(
                      'flex items-center gap-1 sm:gap-1.5 px-2 py-1 rounded-xl text-xs font-bold transition-all',
                      step === s.num
                        ? 'bg-amber-500 text-slate-950 font-black shadow-sm'
                        : step > s.num
                        ? 'bg-green-100 text-green-800 font-bold'
                        : 'bg-slate-100 text-slate-400 font-medium'
                    )}
                  >
                    <span
                      className={cn(
                        'w-4 h-4 rounded-full flex items-center justify-center text-[10px] shrink-0',
                        step === s.num
                          ? 'bg-slate-950 text-amber-400 font-black'
                          : step > s.num
                          ? 'bg-green-600 text-white font-bold'
                          : 'bg-slate-200 text-slate-500'
                      )}
                    >
                      {step > s.num ? '✓' : s.num}
                    </span>
                    <span className="text-[11px] whitespace-nowrap hidden md:inline">{s.label}</span>
                  </div>
                ))}
              </div>
            )}
            <button
              onClick={() => {
                onClose();
              }}
              className="p-2 hover:bg-slate-200 rounded-full transition-colors cursor-pointer"
              aria-label="Close modal"
            >
              <X className="w-5 h-5 text-slate-500" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {/* Post-Submission Success Screen */}
          {qtSuccess ? (
            <div className="py-8 px-4 text-center space-y-6 max-w-lg mx-auto">
              <div className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto shadow-xl shadow-green-100 animate-in zoom-in">
                <CheckCircle2 className="w-10 h-10" />
              </div>

              <div className="space-y-2">
                <h4 className="text-2xl font-black text-slate-900 uppercase tracking-tight">
                  Ticket Created &amp; Verified!
                </h4>
                <p className="text-sm text-slate-600">
                  Ohio Buy Ticket{' '}
                  <span className="font-mono font-bold text-slate-900">
                    #{(printedTicket?.id || qtCreatedTicketId).toUpperCase()}
                  </span>{' '}
                  has been recorded and inventory synchronized.
                </p>
              </div>

              {/* Verified Post-Print Summary Card */}
              <div className="bg-slate-50 rounded-2xl p-5 text-left border border-slate-200 shadow-sm space-y-3">
                <div className="flex justify-between items-center pb-2 border-b border-slate-200">
                  <span className="text-xs font-black text-slate-400 uppercase tracking-wider">Summary Receipt</span>
                  <span className="text-[10px] font-bold px-2 py-0.5 bg-green-100 text-green-800 rounded-full">
                    Completed
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-y-2.5 text-sm">
                  <span className="text-slate-400 font-medium">Ticket ID:</span>
                  <span className="font-mono font-bold text-right text-slate-900 break-all">
                    {(printedTicket?.id || qtCreatedTicketId).toUpperCase()}
                  </span>

                  <span className="text-slate-400 font-medium">Customer:</span>
                  <span className="font-bold text-right text-slate-900 truncate">
                    {printedTicket?.customerName || qtCustomer?.name || qtNewCustomer.name || 'Walk-in Customer'}
                  </span>

                  <span className="text-slate-400 font-medium">Total Net Weight:</span>
                  <span className="font-bold text-right text-slate-900">
                    {(printedTicket?.netWeight ?? totalNetWeight).toLocaleString()} lb
                  </span>

                  <span className="text-slate-400 font-medium">Total Payout:</span>
                  <span className="font-mono font-black text-right text-green-600 text-lg">
                    ${(printedTicket?.totalAmount ?? totalAmount).toFixed(2)}
                  </span>
                </div>
              </div>

              {/* Post-Ticket Ohio DPS Verification Card */}
              <div className={cn(
                "rounded-2xl p-4 text-left border shadow-sm space-y-3",
                (printedTicket?.ohioDatabaseStatus === 'cleared' || qtOhioDatabaseStatus === 'cleared')
                  ? "bg-emerald-50/70 border-emerald-200"
                  : (printedTicket?.ohioDatabaseStatus === 'flagged' || qtOhioDatabaseStatus === 'flagged')
                  ? "bg-red-50/70 border-red-200"
                  : "bg-amber-50/80 border-amber-300"
              )}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Fingerprint className={cn(
                      "w-4 h-4",
                      (printedTicket?.ohioDatabaseStatus === 'cleared' || qtOhioDatabaseStatus === 'cleared') ? "text-emerald-700" :
                      (printedTicket?.ohioDatabaseStatus === 'flagged' || qtOhioDatabaseStatus === 'flagged') ? "text-red-700" : "text-amber-700"
                    )} />
                    <span className="text-xs font-black text-slate-900 uppercase">
                      Ohio DPS Database Status
                    </span>
                  </div>
                  <span className={cn(
                    "text-[10px] font-black uppercase px-2 py-0.5 rounded-full border",
                    (printedTicket?.ohioDatabaseStatus === 'cleared' || qtOhioDatabaseStatus === 'cleared')
                      ? "bg-emerald-100 border-emerald-300 text-emerald-900"
                      : (printedTicket?.ohioDatabaseStatus === 'flagged' || qtOhioDatabaseStatus === 'flagged')
                      ? "bg-red-100 border-red-300 text-red-900"
                      : "bg-amber-100 border-amber-300 text-amber-900"
                  )}>
                    {(printedTicket?.ohioDatabaseStatus || qtOhioDatabaseStatus || 'not_checked').replace('_', ' ').toUpperCase()}
                  </span>
                </div>

                <p className="text-xs text-slate-600">
                  {postDpsResult?.message || (
                    (printedTicket?.ohioDatabaseStatus === 'cleared' || qtOhioDatabaseStatus === 'cleared')
                      ? 'Seller successfully verified against Ohio Homeland Security Do-Not-Buy registry.'
                      : (printedTicket?.ohioDatabaseStatus === 'flagged' || qtOhioDatabaseStatus === 'flagged')
                      ? 'WARNING: Seller is marked as flagged on the Do-Not-Buy registry.'
                      : 'DPS check was deferred during ticket creation. You can run the live state verification below to update the ticket record.'
                  )}
                </p>

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      const tId = printedTicket?.id || qtCreatedTicketId;
                      const cName = printedTicket?.customerName || qtCustomer?.name || qtNewCustomer.name || '';
                      const idNum = printedTicket?.idNumber || qtCustomer?.idNumber || qtNewCustomer.idNumber || '';
                      runPostTicketOhioCheck(tId, cName, idNum);
                    }}
                    disabled={isRunningPostDpsCheck}
                    className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-2 transition-all shadow cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className={cn("w-3.5 h-3.5", isRunningPostDpsCheck && "animate-spin")} />
                    <span>{isRunningPostDpsCheck ? "Verifying..." : "Run Ohio DPS Check Now"}</span>
                  </button>


                  <a
                    href={settings.ohioScrapPortalUrl || "https://services.dps.ohio.gov/ScrapDealer/DoNotBuyList"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-2 bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer"
                  >
                    <span>Open State Portal</span>
                    <ExternalLink className="w-3 h-3 text-slate-400" />
                  </a>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 pt-2">
                <button
                  onClick={() => setShowPrintPreview(true)}
                  className="flex-1 py-3.5 bg-slate-900 text-white rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-slate-800 transition-all shadow-md active:scale-95 text-xs uppercase tracking-wider"
                >
                  <Printer className="w-4 h-4" />
                  Print Ticket Receipt
                </button>
                <button
                  onClick={() => resetQuickTicket(false)}
                  className="flex-1 py-3.5 bg-amber-500 text-slate-950 font-black rounded-xl hover:bg-amber-600 transition-all shadow-md active:scale-95 text-xs uppercase tracking-wider flex items-center justify-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  Create Another Ticket
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Draft Recovery Banner BEFORE step content */}
              {unconfirmedDraft && (
                <div className="p-4 bg-amber-50 border border-amber-300 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-amber-900 shadow-sm animate-in fade-in slide-in-from-top-2 duration-200">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-amber-100 border border-amber-300 flex items-center justify-center text-amber-800 shrink-0">
                      <RotateCcw className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="font-bold text-xs text-amber-950">
                        You have an unfinished ticket from {formatDraftTime(unconfirmedDraft.data?.updatedAt || unconfirmedDraft.data?.lastUpdated || unconfirmedDraft.data?.timestamp)}.
                      </p>
                      <div className="flex items-center gap-1.5">
                        <p className="text-[11px] text-amber-800">
                          Resume where you left off?
                        </p>
                        <Hint text="The app saves your ticket every couple of seconds. If you closed it by accident, choose Resume to pick up where you left off." />
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 w-full sm:w-auto justify-end shrink-0">
                    <button
                      type="button"
                      onClick={() => handleResumeDraft(unconfirmedDraft)}
                      className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black rounded-xl text-xs uppercase tracking-wider transition-all shadow-sm active:scale-95 cursor-pointer"
                    >
                      Resume
                    </button>
                    <button
                      type="button"
                      onClick={() => handleStartFresh(unconfirmedDraft.id)}
                      className="px-3.5 py-2 bg-white hover:bg-slate-100 text-slate-700 font-bold border border-amber-200 rounded-xl text-xs transition-all cursor-pointer"
                    >
                      Start Fresh
                    </button>
                  </div>
                </div>
              )}

              {/* Step 1: Line Items / Materials */}
              {step === 1 && (
                <div className="space-y-6 animate-in fade-in">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                      <Scale className="w-4 h-4 text-amber-500" />
                      Step 1: Weigh &amp; Grade Materials
                    </h4>
                    <Hint text="Type the material code or name. Codes match first — typing 611 and pressing Tab selects THHN and jumps to Gross weight. Up to 20 materials per ticket." />
                  </div>

                  <div className="space-y-4">
                    {qtItems.map((item, index) => {
                      const effectivePrice =
                        item.overridePrice !== undefined ? item.overridePrice : (item.material?.buyPrice || 0);
                      const isTon = isTonMaterial(item.material?.unit, item.material?.category, item.material?.name);
                      const line = calculateMaterialLineItem(
                        item.gross,
                        item.tare,
                        item.deduction,
                        effectivePrice,
                        item.material?.unit,
                        item.material?.category,
                        item.material?.name
                      );

                      const selectMaterial = (m: Material) => {
                        const mIsTon = isTonMaterial(m.unit, m.category, m.name);
                        setQtItems((prev) =>
                          prev.map((i) =>
                            i.id === item.id
                              ? {
                                  ...i,
                                  material: m,
                                  overridePrice: m.buyPrice,
                                  unit: mIsTon ? 'ton' : 'lb',
                                  isDropdownOpen: false,
                                  materialSearch: ''
                                }
                              : i
                          )
                        );
                        setTimeout(() => {
                          const matBtn = document.getElementById(`material-btn-${item.id}`);
                          if (matBtn) matBtn.focus();
                        }, 50);
                      };

                      const searchTrimmed = (item.materialSearch || '').trim();
                      const filteredMaterials = filterAndSortMaterials(materials, item.materialSearch || '');
                      const visibleResults = filteredMaterials.slice(0, 6);
                      const remainingCount = filteredMaterials.length - visibleResults.length;

                      return (
                        <div
                          key={item.id}
                          className="p-5 bg-slate-50 border border-slate-200 rounded-2xl space-y-4 relative"
                        >
                          <div className="flex items-center justify-between gap-4">
                            <span className="w-6 h-6 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center font-bold text-xs shrink-0">
                              {index + 1}
                            </span>
                            <div className="flex-1 relative">
                              {item.material && !item.isDropdownOpen ? (
                                <button
                                  type="button"
                                  id={`material-btn-${item.id}`}
                                  onClick={() => {
                                    setQtItems((prev) =>
                                      prev.map((i) =>
                                        i.id === item.id ? { ...i, isDropdownOpen: true, materialSearch: '' } : i
                                      )
                                    );
                                    setTimeout(() => {
                                      const input = (document.querySelector(`[data-material-search-id="${item.id}"]`) ||
                                        document.querySelector('[data-material-search]')) as HTMLInputElement | null;
                                      if (input) {
                                        input.focus();
                                        input.click();
                                      }
                                    }, 50);
                                  }}
                                  className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-left font-bold text-sm flex items-center justify-between hover:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 transition-colors group cursor-pointer"
                                >
                                  <div className="flex items-center gap-2 truncate">
                                    {item.material.code && (
                                      <span className="px-1.5 py-0.5 bg-slate-100 border border-slate-200 text-slate-700 font-mono text-[10px] font-black rounded-md shrink-0">
                                        {item.material.code}
                                      </span>
                                    )}
                                    <span className="truncate text-slate-900">{item.material.name}</span>
                                  </div>
                                  <div className="flex items-center gap-2 shrink-0 ml-2">
                                    <PricingUnitBadge
                                      unit={item.material.unit}
                                      category={item.material.category}
                                      materialName={item.material.name}
                                    />
                                    <span className="text-[11px] font-bold text-slate-400 group-hover:text-amber-600 transition-colors">
                                      Change
                                    </span>
                                  </div>
                                </button>
                              ) : (
                                <div className="relative">
                                  <input
                                    data-material-search
                                    data-material-search-id={item.id}
                                    type="text"
                                    placeholder="Type code or material..."
                                    className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-bold placeholder:text-slate-400 placeholder:font-normal outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 transition-all"
                                    value={item.materialSearch || ''}
                                    onChange={(e) => {
                                      const newSearch = e.target.value;
                                      setQtItems((prev) =>
                                        prev.map((i) =>
                                          i.id === item.id ? { ...i, materialSearch: newSearch, isDropdownOpen: true } : i
                                        )
                                      );

                                      if (newSearch.trim().length > 0) {
                                        const matches = filterAndSortMaterials(materials, newSearch);
                                        if (matches.length === 1) {
                                          selectMaterial(matches[0]);
                                        }
                                      }
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Tab' || e.key === 'Enter') {
                                        const currentMatches = filterAndSortMaterials(materials, item.materialSearch || '');
                                        if (currentMatches.length > 0) {
                                          e.preventDefault();
                                          selectMaterial(currentMatches[0]);
                                        }
                                      }
                                      if (e.key === 'Escape') {
                                        setQtItems((prev) =>
                                          prev.map((i) =>
                                            i.id === item.id ? { ...i, isDropdownOpen: false } : i
                                          )
                                        );
                                        setTimeout(() => {
                                          const matBtn = document.getElementById(`material-btn-${item.id}`);
                                          if (matBtn) matBtn.focus();
                                        }, 50);
                                      }
                                    }}
                                    onBlur={() => {
                                      setTimeout(() => {
                                        if (item.material) {
                                          setQtItems((prev) =>
                                            prev.map((i) =>
                                              i.id === item.id ? { ...i, isDropdownOpen: false, materialSearch: '' } : i
                                            )
                                          );
                                        }
                                      }, 200);
                                    }}
                                  />

                                  {/* FIX 1, 3, 4: Live filtered compact dropdown */}
                                  {searchTrimmed.length > 0 && (
                                    <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden">
                                      {filteredMaterials.length === 0 ? (
                                        <p className="py-2.5 px-3 text-xs text-slate-400 text-center font-medium">
                                          No materials match "{item.materialSearch}"
                                        </p>
                                      ) : (
                                        <div className="divide-y divide-slate-100">
                                          {visibleResults.map((m) => (
                                            <button
                                              key={m.id}
                                              type="button"
                                              onMouseDown={(e) => e.preventDefault()}
                                              onTouchStart={(e) => e.preventDefault()}
                                              onClick={() => {
                                                selectMaterial(m);
                                              }}
                                              className="w-full py-1.5 px-3 text-left hover:bg-amber-50 active:bg-amber-100 flex items-center justify-between cursor-pointer transition-colors"
                                            >
                                              <div className="flex items-center gap-2 min-w-0 truncate">
                                                {m.code && (
                                                  <span className="px-1.5 py-0.5 bg-slate-100 border border-slate-200 text-slate-700 font-mono text-[10px] font-black rounded shrink-0">
                                                    {m.code}
                                                  </span>
                                                )}
                                                <span className="truncate text-xs font-bold text-slate-800">{m.name}</span>
                                              </div>
                                              <span className="text-slate-500 font-mono text-[11px] font-semibold shrink-0 ml-2">
                                                {formatUnitPrice(m.buyPrice, m.unit, m.category, m.name)}
                                              </span>
                                            </button>
                                          ))}
                                          {remainingCount > 0 && (
                                            <div className="py-1 px-3 text-center text-[10px] font-semibold text-slate-400 bg-slate-50">
                                              {remainingCount} more result{remainingCount === 1 ? '' : 's'} — keep typing
                                            </div>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>

                            {qtItems.length > 1 && (
                              <button
                                type="button"
                                tabIndex={-1}
                                onClick={() => setQtItems((prev) => prev.filter((i) => i.id !== item.id))}
                                className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors shrink-0"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            )}
                          </div>

                          {/* Weights Grid */}
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            <div>
                              <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1 flex items-center justify-between">
                                <span>Gross (lb)</span>
                                {index === 0 && (
                                  <Hint
                                    tabIndex={-1}
                                    text="Tab moves Material → Gross → Tare → Deduction → Price → next row. The small scale icon inside each box pulls the weight from the scale."
                                  />
                                )}
                              </label>
                              <div className="relative">
                                <input
                                  id={`gross-${item.id}`}
                                  type="number"
                                  className="w-full px-3 py-2 pr-8 bg-white border border-slate-200 rounded-xl font-mono font-bold text-sm focus:ring-2 focus:ring-amber-500 outline-none"
                                  value={item.gross || ''}
                                  onChange={(e) =>
                                    setQtItems((prev) =>
                                      prev.map((i) =>
                                        i.id === item.id ? { ...i, gross: parseFloat(e.target.value) || 0 } : i
                                      )
                                    )
                                  }
                                  placeholder="0"
                                />
                                <div className="absolute right-2 top-1/2 -translate-y-1/2" tabIndex={-1}>
                                  <ScaleCaptureButton
                                    onCapture={(w) =>
                                      setQtItems((prev) =>
                                        prev.map((i) => (i.id === item.id ? { ...i, gross: w } : i))
                                      )
                                    }
                                    compact={true}
                                  />
                                </div>
                              </div>
                            </div>

                            <div>
                              <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1 block">
                                Tare (lb)
                              </label>
                              <div className="relative">
                                <input
                                  id={`tare-${item.id}`}
                                  type="number"
                                  className="w-full px-3 py-2 pr-8 bg-white border border-slate-200 rounded-xl font-mono font-bold text-sm focus:ring-2 focus:ring-amber-500 outline-none"
                                  value={item.tare || ''}
                                  onChange={(e) =>
                                    setQtItems((prev) =>
                                      prev.map((i) =>
                                        i.id === item.id ? { ...i, tare: parseFloat(e.target.value) || 0 } : i
                                      )
                                    )
                                  }
                                  placeholder="0"
                                />
                                <div className="absolute right-2 top-1/2 -translate-y-1/2" tabIndex={-1}>
                                  <ScaleCaptureButton
                                    onCapture={(w) =>
                                      setQtItems((prev) =>
                                        prev.map((i) => (i.id === item.id ? { ...i, tare: w } : i))
                                      )
                                    }
                                    compact={true}
                                  />
                                </div>
                              </div>
                            </div>

                            <div>
                              <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1 block">
                                Deduction (lb)
                              </label>
                              <div className="relative">
                                <input
                                  id={`deduction-${item.id}`}
                                  type="number"
                                  className="w-full px-3 py-2 pr-8 bg-white border border-slate-200 rounded-xl font-mono font-bold text-sm focus:ring-2 focus:ring-amber-500 outline-none"
                                  value={item.deduction || ''}
                                  onChange={(e) =>
                                    setQtItems((prev) =>
                                      prev.map((i) =>
                                        i.id === item.id ? { ...i, deduction: parseFloat(e.target.value) || 0 } : i
                                      )
                                    )
                                  }
                                  placeholder="0"
                                />
                                <div className="absolute right-2 top-1/2 -translate-y-1/2" tabIndex={-1}>
                                  <ScaleCaptureButton
                                    onCapture={(w) =>
                                      setQtItems((prev) =>
                                        prev.map((i) => (i.id === item.id ? { ...i, deduction: w } : i))
                                      )
                                    }
                                    compact={true}
                                  />
                                </div>
                              </div>
                            </div>

                            <div>
                              <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1 flex items-center justify-between">
                                <span>Price ({isTon ? '$/NT' : '$/lb'})</span>
                                {index === 0 && (
                                  <Hint
                                    tabIndex={-1}
                                    text="Arrow keys change the price by one cent. Manager approval is required for large overrides."
                                  />
                                )}
                              </label>
                              <input
                                id={`price-${item.id}`}
                                type="number"
                                step="0.01"
                                min="0"
                                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl font-mono font-bold text-sm focus:ring-2 focus:ring-amber-500 outline-none"
                                value={item.overridePrice !== undefined ? item.overridePrice : (item.material?.buyPrice !== undefined ? item.material.buyPrice : '')}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setQtItems((prev) =>
                                    prev.map((i) =>
                                      i.id === item.id
                                        ? { ...i, overridePrice: val === '' ? undefined : Math.max(0, parseFloat(val) || 0) }
                                        : i
                                    )
                                  );
                                }}
                                onBlur={(e) => {
                                  if (e.target.value !== '') {
                                    const num = Math.max(0, parseFloat(e.target.value) || 0);
                                    setQtItems((prev) =>
                                      prev.map((i) =>
                                        i.id === item.id
                                          ? { ...i, overridePrice: parseFloat(num.toFixed(2)) }
                                          : i
                                      )
                                    );
                                  }
                                }}
                                placeholder="0.00"
                              />
                            </div>
                          </div>

                          <div className="flex justify-between items-center pt-2 border-t border-slate-200/60 text-xs">
                            <span className="text-slate-500">
                              Paid Weight: <strong>{line.paidWeightLbs} lb</strong>
                            </span>
                            <span className="font-mono font-black text-slate-900 text-sm">
                              Line Total: ${line.totalAmount.toFixed(2)}
                            </span>
                          </div>
                        </div>
                      );
                    })}

                    <button
                      type="button"
                      onClick={() => {
                        setQtItems((prev) => [
                          ...prev,
                          {
                            id: Math.random().toString(36).substr(2, 9),
                            material: null,
                            gross: 0,
                            tare: 0,
                            deduction: 0,
                            materialSearch: '',
                            isDropdownOpen: true
                          }
                        ]);
                        setTimeout(() => {
                          const inputs = document.querySelectorAll('[data-material-search]');
                          const last = inputs[inputs.length - 1] as HTMLInputElement;
                          if (last) {
                            last.focus({ preventScroll: false });
                            last.click();
                          }
                        }, 150);
                      }}
                      className="w-full py-3 bg-white border-2 border-dashed border-slate-300 rounded-2xl text-xs font-bold text-slate-600 hover:border-amber-500 hover:text-amber-700 hover:bg-amber-50/50 transition-all flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <Plus className="w-4 h-4" />
                      Add Another Material Item
                    </button>
                  </div>
                </div>
              )}

              {/* Step 2: Customer Selection */}
              {step === 2 && (
                <div className="space-y-6 animate-in fade-in">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                        <User className="w-4 h-4 text-amber-500" />
                        Step 2: Select or Scan Customer
                      </h4>
                      <Hint text="Search by name or phone. Picking a returning customer pre-loads their photos, ID, and vehicle so you only capture what's missing." />
                    </div>
                    <button
                      onClick={() => setIsUSBScannerOpen(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 text-white rounded-xl text-xs font-bold hover:bg-slate-800 transition-all shadow-sm cursor-pointer"
                    >
                      <Fingerprint className="w-3.5 h-3.5 text-amber-400" />
                      <span>Scan 2D License (Barcode)</span>
                    </button>
                  </div>

                  {usbScanFeedback && (
                    <div
                      className={cn(
                        'p-3.5 rounded-2xl border flex items-center gap-2 text-xs font-bold animate-in fade-in',
                        usbScanFeedback.type === 'success'
                          ? 'bg-green-50 border-green-200 text-green-800'
                          : 'bg-amber-50 border-amber-200 text-amber-800'
                      )}
                    >
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      <span>{usbScanFeedback.message}</span>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* Existing Customer Option */}
                    <div
                      onClick={() => {
                        setIsQtNewCustomer(false);
                        setIsCustomerLookupOpen(true);
                      }}
                      className={cn(
                        'p-5 rounded-2xl border-2 cursor-pointer transition-all flex flex-col justify-between space-y-4 hover:border-amber-400 hover:shadow-md',
                        !isQtNewCustomer && qtCustomer
                          ? 'bg-amber-50/50 border-amber-500'
                          : 'bg-slate-50 border-slate-200'
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <div className="p-3 bg-white rounded-xl border border-slate-200 text-slate-700">
                          <Search className="w-5 h-5" />
                        </div>
                        {qtCustomer && (
                          <span className="text-[10px] font-black px-2 py-0.5 bg-green-100 text-green-800 rounded-full">
                            Selected
                          </span>
                        )}
                      </div>
                      <div>
                        <h5 className="font-black text-slate-900 text-base">
                          {qtCustomer ? qtCustomer.name : 'Lookup Existing Customer'}
                        </h5>
                        <p className="text-xs text-slate-500 mt-1">
                          {qtCustomer
                            ? `${qtCustomer.phone || 'No phone'} • ${qtCustomer.idNumber || 'No ID on file'}`
                            : 'Search customer database or history'}
                        </p>
                      </div>
                    </div>

                    {/* New Customer Option */}
                    <div
                      onClick={() => {
                        setIsQtNewCustomer(true);
                        setQtCustomer(null);
                      }}
                      className={cn(
                        'p-5 rounded-2xl border-2 cursor-pointer transition-all flex flex-col justify-between space-y-4 hover:border-amber-400 hover:shadow-md',
                        isQtNewCustomer ? 'bg-amber-50/50 border-amber-500' : 'bg-slate-50 border-slate-200'
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <div className="p-3 bg-white rounded-xl border border-slate-200 text-slate-700">
                          <UserPlus className="w-5 h-5" />
                        </div>
                        {isQtNewCustomer && (
                          <span className="text-[10px] font-black px-2 py-0.5 bg-amber-200 text-amber-900 rounded-full">
                            New Profile
                          </span>
                        )}
                      </div>
                      <div>
                        <h5 className="font-black text-slate-900 text-base">New Walk-In Customer</h5>
                        <p className="text-xs text-slate-500 mt-1">Quick profile entry with driver's license info</p>
                      </div>
                    </div>
                  </div>

                  {/* New Customer Quick Form */}
                  {isQtNewCustomer && (
                    <div className="p-5 bg-slate-50 border border-slate-200 rounded-2xl space-y-4 animate-in fade-in">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="text-xs font-black text-slate-400 uppercase tracking-widest">
                            Full Legal Name *
                          </label>
                          <input
                            type="text"
                            required
                            className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-amber-500 outline-none font-bold text-sm mt-1.5"
                            placeholder="John Doe"
                            value={qtNewCustomer.name}
                            onChange={(e) => setQtNewCustomer({ ...qtNewCustomer, name: e.target.value })}
                          />
                        </div>
                        <div>
                          <label className="text-xs font-black text-slate-400 uppercase tracking-widest">
                            Phone Number
                          </label>
                          <input
                            type="tel"
                            className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-amber-500 outline-none font-bold text-sm mt-1.5"
                            placeholder="(555) 123-4567"
                            value={qtNewCustomer.phone}
                            onChange={(e) => setQtNewCustomer({ ...qtNewCustomer, phone: e.target.value })}
                          />
                        </div>
                        <div>
                          <label className="text-xs font-black text-slate-400 uppercase tracking-widest">
                            Driver's License / State ID #
                          </label>
                          <input
                            type="text"
                            className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-amber-500 outline-none font-bold text-sm mt-1.5"
                            placeholder="OH12345678"
                            value={qtNewCustomer.idNumber}
                            onChange={(e) => setQtNewCustomer({ ...qtNewCustomer, idNumber: e.target.value })}
                          />
                        </div>
                        <div>
                          <label className="text-xs font-black text-slate-400 uppercase tracking-widest">
                            Street Address &amp; City
                          </label>
                          <input
                            type="text"
                            className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-amber-500 outline-none font-bold text-sm mt-1.5"
                            placeholder="123 Main St, Columbus, OH"
                            value={qtNewCustomer.address}
                            onChange={(e) => setQtNewCustomer({ ...qtNewCustomer, address: e.target.value })}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Step 3: Ohio DPS Check & Photos (Consolidated) */}
              {step === 3 && (
                <div className="space-y-6 animate-in fade-in">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-amber-500" />
                      Step 3: Ohio DPS Check &amp; Compliance Verification (ORC 4737.04)
                    </h4>
                  </div>

                  {/* Ohio DPS Live Status */}
                  <div className={cn(
                    "p-4 border rounded-2xl flex flex-col gap-3 transition-all",
                    qtOhioDatabaseStatus === 'cleared' ? "bg-emerald-50/70 border-emerald-200" :
                    qtOhioDatabaseStatus === 'flagged' ? "bg-red-50/70 border-red-200" :
                    isCheckingOhioPortal ? "bg-amber-50/70 border-amber-200" : "bg-slate-50 border-slate-200"
                  )}>
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "w-9 h-9 rounded-xl flex items-center justify-center shrink-0",
                          qtOhioDatabaseStatus === 'cleared' ? "bg-emerald-100 text-emerald-700" :
                          qtOhioDatabaseStatus === 'flagged' ? "bg-red-100 text-red-700" :
                          isCheckingOhioPortal ? "bg-amber-100 text-amber-700" : "bg-slate-200 text-slate-700"
                        )}>
                          {isCheckingOhioPortal ? (
                            <Loader2 className="w-5 h-5 animate-spin" />
                          ) : qtOhioDatabaseStatus === 'cleared' ? (
                            <ShieldCheck className="w-5 h-5" />
                          ) : qtOhioDatabaseStatus === 'flagged' ? (
                            <AlertCircle className="w-5 h-5" />
                          ) : (
                            <Fingerprint className="w-5 h-5 text-slate-400" />
                          )}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-black text-slate-900 uppercase">Ohio DPS Do-Not-Buy Registry</span>
                            <Hint text="The state Do-Not-Buy check runs automatically. Amber means wait — it usually clears in a few seconds. Red means you cannot buy from this person; close the ticket." />
                            <span className={cn(
                              "text-[10px] font-black px-2 py-0.5 rounded-full uppercase border",
                              qtOhioDatabaseStatus === 'cleared' ? "bg-emerald-100 border-emerald-300 text-emerald-900" :
                              qtOhioDatabaseStatus === 'flagged' ? "bg-red-100 border-red-300 text-red-900" :
                              isCheckingOhioPortal ? "bg-amber-100 border-amber-300 text-amber-900" : "bg-slate-200 border-slate-300 text-slate-700"
                            )}>
                              {isCheckingOhioPortal ? "Checking Live..." : qtOhioDatabaseStatus === 'not_checked' ? 'Pending Check' : qtOhioDatabaseStatus.toUpperCase()}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500 mt-0.5">
                            {ohioCheckMessage || (
                              qtOhioDatabaseStatus === 'cleared' 
                                ? 'Seller cleared in Ohio Homeland Security Portal & Local Database' 
                                : qtOhioDatabaseStatus === 'flagged'
                                ? 'Prohibited: Seller flagged on Do-Not-Buy registry'
                                : 'DPS verification pending. You may continue the ticket and verify after.'
                            )}
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto justify-end">
                        <button
                          type="button"
                          onClick={() => runOhioCheck()}
                          disabled={isCheckingOhioPortal || !((qtCustomer?.name || qtNewCustomer.name || '').trim())}
                          className="px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shrink-0 disabled:opacity-50 cursor-pointer"
                        >
                          <RefreshCw className={cn("w-3.5 h-3.5", isCheckingOhioPortal && "animate-spin")} />
                          <span>{isCheckingOhioPortal ? "Checking..." : "Re-Check Database"}</span>
                        </button>

                        <a
                          href={settings.ohioScrapPortalUrl || "https://services.dps.ohio.gov/ScrapDealer/DoNotBuyList"}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 rounded-xl text-xs font-bold transition-all flex items-center gap-1 shrink-0 cursor-pointer"
                        >
                          <span>State Portal</span>
                          <ExternalLink className="w-3 h-3 text-slate-400" />
                        </a>
                      </div>
                    </div>
                  </div>

                  {/* Photo Captures Grid (2x2) */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* Customer Photo - MANDATORY */}
                    <div className={cn(
                      "p-4 border rounded-2xl space-y-3 transition-all flex flex-col justify-between min-h-[200px]",
                      qtCustomerPhotoUrl ? "bg-slate-50 border-slate-200" : "bg-amber-50/50 border-amber-300"
                    )}>
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-black text-slate-700 uppercase tracking-wider flex items-center gap-1">
                            Seller Photo
                            {!qtCustomerPhotoUrl && <span className="text-red-500 font-bold">*Required</span>}
                            <Hint text="Required by Ohio law on every ticket. Use the laptop camera; the timestamp is added automatically." />
                          </span>
                          {qtCustomerPhotoUrl ? (
                            <span className="text-[10px] font-black text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" />
                              {qtCustomer?.photoUrl && qtCustomerPhotoUrl === qtCustomer.photoUrl ? 'On file' : 'Captured'}
                            </span>
                          ) : (
                            <span className="text-[10px] font-bold text-amber-700 uppercase">Mandatory</span>
                          )}
                        </div>
                        {qtCustomerPhotoUrl ? (
                          <span className="text-[10px] text-slate-500 block mb-2">
                            {qtCustomer?.photoUrl && qtCustomerPhotoUrl === qtCustomer.photoUrl ? 'Photo on file from customer profile' : 'Fresh photo captured for today'}
                          </span>
                        ) : (
                          <span className="text-[10px] text-slate-400 block mb-2">Take clear photo of seller</span>
                        )}
                      </div>
                      <CameraCapture
                        label="Take Customer Photo"
                        photoUrl={qtCustomerPhotoUrl}
                        onCapture={(url) => setQtCustomerPhotoUrl(url)}
                        className="aspect-video"
                      />
                    </div>

                    {/* ID Card Capture - MANDATORY */}
                    <div className={cn(
                      "p-4 border rounded-2xl space-y-3 transition-all flex flex-col justify-between min-h-[200px]",
                      qtIdImageUrl ? "bg-slate-50 border-slate-200" : "bg-amber-50/50 border-amber-300"
                    )}>
                      <div>
                        {/* ID Expiry & Source Status Banner (Prominent Lead when on file) */}
                        {qtIdStatus === 'on_file' && qtIdImageUrl && (
                          <div className="p-3 bg-emerald-100 border border-emerald-300 rounded-xl mb-3 text-emerald-950">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-1.5 font-black text-sm text-emerald-900">
                                <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                                <span>Valid ID on file</span>
                              </div>
                              <span className="text-[10px] font-black text-emerald-800 bg-emerald-200/80 px-2 py-0.5 rounded-full">
                                Verified
                              </span>
                            </div>
                            <p className="text-[11px] text-emerald-800 mt-1">
                              Verify this matches today's ID. Re-take below if expired or changed.
                            </p>
                          </div>
                        )}

                        {qtIdStatus === 'expired' && (
                          <div className="p-3 bg-amber-100 border border-amber-300 rounded-xl mb-3 text-amber-950">
                            <div className="flex items-center gap-1.5 font-black text-xs text-amber-900">
                              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                              <span>ID on file is expired (&gt; 365 days)</span>
                            </div>
                            <p className="text-[11px] text-amber-800 mt-1">
                              ID on file is older than 365 days — re-scan required to proceed.
                            </p>
                          </div>
                        )}

                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-black text-slate-700 uppercase tracking-wider flex items-center gap-1">
                            Photo ID
                            {!qtIdImageUrl && <span className="text-red-500 font-bold">*Required</span>}
                            <Hint text="Green = ID on file and verified in the last year. Amber = ID on file but check it matches today's card; re-scan if it's expired or different. Red = you must scan an ID before continuing." />
                          </span>
                          {qtIdImageUrl ? (
                            <span className="text-[10px] font-black text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" />
                              {qtIdStatus === 'on_file' ? 'On file' : 'Captured'}
                            </span>
                          ) : (
                            <span className="text-[10px] font-bold text-amber-700 uppercase">Mandatory</span>
                          )}
                        </div>

                        {!qtIdImageUrl && (
                          <span className="text-[10px] text-slate-400 block mb-2">Government-issued photo identification</span>
                        )}
                      </div>

                      <CameraCapture
                        label="Take ID Card Photo"
                        photoUrl={qtIdImageUrl}
                        onCapture={(url) => {
                          setQtIdImageUrl(url);
                          if (url) setQtIdStatus('on_file');
                        }}
                        className="aspect-video"
                      />
                    </div>

                    {/* Vehicle Photo - ADVISORY */}
                    <div className={cn(
                      "p-4 border rounded-2xl space-y-3 transition-all flex flex-col justify-between min-h-[200px]",
                      qtVehiclePhotoUrl ? "bg-slate-50 border-slate-200" : "bg-slate-50 border-slate-200"
                    )}>
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-black text-slate-700 uppercase tracking-wider flex items-center gap-1">
                            Vehicle Photo <span className="text-slate-400 font-medium">(Optional)</span>
                          </span>
                          {qtVehiclePhotoUrl ? (
                            <span className="text-[10px] font-black text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" />
                              {qtCustomer?.vehiclePhotoUrl && qtVehiclePhotoUrl === qtCustomer.vehiclePhotoUrl ? 'On file' : 'Captured'}
                            </span>
                          ) : (
                            <span className="text-[10px] font-bold px-2 py-0.5 bg-amber-100 text-amber-800 rounded-full">
                              Advisory
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-slate-400 block mb-2">
                          {qtVehiclePhotoUrl ? (qtCustomer?.vehiclePhotoUrl && qtVehiclePhotoUrl === qtCustomer.vehiclePhotoUrl ? 'Photo on file from customer profile' : 'Photo of seller vehicle') : 'Vehicle photo not captured — recommended'}
                        </span>
                      </div>
                      <CameraCapture
                        label="Take Vehicle Photo"
                        photoUrl={qtVehiclePhotoUrl}
                        onCapture={(url) => setQtVehiclePhotoUrl(url)}
                        className="aspect-video"
                      />
                    </div>

                    {/* Load Photo - FRESH PER TRANSACTION / ADVISORY */}
                    <div className={cn(
                      "p-4 border rounded-2xl space-y-3 transition-all flex flex-col justify-between min-h-[200px]",
                      qtLoadPhotoUrl ? "bg-slate-50 border-slate-200" : "bg-slate-50 border-slate-200"
                    )}>
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-black text-slate-700 uppercase tracking-wider flex items-center gap-1">
                            Scrap Load Photo <span className="text-slate-400 font-medium">(Optional)</span>
                            <Hint text="Optional but recommended — a photo of the material at the scale. If skipped, the seller photo is used for the state report." />
                          </span>
                          {qtLoadPhotoUrl ? (
                            <span className="text-[10px] font-black text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3" /> Captured
                            </span>
                          ) : (
                            <span className="text-[10px] font-bold px-2 py-0.5 bg-amber-100 text-amber-800 rounded-full">
                              Advisory
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-slate-400 block mb-2">
                          {qtLoadPhotoUrl ? 'Photo of scrap materials on scale' : 'No load photo — seller photo will be used for state reporting'}
                        </span>
                      </div>
                      <CameraCapture
                        label="Take Load Photo"
                        photoUrl={qtLoadPhotoUrl}
                        onCapture={(url) => setQtLoadPhotoUrl(url)}
                        className="aspect-video"
                      />
                    </div>
                  </div>

                  {/* Vehicle Details */}
                  <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-4">
                    <span className="text-xs font-black text-slate-500 uppercase tracking-wider block">
                      Transportation / Vehicle Information
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
                          License Plate
                        </label>
                        <input
                          type="text"
                          className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl font-black text-sm uppercase focus:ring-2 focus:ring-amber-500 outline-none mt-1"
                          placeholder="ABC-1234"
                          value={qtVehiclePlate}
                          onChange={(e) => setQtVehiclePlate(e.target.value.toUpperCase())}
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
                          Vehicle Make / Model / Color
                        </label>
                        <input
                          type="text"
                          className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl font-bold text-sm focus:ring-2 focus:ring-amber-500 outline-none mt-1"
                          placeholder="White Ford F-150"
                          value={qtVehicleType}
                          onChange={(e) => setQtVehicleType(e.target.value)}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Vehicle Warning if missing */}
                  {showQtVehicleConfirm && (
                    <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
                        <p className="text-xs text-amber-900 font-bold">
                          Vehicle information is missing. Proceed without vehicle plate/make?
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setQtVehicleBypassed(true);
                          setShowQtVehicleConfirm(false);
                          checkDoNotBuy();
                        }}
                        className="px-4 py-2 bg-amber-600 text-white rounded-xl text-xs font-bold hover:bg-amber-700 transition-all shrink-0 cursor-pointer"
                      >
                        Bypass Vehicle
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Step 4: Digital Signature & Settlement */}
              {step === 4 && (
                <div className="space-y-6 animate-in fade-in">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                        <Fingerprint className="w-4 h-4 text-amber-500" />
                        Step 4: Seller Signature &amp; Pay
                      </h4>
                      <Hint text="Have the customer read the line items and total BEFORE signing. Voids are far easier to avoid than to fix." />
                    </div>
                    <span className="text-xs font-bold text-slate-500">
                      Customer: <span className="text-slate-900 font-black">{qtCustomer?.name || qtNewCustomer.name || 'Walk-in'}</span>
                    </span>
                  </div>

                  {idCheckResult?.prohibited && (
                    <div className="p-4 bg-red-50 border-2 border-red-500 rounded-2xl flex items-center gap-3 text-red-900 font-bold text-xs">
                      <AlertCircle className="w-6 h-6 text-red-600 shrink-0" />
                      <div>
                        <p className="text-sm font-black">POLICE DO-NOT-BUY ALERT</p>
                        <p className="font-normal text-red-700 mt-0.5">
                          This seller matches a Do-Not-Buy record: {idCheckResult.reason || 'Restricted seller'}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Ohio DPS Check Status Ribbon in Step 4 */}
                  <div className={cn(
                    "p-3.5 border rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs",
                    qtOhioDatabaseStatus === 'cleared' ? "bg-emerald-50/70 border-emerald-200" :
                    qtOhioDatabaseStatus === 'flagged' ? "bg-red-50/70 border-red-200" :
                    "bg-blue-50/80 border-blue-200"
                  )}>
                    <div className="flex items-center gap-2.5">
                      <div className={cn(
                        "p-1.5 rounded-lg",
                        qtOhioDatabaseStatus === 'cleared' ? "bg-emerald-100 text-emerald-700" :
                        qtOhioDatabaseStatus === 'flagged' ? "bg-red-100 text-red-700" :
                        "bg-blue-100 text-blue-700"
                      )}>
                        <Fingerprint className="w-4 h-4" />
                      </div>
                      <div>
                        <p className="font-black text-slate-900 uppercase text-[11px] flex items-center gap-2">
                          Ohio DPS Registry:
                          <span className={cn(
                            "px-2 py-0.5 rounded-full text-[10px] font-black",
                            qtOhioDatabaseStatus === 'cleared' ? "bg-emerald-200 text-emerald-900" :
                            qtOhioDatabaseStatus === 'flagged' ? "bg-red-200 text-red-900" :
                            "bg-amber-200 text-amber-900"
                          )}>
                            {qtOhioDatabaseStatus === 'cleared' ? 'CLEARED' : qtOhioDatabaseStatus === 'flagged' ? 'FLAGGED' : 'PENDING CHECK'}
                          </span>
                        </p>
                        <p className="text-[11px] text-slate-600">
                          {qtOhioDatabaseStatus === 'cleared'
                            ? 'Seller verified and cleared in Ohio Do-Not-Buy registry.'
                            : qtOhioDatabaseStatus === 'flagged'
                            ? 'Prohibited transaction: Seller flagged on Do-Not-Buy registry.'
                            : 'Database check pending. Verification required before final submission.'}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => runOhioCheck()}
                        disabled={isCheckingOhioPortal || !((qtCustomer?.name || qtNewCustomer.name || '').trim())}
                        className="px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 rounded-xl text-xs font-bold shrink-0 transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                      >
                        <RefreshCw className={cn("w-3.5 h-3.5", isCheckingOhioPortal && "animate-spin")} />
                        <span>{isCheckingOhioPortal ? "Checking..." : "Re-Check Database"}</span>
                      </button>
                    </div>
                  </div>

                  {/* Itemized Materials Table */}
                  <div className="bg-slate-50 border border-slate-200 rounded-2xl overflow-hidden">
                    <div className="px-4 py-3 bg-slate-100/80 border-b border-slate-200 flex items-center justify-between">
                      <span className="text-xs font-black text-slate-600 uppercase tracking-wider">
                        Itemized Material Breakdown
                      </span>
                      <span className="text-xs font-bold text-slate-500">
                        {qtItems.filter((i) => i.material).length} line item(s)
                      </span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="border-b border-slate-200 bg-white/50 text-slate-400 font-black uppercase text-[10px] tracking-wider">
                            <th className="py-2.5 px-4">Material / Commodity</th>
                            <th className="py-2.5 px-3 text-right">Gross</th>
                            <th className="py-2.5 px-3 text-right">Tare</th>
                            <th className="py-2.5 px-3 text-right">Net Wt</th>
                            <th className="py-2.5 px-3 text-right">Price / Unit</th>
                            <th className="py-2.5 px-4 text-right">Line Total</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                          {qtItems
                            .filter((item) => item.material)
                            .map((item, idx) => {
                              const price = item.overridePrice !== undefined ? item.overridePrice : (item.material?.buyPrice || 0);
                              const effectiveUnit = item.unit || item.material?.unit;
                              const line = calculateMaterialLineItem(
                                item.gross,
                                item.tare,
                                item.deduction,
                                price,
                                effectiveUnit,
                                item.material?.category,
                                item.material?.name
                              );
                              return (
                                <tr key={item.id || idx} className="hover:bg-slate-100/50 transition-colors">
                                  <td className="py-2.5 px-4">
                                    <div className="flex items-center gap-2">
                                      <span className="font-mono text-[10px] font-black bg-slate-200/70 text-slate-700 px-1.5 py-0.5 rounded">
                                        {item.material?.code}
                                      </span>
                                      <span className="font-bold text-slate-900">{item.material?.name}</span>
                                    </div>
                                  </td>
                                  <td className="py-2.5 px-3 text-right text-slate-600 font-mono">
                                    {item.gross.toLocaleString()}
                                  </td>
                                  <td className="py-2.5 px-3 text-right text-slate-600 font-mono">
                                    {item.tare.toLocaleString()}
                                  </td>
                                  <td className="py-2.5 px-3 text-right font-black text-slate-900 font-mono">
                                    {line.netWeight.toLocaleString()} lb
                                  </td>
                                  <td className="py-2.5 px-3 text-right text-slate-700 font-bold">
                                    {formatUnitPrice(price, effectiveUnit, item.material?.category, item.material?.name)}
                                  </td>
                                  <td className="py-2.5 px-4 text-right font-black text-green-700 font-mono">
                                    ${line.totalAmount.toFixed(2)}
                                  </td>
                                </tr>
                              );
                            })}
                        </tbody>
                        <tfoot>
                          <tr className="bg-slate-100 font-black border-t-2 border-slate-300 text-xs">
                            <td className="py-3 px-4 uppercase text-slate-700" colSpan={3}>
                              Total Summary
                            </td>
                            <td className="py-3 px-3 text-right font-mono text-slate-900">
                              {totalNetWeight.toLocaleString()} lb
                            </td>
                            <td className="py-3 px-3 text-right text-slate-500 uppercase text-[10px]">
                              Payout
                            </td>
                            <td className="py-3 px-4 text-right font-mono text-base text-green-600">
                              ${totalAmount.toFixed(2)}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>

                  {/* Affirmation Statement & Signature Pad */}
                  <div className="space-y-4">
                    {/* Legal Ownership Affirmation */}
                    <div className="p-3.5 bg-amber-50/70 border border-amber-200 rounded-2xl text-xs text-amber-900 leading-relaxed space-y-1">
                      <p className="font-black text-[11px] uppercase tracking-wider flex items-center gap-1.5 text-amber-950">
                        <ShieldCheck className="w-4 h-4 text-amber-600 shrink-0" />
                        Seller Ownership Affirmation (ORC 4737.04)
                      </p>
                      <p className="text-[11px] text-amber-800">
                        I hereby affirm under penalty of law that I am the sole lawful owner of all scrap metals and materials listed on this transaction ticket, or am authorized by the owner to sell said materials. I certify all statements provided are true and accurate.
                      </p>
                    </div>

                    {/* Signature Pad */}
                    <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-black text-slate-700 uppercase tracking-wider block">
                          Seller Digital Signature *
                        </span>
                        {qtSignatureUrl ? (
                          <span className="text-[10px] font-black text-green-700 bg-green-100 px-2 py-0.5 rounded-full flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" /> Signed
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold text-amber-700 uppercase">Required</span>
                        )}
                      </div>
                      <SignaturePad onCapture={(url) => setQtSignatureUrl(url)} />
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer Navigation Controls */}
        {!qtSuccess && (
          <div className="p-4 sm:p-6 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              {step > 1 ? (
                <button
                  type="button"
                  onClick={() => setStep(step - 1)}
                  className="px-4 py-2.5 bg-white border border-slate-200 text-slate-700 font-bold rounded-xl text-xs hover:bg-slate-100 transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Back
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => resetQuickTicket(true)}
                  className="px-4 py-2.5 bg-white border border-slate-200 text-slate-700 font-bold rounded-xl text-xs hover:bg-slate-100 transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4" />
                  Reset
                </button>
              )}
            </div>

            <div className="flex items-center gap-4">
              <div className="text-right hidden sm:block">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Total Payout</p>
                <p className="text-xl font-black text-green-600">${totalAmount.toFixed(2)}</p>
              </div>

              {step < 4 ? (
                <button
                  type="button"
                  onClick={handleNext}
                  disabled={
                    (step === 1 && (qtItems.length === 0 || qtItems.some((i) => !i.material || (i.gross - i.tare) <= 0))) ||
                    (step === 2 && !qtCustomer && (!isQtNewCustomer || !qtNewCustomer.name || !qtNewCustomer.name.trim())) ||
                    (step === 3 && (!qtIdImageUrl || !qtCustomerPhotoUrl || qtOhioDatabaseStatus !== 'cleared'))
                  }
                  className="px-6 py-3 bg-amber-500 text-slate-950 font-black rounded-xl text-xs uppercase tracking-wider hover:bg-amber-600 transition-all shadow-md active:scale-95 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  <span>Continue</span>
                  <ChevronRight className="w-4 h-4" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleQuickTicketSubmit}
                  disabled={qtProcessing || !qtSignatureUrl || qtOhioDatabaseStatus !== 'cleared'}
                  className="px-6 py-3 bg-green-600 text-white font-black rounded-xl text-xs uppercase tracking-wider hover:bg-green-700 transition-all shadow-md active:scale-95 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {qtProcessing ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <DollarSign className="w-4 h-4" />
                      <span>Finalize &amp; Print Ticket</span>
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Customer Lookup Modal */}
      {isCustomerLookupOpen && (
        <div
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[200] p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-lg overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <h4 className="font-black text-slate-900 text-sm uppercase">Select Existing Customer</h4>
              <button onClick={() => setIsCustomerLookupOpen(false)}>
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  autoFocus
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold focus:ring-2 focus:ring-amber-500 outline-none"
                  placeholder="Search customer by name, phone, or ID..."
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                />
              </div>

              <div className="max-h-60 overflow-y-auto space-y-2">
                {customers
                  .filter((c) => {
                    const q = customerSearch.toLowerCase();
                    return (
                      c.name.toLowerCase().includes(q) ||
                      (c.phone && c.phone.includes(q)) ||
                      (c.idNumber && c.idNumber.toLowerCase().includes(q))
                    );
                  })
                  .slice(0, 15)
                  .map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setQtCustomer(c);
                        setIsCustomerLookupOpen(false);
                      }}
                      className="w-full p-3 rounded-xl border border-slate-200 text-left hover:bg-amber-50/60 hover:border-amber-400 transition-all flex items-center justify-between"
                    >
                      <div>
                        <p className="font-bold text-slate-900 text-sm">{c.name}</p>
                        <p className="text-xs text-slate-500">
                          {c.phone || 'No phone'} • ID: {c.idNumber || 'None'}
                        </p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-slate-400" />
                    </button>
                  ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* USB Barcode Scanner Modal */}
      <USBBarcodeScannerModal
        isOpen={isUSBScannerOpen}
        onClose={() => setIsUSBScannerOpen(false)}
        onScanSuccess={handleQuickUSBScanSuccess}
      />

      {/* Manager PIN Modal */}
      <ManagerPinModal
        isOpen={showPinModal}
        onClose={() => setShowPinModal(false)}
        onSuccess={() => saveQuickTicket()}
      />

      {/* Print Preview Modal */}
      {showPrintPreview && (printedTicket || qtSuccess) && (
        <div className="fixed inset-0 bg-slate-900/80 z-[250] flex items-center justify-center p-4 backdrop-blur-md animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <h4 className="font-bold text-slate-900 text-sm">Receipt Preview</h4>
              <button onClick={() => setShowPrintPreview(false)}>
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto flex-1 space-y-4">
              <div className="p-4 bg-white border border-slate-200 rounded-2xl shadow-sm text-xs font-mono space-y-2">
                <div className="text-center pb-2 border-b border-slate-200">
                  <p className="font-black text-sm">{COMPANY_NAME}</p>
                  <p className="text-[10px] text-slate-500">{COMPANY_ADDRESS}</p>
                  <p className="text-[10px] text-slate-500">{COMPANY_PHONE}</p>
                </div>
                <div className="pt-2 flex justify-between">
                  <span>TICKET:</span>
                  <span className="font-black">#{(printedTicket?.id || qtCreatedTicketId).toUpperCase()}</span>
                </div>
                <div className="flex justify-between">
                  <span>CUSTOMER:</span>
                  <span className="font-bold">
                    {printedTicket?.customerName || qtCustomer?.name || qtNewCustomer.name || 'Walk-in'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>DATE:</span>
                  <span>{new Date().toLocaleString()}</span>
                </div>
                <div className="pt-2 border-t border-slate-200 flex justify-between font-black text-sm">
                  <span>TOTAL PAYOUT:</span>
                  <span className="text-green-600">${(printedTicket?.totalAmount ?? totalAmount).toFixed(2)}</span>
                </div>
              </div>
            </div>
            <div className="p-4 bg-slate-50 border-t border-slate-200 flex gap-3">
              <button
                type="button"
                onClick={() => setShowPrintPreview(false)}
                className="flex-1 py-2.5 border border-slate-200 rounded-xl font-bold text-slate-600 hover:bg-slate-100 text-xs"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  setShowPrintPreview(false);
                  await new Promise((r) => setTimeout(r, 100));
                  const tempTicket: BuyTicket = {
                    id: printedTicket?.id || qtCreatedTicketId || 'QUICK',
                    customerId: printedTicket?.customerId || qtCustomer?.id || 'new',
                    materials: printedTicket?.materials || [],
                    totalAmount: printedTicket?.totalAmount ?? totalAmount,
                    status: 'completed',
                    timestamp: printedTicket?.timestamp || new Date().toISOString(),
                    paymentMethod: 'cash',
                    customerPhotoUrl: printedTicket?.customerPhotoUrl || qtCustomerPhotoUrl || '',
                    vehiclePhotoUrl: printedTicket?.vehiclePhotoUrl || qtVehiclePhotoUrl || '',
                    loadPhotoUrl: printedTicket?.loadPhotoUrl || qtLoadPhotoUrl || '',
                    idImageUrl: printedTicket?.idImageUrl || qtIdImageUrl || '',
                    vehiclePlate: printedTicket?.vehiclePlate || qtVehiclePlate || '',
                    vehicleType: printedTicket?.vehicleType || qtVehicleType || '',
                    signatureUrl: printedTicket?.signatureUrl || qtSignatureUrl || '',
                    sellerAffirmed: printedTicket?.sellerAffirmed ?? !!(qtSignatureUrl)
                  };

                  await printTicket(
                    <BuyTicketPrint
                      ticket={tempTicket}
                      customerName={printedTicket?.customerName || qtCustomer?.name || qtNewCustomer.name || 'Walk-in'}
                      materials={materials}
                      format={settings.receiptFormat}
                    />,
                    { format: settings.receiptFormat, debugMode: settings.debugPrintMode }
                  );
                }}
                className="flex-1 py-2.5 bg-slate-900 text-white rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-slate-800 text-xs uppercase tracking-wider"
              >
                <Printer className="w-4 h-4" />
                Print Now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
