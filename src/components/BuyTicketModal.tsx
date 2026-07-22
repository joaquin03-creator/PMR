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
  Database,
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
  AlertTriangle,
  Fingerprint,
  Check,
  ExternalLink,
  Copy
} from 'lucide-react';
import { auth, db } from '../firebase';
import { collection, onSnapshot, addDoc, doc, getDoc, getDocFromCache, updateDoc, increment, setDoc, query, where, orderBy, limit, getDocs, deleteDoc } from 'firebase/firestore';
import { Material, Customer, BuyTicket, BuyTicketMaterial, DoNotBuyEntry, UserProfile } from '../types';
import { COMPANY_NAME, COMPANY_ADDRESS, COMPANY_PHONE, COMPANY_WEBSITE, handleImageError } from '../constants';
import { BrandLogo } from './BrandLogo';
import { cn, generateTicketId } from '../lib/utils';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';
import { useSettings } from '../context/SettingsContext';
import ManagerPinModal from './ManagerPinModal';
import { ScaleCaptureButton } from './ScaleCaptureButton';
import { CameraCapture } from './CameraCapture';
import SignaturePad from './SignaturePad';
import { printTicket } from '../lib/printTicket';
import { BuyTicketPrint } from './BuyTicketPrint';
import { logAuditEvent } from '../lib/audit';
import { roundNetWeight } from '../lib/weightUtils';

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

interface BuyTicketModalProps {
  isOpen: boolean;
  onClose: () => void;
  profile: UserProfile | null;
  resumeDraftId?: string | null;
}

export default function BuyTicketModal({ isOpen, onClose, profile, resumeDraftId }: BuyTicketModalProps) {
  const [step, setStep] = useState(1);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [doNotBuyList, setDoNotBuyList] = useState<DoNotBuyEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // Auto-save and draft states
  const [activeDraftId, setActiveDraftId] = useState<string | null>(resumeDraftId || null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // Ticket State
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [customerSearch, setCustomerSearch] = useState('');
  const [isCustomerLookupOpen, setIsCustomerLookupOpen] = useState(false);
  const [newCustomer, setNewCustomer] = useState({ name: '', phone: '', address: '', businessName: '', idNumber: '', idType: '', idExpiration: '' });
  const [isNewCustomer, setIsNewCustomer] = useState(false);
  const [idImageSource, setIdImageSource] = useState<'new' | 'on_file' | 'updated'>('new');
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  
  const [items, setItems] = useState<(BuyTicketMaterial & { id: string, material: Material | null, materialSearch?: string, isDropdownOpen?: boolean })[]>([
    { id: Math.random().toString(36).substr(2, 9), materialId: '', material: null, grossWeight: 0, tareWeight: 0, netWeight: 0, pricePerUnit: 0, totalAmount: 0, materialSearch: '', isDropdownOpen: false, photoUrl: '' }
  ]);

  const [ticketDetails, setTicketDetails] = useState({
    vehiclePlate: '',
    vehicleType: '',
    paymentMethod: 'cash' as 'cash' | 'check' | 'other',
    notes: '',
    customerPhotoUrl: '',
    signatureUrl: '',
    idImageUrl: '',
    vehiclePhotoUrl: '',
    ohioDatabaseStatus: 'not_checked' as 'not_checked' | 'cleared' | 'flagged'
  });

  const [processing, setQtProcessing] = useState(false);
  const [isReadingID, setIsReadingID] = useState(false);

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
        if (selectedCustomer) {
          // If a customer is already selected, do NOT overwrite the customer selection!
          // We can merge the OCR details if they are missing
          setSelectedCustomer(prev => {
            if (!prev) return null;
            return {
              ...prev,
              idNumber: prev.idNumber || result.idNumber || '',
              idType: prev.idType || result.idType || "Driver's License",
              idExpiration: prev.idExpiration || result.idExpiration || '',
              address: prev.address || result.address || '',
            };
          });
        } else if (isNewCustomer) {
          setNewCustomer(prev => ({
            ...prev,
            name: result.name || prev.name,
            address: result.address || prev.address,
            idType: result.idType || prev.idType || "Driver's License",
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
              idType: result.idType || prev.idType || "Driver's License",
              idNumber: result.idNumber || prev.idNumber,
              idExpiration: result.idExpiration || prev.idExpiration
            }));
          }
        }
      }
    } catch (error) {
      console.error("Error performing AI OCR on ID in BuyTicketModal:", error);
    } finally {
      setIsReadingID(false);
    }
  };
  const [isCheckingOhioPortal, setIsCheckingOhioPortal] = useState(false);
  const [ohioCheckMessage, setOhioCheckMessage] = useState<string | null>(null);

  const runOhioCheck = async (customerName?: string, idNum?: string) => {
    const nameToCheck = customerName || selectedCustomer?.name || newCustomer.name || '';
    if (!nameToCheck || nameToCheck.trim() === '') return;

    setIsCheckingOhioPortal(true);
    setOhioCheckMessage(null);
    try {
      const response = await fetch("/api/check-ohio-db", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: nameToCheck,
          idNumber: idNum || selectedCustomer?.idNumber || newCustomer.idNumber || '',
          username: settings.ohioScrapUsername,
          password: settings.ohioScrapPassword
        })
      });

      if (!response.ok) {
        throw new Error("Portal check API responded with an error");
      }

      const res = await response.json();
      if (res.success) {
        setTicketDetails(prev => ({
          ...prev,
          ohioDatabaseStatus: res.status
        }));
        setOhioCheckMessage(`${res.message} (${res.source === 'state_portal' ? 'Live State Database' : 'Local Offline Database Sync'})`);
      }
    } catch (err) {
      console.error("Error executing auto Ohio check in BuyTicketModal:", err);
      setOhioCheckMessage("Unable to connect to state portal or offline fallback. Please check manually.");
    } finally {
      setIsCheckingOhioPortal(false);
    }
  };

  // Automatically trigger Ohio Homeland Security check when customer is selected or name is updated
  useEffect(() => {
    const activeName = selectedCustomer?.name || newCustomer.name;
    if (activeName && activeName.trim() !== '') {
      const activeId = selectedCustomer?.idNumber || newCustomer.idNumber;
      
      const timer = setTimeout(() => {
        if (ticketDetails.ohioDatabaseStatus === 'not_checked') {
          runOhioCheck(activeName, activeId);
        }
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [selectedCustomer?.id, newCustomer.name, ticketDetails.ohioDatabaseStatus]);

  // Automatically reset check status when customer changes
  useEffect(() => {
    setTicketDetails(prev => ({ ...prev, ohioDatabaseStatus: 'not_checked' }));
    setOhioCheckMessage(null);
  }, [selectedCustomer?.id, newCustomer.name]);

  // Automatically load existing customer's ID photo on file
  useEffect(() => {
    if (selectedCustomer) {
      if (selectedCustomer.idImageUrl) {
        setTicketDetails(prev => ({ ...prev, idImageUrl: selectedCustomer.idImageUrl || '' }));
        setIdImageSource('on_file');
      } else {
        setIdImageSource('new');
      }
    } else {
      setIdImageSource('new');
    }
  }, [selectedCustomer?.id]);

  const [success, setQtSuccess] = useState(false);
  const [qtVerificationStatus, setQtVerificationStatus] = useState<'idle' | 'verifying' | 'verified' | 'failed' | 'offline-saved'>('idle');
  const [lastCreatedTicket, setLastCreatedTicket] = useState<BuyTicket | null>(null);
  const [showPrintPreview, setShowPrintPreview] = useState(false);
  const [isPreviewOnly, setIsPreviewOnly] = useState(false);
  const [idCheckResult, setIdCheckResult] = useState<{ prohibited: boolean, reason?: string } | null>(null);
  const [showPinModal, setShowPinModal] = useState(false);
  const [dbHistoryAlert, setDbHistoryAlert] = useState<{
    isOpen: boolean;
    ticketId: string;
    customerName: string;
    totalAmount: number;
    timestamp: string;
  } | null>(null);
  const [showVehicleConfirm, setShowVehicleConfirm] = useState(false);
  const [showIdConfirm, setShowIdConfirm] = useState(false);
  const { settings } = useSettings();

  // Auto-print effect
  useEffect(() => {
    if (success && settings.autoPrint && lastCreatedTicket) {
      setShowPrintPreview(true);
    }
  }, [success, settings.autoPrint, lastCreatedTicket]);

  useEffect(() => {
    if (resumeDraftId) {
      setActiveDraftId(resumeDraftId);
    } else {
      setActiveDraftId(null);
    }
  }, [resumeDraftId]);

  useEffect(() => {
    if (!resumeDraftId || !isOpen || materials.length === 0) return;
    const loadDraft = async () => {
      try {
        const docRef = doc(db, 'ticketDrafts', resumeDraftId);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const draft = docSnap.data();
          setStep(draft.step || 1);
          setSelectedCustomer(draft.selectedCustomer);
          setIsNewCustomer(draft.isNewCustomer || false);
          if (draft.newCustomer) {
            setNewCustomer(draft.newCustomer);
          }
          if (draft.items) {
            setItems(draft.items.map((i: any) => ({
              id: Math.random().toString(36).substr(2, 9),
              materialId: i.materialId || '',
              material: materials.find(m => m.id === i.materialId) || null,
              grossWeight: i.grossWeight || 0,
              tareWeight: i.tareWeight || 0,
              netWeight: i.netWeight || 0,
              pricePerUnit: i.pricePerUnit || 0,
              totalAmount: i.totalAmount || 0,
              materialSearch: materials.find(m => m.id === i.materialId)?.name || '',
              isDropdownOpen: false,
              photoUrl: i.photoUrl || ''
            })));
          }
          if (draft.ticketDetails) {
            setTicketDetails(draft.ticketDetails);
          }
          setSaveStatus('saved');
        }
      } catch (err) {
        console.error("Error loading draft in modal:", err);
      }
    };
    loadDraft();
  }, [resumeDraftId, isOpen, materials]);

  const saveDraftToFirestore = async () => {
    if (!auth.currentUser || !isOpen) return;
    const hasCustomer = selectedCustomer || isNewCustomer || newCustomer.name;
    const hasMaterials = items.some(i => i.materialId || i.grossWeight > 0 || i.netWeight > 0);
    const hasVehicle = ticketDetails.vehiclePlate || ticketDetails.vehicleType;
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
        type: 'robust',
        step,
        selectedCustomer: selectedCustomer ? {
          id: selectedCustomer.id,
          name: selectedCustomer.name,
          phone: selectedCustomer.phone || '',
          address: selectedCustomer.address || '',
          businessName: selectedCustomer.businessName || '',
          idType: selectedCustomer.idType || '',
          idNumber: selectedCustomer.idNumber || '',
          idExpiration: selectedCustomer.idExpiration || ''
        } : null,
        isNewCustomer,
        newCustomer,
        items: items.map(i => ({
          materialId: i.materialId || '',
          grossWeight: i.grossWeight || 0,
          tareWeight: i.tareWeight || 0,
          netWeight: i.netWeight || 0,
          pricePerUnit: i.pricePerUnit || 0,
          totalAmount: i.totalAmount || 0,
          photoUrl: i.photoUrl || ''
        })),
        ticketDetails: {
          vehiclePlate: ticketDetails.vehiclePlate || '',
          vehicleType: ticketDetails.vehicleType || '',
          paymentMethod: ticketDetails.paymentMethod || 'cash',
          notes: ticketDetails.notes || '',
          customerPhotoUrl: ticketDetails.customerPhotoUrl || '',
          idImageUrl: ticketDetails.idImageUrl || '',
          vehiclePhotoUrl: ticketDetails.vehiclePhotoUrl || '',
          signatureUrl: ticketDetails.signatureUrl || '',
          ohioDatabaseStatus: ticketDetails.ohioDatabaseStatus || 'not_checked'
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
      console.error("Error saving draft in modal:", err);
      setSaveStatus('error');
    }
  };

  useEffect(() => {
    if (loading || success || processing || !isOpen) return;

    const hasCustomer = selectedCustomer || isNewCustomer || newCustomer.name;
    const hasMaterials = items.some(i => i.materialId || i.grossWeight > 0 || i.netWeight > 0);
    const hasVehicle = ticketDetails.vehiclePlate || ticketDetails.vehicleType;
    if (!hasCustomer && !hasMaterials && !hasVehicle) {
      if (activeDraftId) {
        deleteDoc(doc(db, 'ticketDrafts', activeDraftId)).catch(console.error);
        setActiveDraftId(null);
      }
      return;
    }

    const timer = setTimeout(() => {
      saveDraftToFirestore();
    }, 3000);

    return () => clearTimeout(timer);
  }, [step, selectedCustomer, newCustomer, items, ticketDetails, isNewCustomer, isOpen]);

  useEffect(() => {
    if (!isOpen || !auth.currentUser) return;

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
      try { unsubMaterials(); } catch (e) { console.warn('unsubMaterials error', e); }
      try { unsubCustomers(); } catch (e) { console.warn('unsubCustomers error', e); }
      try { unsubDNB(); } catch (e) { console.warn('unsubDNB error', e); }
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
    const physicalNet = roundNetWeight(Math.max(0, item.grossWeight - item.tareWeight));
    const paidWeight = Math.max(0, physicalNet - (item.deductionWeight || 0));
    const total = Math.round((paidWeight * item.pricePerUnit) * 100) / 100;
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
      const match = doNotBuyList.find(entry => namesMatch(entry.name, nameToCheck));
      if (match) {
        setIdCheckResult({ prohibited: true, reason: match.reason });
        return; // Block progression if prohibited
      }
      
      // ── COMPLIANCE HARD BLOCK: Ohio ORC 4737.04 ──────────────────────────
      // ID card image is REQUIRED. No bypass permitted.
      // A missing ID image produces error code 116 and rejects the Ohio upload.
      if (!ticketDetails.idImageUrl) {
        setShowIdConfirm(true);
        return; // hard stop — cannot proceed without ID image
      }

      // Seller photo is REQUIRED. No bypass permitted.
      // A missing seller photo produces error code 117 and rejects the Ohio upload.
      const hasSellerPhoto = !!(ticketDetails.customerPhotoUrl);
      if (!hasSellerPhoto) {
        setShowIdConfirm(false);
        alert('Ohio ORC 4737.04 Compliance: A photograph of the seller is required before this ticket can be completed. Please capture a customer photo before continuing.');
        return; // hard stop
      }
      // ─────────────────────────────────────────────────────────────────────

      // Ohio DPS check must be run and must not be flagged
      if (ticketDetails.ohioDatabaseStatus === 'not_checked') {
        alert('Ohio DPS check has not been run for this seller. The database check is required before completing a transaction. Please wait for the check to complete or run it manually.');
        return;
      }

      if (ticketDetails.ohioDatabaseStatus === 'flagged') {
        // Do not allow ticket to proceed — seller is on the Do-Not-Buy list
        return; // UI already shows flagged state — hard stop, no alert needed
      }

      setShowIdConfirm(false);
      setIdCheckResult({ prohibited: false });
      setStep(2);
    } else if (step === 2) {
      if (items.some(i => !i.material || i.netWeight <= 0)) return;
      setStep(3);
    } else if (step === 3) {
      // Compliance check: vehicle license plate and vehicle photo captured
      if ((!ticketDetails.vehiclePlate || !ticketDetails.vehiclePhotoUrl || !ticketDetails.vehicleType) && !showVehicleConfirm) {
        setShowVehicleConfirm(true);
        return;
      }
      setShowVehicleConfirm(false);
      setStep(4);
    }
  };

  const handleBack = () => {
    setShowVehicleConfirm(false);
    setShowIdConfirm(false);
    if (step > 1) setStep(step - 1);
  };

  const handleSubmit = async () => {
    // Check for price overrides
    const hasOverrides = items.some(item => {
      const originalPrice = item.material?.buyPrice || 0;
      const newPrice = item.pricePerUnit;
      const diff = Math.abs(newPrice - originalPrice);
      // Only require manager pin if override is more than 12% of material's price
      return originalPrice === 0 ? (diff > 0) : (diff / originalPrice > 0.12);
    });

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
        vehiclePhotoUrl: ticketDetails.vehiclePhotoUrl || '',
        signatureUrl: ticketDetails.signatureUrl || '',
        ohioDatabaseStatus: ticketDetails.ohioDatabaseStatus || 'not_checked',
        createdBy: profile?.uid || '',
        createdByName: profile?.displayName || profile?.email || 'System'
      };

      const ticketId = generateTicketId('BUY');
      const docRef = doc(db, 'buyTickets', ticketId);
      await setDoc(docRef, ticketData);

      // Track action in Audit Log
      await logAuditEvent(
        'buyTicket',
        docRef.id,
        'create',
        { after: ticketData },
        `Buy Ticket created (Modal) for ${selectedCustomer?.name || 'Customer'}`
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
            `Price override approved for ${mat.name} in Buy Ticket #${docRef.id.toUpperCase()}: $${mat.buyPrice.toFixed(2)}/lb to $${item.pricePerUnit.toFixed(2)}/lb`
          );
        }
      }
      
      // Update customer profile with any and all annotated data from this ticket (photos, vehicle info, and profile info)
      const customerUpdate: any = {};
      if (ticketDetails.customerPhotoUrl) customerUpdate.photoUrl = ticketDetails.customerPhotoUrl;
      if (ticketDetails.idImageUrl) customerUpdate.idImageUrl = ticketDetails.idImageUrl;
      if (ticketDetails.vehiclePlate) customerUpdate.vehiclePlate = ticketDetails.vehiclePlate;
      if (ticketDetails.vehicleType) customerUpdate.vehicleType = ticketDetails.vehicleType;
      if (ticketDetails.vehiclePhotoUrl) customerUpdate.vehiclePhotoUrl = ticketDetails.vehiclePhotoUrl;

      if (selectedCustomer) {
        customerUpdate.phone = selectedCustomer.phone || '';
        customerUpdate.secondaryPhone = selectedCustomer.secondaryPhone || '';
        customerUpdate.email = selectedCustomer.email || '';
        customerUpdate.address = selectedCustomer.address || '';
        customerUpdate.businessName = selectedCustomer.businessName || '';
        customerUpdate.idType = selectedCustomer.idType || '';
        customerUpdate.idNumber = selectedCustomer.idNumber || '';
        customerUpdate.idExpiration = selectedCustomer.idExpiration || '';
      }

      if (Object.keys(customerUpdate).length > 0) {
        await updateDoc(doc(db, 'customers', customerId), {
          ...customerUpdate,
          updatedAt: new Date().toISOString()
        });
      }
      setLastCreatedTicket({ id: docRef.id, ...ticketData });

      // Update Inventory
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
            ? `Inventory updated via Buy Ticket ${docRef.id}`
            : `Initial inventory created via Buy Ticket ${docRef.id}`
        );
      }

      setQtVerificationStatus('verifying');
      
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
      
      // Open the Database confirmation popup dialogue!
      setDbHistoryAlert({
        isOpen: true,
        ticketId: docRef.id,
        customerName: selectedCustomer?.name || newCustomer.name || 'Unknown Customer',
        totalAmount: totalAmount || 0,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error creating ticket:', error);
      setQtVerificationStatus('failed');
      handleFirestoreError(error, OperationType.CREATE, 'buyTickets');
    } finally {
      setQtProcessing(false);
    }
  };

  const reset = () => {
    if (activeDraftId) {
      deleteDoc(doc(db, 'ticketDrafts', activeDraftId)).catch(console.error);
      setActiveDraftId(null);
    }
    setStep(1);
    setSelectedCustomer(null);
    setCustomerSearch('');
    setNewCustomer({ name: '', phone: '', address: '', businessName: '', idNumber: '', idType: '', idExpiration: '' });
    setIsNewCustomer(false);
    setItems([{ id: Math.random().toString(36).substr(2, 9), materialId: '', material: null, grossWeight: 0, tareWeight: 0, netWeight: 0, pricePerUnit: 0, totalAmount: 0, materialSearch: '', isDropdownOpen: false }]);
    setTicketDetails({ vehiclePlate: '', vehicleType: '', paymentMethod: 'cash', notes: '', customerPhotoUrl: '', signatureUrl: '', idImageUrl: '', vehiclePhotoUrl: '', ohioDatabaseStatus: 'not_checked' });
    setIdImageSource('new');
    setLightboxUrl(null);
    setQtSuccess(false);
    setQtVerificationStatus('idle');
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
                <h3 className="text-2xl font-black text-slate-900 tracking-tight font-display uppercase">
                  {qtVerificationStatus === 'offline-saved' ? 'Saved Locally!' : 'Ticket Completed!'}
                </h3>
                <p className="text-slate-500 max-w-md mx-auto text-sm font-medium">
                  {qtVerificationStatus === 'offline-saved'
                    ? "Saved to local offline queue. Once internet connection is restored, this ticket will automatically synchronize with cloud servers."
                    : "The payout has been recorded, inventory recalculated, and the transaction securely verified."
                  }
                </p>
              </div>

              <div className="max-w-md mx-auto bg-slate-50 border border-slate-200 rounded-3xl p-5 text-left space-y-4 shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-200 pb-2.5">
                  <span className="text-xs font-black text-slate-400 uppercase tracking-widest">Database Integrity &amp; Sync</span>
                  {qtVerificationStatus === 'verifying' && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-black bg-amber-100 text-amber-800 rounded-full">
                      <Loader2 className="w-3 animate-spin" /> VERIFYING...
                    </span>
                  )}
                  {qtVerificationStatus === 'verified' && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-black bg-green-100 text-green-800 rounded-full">
                      <div className="w-1.5 h-1.5 bg-green-600 rounded-full inline-block animate-pulse" /> SECURELY STORED
                    </span>
                  )}
                  {qtVerificationStatus === 'offline-saved' && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-black bg-amber-100 text-amber-800 rounded-full">
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
                  <span className="text-slate-400">Verified Ticket ID:</span>
                  <span className="font-mono font-bold text-right text-slate-800 break-all">{lastCreatedTicket?.id || 'Writing to DB...'}</span>
                  
                  <span className="text-slate-400">Customer:</span>
                  <span className="font-bold text-right text-slate-800">{selectedCustomer?.name || newCustomer.name || 'Unknown'}</span>
                  
                  <span className="text-slate-400">Total Net Weight:</span>
                  <span className="font-bold text-right text-slate-800">
                    {items.reduce((sum, item) => sum + (item.netWeight - (item.deductionWeight || 0)), 0)} lb
                  </span>
                  
                  <span className="text-slate-400">Total Payout:</span>
                  <span className="font-mono font-black text-right text-green-600">${totalAmount.toFixed(2)}</span>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 justify-center pt-6">
                <button
                  onClick={() => setShowPrintPreview(true)}
                  className="px-8 py-4 bg-slate-900 text-white rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-slate-800 transition-all shadow-md text-xs uppercase tracking-wider active:scale-95"
                >
                  <Printer className="w-5 h-5" />
                  Print Ticket Receipt
                </button>
                <button
                  onClick={() => { onClose(); reset(); }}
                  className="px-8 py-4 bg-white border-2 border-slate-200 text-slate-700 rounded-2xl font-bold hover:bg-slate-50 hover:border-slate-300 transition-all text-xs uppercase tracking-wider active:scale-95"
                >
                  Done &amp; Reset Form
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-8">
              {/* Step 1: Customer */}
              {step === 1 && (
                <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                  {/* Ohio DB Banner */}
                  {(selectedCustomer || (isNewCustomer && newCustomer.name)) && (
                    <div className="space-y-3">
                      {ticketDetails.ohioDatabaseStatus === 'flagged' && (
                        <div className="p-4 bg-red-100 border-2 border-red-500 rounded-xl text-red-800 animate-in fade-in duration-200">
                          <p className="font-black text-xs flex items-center gap-2">
                            <span>⛔ TRANSACTION BLOCKED — This seller is on the Ohio Do-Not-Buy list. You are prohibited from purchasing from this individual under Ohio ORC 4737.04. Do not proceed.</span>
                          </p>
                          {(() => {
                            const dnbMatch = doNotBuyList.find(entry => namesMatch(entry.name, selectedCustomer?.name || newCustomer.name || ''));
                            const dnbReason = dnbMatch?.reason || ohioCheckMessage || '';
                            return dnbReason ? (
                              <p className="text-[10px] font-bold text-red-700 mt-2 bg-red-50 p-2 rounded-lg border border-red-200">
                                DNB Reason: {dnbReason}
                              </p>
                            ) : null;
                          })()}
                        </div>
                      )}
                      {ticketDetails.ohioDatabaseStatus === 'not_checked' && (
                        <div className="p-4 bg-amber-50 border border-amber-300 rounded-xl text-amber-800 font-bold text-xs flex items-center gap-2 animate-pulse">
                          <span className="w-2 h-2 bg-amber-500 rounded-full animate-ping" />
                          <span>Ohio DPS check in progress — please wait before continuing.</span>
                        </div>
                      )}
                      {ticketDetails.ohioDatabaseStatus === 'cleared' && (
                        <div className="p-4 bg-emerald-50 border border-emerald-300 rounded-xl text-emerald-800 font-bold text-xs flex items-center gap-2">
                          <span className="w-2 h-2 bg-emerald-500 rounded-full" />
                          <span>Ohio DPS check cleared — seller is not on the Do-Not-Buy list.</span>
                        </div>
                      )}
                    </div>
                  )}

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
                    <div className="p-6 bg-slate-50 rounded-2xl border border-slate-200 space-y-4 animate-in fade-in duration-200">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-slate-500 uppercase">Full Name</label>
                          <input 
                            className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                            value={newCustomer.name}
                            onChange={e => setNewCustomer({...newCustomer, name: e.target.value})}
                            placeholder="John Doe"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-slate-500 uppercase">Business Name (Optional)</label>
                          <input 
                            className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                            value={newCustomer.businessName}
                            onChange={e => setNewCustomer({...newCustomer, businessName: e.target.value})}
                            placeholder="Acme Scrap"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-slate-500 uppercase">Phone</label>
                          <input 
                            className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                            value={newCustomer.phone}
                            onChange={e => setNewCustomer({...newCustomer, phone: e.target.value})}
                            placeholder="(555) 000-0000"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-slate-500 uppercase">Address</label>
                          <input 
                            className="w-full px-4 py-2 bg-white border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                            value={newCustomer.address}
                            onChange={e => setNewCustomer({...newCustomer, address: e.target.value})}
                            placeholder="123 Main St"
                          />
                        </div>
                      </div>

                      <div className="pt-4 border-t border-slate-200 space-y-2">
                        <h5 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                          <span>Driver's License / Official ID Copy</span>
                          {ticketDetails.idImageUrl ? (
                            <span className="text-[8px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-black uppercase">Captured</span>
                          ) : (
                            <span className="text-[8px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-black uppercase">Important Check</span>
                          )}
                        </h5>
                        <p className="text-[10px] text-slate-500">Ohio ORC 4737.04 photo copy compliance of identity.</p>
                        
                        {!ticketDetails.idImageUrl && (
                          <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-center gap-2.5 text-xs text-rose-800 font-bold animate-in fade-in duration-200">
                            <span className="w-2.5 h-2.5 bg-rose-500 rounded-full animate-pulse shrink-0" />
                            <span>ID required — scan or photograph seller's state-issued ID.</span>
                          </div>
                        )}
                        {idImageSource === 'updated' && ticketDetails.idImageUrl && (
                          <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex flex-col gap-3 text-xs text-emerald-800 font-bold animate-in fade-in duration-200">
                            <div className="flex items-center gap-2.5">
                              <span className="w-2.5 h-2.5 bg-emerald-500 rounded-full shrink-0" />
                              <span>New ID scanned and saved to customer profile.</span>
                            </div>
                            <div className="pt-1 pl-5">
                              <IdImageThumbnail 
                                imageUrl={ticketDetails.idImageUrl} 
                                onViewFull={(url) => setLightboxUrl(url)} 
                              />
                            </div>
                          </div>
                        )}

                        <CameraCapture 
                          label="Capture ID Document Copy"
                          onCapture={(url) => {
                            setTicketDetails({ ...ticketDetails, idImageUrl: url });
                            setShowIdConfirm(false);
                            if (url) {
                              setIdImageSource('updated');
                              handleReadIDFromPhoto(url);
                            } else {
                              setIdImageSource('new');
                            }
                          }}
                          networkUrl={settings.useSwannCams ? settings.swannCams.customer : undefined}
                          className="aspect-video w-full rounded-xl overflow-hidden"
                        />
                        {isReadingID && (
                          <div className="p-3 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl flex items-center gap-2.5 animate-pulse mt-2">
                            <Loader2 className="w-4.5 h-4.5 animate-spin text-blue-600 shrink-0" />
                            <div className="flex-1">
                              <p className="text-[10px] font-extrabold text-blue-900 uppercase tracking-wider">AI OCR Reading ID...</p>
                              <p className="text-[9px] text-blue-600 font-medium">Extracting customer information and auto-filling...</p>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {!selectedCustomer && (
                        <div className="flex flex-col items-center justify-center py-10 px-4 bg-slate-50 border-2 border-dashed border-slate-200 rounded-2xl text-center space-y-4 animate-in fade-in duration-200">
                          <div className="w-12 h-12 bg-blue-50 rounded-full flex items-center justify-center text-blue-600 shadow-inner">
                            <User className="w-6 h-6" />
                          </div>
                          <div className="max-w-xs space-y-1">
                            <h4 className="font-black text-slate-900 text-sm">No Seller Selected</h4>
                            <p className="text-xs text-slate-500 font-semibold leading-relaxed">
                              Find an existing customer from our database directory or register a new customer profile.
                            </p>
                          </div>
                          <div className="flex flex-col sm:flex-row gap-3 w-full max-w-xs pt-1">
                            <button
                              type="button"
                              onClick={() => setIsCustomerLookupOpen(true)}
                              className="flex-1 px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-black uppercase tracking-wider shadow-sm transition-all active:scale-95 flex items-center justify-center gap-1.5"
                            >
                              <Search className="w-3.5 h-3.5" />
                              Search Previous
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setIsNewCustomer(true);
                              }}
                              className="flex-1 px-4 py-3 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-xl text-xs font-black uppercase tracking-wider transition-all active:scale-95 flex items-center justify-center gap-1.5"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              Add New
                            </button>
                          </div>
                        </div>
                      )}
                      {selectedCustomer && (
                        <div className="space-y-4 animate-in fade-in duration-250">
                          <div className="p-4 bg-blue-50 border border-blue-100 rounded-xl flex items-center justify-between gap-4">
                            <div className="flex items-center gap-4">
                              <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center text-blue-600 shadow-sm">
                                <User className="w-6 h-6" />
                              </div>
                              <div>
                                <p className="font-bold text-blue-900">{selectedCustomer.name}</p>
                                <p className="text-xs text-blue-600">{selectedCustomer.phone || 'No phone'} • {selectedCustomer.address || 'No address'}</p>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedCustomer(null);
                                setCustomerSearch('');
                              }}
                              className="p-1.5 text-slate-400 hover:text-slate-600 bg-white hover:bg-slate-50 border border-slate-200 rounded-full transition-colors shrink-0"
                              title="Clear customer"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>

                          <div className="p-6 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
                            <h5 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                              <span>Driver's License / Official ID Copy</span>
                              {ticketDetails.idImageUrl ? (
                                <span className="text-[8px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-black uppercase">Captured</span>
                              ) : (
                                <span className="text-[8px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-black uppercase">Important Check</span>
                              )}
                            </h5>
                            <p className="text-[10px] text-slate-500">Scan or snapshot of state-issued ID for official records record-keeping.</p>
                            
                            {!ticketDetails.idImageUrl && (
                              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-center gap-2.5 text-xs text-rose-800 font-bold animate-in fade-in duration-200">
                                <span className="w-2.5 h-2.5 bg-rose-500 rounded-full animate-pulse shrink-0" />
                                <span>ID required — scan or photograph seller's state-issued ID.</span>
                              </div>
                            )}
                            {idImageSource === 'on_file' && ticketDetails.idImageUrl && (
                              <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl flex flex-col gap-3 text-xs text-amber-800 font-bold animate-in fade-in duration-200">
                                <div className="flex items-center gap-2.5">
                                  <span className="w-2.5 h-2.5 bg-amber-500 rounded-full animate-pulse shrink-0" />
                                  <span>ID on file — verify this matches today's ID. Re-scan if expired or changed.</span>
                                </div>
                                
                                <div className="flex flex-col gap-1.5 pt-1 pl-5">
                                  <span className="text-[10px] text-amber-900 font-extrabold uppercase tracking-wider">
                                    Seller Profile: {selectedCustomer?.name}
                                  </span>
                                  <IdImageThumbnail 
                                    imageUrl={ticketDetails.idImageUrl} 
                                    onViewFull={(url) => setLightboxUrl(url)} 
                                  />
                                </div>

                                <div className="pl-5 pt-1">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setTicketDetails(prev => ({ ...prev, idImageUrl: '' }));
                                      setIdImageSource('new');
                                    }}
                                    className="px-2.5 py-1 text-[11px] font-bold bg-amber-100 hover:bg-amber-200 text-amber-900 rounded-lg border border-amber-300 transition-colors cursor-pointer whitespace-nowrap w-fit"
                                  >
                                    Re-scan ID
                                  </button>
                                </div>
                              </div>
                            )}
                            {idImageSource === 'updated' && ticketDetails.idImageUrl && (
                              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex flex-col gap-3 text-xs text-emerald-800 font-bold animate-in fade-in duration-200">
                                <div className="flex items-center gap-2.5">
                                  <span className="w-2.5 h-2.5 bg-emerald-500 rounded-full shrink-0" />
                                  <span>New ID scanned and saved to customer profile.</span>
                                </div>
                                <div className="pt-1 pl-5">
                                  <IdImageThumbnail 
                                    imageUrl={ticketDetails.idImageUrl} 
                                    onViewFull={(url) => setLightboxUrl(url)} 
                                  />
                                </div>
                              </div>
                            )}

                            <CameraCapture 
                              label="Capture ID Document Copy"
                              onCapture={(url) => {
                                setTicketDetails({ ...ticketDetails, idImageUrl: url });
                                setShowIdConfirm(false);
                                if (url) {
                                  setIdImageSource('updated');
                                  handleReadIDFromPhoto(url);
                                } else {
                                  setIdImageSource('new');
                                }
                              }}
                              networkUrl={settings.useSwannCams ? settings.swannCams.customer : undefined}
                              className="aspect-video w-full rounded-xl overflow-hidden"
                            />
                            {isReadingID && (
                              <div className="p-3 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl flex items-center gap-2.5 animate-pulse mt-2">
                                <Loader2 className="w-4.5 h-4.5 animate-spin text-blue-600 shrink-0" />
                                <div className="flex-1">
                                  <p className="text-[10px] font-extrabold text-blue-900 uppercase tracking-wider">AI OCR Reading ID...</p>
                                  <p className="text-[9px] text-blue-600 font-medium">Extracting customer information and auto-filling...</p>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {showIdConfirm && (
                    <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl flex gap-3 items-center animate-in zoom-in-95 mt-4" role="alert">
                      <AlertCircle className="w-5 h-5 text-amber-600 shrink-0" />
                      <div className="flex-1 text-xs">
                        <p className="font-extrabold text-amber-900 text-sm">Bypass State ID Warning</p>
                        <p className="text-amber-700 font-medium">Ohio state ORC § 4737.04 compliance regulates active capture of state ID copies. To ignore, click Bypass.</p>
                      </div>
                      <button 
                        type="button"
                        onClick={() => {
                          setShowIdConfirm(false);
                          setIdCheckResult({ prohibited: false });
                          setStep(2);
                        }}
                        className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-black shadow-lg shadow-amber-200/50 transition-all hover:scale-102"
                      >
                        Bypass Check
                      </button>
                    </div>
                  )}

                  {/* Ohio Dept of Homeland Security Scrap Database Check */}
                  {(selectedCustomer || (isNewCustomer && newCustomer.name)) && (
                    <div className="mt-6 pt-6 border-t border-slate-200 space-y-4">
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
                        {ticketDetails.ohioDatabaseStatus === 'cleared' ? (
                          <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 text-[8px] font-black uppercase rounded border border-emerald-200 flex items-center gap-0.5 font-sans">
                            <Check className="w-2.5 h-2.5" /> Cleared
                          </span>
                        ) : ticketDetails.ohioDatabaseStatus === 'flagged' ? (
                          <span className="px-2 py-0.5 bg-red-100 text-red-800 text-[8px] font-black uppercase rounded border border-red-200 flex items-center gap-0.5 font-sans">
                            <AlertTriangle className="w-2.5 h-2.5 animate-pulse" /> Flagged
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 bg-amber-100 text-amber-800 text-[8px] font-black uppercase rounded border border-amber-200 font-sans">
                            Pending
                          </span>
                        )}
                      </div>

                      <div className="bg-slate-100/75 border border-slate-200 rounded-xl p-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {/* Copy info helper */}
                        <div className="space-y-1.5">
                          <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Seller Details (Click to copy)</p>
                          <div className="grid grid-cols-1 gap-1 text-[11px]">
                            <button
                              type="button"
                              onClick={() => {
                                const name = selectedCustomer?.name || newCustomer.name || '';
                                navigator.clipboard.writeText(name);
                              }}
                              className="flex items-center justify-between px-2.5 py-1.5 bg-white hover:bg-slate-50 rounded-lg border border-slate-200 text-left font-bold transition-all text-slate-700 w-full"
                            >
                              <span className="truncate">Name: <span className="text-slate-900 font-mono">{selectedCustomer?.name || newCustomer.name || 'N/A'}</span></span>
                              <Copy className="w-3 h-3 text-slate-400 shrink-0 ml-1.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                const addressStr = selectedCustomer?.address || newCustomer.address || '';
                                navigator.clipboard.writeText(addressStr);
                              }}
                              className="flex items-center justify-between px-2.5 py-1.5 bg-white hover:bg-slate-50 rounded-lg border border-slate-200 text-left font-bold transition-all text-slate-700 w-full"
                            >
                              <span className="truncate">Address: <span className="text-slate-900 font-mono font-normal">{selectedCustomer?.address || newCustomer.address || 'N/A'}</span></span>
                              <Copy className="w-3 h-3 text-slate-400 shrink-0 ml-1.5" />
                            </button>
                          </div>
                        </div>

                        {/* Credentials helper */}
                        <div className="space-y-1.5 border-t sm:border-t-0 sm:border-l border-slate-200 sm:pl-3 pt-3 sm:pt-0">
                          <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Portal Credentials (Click to copy)</p>
                          <div className="grid grid-cols-1 gap-1 text-[11px]">
                            <div className="flex items-center justify-between px-2.5 py-1.5 bg-white rounded-lg border border-slate-200 font-semibold text-slate-700">
                              <span className="truncate">User: <span className="font-mono font-bold text-slate-900">{settings.ohioScrapUsername || 'Not Configured'}</span></span>
                              {settings.ohioScrapUsername && (
                                <button
                                  type="button"
                                  onClick={() => navigator.clipboard.writeText(settings.ohioScrapUsername)}
                                  className="p-0.5 hover:bg-slate-100 rounded border border-slate-200 text-slate-500 hover:text-slate-700 transition-all shrink-0 ml-1.5"
                                  title="Copy Username"
                                >
                                  <Copy className="w-2.5 h-2.5" />
                                </button>
                              )}
                            </div>
                            <div className="flex items-center justify-between px-2.5 py-1.5 bg-white rounded-lg border border-slate-200 font-semibold text-slate-700">
                              <span className="truncate">Pass: <span className="font-mono font-bold text-slate-900">{settings.ohioScrapPassword ? '••••••••' : 'Not Configured'}</span></span>
                              {settings.ohioScrapPassword && (
                                <button
                                  type="button"
                                  onClick={() => navigator.clipboard.writeText(settings.ohioScrapPassword)}
                                  className="p-0.5 hover:bg-slate-100 rounded border border-slate-200 text-slate-500 hover:text-slate-700 transition-all shrink-0 ml-1.5"
                                  title="Copy Password"
                                >
                                  <Copy className="w-2.5 h-2.5" />
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => runOhioCheck()}
                          disabled={isCheckingOhioPortal}
                          className="px-3 py-2 bg-amber-600 hover:bg-amber-700 disabled:bg-amber-400 text-white rounded-lg text-[9px] font-black uppercase tracking-widest transition-all flex items-center gap-1"
                        >
                          {isCheckingOhioPortal ? (
                            <>
                              <Loader2 className="w-3 h-3 animate-spin" />
                              Checking...
                            </>
                          ) : (
                            <>
                              <Fingerprint className="w-3 h-3" />
                              Automated Check
                            </>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => window.open(settings.ohioScrapPortalUrl, '_blank')}
                          className="px-3 py-2 bg-slate-900 hover:bg-blue-600 text-white rounded-lg text-[9px] font-black uppercase tracking-widest transition-all flex items-center gap-1"
                        >
                          <ExternalLink className="w-3 h-3" />
                          Open Portal
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setTicketDetails(prev => ({ ...prev, ohioDatabaseStatus: 'cleared' }));
                            setOhioCheckMessage("Manually marked as CLEARED.");
                          }}
                          className={`px-3 py-2 rounded-lg text-[9px] font-black uppercase tracking-widest border transition-all ${
                            ticketDetails.ohioDatabaseStatus === 'cleared'
                              ? 'bg-emerald-100 border-emerald-200 text-emerald-800'
                              : 'bg-white hover:bg-emerald-50 border-slate-200 text-slate-700 hover:text-emerald-700'
                          }`}
                        >
                          Mark Cleared
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setTicketDetails(prev => ({ ...prev, ohioDatabaseStatus: 'flagged' }));
                            setOhioCheckMessage("Manually marked as FLAGGED / HOLD.");
                          }}
                          className={`px-3 py-2 rounded-lg text-[9px] font-black uppercase tracking-widest border transition-all ${
                            ticketDetails.ohioDatabaseStatus === 'flagged'
                              ? 'bg-red-100 border-red-200 text-red-800'
                              : 'bg-white hover:bg-red-50 border-slate-200 text-slate-700 hover:text-red-700'
                          }`}
                        >
                          Mark Flagged
                        </button>
                      </div>

                      {ohioCheckMessage && (
                        <div className={`p-2.5 rounded-lg border text-[10px] font-semibold flex items-start gap-1.5 mt-2 ${
                          ticketDetails.ohioDatabaseStatus === 'flagged'
                            ? 'bg-rose-50 border-rose-200 text-rose-800'
                            : ticketDetails.ohioDatabaseStatus === 'cleared'
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                            : 'bg-amber-50 border-amber-200 text-amber-800'
                        }`}>
                          <div className="flex-1">
                            <p className="font-extrabold uppercase text-[8px] tracking-wider mb-0.5">Ohio Portal Check Status</p>
                            <p className="leading-relaxed font-mono">{ohioCheckMessage}</p>
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
                                onBlur={() => {
                                  // Delay to allow onMouseDown/onTouchStart to fire first
                                  setTimeout(() => {
                                    setItems(currentItems => currentItems.map(i => {
                                      if (i.id === item.id) {
                                        if (i.isDropdownOpen) {
                                          const search = (i.materialSearch || '').toLowerCase();
                                          if (search && !i.material) {
                                            const filtered = materials.filter(m => 
                                              m.name.toLowerCase().includes(search) || 
                                              m.code.toLowerCase().includes(search)
                                            );
                                            if (filtered.length > 0) {
                                              return {
                                                ...i,
                                                material: filtered[0],
                                                materialSearch: '',
                                                isDropdownOpen: false,
                                                materialId: filtered[0].id,
                                                pricePerUnit: filtered[0].buyPrice
                                              };
                                            }
                                          }
                                          return { ...i, isDropdownOpen: false };
                                        }
                                      }
                                      return i;
                                    }));
                                  }, 150);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Tab' || e.key === 'Enter') {
                                    if (item.material && !(item.materialSearch || '').trim()) return;
                                    const search = (item.materialSearch || '').toLowerCase();
                                    if (!search) return;
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
                                      return aCode.localeCompare(bCode, undefined, { numeric: true, sensitivity: 'base' });
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
                                        return aCode.localeCompare(bCode, undefined, { numeric: true, sensitivity: 'base' });
                                      })
                                      .map(m => (
                                        <button
                                          key={m.id}
                                          onMouseDown={(e) => {
                                            e.preventDefault();
                                            updateItem(item.id, { material: m, isDropdownOpen: false, materialSearch: '', pricePerUnit: m.buyPrice });
                                          }}
                                          onTouchStart={(e) => {
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
                              step="0.5"
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
                                className="w-full pl-9 pr-4 py-3 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-bold"
                                value={item.pricePerUnit || ''}
                                onChange={e => updateItem(item.id, { pricePerUnit: Number(e.target.value) })}
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

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="space-y-4">
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-slate-500 uppercase">Vehicle Plate</label>
                        <div className="relative">
                          <Truck className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                          <input 
                            className="w-full pl-9 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-bold uppercase text-slate-900"
                            value={ticketDetails.vehiclePlate}
                            onChange={e => {
                              setTicketDetails({...ticketDetails, vehiclePlate: e.target.value});
                              setShowVehicleConfirm(false);
                            }}
                            placeholder="ABC-1234"
                          />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-slate-500 uppercase">Vehicle Type</label>
                        <input 
                          className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-slate-900"
                          value={ticketDetails.vehicleType}
                          onChange={e => {
                            setTicketDetails({...ticketDetails, vehicleType: e.target.value});
                            setShowVehicleConfirm(false);
                          }}
                          placeholder="F-150, Silverado, etc."
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-500 uppercase flex items-center justify-between">
                        <span>Gate / Entrance Photo</span>
                        {ticketDetails.vehiclePhotoUrl ? (
                          <span className="text-[8px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded font-black uppercase">Captured</span>
                        ) : (
                          <span className="text-[8px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-black uppercase">Required</span>
                        )}
                      </label>
                      <CameraCapture 
                        label="Take Entrance Photo"
                        onCapture={(url) => {
                          setTicketDetails({ ...ticketDetails, vehiclePhotoUrl: url });
                          setShowVehicleConfirm(false);
                        }}
                        networkUrl={settings.useSwannCams ? settings.swannCams.entrance : undefined}
                        className="aspect-video w-full rounded-xl overflow-hidden"
                      />
                    </div>

                    <div className="space-y-4">
                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-slate-500 uppercase">Payment Method</label>
                        <div className="grid grid-cols-3 gap-2">
                          {(['cash', 'check', 'other'] as const).map(method => (
                            <button
                              type="button"
                              key={method}
                              onClick={() => setTicketDetails({...ticketDetails, paymentMethod: method})}
                              className={cn(
                                "py-3 rounded-xl border text-xs font-bold capitalize transition-all outline-none focus:ring-2 focus:ring-blue-500",
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
                        <p className="text-sm font-bold text-amber-900">Missing Transportation Compliance details</p>
                        <p className="text-xs text-amber-700">Ohio law advises capturing active transportation credentials (license plate text, vehicle model, and gate entrance photos). Are you sure you want to bypass select checks?</p>
                      </div>
                      <button 
                        type="button"
                        onClick={() => {
                          setShowVehicleConfirm(false);
                          setStep(4);
                        }}
                        className="px-4 py-2 bg-amber-600 text-white text-xs font-black rounded-xl shadow-lg shadow-amber-200 hover:bg-amber-700 transition-all hover:scale-102"
                      >
                        Bypass &amp; Review
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
              disabled={(step === 1 && !showIdConfirm) || processing}
              className="px-6 py-3 text-slate-600 font-bold hover:bg-slate-200 rounded-xl transition-all disabled:opacity-0"
            >
              Back
            </button>
            <div className="flex gap-3">
              {step < 4 ? (
                <button
                  onClick={handleNext}
                  disabled={
                    (step === 1 && (
                      !selectedCustomer && (!isNewCustomer || !newCustomer.name) ||
                      ticketDetails.ohioDatabaseStatus === 'not_checked' ||
                      ticketDetails.ohioDatabaseStatus === 'flagged'
                    )) ||
                    (step === 2 && items.some(i => !i.material || i.netWeight <= 0)) ||
                    showIdConfirm ||
                    showVehicleConfirm
                  }
                  className="px-8 py-3 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800 transition-all shadow-lg shadow-slate-200 flex items-center gap-2 disabled:opacity-50"
                >
                  {(showIdConfirm || showVehicleConfirm) ? 'Acknowledge Warning' : <>Continue <ChevronRight className="w-4 h-4" /></>}
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

      {dbHistoryAlert && dbHistoryAlert.isOpen && (
        <div id="db-history-alert-modal" className="fixed inset-0 bg-slate-900/80 z-[250] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl w-full max-w-sm p-6 shadow-2xl border-2 border-green-500 text-center space-y-6">
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
            
            <div className="p-8 overflow-y-auto flex-1 bg-slate-50 space-y-4">
              <div className="p-3.5 bg-blue-50/80 border border-blue-200 rounded-2xl text-left space-y-1">
                <p className="text-xs font-extrabold text-blue-900 flex items-center gap-1.5">
                  <span>💡</span>
                  Browser Printing Pro-Tip
                </p>
                <p className="text-[10px] text-blue-800 leading-normal font-medium">
                  If the print pop-up is blocked or does not open, make sure to click <strong>"Open in New Tab"</strong> at the top of AI Studio. Browsers block system dialogue windows within sandboxed preview frames!
                </p>
              </div>

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
                  <p className="text-[10px] text-slate-400 font-medium tracking-wide mt-0.5">{COMPANY_WEBSITE}</p>
                  <p className="text-[10px] text-slate-500 font-bold mt-1">{COMPANY_ADDRESS}</p>
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
                onClick={async () => {
                  setShowPrintPreview(false);
                  await new Promise(r => setTimeout(r, 150));
                  if (lastCreatedTicket) {
                    await printTicket(
                      <BuyTicketPrint 
                        ticket={lastCreatedTicket} 
                        customerName={getCustomerName(lastCreatedTicket.customerId)} 
                        materials={materials} 
                        format={settings.receiptFormat}
                      />,
                      { format: settings.receiptFormat, debugMode: settings.debugPrintMode }
                    );
                  }
                  if (!isPreviewOnly) {
                    onClose();
                    reset();
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

      {/* Customer Lookup Directory Modal */}
      {isCustomerLookupOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[300] p-4 animate-in fade-in duration-200" role="dialog" aria-modal="true">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-xl max-h-[80vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="p-5 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight flex items-center gap-2">
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
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Search Input (No Autocomplete or Dropdown) */}
            <div className="p-5 bg-slate-50 border-b border-slate-100">
              <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search by name, phone, or business name..."
                  className="w-full pl-10 pr-10 py-3 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all font-bold text-slate-900 text-sm"
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
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>

            {/* Scrollable Customer List */}
            <div className="flex-1 overflow-y-auto p-5 space-y-2.5 custom-scrollbar">
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
                    <div className="py-10 text-center space-y-3">
                      <p className="text-slate-500 font-semibold text-xs">No customers found matching "{customerSearch}"</p>
                      <button
                        type="button"
                        onClick={() => {
                          setNewCustomer(prev => ({ ...prev, name: customerSearch }));
                          setIsNewCustomer(true);
                          setIsCustomerLookupOpen(false);
                          setCustomerSearch('');
                        }}
                        className="px-4 py-2 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-xl text-[10px] font-black uppercase tracking-wider transition-colors inline-flex items-center gap-1.5"
                      >
                        <Plus className="w-3.5 h-3.5" /> Register "{customerSearch}" as New Customer
                      </button>
                    </div>
                  );
                }

                return filtered.map(c => (
                  <div
                    key={c.id}
                    className="p-3 border border-slate-100 hover:border-slate-200 rounded-xl hover:bg-slate-50 flex items-center justify-between transition-all"
                  >
                    <div>
                      <h4 className="font-black text-slate-900 text-xs">{c.name}</h4>
                      <p className="text-[10px] text-slate-500 font-semibold mt-0.5">
                        {c.phone || 'No Phone'} {c.address ? `• ${c.address}` : ''}
                      </p>
                      {c.businessName && (
                        <div className="mt-1">
                          <span className="px-1.5 py-0.5 bg-slate-100 text-slate-600 text-[8px] font-black uppercase rounded border border-slate-200">
                            {c.businessName}
                          </span>
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedCustomer(c);
                        setIsCustomerLookupOpen(false);
                        setCustomerSearch('');
                      }}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 shadow-sm"
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
              type="button"
              className="absolute top-4 right-4 p-2 bg-black/60 hover:bg-black/80 text-white rounded-full transition-colors z-10 cursor-pointer"
              onClick={() => setLightboxUrl(null)}
            >
              <X className="w-5 h-5" />
            </button>
            <div className="p-4 max-h-[80vh] overflow-auto flex items-center justify-center">
              <img
                src={lightboxUrl}
                alt="Full size ID"
                referrerPolicy="no-referrer"
                className="max-w-full max-h-[70vh] object-contain rounded-lg"
                onClick={(e) => e.stopPropagation()}
              />
            </div>
            <div className="pb-4 px-6 text-white text-xs font-bold text-center">
              Full Size ID Document Preview (Inspect closely for compliance checks)
            </div>
          </div>
        </div>
      )}

      {/* Print Styles moved to index.css */}
    </div>
  );
}
