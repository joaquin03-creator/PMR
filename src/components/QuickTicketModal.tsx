import React, { useState, useEffect, useMemo } from 'react';
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
  RefreshCw
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
import { PricingUnitBadge } from './PricingUnitBadge';
import USBBarcodeScannerModal from './USBBarcodeScannerModal';

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
  const { firestore, error: toastError } = useToast();

  const [materials, setMaterials] = useState<Material[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [doNotBuyList, setDoNotBuyList] = useState<DoNotBuyEntry[]>([]);

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
      isDropdownOpen: false,
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
    customerPhotoUrl?: string;
    vehiclePhotoUrl?: string;
    loadPhotoUrl?: string;
    idImageUrl?: string;
  } | null>(null);

  const [qtCustomerPhotoUrl, setQtCustomerPhotoUrl] = useState('');
  const [qtVehiclePhotoUrl, setQtVehiclePhotoUrl] = useState('');
  const [qtLoadPhotoUrl, setQtLoadPhotoUrl] = useState('');
  const [qtIdImageUrl, setQtIdImageUrl] = useState('');
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

  const [isUSBScannerOpen, setIsUSBScannerOpen] = useState(false);
  const [usbScanFeedback, setUsbScanFeedback] = useState<{ type: 'success' | 'new'; message: string } | null>(null);

  // Clean state reset function
  const resetQuickTicket = () => {
    if (activeDraftId) {
      deleteDoc(doc(db, 'ticketDrafts', activeDraftId)).catch(console.error);
      setActiveDraftId(null);
    }
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
        isDropdownOpen: false,
        photoUrl: ''
      }
    ]);
    setQtCustomerPhotoUrl('');
    setQtVehiclePhotoUrl('');
    setQtLoadPhotoUrl('');
    setQtIdImageUrl('');
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
      setDoNotBuyList(snap.docs.map((d) => ({ id: d.id, ...d.data() } as DoNotBuyEntry)));
    });

    return () => {
      unsubMaterials();
      unsubCustomers();
      unsubDnb();
    };
  }, [isOpen]);

  // Load initial draft if specified or ensure fresh state
  useEffect(() => {
    if (isOpen) {
      if (initialDraftId) {
        getDoc(doc(db, 'ticketDrafts', initialDraftId)).then((snap) => {
          if (snap.exists()) {
            const d = snap.data();
            if (d.selectedCustomer) {
              setQtCustomer(d.selectedCustomer);
              setIsQtNewCustomer(false);
            } else if (d.newCustomer) {
              setQtNewCustomer(d.newCustomer);
              setIsQtNewCustomer(true);
            }
            if (d.items && d.items.length > 0) {
              setQtItems(
                d.items.map((it: any) => ({
                  id: it.id || Math.random().toString(36).substr(2, 9),
                  material: it.material || null,
                  gross: it.grossWeight || it.gross || 0,
                  tare: it.tareWeight || it.tare || 0,
                  deduction: it.deductionWeight || it.deduction || 0,
                  overridePrice: it.pricePerUnit || it.overridePrice,
                  unit: it.unit || 'lb',
                  materialSearch: '',
                  isDropdownOpen: false,
                  photoUrl: it.photoUrl || ''
                }))
              );
            }
            if (d.ticketDetails) {
              if (d.ticketDetails.vehiclePlate) setQtVehiclePlate(d.ticketDetails.vehiclePlate);
              if (d.ticketDetails.vehicleType) setQtVehicleType(d.ticketDetails.vehicleType);
              if (d.ticketDetails.customerPhotoUrl) setQtCustomerPhotoUrl(d.ticketDetails.customerPhotoUrl);
              if (d.ticketDetails.vehiclePhotoUrl) setQtVehiclePhotoUrl(d.ticketDetails.vehiclePhotoUrl);
              if (d.ticketDetails.loadPhotoUrl) setQtLoadPhotoUrl(d.ticketDetails.loadPhotoUrl);
              if (d.ticketDetails.idImageUrl) setQtIdImageUrl(d.ticketDetails.idImageUrl);
              if (d.ticketDetails.signatureUrl) setQtSignatureUrl(d.ticketDetails.signatureUrl);
            }
            if (d.step) setStep(d.step);
            setActiveDraftId(initialDraftId);
          }
        }).catch(console.error);
      }
    }
  }, [isOpen, initialDraftId]);

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
      if (qtCustomer.idImageUrl) {
        setQtIdImageUrl(qtCustomer.idImageUrl);
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
              setQtIdImageUrl(lastTicket.idImageUrl);
            }
          }
        })
        .catch((err) => console.warn('Could not load customer history:', err));
    }
  }, [qtCustomer]);

  // Ohio DPS Check Handler
  const runOhioCheck = async (customerName?: string, idNum?: string) => {
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
          idNumber: idNum || qtCustomer?.idNumber || qtNewCustomer.idNumber || ''
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
      console.error("Error executing Ohio check in QuickTicketModal:", err);
      setOhioCheckMessage("Unable to connect to live state portal. Using local offline registry fallback.");
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
          runOhioCheck(activeName, activeId);
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

  // Ohio DPS Check & Do-Not-Buy matching
  const namesMatch = (dnbName: string, custName: string) => {
    const cleanDnb = dnbName.toLowerCase().replace(/[^a-z0-9]/g, ' ').trim().split(/\s+/);
    const cleanCust = custName.toLowerCase().replace(/[^a-z0-9]/g, ' ').trim().split(/\s+/);
    if (cleanDnb.length === 0 || cleanCust.length === 0) return false;
    return cleanDnb.every((part) => cleanCust.includes(part));
  };

  const checkDoNotBuy = () => {
    const nameToCheck = qtCustomer?.name || qtNewCustomer.name;
    const match = doNotBuyList.find((entry) => namesMatch(entry.name, nameToCheck));

    if (match) {
      setIdCheckResult({ prohibited: true, reason: match.reason });
    } else {
      setIdCheckResult({ prohibited: false });
    }
    setStep(4);
  };

  const handleNext = () => {
    if (step === 1) {
      if (!qtCustomer && (!isQtNewCustomer || !qtNewCustomer.name)) return;
      setStep(2);
    } else if (step === 2) {
      if (qtItems.some((i) => !i.material || (i.gross - i.tare) <= 0)) return;
      setStep(3);
    } else if (step === 3) {
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

      // Compliance Hard Block 3: Ohio DPS Check Must Not Be Not-Checked or Flagged
      if (qtOhioDatabaseStatus === 'not_checked') {
        alert('Ohio DPS check has not been run for this seller. The database check is required before completing a transaction. Please wait for the check to complete or click "Run Ohio DPS Check".');
        return;
      }
      if (qtOhioDatabaseStatus === 'flagged') {
        alert('Ohio DPS Check: This seller is FLAGGED on the Do-Not-Buy registry. Transactions for flagged individuals are prohibited by Ohio law.');
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
    if (!qtIdImageUrl) {
      alert('Ohio ORC 4737.04 Compliance: A valid photo ID image is required before this ticket can be completed.');
      return;
    }
    if (!qtCustomerPhotoUrl) {
      alert('Ohio ORC 4737.04 Compliance: A photograph of the seller is required before this ticket can be completed.');
      return;
    }
    if (qtOhioDatabaseStatus === 'not_checked') {
      alert('Ohio DPS check has not been completed. Please run or wait for the database check before submitting.');
      return;
    }
    if (qtOhioDatabaseStatus === 'flagged') {
      alert('Ohio DPS Check: This seller is FLAGGED on the Do-Not-Buy registry. Submission is prohibited.');
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
      if (isQtNewCustomer && !customerId) {
        const custRef = await addDoc(collection(db, 'customers'), {
          ...qtNewCustomer,
          photoUrl: qtCustomerPhotoUrl || '',
          idImageUrl: qtIdImageUrl || '',
          idImageUpdatedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
        customerId = custRef.id;
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

      const ticketId = generateTicketId('BUY');
      const docRef = doc(db, 'buyTickets', ticketId);
      await setDoc(docRef, ticketData);

      const customerName = qtCustomer?.name || qtNewCustomer.name || 'Walk-in Customer';

      await logAuditEvent(
        'buyTicket',
        docRef.id,
        'create',
        { after: ticketData },
        `Quick Ticket created for ${customerName}`
      );

      // Audit overrides
      for (const item of qtItems) {
        if (item.material && item.overridePrice !== undefined && item.overridePrice !== item.material.buyPrice) {
          await logAuditEvent(
            'buyTicket',
            docRef.id,
            'override',
            {
              before: { price: item.material.buyPrice },
              after: { price: item.overridePrice }
            },
            `Price override approved for ${item.material.name} in Quick Ticket #${docRef.id.toUpperCase()}: $${item.material.buyPrice.toFixed(2)}/lb to $${item.overridePrice.toFixed(2)}/lb`
          );
        }
      }

      // Update customer record with photos, ID, and vehicle info
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
        await updateDoc(doc(db, 'customers', customerId), {
          ...customerUpdate,
          updatedAt: new Date().toISOString()
        });
      }

      // Snapshot for post-print receipt and preview
      const ticketSnapshot = {
        id: docRef.id,
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
        customerPhotoUrl: qtCustomerPhotoUrl || '',
        vehiclePhotoUrl: qtVehiclePhotoUrl || '',
        loadPhotoUrl: qtLoadPhotoUrl || '',
        idImageUrl: qtIdImageUrl || ''
      };

      setPrintedTicket(ticketSnapshot);
      setQtCreatedTicketId(docRef.id);
      setQtSuccess(true);

      // Update inventory
      for (const item of ticketMaterials) {
        const invRef = doc(db, 'inventory', item.materialId);
        await setDoc(
          invRef,
          {
            materialId: item.materialId,
            currentWeight: increment(item.netWeight),
            lastUpdated: new Date().toISOString()
          },
          { merge: true }
        );
      }

      // Clean draft
      if (activeDraftId) {
        await deleteDoc(doc(db, 'ticketDrafts', activeDraftId)).catch(console.error);
        setActiveDraftId(null);
      }

      setQtVerificationStatus('verified');

      firestore(
        'Quick Ticket Finalized',
        `Ohio Buy Ticket #${docRef.id.toUpperCase()} committed for ${customerName}. Total: $${calculatedFinalTotal.toFixed(2)}`
      );

      // Auto-print if enabled
      if (settings.autoPrint) {
        try {
          const tempTicket: BuyTicket = {
            id: docRef.id,
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
            signatureUrl: qtSignatureUrl || ''
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
      <div className="bg-white w-full max-w-4xl rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh] animate-in zoom-in-95 duration-200">
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

          <div className="flex items-center gap-2">
            {!qtSuccess && (
              <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 bg-white rounded-xl border border-slate-200 text-xs font-bold text-slate-600">
                {[1, 2, 3, 4].map((s) => (
                  <div
                    key={s}
                    className={cn(
                      'w-6 h-6 rounded-lg flex items-center justify-center text-[10px] transition-all',
                      step === s
                        ? 'bg-amber-500 text-slate-950 font-black scale-110 shadow-sm'
                        : step > s
                        ? 'bg-green-500 text-white font-bold'
                        : 'bg-slate-100 text-slate-400'
                    )}
                  >
                    {step > s ? '✓' : s}
                  </div>
                ))}
              </div>
            )}
            <button
              onClick={() => {
                resetQuickTicket();
                onClose();
              }}
              className="p-2 hover:bg-slate-200 rounded-full transition-colors"
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

              <div className="flex flex-col sm:flex-row gap-3 pt-2">
                <button
                  onClick={() => setShowPrintPreview(true)}
                  className="flex-1 py-3.5 bg-slate-900 text-white rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-slate-800 transition-all shadow-md active:scale-95 text-xs uppercase tracking-wider"
                >
                  <Printer className="w-4 h-4" />
                  Print Ticket Receipt
                </button>
                <button
                  onClick={resetQuickTicket}
                  className="flex-1 py-3.5 bg-amber-500 text-slate-950 font-black rounded-xl hover:bg-amber-600 transition-all shadow-md active:scale-95 text-xs uppercase tracking-wider flex items-center justify-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  Create Another Ticket
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Step 1: Customer Selection */}
              {step === 1 && (
                <div className="space-y-6 animate-in fade-in">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                      <User className="w-4 h-4 text-amber-500" />
                      Step 1: Select or Scan Customer
                    </h4>
                    <button
                      onClick={() => setIsUSBScannerOpen(true)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 text-white rounded-xl text-xs font-bold hover:bg-slate-800 transition-all shadow-sm"
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

                  {/* Ohio DPS Compliance Banner in Step 1 */}
                  {(qtCustomer || (isQtNewCustomer && qtNewCustomer.name)) && (
                    <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "w-9 h-9 rounded-xl flex items-center justify-center shrink-0",
                          qtOhioDatabaseStatus === 'cleared' ? "bg-green-100 text-green-700" :
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
                            <ShieldCheck className="w-5 h-5 text-slate-400" />
                          )}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-black text-slate-900 uppercase">Ohio DPS Database Check</span>
                            <span className={cn(
                              "text-[10px] font-black px-2 py-0.5 rounded-full uppercase",
                              qtOhioDatabaseStatus === 'cleared' ? "bg-green-100 text-green-800" :
                              qtOhioDatabaseStatus === 'flagged' ? "bg-red-100 text-red-800" :
                              isCheckingOhioPortal ? "bg-amber-100 text-amber-800" : "bg-slate-200 text-slate-700"
                            )}>
                              {isCheckingOhioPortal ? "Checking..." : qtOhioDatabaseStatus.toUpperCase()}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500 mt-0.5">
                            {ohioCheckMessage || (qtOhioDatabaseStatus === 'cleared' ? 'Seller cleared in State Registry' : 'Automatic verification will run before ticket submission')}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => runOhioCheck()}
                        disabled={isCheckingOhioPortal}
                        className="px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shrink-0 disabled:opacity-50"
                      >
                        <RefreshCw className={cn("w-3.5 h-3.5", isCheckingOhioPortal && "animate-spin")} />
                        <span>{isCheckingOhioPortal ? "Checking..." : "Re-Check DPS"}</span>
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Step 2: Line Items */}
              {step === 2 && (
                <div className="space-y-6 animate-in fade-in">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                      <Scale className="w-4 h-4 text-amber-500" />
                      Step 2: Weigh &amp; Grade Materials
                    </h4>
                    <span className="text-xs font-bold text-slate-500">
                      Customer:{' '}
                      <strong className="text-slate-900">
                        {qtCustomer?.name || qtNewCustomer.name || 'Walk-in'}
                      </strong>
                    </span>
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
                      };

                      return (
                        <div
                          key={item.id}
                          className="p-5 bg-slate-50 border border-slate-200 rounded-2xl space-y-4 relative"
                        >
                          <div className="flex items-center justify-between gap-4">
                            <span className="w-6 h-6 rounded-full bg-slate-200 text-slate-700 flex items-center justify-center font-bold text-xs">
                              {index + 1}
                            </span>
                            <div className="flex-1 relative">
                              <button
                                type="button"
                                onClick={() =>
                                  setQtItems((prev) =>
                                    prev.map((i) =>
                                      i.id === item.id ? { ...i, isDropdownOpen: !i.isDropdownOpen } : i
                                    )
                                  )
                                }
                                className="w-full px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-left font-bold text-sm flex items-center justify-between hover:border-amber-500 focus:outline-none"
                              >
                                <span>{item.material ? item.material.name : 'Select Scrap Material...'}</span>
                                {item.material && (
                                  <PricingUnitBadge
                                    unit={item.material.unit}
                                    category={item.material.category}
                                    materialName={item.material.name}
                                    className="ml-2"
                                  />
                                )}
                              </button>

                              {item.isDropdownOpen && (
                                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-2xl shadow-xl z-50 p-2 max-h-56 overflow-y-auto">
                                  <input
                                    type="text"
                                    autoFocus
                                    placeholder="Type to filter scrap materials..."
                                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold mb-2 outline-none focus:ring-2 focus:ring-amber-500"
                                    value={item.materialSearch || ''}
                                    onChange={(e) =>
                                      setQtItems((prev) =>
                                        prev.map((i) =>
                                          i.id === item.id ? { ...i, materialSearch: e.target.value } : i
                                        )
                                      )
                                    }
                                  />
                                  <div className="space-y-1">
                                    {materials
                                      .filter((m) =>
                                        m.name
                                          .toLowerCase()
                                          .includes((item.materialSearch || '').toLowerCase())
                                      )
                                      .map((m) => (
                                        <button
                                          key={m.id}
                                          type="button"
                                          onClick={() => selectMaterial(m)}
                                          className="w-full p-2 text-left hover:bg-amber-50 rounded-xl text-xs font-bold flex items-center justify-between"
                                        >
                                          <span>{m.name}</span>
                                          <span className="text-slate-400 font-mono">
                                            {formatUnitPrice(m.buyPrice, m.unit, m.category, m.name)}
                                          </span>
                                        </button>
                                      ))}
                                  </div>
                                </div>
                              )}
                            </div>

                            {qtItems.length > 1 && (
                              <button
                                type="button"
                                onClick={() => setQtItems((prev) => prev.filter((i) => i.id !== item.id))}
                                className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            )}
                          </div>

                          {/* Weights Grid */}
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            <div>
                              <div className="flex items-center justify-between mb-1">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
                                  Gross (lb)
                                </label>
                                <ScaleCaptureButton
                                  onCapture={(w) =>
                                    setQtItems((prev) =>
                                      prev.map((i) => (i.id === item.id ? { ...i, gross: w } : i))
                                    )
                                  }
                                />
                              </div>
                              <input
                                type="number"
                                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl font-mono font-bold text-sm focus:ring-2 focus:ring-amber-500 outline-none"
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
                            </div>

                            <div>
                              <div className="flex items-center justify-between mb-1">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider">
                                  Tare (lb)
                                </label>
                                <ScaleCaptureButton
                                  onCapture={(w) =>
                                    setQtItems((prev) =>
                                      prev.map((i) => (i.id === item.id ? { ...i, tare: w } : i))
                                    )
                                  }
                                />
                              </div>
                              <input
                                type="number"
                                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl font-mono font-bold text-sm focus:ring-2 focus:ring-amber-500 outline-none"
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
                            </div>

                            <div>
                              <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block mb-1">
                                Deduction (lb)
                              </label>
                              <input
                                type="number"
                                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl font-mono font-bold text-sm focus:ring-2 focus:ring-amber-500 outline-none"
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
                            </div>

                            <div>
                              <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider block mb-1">
                                Price ({isTon ? '$/NT' : '$/lb'})
                              </label>
                              <input
                                type="number"
                                step="0.001"
                                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl font-mono font-bold text-sm focus:ring-2 focus:ring-amber-500 outline-none"
                                value={item.overridePrice !== undefined ? item.overridePrice : (item.material?.buyPrice || '')}
                                onChange={(e) =>
                                  setQtItems((prev) =>
                                    prev.map((i) =>
                                      i.id === item.id
                                        ? { ...i, overridePrice: parseFloat(e.target.value) || 0 }
                                        : i
                                    )
                                  )
                                }
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
                      onClick={() =>
                        setQtItems((prev) => [
                          ...prev,
                          {
                            id: Math.random().toString(36).substr(2, 9),
                            material: null,
                            gross: 0,
                            tare: 0,
                            deduction: 0,
                            materialSearch: '',
                            isDropdownOpen: false
                          }
                        ])
                      }
                      className="w-full py-3 bg-white border-2 border-dashed border-slate-300 rounded-2xl text-xs font-bold text-slate-600 hover:border-amber-500 hover:text-amber-700 hover:bg-amber-50/50 transition-all flex items-center justify-center gap-2"
                    >
                      <Plus className="w-4 h-4" />
                      Add Another Material Item
                    </button>
                  </div>
                </div>
              )}

              {/* Step 3: Compliance & Vehicle */}
              {step === 3 && (
                <div className="space-y-6 animate-in fade-in">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-amber-500" />
                      Step 3: Ohio Compliance &amp; Verification (ORC 4737.04)
                    </h4>
                  </div>

                  {/* Ohio DPS Live Status */}
                  <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        "w-9 h-9 rounded-xl flex items-center justify-center shrink-0",
                        qtOhioDatabaseStatus === 'cleared' ? "bg-green-100 text-green-700" :
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
                          <ShieldCheck className="w-5 h-5 text-slate-400" />
                        )}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-black text-slate-900 uppercase">Ohio DPS Do-Not-Buy Check</span>
                          <span className={cn(
                            "text-[10px] font-black px-2 py-0.5 rounded-full uppercase",
                            qtOhioDatabaseStatus === 'cleared' ? "bg-green-100 text-green-800" :
                            qtOhioDatabaseStatus === 'flagged' ? "bg-red-100 text-red-800" :
                            isCheckingOhioPortal ? "bg-amber-100 text-amber-800" : "bg-slate-200 text-slate-700"
                          )}>
                            {isCheckingOhioPortal ? "Checking Live..." : qtOhioDatabaseStatus.toUpperCase()}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          {ohioCheckMessage || (qtOhioDatabaseStatus === 'cleared' ? 'Seller cleared in Ohio Homeland Security Portal' : 'Verification required before transaction submission')}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => runOhioCheck()}
                      disabled={isCheckingOhioPortal}
                      className="px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shrink-0 disabled:opacity-50"
                    >
                      <RefreshCw className={cn("w-3.5 h-3.5", isCheckingOhioPortal && "animate-spin")} />
                      <span>{isCheckingOhioPortal ? "Checking..." : "Re-Check Database"}</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* Customer Photo - MANDATORY */}
                    <div className={cn(
                      "p-4 border rounded-2xl space-y-3 transition-all",
                      qtCustomerPhotoUrl ? "bg-slate-50 border-slate-200" : "bg-amber-50/50 border-amber-300"
                    )}>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-black text-slate-700 uppercase tracking-wider flex items-center gap-1">
                          Seller Photo <span className="text-red-500 font-bold">*Required</span>
                        </span>
                        {qtCustomerPhotoUrl ? (
                          <CheckCircle2 className="w-4 h-4 text-green-500" />
                        ) : (
                          <span className="text-[10px] font-bold text-amber-700 uppercase">Mandatory</span>
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
                      "p-4 border rounded-2xl space-y-3 transition-all",
                      qtIdImageUrl ? "bg-slate-50 border-slate-200" : "bg-amber-50/50 border-amber-300"
                    )}>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-black text-slate-700 uppercase tracking-wider flex items-center gap-1">
                          Driver's License / ID <span className="text-red-500 font-bold">*Required</span>
                        </span>
                        {qtIdImageUrl ? (
                          <CheckCircle2 className="w-4 h-4 text-green-500" />
                        ) : (
                          <span className="text-[10px] font-bold text-amber-700 uppercase">Mandatory</span>
                        )}
                      </div>
                      <CameraCapture
                        label="Take ID Card Photo"
                        photoUrl={qtIdImageUrl}
                        onCapture={(url) => setQtIdImageUrl(url)}
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
                        className="px-4 py-2 bg-amber-600 text-white rounded-xl text-xs font-bold hover:bg-amber-700 transition-all shrink-0"
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
                    <h4 className="text-sm font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                      <Fingerprint className="w-4 h-4 text-amber-500" />
                      Step 4: Seller Signature &amp; Review
                    </h4>
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

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* Summary Overview */}
                    <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3">
                      <span className="text-xs font-black text-slate-400 uppercase tracking-wider block">
                        Ticket Payout Summary
                      </span>
                      <div className="space-y-2 text-xs">
                        <div className="flex justify-between">
                          <span className="text-slate-500">Customer:</span>
                          <span className="font-bold text-slate-900">
                            {qtCustomer?.name || qtNewCustomer.name || 'Walk-in'}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Total Net Weight:</span>
                          <span className="font-bold text-slate-900">{totalNetWeight.toLocaleString()} lb</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Payment Method:</span>
                          <span className="font-bold text-slate-900 uppercase">Cash</span>
                        </div>
                        <div className="flex justify-between pt-2 border-t border-slate-200">
                          <span className="text-sm font-black text-slate-900">Total Payout:</span>
                          <span className="text-xl font-black text-green-600">${totalAmount.toFixed(2)}</span>
                        </div>
                      </div>
                    </div>

                    {/* Signature Pad */}
                    <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-2">
                      <span className="text-xs font-black text-slate-400 uppercase tracking-wider block">
                        Seller Signature (Touch / Mouse)
                      </span>
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
                  className="px-4 py-2.5 bg-white border border-slate-200 text-slate-700 font-bold rounded-xl text-xs hover:bg-slate-100 transition-all flex items-center gap-1.5"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Back
                </button>
              ) : (
                <button
                  type="button"
                  onClick={resetQuickTicket}
                  className="px-4 py-2.5 bg-white border border-slate-200 text-slate-700 font-bold rounded-xl text-xs hover:bg-slate-100 transition-all flex items-center gap-1.5"
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
                    (step === 1 && !qtCustomer && (!isQtNewCustomer || !qtNewCustomer.name)) ||
                    (step === 2 && qtItems.some((i) => !i.material || (i.gross - i.tare) <= 0))
                  }
                  className="px-6 py-3 bg-amber-500 text-slate-950 font-black rounded-xl text-xs uppercase tracking-wider hover:bg-amber-600 transition-all shadow-md active:scale-95 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span>Continue</span>
                  <ChevronRight className="w-4 h-4" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleQuickTicketSubmit}
                  disabled={qtProcessing}
                  className="px-6 py-3 bg-green-600 text-white font-black rounded-xl text-xs uppercase tracking-wider hover:bg-green-700 transition-all shadow-md active:scale-95 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
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
                    signatureUrl: printedTicket?.signatureUrl || qtSignatureUrl || ''
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
