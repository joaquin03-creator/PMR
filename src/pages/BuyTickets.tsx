import { useState, useEffect } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { auth, db } from '../firebase';
import { collection, onSnapshot, addDoc, doc, getDoc, getDocFromCache, updateDoc, increment, setDoc, query, where, orderBy, limit, getDocs, deleteDoc } from 'firebase/firestore';
import { Material, Customer, BuyTicket, BuyTicketMaterial, InventoryItem, UserProfile, DoNotBuyEntry } from '../types';
import { COMPANY_NAME, COMPANY_ADDRESS, COMPANY_PHONE, COMPANY_WEBSITE, handleImageError } from '../constants';
import { BrandLogo } from '../components/BrandLogo';
import { 
  Search, 
  Scale, 
  User, 
  DollarSign, 
  CheckCircle2, 
  Database,
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
  ArrowRightLeft,
  Fingerprint,
  Check,
  ExternalLink,
  Copy,
  Clock
} from 'lucide-react';
import { cn, generateTicketId } from '../lib/utils';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';
import { logAuditEvent } from '../lib/audit';
import { useToast } from '../context/ToastContext';
import { isCatalyticConverterMat, checkCatalyticConverterLimit } from '../lib/catalyticUtils';
import ManagerPinModal from '../components/ManagerPinModal';
import { ScaleCaptureButton } from '../components/ScaleCaptureButton';
import { CameraCapture } from '../components/CameraCapture';
import SignaturePad from '../components/SignaturePad';
import { useIDScanner } from '../hooks/useIDScanner';
import { useSettings } from '../context/SettingsContext';
import { roundNetWeight } from '../lib/weightUtils';
import { Scan, QrCode } from 'lucide-react';
import { printTicket } from '../lib/printTicket';
import BuyTicketPrint from '../components/BuyTicketPrint';
import USBBarcodeScannerModal from '../components/USBBarcodeScannerModal';

interface BuyTicketsProps {
  profile: UserProfile | null;
}

export default function BuyTickets({ profile }: BuyTicketsProps) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const editTicketId = searchParams.get("edit");
  const isEditing = !!editTicketId;
  const [originalTicket, setOriginalTicket] = useState<BuyTicket | null>(null);
  const { firestore, local, error: toastError, info } = useToast();
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
    secondaryPhone: '',
    email: '',
    address: '', 
    businessName: '',
    idType: '',
    idNumber: '',
    idExpiration: ''
  });
  const [isNewCustomer, setIsNewCustomer] = useState(false);
  const [customerSearch, setCustomerSearch] = useState('');
  const [isCustomerLookupOpen, setIsCustomerLookupOpen] = useState(false);
  const [isUSBScannerOpen, setIsUSBScannerOpen] = useState(false);
  const [usbScanFeedback, setUsbScanFeedback] = useState<{ type: 'success' | 'new', message: string } | null>(null);

  const handleUSBScanSuccess = (result: {
    name: string;
    idNumber: string;
    address: string;
    idType: string;
    idExpiration: string;
  }) => {
    const existing = customers.find(c => c.idNumber && c.idNumber.replace(/[^A-Za-z0-9]/g, '').toUpperCase() === result.idNumber.replace(/[^A-Za-z0-9]/g, '').toUpperCase());
    
    if (existing) {
      setSelectedCustomer(existing);
      setIsNewCustomer(false);
      setUsbScanFeedback({
        type: 'success',
        message: `Selected existing customer: ${existing.name}`
      });
    } else {
      setIsNewCustomer(true);
      setNewCustomer({
        name: result.name,
        phone: '',
        secondaryPhone: '',
        email: '',
        address: result.address,
        businessName: '',
        idType: "Driver's License",
        idNumber: result.idNumber,
        idExpiration: result.idExpiration
      });
      setUsbScanFeedback({
        type: 'new',
        message: `Scanned DL for new customer: ${result.name}. Review fields and click save!`
      });
    }
    
    setTimeout(() => {
      setUsbScanFeedback(null);
    }, 6000);
  };
  
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
    customTimestamp: '',
    customerPhotoUrl: '',
    idImageUrl: '',
    vehiclePhotoUrl: '',
    signatureUrl: '',
    sellerAffirmed: false,
    ohioDatabaseStatus: 'not_checked' as 'not_checked' | 'cleared' | 'flagged'
  });

  const [pastVehicles, setPastVehicles] = useState<{
    plate: string;
    type: string;
    year: string;
    make: string;
    model: string;
    photoUrl: string;
  }[]>([]);

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
      console.error("Error performing AI OCR on ID:", error);
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
          idNumber: idNum || selectedCustomer?.idNumber || newCustomer.idNumber || ''
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
      console.error("Error executing auto Ohio check:", err);
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

  const [success, setSuccess] = useState(false);
  const [verificationStatus, setVerificationStatus] = useState<'idle' | 'verifying' | 'verified' | 'failed' | 'offline-saved'>('idle');
  const [lastCreatedTicket, setLastCreatedTicket] = useState<BuyTicket | null>(null);
  const [showPrintPreview, setShowPrintPreview] = useState(false);
  const [printFormat, setPrintFormat] = useState<'letter' | 'thermal'>('letter');
  
  useEffect(() => {
    if (settings.receiptFormat) {
      setPrintFormat(settings.receiptFormat);
    }
  }, [settings.receiptFormat, showPrintPreview]);

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

  // Draft and auto-save state
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [drafts, setDrafts] = useState<any[]>([]);

  // Auto-print effect
  useEffect(() => {
    if (success && settings.autoPrint && lastCreatedTicket) {
      setShowPrintPreview(true);
    }
  }, [success, settings.autoPrint, lastCreatedTicket]);

  // Subscribe to user's drafts
  useEffect(() => {
    if (!auth.currentUser) return;
    const qDrafts = query(
      collection(db, 'ticketDrafts'),
      where('userId', '==', auth.currentUser.uid)
    );
    const unsubDrafts = onSnapshot(qDrafts, (snapshot) => {
      setDrafts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'ticketDrafts'));
    return () => {
      try {
        unsubDrafts();
      } catch (e) {
        console.warn('unsubDrafts error', e);
      }
    };
  }, [profile]);

  // Load a draft
  const resumeDraft = async (draftId: string) => {
    try {
      const docRef = doc(db, 'ticketDrafts', draftId);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        const draft = docSnap.data();
        setStep(draft.step || 1);
        setSelectedCustomer(draft.selectedCustomer);
        setIsNewCustomer(draft.isNewCustomer || false);
        if (draft.newCustomer) {
          setNewCustomer(draft.newCustomer);
        }
        if (draft.items && materials.length > 0) {
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
        setActiveDraftId(draftId);
        setSaveStatus('saved');
      }
    } catch (err) {
      console.error("Error loading draft:", err);
    }
  };

  // Auto-save logic
  const saveDraftToFirestore = async () => {
    if (!auth.currentUser) return;
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
          signatureUrl: ticketDetails.signatureUrl || ''
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
      local(
        'Draft Autosaved',
        `Ticket Draft successfully backed up and synchronized with Cloud Firestore.`
      );
    } catch (err: any) {
      console.error("Error saving robust draft:", err);
      setSaveStatus('error');
      toastError('Draft Autosave Failed', `Failed to back up ticket draft: ${err.message || err}`);
    }
  };

  useEffect(() => {
    if (loading || success || processing) return;

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
  }, [step, selectedCustomer, newCustomer, items, ticketDetails, isNewCustomer]);

  const totalAmount = items.reduce((sum, i) => sum + i.totalAmount, 0);
  const totalWeight = items.reduce((sum, i) => sum + i.netWeight, 0);

  useEffect(() => {
    if (!auth.currentUser) return;

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
  }, [profile]);

  // Global Keyboard Shortcuts for rapid ticket creation
  useEffect(() => {
    const handleGlobalShortcuts = (e: KeyboardEvent) => {
      if (success || processing) return;

      const isInput = e.target instanceof HTMLInputElement || 
                      e.target instanceof HTMLTextAreaElement || 
                      (e.target as HTMLElement).isContentEditable;
      
      // If inside an input, only allow Ctrl + Enter shortcut
      if (isInput) {
        const isCtrlEnter = e.ctrlKey && e.key === 'Enter';
        if (!isCtrlEnter) return;
      }

      // Ctrl + Enter or Alt + N to advance step / complete
      if ((e.ctrlKey && e.key === 'Enter') || (e.altKey && e.key.toLowerCase() === 'n')) {
        e.preventDefault();
        if (step < 4) {
          const isNextDisabled = 
            (step === 1 && !selectedCustomer && (!isNewCustomer || !newCustomer.name)) ||
            (step === 2 && items.some(i => !i.material || i.netWeight <= 0)) ||
            showIdConfirm ||
            showVehicleConfirm;
          if (!isNextDisabled) {
            handleNext();
          }
        } else {
          handleSubmit();
        }
      }

      // Alt + B for Back Step
      if (e.altKey && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        if (step > 1) {
          setShowVehicleConfirm(false);
          setShowIdConfirm(false);
          setStep(step - 1);
        }
      }

      // Ctrl + I to add line item on Step 2
      if (e.ctrlKey && e.key.toLowerCase() === 'i') {
        if (step === 2) {
          e.preventDefault();
          addItem();
        }
      }
    };

    window.addEventListener('keydown', handleGlobalShortcuts);
    return () => window.removeEventListener('keydown', handleGlobalShortcuts);
  }, [step, selectedCustomer, isNewCustomer, newCustomer, items, showIdConfirm, showVehicleConfirm, processing, success]);

  // Recall last vehicle and compliance details for customer
  useEffect(() => {
    if (selectedCustomer) {
      // Initialize from customer profile first
      setTicketDetails(prev => ({
        ...prev,
        customerPhotoUrl: selectedCustomer.photoUrl || prev.customerPhotoUrl || '',
        idImageUrl: selectedCustomer.idImageUrl || prev.idImageUrl || '',
        vehiclePlate: selectedCustomer.vehiclePlate || prev.vehiclePlate || '',
        vehicleType: selectedCustomer.vehicleType || prev.vehicleType || '',
        vehicleYear: selectedCustomer.vehicleYear || prev.vehicleYear || '',
        vehicleMake: selectedCustomer.vehicleMake || prev.vehicleMake || '',
        vehicleModel: selectedCustomer.vehicleModel || prev.vehicleModel || '',
        vehiclePhotoUrl: selectedCustomer.vehiclePhotoUrl || prev.vehiclePhotoUrl || '',
      }));

      const fetchLastVehicle = async () => {
        try {
          const ticketsRef = collection(db, 'buyTickets');
          const q = query(
            ticketsRef, 
            where('customerId', '==', selectedCustomer.id)
          );
          const querySnapshot = await getDocs(q);
          
          // Find the most recent non-empty values for each field, using the Customer profile as primary source
          let vehiclePlate = selectedCustomer.vehiclePlate || '';
          let vehicleType = selectedCustomer.vehicleType || '';
          let vehicleYear = selectedCustomer.vehicleYear || '';
          let vehicleMake = selectedCustomer.vehicleMake || '';
          let vehicleModel = selectedCustomer.vehicleModel || '';
          let vehiclePhotoUrl = selectedCustomer.vehiclePhotoUrl || '';
          let paymentMethod: 'cash' | 'check' | 'eft' | 'other' | undefined;
          let idImageUrl = selectedCustomer.idImageUrl || '';
          let customerPhotoUrl = selectedCustomer.photoUrl || '';
          let signatureUrl = '';

          // Load other contact & compliance fields from past tickets if they are blank on current profile
          let phone = selectedCustomer.phone || '';
          let secondaryPhone = selectedCustomer.secondaryPhone || '';
          let email = selectedCustomer.email || '';
          let address = selectedCustomer.address || '';
          let businessName = selectedCustomer.businessName || '';
          let idType = selectedCustomer.idType || '';
          let idNumber = selectedCustomer.idNumber || '';
          let idExpiration = selectedCustomer.idExpiration || '';

          // Gather unique historical vehicles
          const uniqueVehiclesMap = new Map<string, { plate: string; type: string; year: string; make: string; model: string; photoUrl: string }>();

          // Add current profile vehicle if present
          if (selectedCustomer.vehiclePlate) {
            uniqueVehiclesMap.set(selectedCustomer.vehiclePlate.toUpperCase().trim(), {
              plate: selectedCustomer.vehiclePlate,
              type: selectedCustomer.vehicleType || '',
              year: selectedCustomer.vehicleYear || '',
              make: selectedCustomer.vehicleMake || '',
              model: selectedCustomer.vehicleModel || '',
              photoUrl: selectedCustomer.vehiclePhotoUrl || '',
            });
          }

          if (!querySnapshot.empty) {
            // Sort in-memory to avoid needing a Firestore composite index
            const tickets = querySnapshot.docs
              .map(doc => doc.data() as BuyTicket)
              .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
            
            for (const ticket of tickets) {
              const t = ticket as any;
              if (!vehiclePlate && ticket.vehiclePlate) vehiclePlate = ticket.vehiclePlate;
              if (!vehicleType && ticket.vehicleType) vehicleType = ticket.vehicleType;
              if (!vehicleYear && ticket.vehicleYear) vehicleYear = ticket.vehicleYear;
              if (!vehicleMake && ticket.vehicleMake) vehicleMake = ticket.vehicleMake;
              if (!vehicleModel && ticket.vehicleModel) vehicleModel = ticket.vehicleModel;
              if (!vehiclePhotoUrl && ticket.vehiclePhotoUrl) vehiclePhotoUrl = ticket.vehiclePhotoUrl;
              if (!paymentMethod && ticket.paymentMethod) paymentMethod = ticket.paymentMethod;
              if (!idImageUrl && ticket.idImageUrl) idImageUrl = ticket.idImageUrl;
              if (!customerPhotoUrl && ticket.customerPhotoUrl) customerPhotoUrl = ticket.customerPhotoUrl;
              if (!signatureUrl && ticket.signatureUrl) signatureUrl = ticket.signatureUrl;

              // Pull missing compliance and contact details from the most recent tickets that have them
              if (!phone && t.phone) phone = t.phone;
              if (!secondaryPhone && t.secondaryPhone) secondaryPhone = t.secondaryPhone;
              if (!email && t.email) email = t.email;
              if (!address && t.address) address = t.address;
              if (!businessName && t.businessName) businessName = t.businessName;
              if (!idType && t.idType) idType = t.idType;
              if (!idNumber && t.idNumber) idNumber = t.idNumber;
              if (!idExpiration && t.idExpiration) idExpiration = t.idExpiration;

              // Extract unique vehicles from past tickets
              if (ticket.vehiclePlate) {
                const plateKey = ticket.vehiclePlate.toUpperCase().trim();
                if (!uniqueVehiclesMap.has(plateKey)) {
                  uniqueVehiclesMap.set(plateKey, {
                    plate: ticket.vehiclePlate,
                    type: ticket.vehicleType || '',
                    year: ticket.vehicleYear || '',
                    make: ticket.vehicleMake || '',
                    model: ticket.vehicleModel || '',
                    photoUrl: ticket.vehiclePhotoUrl || '',
                  });
                }
              }
            }
          }

          // Update state with historical vehicles list
          setPastVehicles(Array.from(uniqueVehiclesMap.values()));

          setTicketDetails(prev => ({
            ...prev,
            vehiclePlate: vehiclePlate || prev.vehiclePlate || '',
            vehicleType: vehicleType || prev.vehicleType || '',
            vehicleYear: vehicleYear || prev.vehicleYear || '',
            vehicleMake: vehicleMake || prev.vehicleMake || '',
            vehicleModel: vehicleModel || prev.vehicleModel || '',
            vehiclePhotoUrl: vehiclePhotoUrl || prev.vehiclePhotoUrl || '',
            paymentMethod: paymentMethod || prev.paymentMethod || 'cash',
            idImageUrl: idImageUrl || prev.idImageUrl || '',
            customerPhotoUrl: customerPhotoUrl || prev.customerPhotoUrl || '',
            signatureUrl: signatureUrl || prev.signatureUrl || '',
          }));

          // Proactively enrich customer profile if it is missing any of the retrieved values
          const profileUpdates: any = {};
          if (!selectedCustomer.photoUrl && customerPhotoUrl) profileUpdates.photoUrl = customerPhotoUrl;
          if (!selectedCustomer.idImageUrl && idImageUrl) profileUpdates.idImageUrl = idImageUrl;
          if (!selectedCustomer.vehiclePlate && vehiclePlate) profileUpdates.vehiclePlate = vehiclePlate;
          if (!selectedCustomer.vehicleType && vehicleType) profileUpdates.vehicleType = vehicleType;
          if (!selectedCustomer.vehicleYear && vehicleYear) profileUpdates.vehicleYear = vehicleYear;
          if (!selectedCustomer.vehicleMake && vehicleMake) profileUpdates.vehicleMake = vehicleMake;
          if (!selectedCustomer.vehicleModel && vehicleModel) profileUpdates.vehicleModel = vehicleModel;
          if (!selectedCustomer.vehiclePhotoUrl && vehiclePhotoUrl) profileUpdates.vehiclePhotoUrl = vehiclePhotoUrl;

          if (!selectedCustomer.phone && phone) profileUpdates.phone = phone;
          if (!selectedCustomer.secondaryPhone && secondaryPhone) profileUpdates.secondaryPhone = secondaryPhone;
          if (!selectedCustomer.email && email) profileUpdates.email = email;
          if (!selectedCustomer.address && address) profileUpdates.address = address;
          if (!selectedCustomer.businessName && businessName) profileUpdates.businessName = businessName;
          if (!selectedCustomer.idType && idType) profileUpdates.idType = idType;
          if (!selectedCustomer.idNumber && idNumber) profileUpdates.idNumber = idNumber;
          if (!selectedCustomer.idExpiration && idExpiration) profileUpdates.idExpiration = idExpiration;

          if (Object.keys(profileUpdates).length > 0) {
            await updateDoc(doc(db, 'customers', selectedCustomer.id), {
              ...profileUpdates,
              updatedAt: new Date().toISOString()
            });
            // Update selectedCustomer locally as well so that the current session state reflects it
            setSelectedCustomer(prev => prev ? { ...prev, ...profileUpdates } : null);
          }
        } catch (error) {
          console.error("Error fetching last vehicle:", error);
        }
      };
      fetchLastVehicle();
    } else {
      setPastVehicles([]);
    }
  }, [selectedCustomer?.id]);

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
      timestamp: ticketDetails.customTimestamp ? new Date(ticketDetails.customTimestamp).toISOString() : new Date().toISOString(),
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
        if (updates.material) {
          updated.materialId = updates.material.id;
          updated.pricePerUnit = updates.material.buyPrice;
        }
        return calculateItem(updated);
      }
      return i;
    }));
  };

  const handleNext = async () => {
    if (step === 1) {
      if (!selectedCustomer && (!isNewCustomer || !newCustomer.name)) return;
      const nameToCheck = selectedCustomer?.name || newCustomer.name;
      const match = doNotBuyList.find(entry => entry.name.toLowerCase() === nameToCheck.toLowerCase());
      
      if (match) {
        setIdCheckResult({ prohibited: true, reason: match.reason });
        return; // Block proceeding if prohibited
      }
      
      // Compliance check: government ID copy photo captured
      if (!ticketDetails.idImageUrl && !showIdConfirm) {
        setShowIdConfirm(true);
        return;
      }
      
      setShowIdConfirm(false);
      setIdCheckResult({ prohibited: false });
      setStep(2);
    } else if (step === 2) {
      if (items.some(i => !i.material || i.netWeight <= 0)) return;

      const sellerIdNum = isNewCustomer ? (newCustomer.idNumber || '') : (selectedCustomer?.idNumber || '');
      const bName = isNewCustomer ? (newCustomer.businessName || '') : (selectedCustomer?.businessName || '');

      const catalyticCheck = await checkCatalyticConverterLimit(
        items,
        materials,
        sellerIdNum,
        bName,
        db,
        selectedCustomer?.id,
        customers
      );

      if (!catalyticCheck.allowed) {
        alert(catalyticCheck.errorMessage);
        return;
      }

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

  const handleSubmit = async () => {
    const hasOverrides = items.some(item => {
      const originalPrice = item.material?.buyPrice || 0;
      const newPrice = item.pricePerUnit;
      const diff = Math.abs(newPrice - originalPrice);
      // Only require manager pin if override is more than 12% of material's price
      return originalPrice === 0 ? (diff > 0) : (diff / originalPrice > 0.12);
    });

    const anyAdjustments = items.some(item => {
      const originalPrice = item.material?.buyPrice || 0;
      return item.pricePerUnit !== originalPrice;
    });

    const restrictRetroactive = profile?.role === 'cashier' && !profile?.permissions?.canRetroactivePriceAdjustments;

    if ((hasOverrides || (restrictRetroactive && anyAdjustments)) && profile?.role === 'cashier') {
      setShowPinModal(true);
      return;
    }
    await saveTicket();
  };

  const saveTicket = async () => {
    setProcessing(true);
    try {
      const sellerIdNum = isNewCustomer ? (newCustomer.idNumber || '') : (selectedCustomer?.idNumber || '');
      const bName = isNewCustomer ? (newCustomer.businessName || '') : (selectedCustomer?.businessName || '');

      const catalyticCheck = await checkCatalyticConverterLimit(
        items,
        materials,
        sellerIdNum,
        bName,
        db,
        selectedCustomer?.id,
        customers
      );

      if (!catalyticCheck.allowed) {
        alert(catalyticCheck.errorMessage);
        setProcessing(false);
        return;
      }

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

      const ticketData: Omit<BuyTicket, 'id'> & { [key: string]: any } = {
        customerId,
        materials: ticketMaterials,
        totalAmount,
        status: 'completed',
        timestamp: ticketDetails.customTimestamp ? new Date(ticketDetails.customTimestamp).toISOString() : new Date().toISOString(),
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
        sellerAffirmed: ticketDetails.sellerAffirmed,
        ohioDatabaseStatus: ticketDetails.ohioDatabaseStatus || 'not_checked',
        createdBy: profile?.uid || '',
        createdByName: profile?.displayName || profile?.email || 'System',

        // Snapshot of customer details for compliance and future ticket loading
        phone: isNewCustomer ? (newCustomer.phone || '') : (selectedCustomer?.phone || ''),
        secondaryPhone: isNewCustomer ? (newCustomer.secondaryPhone || '') : (selectedCustomer?.secondaryPhone || ''),
        email: isNewCustomer ? (newCustomer.email || '') : (selectedCustomer?.email || ''),
        address: isNewCustomer ? (newCustomer.address || '') : (selectedCustomer?.address || ''),
        businessName: isNewCustomer ? (newCustomer.businessName || '') : (selectedCustomer?.businessName || ''),
        idType: isNewCustomer ? (newCustomer.idType || '') : (selectedCustomer?.idType || ''),
        idNumber: isNewCustomer ? (newCustomer.idNumber || '') : (selectedCustomer?.idNumber || ''),
        idExpiration: isNewCustomer ? (newCustomer.idExpiration || '') : (selectedCustomer?.idExpiration || '')
      };

      const ticketId = generateTicketId('BUY');
      const docRef = doc(db, 'buyTickets', ticketId);
      await setDoc(docRef, ticketData);
      
      // Log ticket creation
      await logAuditEvent(
        'buyTicket',
        docRef.id,
        'create',
        { after: ticketData },
        `Buy Ticket created for ${selectedCustomer?.name || 'Customer'}`
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
      if (ticketDetails.vehicleYear) customerUpdate.vehicleYear = ticketDetails.vehicleYear;
      if (ticketDetails.vehicleMake) customerUpdate.vehicleMake = ticketDetails.vehicleMake;
      if (ticketDetails.vehicleModel) customerUpdate.vehicleModel = ticketDetails.vehicleModel;
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

      for (const item of ticketMaterials) {
        const invRef = doc(db, 'inventory', item.materialId);
        let exists = false;
        let oldWeight = 0;

        try {
          // Wrap with a 1.2s timeout so we never hang if connection is flaky
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

      setVerificationStatus('verifying');
      
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

      setVerificationStatus(statusValue);
      if (activeDraftId) {
        await deleteDoc(doc(db, 'ticketDrafts', activeDraftId));
        setActiveDraftId(null);
      }
      setSuccess(true);
      
      firestore(
        'Ticket Committed',
        `Successfully finalized Ohio Compliance Buy Ticket #${docRef.id.toUpperCase()} for ${selectedCustomer?.name || newCustomer.name || 'Customer'}. Inventory updated dynamically.`
      );

      // Open the Database confirmation popup dialogue!
      setDbHistoryAlert({
        isOpen: true,
        ticketId: docRef.id,
        customerName: selectedCustomer?.name || newCustomer.name || 'Unknown Customer',
        totalAmount: totalAmount || 0,
        timestamp: new Date().toISOString()
      });
    } catch (error: any) {
      console.error('Error creating ticket:', error);
      setVerificationStatus('failed');
      toastError('Ticket Creation Failed', `Failed to commit buy ticket: ${error.message || error}`);
      handleFirestoreError(error, OperationType.CREATE, 'buyTickets');
    } finally {
      setProcessing(false);
    }
  };

  const reset = () => {
    if (activeDraftId) {
      deleteDoc(doc(db, 'ticketDrafts', activeDraftId)).catch(console.error);
      setActiveDraftId(null);
    }
    setStep(1);
    setSelectedCustomer(null);
    setNewCustomer({ name: '', phone: '', secondaryPhone: '', email: '', address: '', businessName: '', idType: '', idNumber: '', idExpiration: '' });
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
      customTimestamp: '',
      customerPhotoUrl: '', 
      idImageUrl: '',
      vehiclePhotoUrl: '',
      signatureUrl: '',
      sellerAffirmed: false,
      ohioDatabaseStatus: 'not_checked'
    });
    setSuccess(false);
    setVerificationStatus('idle');
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
        <div className={cn(
          "border rounded-3xl p-6 md:p-8 animate-in fade-in slide-in-from-top-4 space-y-6",
          verificationStatus === 'offline-saved'
            ? "bg-amber-50/50 border-amber-200"
            : "bg-green-50/50 border-green-200"
        )}>
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 border-b pb-6 border-current/10">
            <div className="flex items-start gap-4">
              <div className={cn(
                "w-12 h-12 rounded-2xl flex items-center justify-center shrink-0",
                verificationStatus === 'offline-saved'
                  ? "bg-amber-105 text-amber-600"
                  : "bg-green-100 text-green-600"
              )}>
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h3 className={cn(
                  "font-black text-xl tracking-tight",
                  verificationStatus === 'offline-saved' ? "text-amber-900" : "text-green-900"
                )}>
                  {verificationStatus === 'offline-saved' ? 'Buy Ticket Saved Locally' : 'Buy Ticket Created &amp; Verified!'}
                </h3>
                <p className={cn(
                  "text-sm font-medium",
                  verificationStatus === 'offline-saved' ? "text-amber-700/90" : "text-green-700/90"
                )}>
                  {verificationStatus === 'offline-saved'
                    ? "Saved to local offline queue. Once internet connection is restored, this ticket will automatically synchronize with cloud servers."
                    : "The buy transaction has been successfully logged, and materials inventory recalculated on the server."
                  }
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => setShowPrintPreview(true)}
                className="px-6 py-3 bg-slate-900 text-white rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-slate-800 transition-all shadow-md active:scale-95 text-xs uppercase tracking-wider"
              >
                <Printer className="w-4 h-4" />
                Print Ticket Receipt
              </button>
              <button
                onClick={reset}
                className="px-6 py-3 bg-white border border-slate-200 text-slate-700 rounded-xl font-bold hover:bg-slate-50 transition-all shadow-sm active:scale-95 text-xs uppercase tracking-wider"
              >
                Create New Ticket
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className={cn(
              "p-4 rounded-2xl border space-y-1 shadow-xs",
              verificationStatus === 'offline-saved'
                ? "bg-white border-amber-100"
                : "bg-white border-green-100"
            )}>
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Sync Status</span>
              <p className="text-sm font-bold flex items-center gap-1.5 pt-1">
                {verificationStatus === 'verifying' && (
                  <>
                    <Loader2 className="w-4 h-4 text-amber-500 animate-spin" />
                    <span className="text-amber-800 font-black">Verifying...</span>
                  </>
                )}
                {verificationStatus === 'verified' && (
                  <>
                    <span className="w-2 h-2 bg-green-500 rounded-full inline-block animate-pulse" />
                    <span className="text-green-800 font-black">Verified &amp; Stored</span>
                  </>
                )}
                {verificationStatus === 'offline-saved' && (
                  <>
                    <span className="w-2 h-2 bg-amber-500 rounded-full inline-block animate-pulse" />
                    <span className="text-amber-800 font-black">Saved Offline</span>
                  </>
                )}
                {verificationStatus === 'failed' && (
                  <>
                    <span className="text-red-500">✕</span>
                    <span className="text-red-800 font-black">Unconfirmed</span>
                  </>
                )}
              </p>
            </div>

            <div className={cn(
              "p-4 rounded-2xl border space-y-1 shadow-xs",
              verificationStatus === 'offline-saved'
                ? "bg-white border-amber-100"
                : "bg-white border-green-100"
            )}>
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Ticket ID</span>
              <p className="text-sm font-mono font-bold text-slate-800 break-all pt-1">
                {lastCreatedTicket?.id || 'Saving...'}
              </p>
            </div>

            <div className={cn(
              "p-4 rounded-2xl border space-y-1 shadow-xs",
              verificationStatus === 'offline-saved'
                ? "bg-white border-amber-100"
                : "bg-white border-green-100"
            )}>
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Customer</span>
              <p className="text-sm font-bold text-slate-800 pt-1 truncate">
                {selectedCustomer?.name || newCustomer.name || 'Unknown'}
              </p>
            </div>

            <div className={cn(
              "p-4 rounded-2xl border space-y-1 shadow-xs",
              verificationStatus === 'offline-saved'
                ? "bg-white border-amber-100"
                : "bg-white border-green-100"
            )}>
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Total Payout</span>
              <p className="text-sm font-black text-green-600 pt-1">
                ${totalAmount.toFixed(2)}
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          {/* Ohio Scrap Metal Purchase Act (ORC 4737.04) Compliance watchdog */}
          {!success && (
            <div className="bg-slate-900 text-slate-100 p-5 rounded-[2rem] border border-slate-800 shadow-xl space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/60 pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="p-1.5 bg-emerald-500/10 text-emerald-400 rounded-lg">
                    <ShieldCheck className="w-5 h-5 text-emerald-400 font-bold" />
                  </div>
                  <div>
                    <h4 className="text-[10px] font-black uppercase tracking-wider text-slate-200 font-display">Ohio Compliance Guard</h4>
                    <p className="text-[9px] text-slate-400 font-bold leading-tight">ORC § 4737.04 Scrap metal Purchasing Act</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[9px] font-bold text-slate-400">NVR feeds:</span>
                  <span className={cn(
                    "px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-wider",
                    settings.useSwannCams ? "bg-emerald-950/80 text-emerald-400 border border-emerald-900" : "bg-amber-950/80 text-amber-500 border border-amber-900"
                  )}>
                    {settings.useSwannCams ? "IP CAMS ACTIVE" : "CAMS BYPASSED"}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* 1. SELLER IDENTITY CHECK */}
                <div className={cn(
                  "p-3 rounded-xl border transition-all space-y-2",
                  (selectedCustomer || (isNewCustomer && newCustomer.name)) && (ticketDetails.idImageUrl || ticketDetails.customerPhotoUrl)
                    ? "bg-emerald-950/30 border-emerald-800/60"
                    : "bg-slate-950/35 border-slate-800/80"
                )}>
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] font-black uppercase tracking-wider text-slate-300 font-display">1. Individual Seller</span>
                    {((selectedCustomer || (isNewCustomer && newCustomer.name)) && (ticketDetails.idImageUrl || ticketDetails.customerPhotoUrl)) ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    ) : (
                      <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0 animate-pulse" />
                    )}
                  </div>
                  <ul className="text-[9px] text-slate-400 font-medium space-y-1">
                    <li className="flex items-center gap-1.5">
                      <span className={cn("w-1 h-1 rounded-full shrink-0", (selectedCustomer || (isNewCustomer && newCustomer.name)) ? "bg-emerald-400" : "bg-slate-600")} />
                      Credentials: {(selectedCustomer?.name || (isNewCustomer && newCustomer.name)) ? <span className="text-slate-200">Captured</span> : <span className="text-rose-400">Required</span>}
                    </li>
                    <li className="flex items-center gap-1.5">
                      <span className={cn("w-1 h-1 rounded-full shrink-0", (ticketDetails.idImageUrl || ticketDetails.customerPhotoUrl) ? "bg-emerald-400" : "bg-slate-600")} />
                      Seller Photo: {(ticketDetails.idImageUrl || ticketDetails.customerPhotoUrl) ? <span className="text-slate-200">Captured</span> : <span className="text-rose-400">Capture (Face/ID)</span>}
                    </li>
                  </ul>
                </div>

                {/* 2. MATERIAL DESCRIPTION CONTROLS */}
                <div className={cn(
                  "p-3 rounded-xl border transition-all space-y-2",
                  items.length > 0 && items.every(i => i.material && i.netWeight > 0)
                    ? "bg-emerald-950/30 border-emerald-800/60"
                    : "bg-slate-950/35 border-slate-800/80"
                )}>
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] font-black uppercase tracking-wider text-slate-300 font-display">2. Purchased metals</span>
                    {(items.length > 0 && items.every(i => i.material && i.netWeight > 0)) ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    ) : (
                      <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                    )}
                  </div>
                  <ul className="text-[9px] text-slate-400 font-medium space-y-1">
                    <li className="flex items-center gap-1.5">
                      <span className={cn("w-1 h-1 rounded-full shrink-0", items.length > 0 ? "bg-emerald-400" : "bg-slate-600")} />
                      Line Items: {items.length > 0 ? <span className="text-slate-200">{items.length} Added</span> : <span className="text-rose-400">Empty</span>}
                    </li>
                    <li className="flex items-center gap-1.5">
                      <span className={cn("w-1 h-1 rounded-full shrink-0", (items.length > 0 && items.every(i => i.netWeight > 0)) ? "bg-emerald-400" : "bg-slate-600")} />
                      Scale weights: {(items.length > 0 && items.every(i => i.netWeight > 0)) ? <span className="text-slate-200">Recorded</span> : <span className="text-rose-400">Wait weighing...</span>}
                    </li>
                  </ul>
                </div>

                {/* 3. VEHICLE TRACKING IDENTITY */}
                <div className={cn(
                  "p-3 rounded-xl border transition-all space-y-2",
                  ticketDetails.vehiclePlate && ticketDetails.vehiclePhotoUrl
                    ? "bg-emerald-950/30 border-emerald-800/60"
                    : "bg-slate-950/35 border-slate-800/80"
                )}>
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] font-black uppercase tracking-wider text-slate-300 font-display">3. Transport Vehicle</span>
                    {(ticketDetails.vehiclePlate && ticketDetails.vehiclePhotoUrl) ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    ) : (
                      <span className="px-1 py-0.5 bg-slate-800 text-slate-400 rounded text-[7px] font-bold">Recommended</span>
                    )}
                  </div>
                  <ul className="text-[9px] text-slate-400 font-medium space-y-1">
                    <li className="flex items-center gap-1.5">
                      <span className={cn("w-1 h-1 rounded-full shrink-0", ticketDetails.vehiclePlate ? "bg-emerald-400" : "bg-slate-600")} />
                      License Plate: {ticketDetails.vehiclePlate ? <span className="text-slate-200">{ticketDetails.vehiclePlate}</span> : <span className="text-slate-400">Not recorded</span>}
                    </li>
                    <li className="flex items-center gap-1.5">
                      <span className={cn("w-1 h-1 rounded-full shrink-0", ticketDetails.vehiclePhotoUrl ? "bg-emerald-400" : "bg-slate-600")} />
                      Entrance Cam photo: {ticketDetails.vehiclePhotoUrl ? <span className="text-slate-200">Captured</span> : <span className="text-slate-400">Not captured</span>}
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* Pending Drafts Warning/Recall Panel */}
          {step === 1 && drafts.length > 0 && (
            <div className="bg-amber-50/75 border border-amber-200 rounded-[2rem] p-8 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-black text-amber-800 uppercase tracking-wider flex items-center gap-2">
                    <AlertCircle className="w-5 h-5 text-amber-600" />
                    Pending Tickets Drawer
                  </h4>
                  <p className="text-xs text-amber-700/80 mt-1">You have unfinished drafts. Click resume to restore state, or discard to start clean.</p>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {drafts.map((d) => (
                  <div key={d.id} className="bg-white p-5 rounded-2xl border border-amber-200/60 shadow-sm flex flex-col justify-between space-y-4">
                    <div>
                      <div className="flex justify-between items-start">
                        <span className="px-2 py-1 bg-amber-100 text-amber-800 text-[10px] font-black uppercase tracking-wider rounded-lg">
                          {d.type === 'quick' ? 'Quick Ticket' : 'Robust Ticket'} (Step {d.step})
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono">
                          {d.timestamp ? new Date(d.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                        </span>
                      </div>
                      <h5 className="font-bold text-slate-800 text-sm mt-2">
                        {d.selectedCustomer?.name || d.newCustomer?.name || 'Walk-in / Unknown'}
                      </h5>
                      <p className="text-xs text-slate-400 mt-1">
                        {d.items?.length || 0} items listed
                      </p>
                    </div>
                    <div className="flex gap-2 pt-2 border-t border-slate-100">
                      <button
                        onClick={() => resumeDraft(d.id)}
                        className="flex-1 py-2 bg-slate-900 text-white rounded-xl text-xs font-bold hover:bg-slate-800 transition-all text-center"
                      >
                        Resume
                      </button>
                      <button
                        onClick={async () => {
                          if (confirm("Discard this draft?")) {
                            await deleteDoc(doc(db, 'ticketDrafts', d.id));
                            if (activeDraftId === d.id) {
                              setActiveDraftId(null);
                            }
                          }
                        }}
                        className="p-2 border border-slate-200 hover:border-red-200 hover:text-red-500 rounded-xl transition-all"
                        title="Discard Draft"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

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
                    <div className="flex flex-wrap gap-2">
                      <button 
                        type="button"
                        onClick={() => setIsUSBScannerOpen(true)}
                        className="px-4 py-2 bg-blue-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-blue-700 transition-all active:scale-95 flex items-center gap-2"
                      >
                        <QrCode className="w-3.5 h-3.5" />
                        Scan DL Barcode (USB)
                      </button>
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

              {usbScanFeedback && (
                <div className={cn(
                  "p-4 rounded-2xl border flex gap-3 items-center text-xs font-bold animate-in fade-in slide-in-from-top-2 duration-300",
                  usbScanFeedback.type === 'success' 
                    ? "bg-emerald-50 border-emerald-100 text-emerald-800" 
                    : "bg-blue-50 border-blue-100 text-blue-800"
                )}>
                  <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-500" />
                  <div>
                    <p>{usbScanFeedback.message}</p>
                  </div>
                </div>
              )}

              {!isNewCustomer && !selectedCustomer && (
                <div className="flex flex-col items-center justify-center py-12 px-6 bg-slate-50 border-2 border-dashed border-slate-200 rounded-[2rem] text-center space-y-6">
                  <div className="w-16 h-16 bg-blue-50 rounded-full flex items-center justify-center text-blue-600 shadow-inner">
                    <User className="w-8 h-8" />
                  </div>
                  <div className="max-w-md space-y-2">
                    <h4 className="font-black text-slate-900 text-lg">No Seller / Customer Selected</h4>
                    <p className="text-sm text-slate-500 font-medium leading-relaxed">
                      Please lookup a registered customer from our directory or add a new seller profile to begin.
                    </p>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-4 w-full max-w-md pt-2">
                    <button
                      type="button"
                      onClick={() => setIsCustomerLookupOpen(true)}
                      className="flex-1 px-6 py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl text-xs font-black uppercase tracking-wider shadow-md hover:shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2"
                    >
                      <Search className="w-4 h-4" />
                      Search Previous Customers
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsNewCustomer(true);
                      }}
                      className="flex-1 px-6 py-4 bg-white hover:bg-slate-50 text-slate-700 border-2 border-slate-200 hover:border-slate-300 rounded-2xl text-xs font-black uppercase tracking-wider transition-all active:scale-95 flex items-center justify-center gap-2"
                    >
                      <Plus className="w-4 h-4" />
                      Add New Customer
                    </button>
                  </div>
                </div>
              )}

              {(selectedCustomer || isNewCustomer) && (
                <div className="bg-slate-50 border border-slate-200/60 rounded-[2rem] p-6 space-y-6">
                  <div className="flex items-center justify-between border-b border-slate-200 pb-4">
                    <div>
                      <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                        {isNewCustomer ? 'New Customer Profile' : 'Active Customer Profile'}
                      </h4>
                      <p className="text-lg font-black text-slate-800 mt-0.5">
                        {isNewCustomer ? (newCustomer.name || 'Registering New Seller') : selectedCustomer?.name}
                      </p>
                    </div>
                    {!isNewCustomer && (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedCustomer(null);
                          setCustomerSearch('');
                          setIsCustomerLookupOpen(true);
                        }}
                        className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 text-[10px] font-black uppercase rounded-xl transition-all"
                      >
                        Change Customer
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    {/* General / Contact Details Section */}
                    <div className="space-y-4">
                      <h5 className="text-[10px] font-black text-blue-600 uppercase tracking-widest flex items-center gap-2">
                        <User className="w-3.5 h-3.5" /> General & Contact Details
                      </h5>
                      
                      {isNewCustomer && (
                        <div className="space-y-1">
                          <label htmlFor="cust-name-input" className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Full Name</label>
                          <input
                            id="cust-name-input"
                            className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-bold text-sm"
                            value={newCustomer.name}
                            onChange={e => setNewCustomer(prev => ({ ...prev, name: e.target.value }))}
                            placeholder="Full name of seller..."
                          />
                        </div>
                      )}

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <label htmlFor="cust-phone-input" className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Primary Phone</label>
                          <input
                            id="cust-phone-input"
                            className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-bold text-sm"
                            value={isNewCustomer ? newCustomer.phone : (selectedCustomer?.phone || '')}
                            onChange={e => {
                              const val = e.target.value;
                              if (isNewCustomer) {
                                setNewCustomer(prev => ({ ...prev, phone: val }));
                              } else {
                                setSelectedCustomer(prev => prev ? ({ ...prev, phone: val }) : null);
                              }
                            }}
                            placeholder="(555) 000-0000"
                          />
                        </div>

                        <div className="space-y-1">
                          <label htmlFor="cust-sec-phone-input" className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Secondary Phone</label>
                          <input
                            id="cust-sec-phone-input"
                            className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-bold text-sm"
                            value={isNewCustomer ? newCustomer.secondaryPhone : (selectedCustomer?.secondaryPhone || '')}
                            onChange={e => {
                              const val = e.target.value;
                              if (isNewCustomer) {
                                setNewCustomer(prev => ({ ...prev, secondaryPhone: val }));
                              } else {
                                setSelectedCustomer(prev => prev ? ({ ...prev, secondaryPhone: val }) : null);
                              }
                            }}
                            placeholder="Backup phone number..."
                          />
                        </div>
                      </div>

                      <div className="space-y-1">
                        <label htmlFor="cust-email-input" className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Email Address</label>
                        <input
                          id="cust-email-input"
                          type="email"
                          className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-bold text-sm"
                          value={isNewCustomer ? newCustomer.email : (selectedCustomer?.email || '')}
                          onChange={e => {
                            const val = e.target.value;
                            if (isNewCustomer) {
                              setNewCustomer(prev => ({ ...prev, email: val }));
                            } else {
                              setSelectedCustomer(prev => prev ? ({ ...prev, email: val }) : null);
                            }
                          }}
                          placeholder="email@example.com"
                        />
                      </div>

                      <div className="space-y-1">
                        <label htmlFor="cust-address-input" className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Street Address</label>
                        <input
                          id="cust-address-input"
                          className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-bold text-sm"
                          value={isNewCustomer ? newCustomer.address : (selectedCustomer?.address || '')}
                          onChange={e => {
                            const val = e.target.value;
                            if (isNewCustomer) {
                              setNewCustomer(prev => ({ ...prev, address: val }));
                            } else {
                              setSelectedCustomer(prev => prev ? ({ ...prev, address: val }) : null);
                            }
                          }}
                          placeholder="Street, City, State, Zip"
                        />
                      </div>

                      <div className="space-y-1">
                        <label htmlFor="cust-business-input" className="text-[10px] font-black text-slate-400 uppercase tracking-wider flex items-center justify-between">
                          <span>Business / Commercial Entity</span>
                          {items.some(i => isCatalyticConverterMat(i.material || materials.find(m => m.id === i.materialId))) && (
                            <span className="text-rose-600 font-extrabold uppercase tracking-normal">* Required for Cat Converters</span>
                          )}
                        </label>
                        <input
                          id="cust-business-input"
                          className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-bold text-sm"
                          value={isNewCustomer ? newCustomer.businessName : (selectedCustomer?.businessName || '')}
                          onChange={e => {
                            const val = e.target.value;
                            if (isNewCustomer) {
                              setNewCustomer(prev => ({ ...prev, businessName: val }));
                            } else {
                              setSelectedCustomer(prev => prev ? ({ ...prev, businessName: val }) : null);
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
                        <label htmlFor="cust-idtype-input" className="text-[10px] font-black text-slate-400 uppercase tracking-wider">ID Document Type</label>
                        <select
                          id="cust-idtype-input"
                          className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-bold text-sm"
                          value={isNewCustomer ? newCustomer.idType : (selectedCustomer?.idType || '')}
                          onChange={e => {
                            const val = e.target.value;
                            if (isNewCustomer) {
                              setNewCustomer(prev => ({ ...prev, idType: val }));
                            } else {
                              setSelectedCustomer(prev => prev ? ({ ...prev, idType: val }) : null);
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
                        <label htmlFor="cust-idnumber-input" className="text-[10px] font-black text-slate-400 uppercase tracking-wider">ID Card / DL Number</label>
                        <input
                          id="cust-idnumber-input"
                          className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-bold text-sm font-mono"
                          value={isNewCustomer ? newCustomer.idNumber : (selectedCustomer?.idNumber || '')}
                          onChange={e => {
                            const val = e.target.value;
                            if (isNewCustomer) {
                              setNewCustomer(prev => ({ ...prev, idNumber: val }));
                            } else {
                              setSelectedCustomer(prev => prev ? ({ ...prev, idNumber: val }) : null);
                            }
                          }}
                          placeholder="e.g. AA123456"
                        />
                      </div>

                      <div className="space-y-1">
                        <label htmlFor="cust-idexpiration-input" className="text-[10px] font-black text-slate-400 uppercase tracking-wider">ID Expiration Date</label>
                        <input
                          id="cust-idexpiration-input"
                          type="date"
                          className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-bold text-sm font-mono"
                          value={isNewCustomer ? newCustomer.idExpiration : (selectedCustomer?.idExpiration || '')}
                          onChange={e => {
                            const val = e.target.value;
                            if (isNewCustomer) {
                              setNewCustomer(prev => ({ ...prev, idExpiration: val }));
                            } else {
                              setSelectedCustomer(prev => prev ? ({ ...prev, idExpiration: val }) : null);
                            }
                          }}
                        />
                      </div>

                      <div className="p-4 bg-emerald-50 border border-emerald-100 rounded-2xl text-[11px] text-emerald-800 font-medium leading-relaxed space-y-1">
                        <p className="font-bold uppercase tracking-wider text-[9px] text-emerald-700">Database Synchronization Status</p>
                        <p>All compliance modifications will automatically synchronize with the persistent customer registry in Google Cloud Firestore upon completing this ticket.</p>
                      </div>
                    </div>
                  </div>
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
                      photoUrl={ticketDetails.idImageUrl}
                      onCapture={(url) => {
                        setTicketDetails({ ...ticketDetails, idImageUrl: url });
                        setShowIdConfirm(false);
                        if (url) {
                          handleReadIDFromPhoto(url);
                        }
                      }}
                      networkUrl={settings.useSwannCams ? settings.swannCams.customer : undefined}
                      className="aspect-video"
                    />
                    {isReadingID && (
                      <div className="p-4 bg-gradient-to-r from-blue-550 to-indigo-50 border border-blue-200 rounded-2xl flex items-center gap-3 animate-pulse">
                        <Loader2 className="w-5 h-5 animate-spin text-blue-600 shrink-0" />
                        <div className="flex-1">
                          <p className="text-xs font-black text-blue-900 uppercase tracking-tight">Gemini AI ID Reader</p>
                          <p className="text-[10px] text-blue-700 font-medium">Analyzing ID photo, performing OCR, and auto-filling details...</p>
                        </div>
                      </div>
                    )}
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

                {showIdConfirm && (
                  <div className="p-6 bg-amber-50/80 border border-amber-200 rounded-3xl flex gap-4 items-center animate-in zoom-in-95 duration-200 mt-6" role="alert">
                    <div className="p-3 bg-amber-100 rounded-2xl" aria-hidden="true">
                      <AlertTriangle className="w-6 h-6 text-amber-600 animate-pulse" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-black text-amber-900">Missing Government ID Photo</p>
                      <p className="text-xs text-amber-700 font-medium leading-relaxed">Under Ohio compliance law (ORC § 4737.04), a copy of the seller's government-issued ID must be captured. Are you sure you want to proceed without it?</p>
                    </div>
                    <button 
                      type="button"
                      onClick={() => {
                        setShowIdConfirm(false);
                        setIdCheckResult({ prohibited: false });
                        setStep(2);
                      }}
                      className="px-5 py-2.5 bg-amber-600 text-white text-xs font-black rounded-xl hover:bg-amber-700 transition-all shadow-lg shadow-amber-200 outline-none hover:scale-[1.02] active:scale-95"
                    >
                      Bypass & Proceed
                    </button>
                  </div>
                )}

                {/* Ohio Dept of Homeland Security Scrap Database Check */}
                {(selectedCustomer || (isNewCustomer && newCustomer.name)) && (
                  <div className="mt-8 pt-8 border-t border-slate-100 space-y-4">
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
                        <span className="px-2.5 py-1 bg-emerald-100 text-emerald-800 text-[9px] font-black uppercase rounded-full border border-emerald-200 flex items-center gap-1 font-sans">
                          <Check className="w-3 h-3" /> Cleared
                        </span>
                      ) : ticketDetails.ohioDatabaseStatus === 'flagged' ? (
                        <span className="px-2.5 py-1 bg-red-100 text-red-800 text-[9px] font-black uppercase rounded-full border border-red-200 flex items-center gap-1 font-sans">
                          <AlertTriangle className="w-3 h-3 animate-pulse" /> Flagged / Hold
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
                              const name = selectedCustomer?.name || newCustomer.name || '';
                              navigator.clipboard.writeText(name);
                            }}
                            className="flex items-center justify-between px-3 py-2 bg-white hover:bg-slate-50 rounded-xl border border-slate-200 text-left font-bold transition-all text-slate-700 w-full"
                          >
                            <span className="truncate">Name: <span className="text-slate-900 font-mono">{selectedCustomer?.name || newCustomer.name || 'N/A'}</span></span>
                            <Copy className="w-3.5 h-3.5 text-slate-400 shrink-0 ml-2" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const addressStr = selectedCustomer?.address || newCustomer.address || '';
                              navigator.clipboard.writeText(addressStr);
                            }}
                            className="flex items-center justify-between px-3 py-2 bg-white hover:bg-slate-50 rounded-xl border border-slate-200 text-left font-bold transition-all text-slate-700 w-full"
                          >
                            <span className="truncate">Address: <span className="text-slate-900 font-mono font-normal">{selectedCustomer?.address || newCustomer.address || 'N/A'}</span></span>
                            <Copy className="w-3.5 h-3.5 text-slate-400 shrink-0 ml-2" />
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => runOhioCheck()}
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
                          setTicketDetails(prev => ({ ...prev, ohioDatabaseStatus: 'cleared' }));
                          setOhioCheckMessage("Manually marked as CLEARED.");
                        }}
                        className={`px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all ${
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
                        className={`px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest border transition-all ${
                          ticketDetails.ohioDatabaseStatus === 'flagged'
                            ? 'bg-red-100 border-red-200 text-red-800'
                            : 'bg-white hover:bg-red-50 border-slate-200 text-slate-700 hover:text-red-700'
                        }`}
                      >
                        Mark Flagged
                      </button>
                    </div>

                    {ohioCheckMessage && (
                      <div className={`p-3.5 rounded-xl border text-[11px] font-semibold flex items-start gap-2 ${
                        ticketDetails.ohioDatabaseStatus === 'flagged'
                          ? 'bg-rose-50 border-rose-200 text-rose-800'
                          : ticketDetails.ohioDatabaseStatus === 'cleared'
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
                )}
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
                  <Plus className="w-4 h-4" aria-hidden="true" /> Add Item <span className="opacity-60 text-[9px] lowercase bg-blue-700 px-1 py-0.5 rounded border border-blue-500/30 font-normal">Ctrl+i</span>
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
                        {isCatalyticConverterMat(item.material || materials.find(m => m.id === item.materialId)) && (
                          <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-center gap-2.5 text-xs text-amber-900 font-medium mb-2">
                            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                            <div>
                              <span className="font-extrabold text-amber-950 uppercase tracking-wider block text-[10px]">Ohio Law Advisory (ORC 4737.04(F)(5))</span>
                              <span>Legal limit of <strong>1 catalytic converter per person per day</strong>, tied to seller's personal ID number.</span>
                            </div>
                          </div>
                        )}
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
                                if (item.material) {
                                  updateItem(item.id, { isDropdownOpen: false });
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                  }
                                  setTimeout(() => {
                                    document.getElementById(`gross-${item.id}`)?.focus();
                                  }, 50);
                                  return;
                                }
                                const search = (item.materialSearch || '').toLowerCase().trim();
                                if (!search) {
                                  updateItem(item.id, { isDropdownOpen: false });
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                  }
                                  setTimeout(() => {
                                    document.getElementById(`gross-${item.id}`)?.focus();
                                  }, 50);
                                  return;
                                }
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
                                  updateItem(item.id, { 
                                    material: m, 
                                    isDropdownOpen: false,
                                    materialSearch: '',
                                    pricePerUnit: m.buyPrice
                                  });
                                  if (e.key === 'Enter') e.preventDefault();
                                  setTimeout(() => {
                                    document.getElementById(`gross-${item.id}`)?.focus();
                                  }, 50);
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
                                    return aCode.localeCompare(bCode, undefined, { numeric: true, sensitivity: 'base' });
                                  })
                                  .map(m => (
                                    <button
                                      key={m.id}
                                      role="option"
                                      aria-selected={item.materialId === m.id}
                                      onMouseDown={(e) => {
                                        e.preventDefault();
                                        updateItem(item.id, { material: m, isDropdownOpen: false, materialSearch: '', pricePerUnit: m.buyPrice });
                                        setTimeout(() => {
                                          document.getElementById(`gross-${item.id}`)?.focus();
                                        }, 100);
                                      }}
                                      onTouchStart={(e) => {
                                        e.preventDefault();
                                        updateItem(item.id, { material: m, isDropdownOpen: false, materialSearch: '', pricePerUnit: m.buyPrice });
                                        setTimeout(() => {
                                          document.getElementById(`gross-${item.id}`)?.focus();
                                        }, 100);
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
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              document.getElementById(`tare-${item.id}`)?.focus();
                            }
                          }}
                        />
                      </div>
                      <div className="space-y-2">
                        <label htmlFor={`tare-${item.id}`} className="text-xs font-black text-slate-400 uppercase tracking-widest">Tare Weight</label>
                        <input 
                          id={`tare-${item.id}`}
                          type="number"
                          step="0.5"
                          className="w-full px-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 font-black text-xl shadow-sm"
                          value={item.tareWeight || ''}
                          onChange={e => updateItem(item.id, { tareWeight: Number(e.target.value) })}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              document.getElementById(`deduction-${item.id}`)?.focus();
                            }
                          }}
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
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              document.getElementById(`price-${item.id}`)?.focus();
                            }
                          }}
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
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                document.getElementById(`deduction-reason-${item.id}`)?.focus();
                              }
                            }}
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
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              document.getElementById(`notes-${item.id}`)?.focus();
                            }
                          }}
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
                  {pastVehicles.length > 0 && (
                    <div className="space-y-2 bg-slate-50 p-4 rounded-2xl border border-slate-100">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Choose From Registered Vehicles</span>
                        <span className="text-[9px] font-black bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full uppercase">{pastVehicles.length} Found</span>
                      </div>
                      <div className="flex flex-wrap gap-2 pt-1">
                        {pastVehicles.map((vehicle, idx) => {
                          const label = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') || vehicle.type || 'Vehicle';
                          const isSelected = ticketDetails.vehiclePlate?.toUpperCase().trim() === vehicle.plate?.toUpperCase().trim();
                          return (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => {
                                setTicketDetails(prev => ({
                                  ...prev,
                                  vehiclePlate: vehicle.plate,
                                  vehicleType: vehicle.type,
                                  vehicleYear: vehicle.year,
                                  vehicleMake: vehicle.make,
                                  vehicleModel: vehicle.model,
                                  vehiclePhotoUrl: vehicle.photoUrl || prev.vehiclePhotoUrl
                                }));
                              }}
                              className={cn(
                                "flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all text-left",
                                isSelected 
                                  ? "bg-blue-600 border-blue-600 text-white shadow-sm"
                                  : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300"
                              )}
                            >
                              <Truck className={cn("w-3.5 h-3.5 shrink-0", isSelected ? "text-white" : "text-slate-400")} />
                              <div>
                                <span className="block leading-none font-black uppercase text-[10px]">{vehicle.plate}</span>
                                <span className={cn("block text-[9px] leading-none mt-0.5 opacity-80", isSelected ? "text-blue-100" : "text-slate-500")}>
                                  {label}
                                </span>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

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
                        photoUrl={ticketDetails.vehiclePhotoUrl}
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
                    <div className="flex justify-between items-center">
                      <label htmlFor="custom-timestamp" className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-blue-500" />
                        Transaction Date & Time
                      </label>
                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider bg-slate-100 px-2.5 py-1 rounded-lg">
                        {ticketDetails.customTimestamp ? 'Custom Date/Time' : 'Live Real-Time'}
                      </span>
                    </div>
                    <input 
                      id="custom-timestamp"
                      type="datetime-local"
                      className="w-full px-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 text-sm font-bold text-slate-800"
                      value={ticketDetails.customTimestamp}
                      onChange={e => setTicketDetails({...ticketDetails, customTimestamp: e.target.value})}
                    />
                    <p className="text-[10px] text-slate-400 font-medium ml-1">
                      Default uses current live time. Adjust for late-night pickups or back-dated records to guarantee cash drawer reconciliation accuracy.
                    </p>
                  </div>

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
                          photoUrl={ticketDetails.customerPhotoUrl}
                          onCapture={(url) => setTicketDetails({ ...ticketDetails, customerPhotoUrl: url })}
                          networkUrl={settings.useSwannCams ? settings.swannCams.customer : undefined}
                          className="h-full"
                        />
                      </div>
                    </div>

                    <div className="p-6 bg-slate-50 rounded-[2rem] border border-slate-200 flex flex-col">
                      <h5 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4">Digitized Signature</h5>
                      
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
                      (step === 2 && items.some(i => !i.material || i.netWeight <= 0)) ||
                      showIdConfirm ||
                      showVehicleConfirm
                    }
                    className="w-full py-5 bg-blue-600 text-white rounded-2xl font-black text-lg hover:bg-blue-700 transition-all shadow-xl shadow-blue-900/20 flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {(showIdConfirm || showVehicleConfirm) ? 'Acknowledge Warning Above' : <>Continue <span className="text-xs opacity-60 font-medium px-1.5 py-0.5 bg-blue-950 rounded border border-blue-500/30">Alt + N</span> <ChevronRight className="w-5 h-5" /></>}
                  </button>
                ) : (
                  <button
                    onClick={handleSubmit}
                    disabled={processing}
                    className="w-full py-5 bg-green-600 text-white rounded-2xl font-black text-lg hover:bg-green-700 transition-all shadow-xl shadow-green-900/20 flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {processing ? <Loader2 className="w-6 h-6 animate-spin" /> : <><DollarSign className="w-6 h-6" /> Complete Ticket <span className="text-xs opacity-60 font-medium px-1.5 py-0.5 bg-green-950 rounded border border-green-500/30">Ctrl + Enter</span></>}
                  </button>
                )}
                
                {(step > 1) && (
                  <button
                    onClick={() => {
                      setShowVehicleConfirm(false);
                      setShowIdConfirm(false);
                      setStep(step - 1);
                    }}
                    disabled={processing}
                    className="w-full py-4 bg-slate-800 text-slate-300 rounded-2xl font-bold hover:bg-slate-700 transition-all flex items-center justify-center gap-2"
                  >
                    <ChevronLeft className="w-4 h-4" /> Back <span className="text-xs opacity-60 font-medium px-1.5 py-0.5 bg-slate-950 rounded border border-slate-700/30">Alt + B</span>
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
              <div className="flex flex-col items-start">
                <h3 className="font-bold text-slate-900">{isPreviewOnly ? 'Ticket Preview' : 'Print Preview'}</h3>
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest mt-0.5">Choose layout below</span>
              </div>
              <div className="flex bg-slate-200/80 p-0.5 rounded-xl border border-slate-200">
                <button
                  type="button"
                  onClick={() => setPrintFormat('letter')}
                  className={cn(
                    "px-2.5 py-1 text-[9px] font-black uppercase rounded-lg transition-all",
                    printFormat === 'letter' ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                  )}
                >
                  Letter
                </button>
                <button
                  type="button"
                  onClick={() => setPrintFormat('thermal')}
                  className={cn(
                    "px-2.5 py-1 text-[9px] font-black uppercase rounded-lg transition-all",
                    printFormat === 'thermal' ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                  )}
                >
                  Thermal
                </button>
              </div>
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
              <div className={cn(
                "bg-white shadow-sm border border-slate-200 rounded-xl relative mx-auto transition-all duration-300",
                printFormat === 'thermal' 
                  ? "max-w-[280px] p-4 border-dashed font-mono text-slate-900 text-xs gap-y-2" 
                  : "w-full p-8 font-sans"
              )}>
                {isPreviewOnly && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-[0.03] rotate-[-35deg]">
                    <span className="text-6xl font-black uppercase">Preview</span>
                  </div>
                )}
                <div className={cn(
                  "text-center border-b border-slate-100 pb-4 mb-4",
                  printFormat === 'thermal' ? "border-dashed border-slate-900" : ""
                )}>
                  <h1 className={cn("font-black uppercase tracking-tight", printFormat === 'thermal' ? "text-base" : "text-xl")}>{COMPANY_NAME}</h1>
                  {printFormat !== 'thermal' && COMPANY_WEBSITE && <p className="text-[10px] text-slate-400 font-medium tracking-wide mt-0.5">{COMPANY_WEBSITE}</p>}
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
                  
                  <div className={cn(
                    "border-t border-slate-100 pt-3 space-y-2",
                    printFormat === 'thermal' ? "border-dashed border-slate-900" : ""
                  )}>
                    <p className="text-[10px] font-bold text-slate-400 uppercase">Items</p>
                    {(lastCreatedTicket.materials || []).map((item, idx) => {
                      const material = materials.find(m => m.id === item.materialId);
                      const displayNetWeight = (item.netWeight || 0) - (item.deductionWeight || 0);
                      const itemTotal = (item.totalAmount !== undefined && item.totalAmount !== null && item.totalAmount > 0)
                        ? item.totalAmount
                        : (displayNetWeight * (item.pricePerUnit || 0));
                      return (
                        <div key={idx} className="space-y-1 border-b border-slate-50 pb-2 last:border-0">
                          <div className="flex justify-between gap-4 text-[11px]">
                            <div className="flex gap-2">
                              <span className="text-slate-400">{idx + 1}.</span>
                              <span className="font-bold">{material?.name || 'N/A'}</span>
                            </div>
                            <div className="text-right font-bold">
                              ${itemTotal.toFixed(2)}
                            </div>
                          </div>
                          <div className="flex justify-between text-[9px] text-slate-500 pl-5">
                            <span>
                              {item.netWeight} lb
                              {item.deductionWeight ? ` (Ded: -${item.deductionWeight} lb)` : ''}
                            </span>
                            <span>@ ${(item.pricePerUnit || 0).toFixed(2)}/lb</span>
                          </div>
                          {item.notes && (
                            <p className="text-[9px] text-slate-400 italic pl-5">Note: {item.notes}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div className={cn(
                    "flex justify-between gap-4 text-base border-t border-slate-900 pt-3 mt-4",
                    printFormat === 'thermal' ? "border-dashed" : ""
                  )}>
                    <span className="font-black uppercase">Total Weight</span>
                    <span className="font-black">
                      {(lastCreatedTicket.materials || []).reduce((sum, m) => sum + ((m.netWeight || 0) - (m.deductionWeight || 0)), 0)} lb
                    </span>
                  </div>
                  <div className={cn(
                    "flex justify-between gap-4 text-xl border-t-2 border-slate-900 pt-4 mt-4",
                    printFormat === 'thermal' ? "border-dashed" : ""
                  )}>
                    <span className="font-black uppercase">Total Payout</span>
                    <span className="font-black">
                      ${((lastCreatedTicket.totalAmount !== undefined && lastCreatedTicket.totalAmount > 0)
                        ? lastCreatedTicket.totalAmount
                        : (lastCreatedTicket.materials || []).reduce((sum, m) => {
                            const net = (m.netWeight || 0) - (m.deductionWeight || 0);
                            return sum + (m.totalAmount || (net * (m.pricePerUnit || 0)));
                          }, 0)
                      ).toFixed(2)}
                    </span>
                  </div>
                </div>
                
                <div className={cn(
                  "mt-8 pt-6 border-t border-slate-200 space-y-4",
                  printFormat === 'thermal' ? "border-dashed border-slate-900 mt-4 pt-4" : ""
                )}>
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
                
                {printFormat === 'thermal' && settings.thermalShowBarcode && (
                  <div className="mt-4 flex flex-col items-center border-t border-dashed border-slate-900 pt-3">
                    <div className="flex h-8 w-36 gap-0.5 bg-white px-2 py-1 border">
                      {Array.from({ length: 30 }).map((_, i) => (
                        <div 
                          key={i} 
                          className="h-full flex-1" 
                          style={{ backgroundColor: (i * 7 + 13) % 5 === 0 || i % 3 === 0 ? 'black' : 'transparent' }} 
                        />
                      ))}
                    </div>
                    <span className="text-[8px] font-mono tracking-widest mt-1">*{lastCreatedTicket.id.toUpperCase().slice(-8)}*</span>
                  </div>
                )}

                <div className="mt-8 text-center">
                  <p className="text-[10px] font-bold text-slate-900">TICKET ID: {lastCreatedTicket.id.toUpperCase()}</p>
                </div>
              </div>
            </div>
            
            <div className="p-4 bg-white border-t border-slate-100 flex gap-3">
              <button 
                onClick={() => setShowPrintPreview(false)}
                className="flex-1 py-3 border border-slate-200 rounded-xl font-bold text-slate-600 hover:bg-slate-50 transition-all text-xs"
              >
                Cancel
              </button>
              <button 
                onClick={async () => {
                  setShowPrintPreview(false);
                  await new Promise(r => setTimeout(r, 150));
                  await printTicket(
                    <BuyTicketPrint
                      ticket={lastCreatedTicket!}
                      customerName={getCustomerName(lastCreatedTicket!.customerId)}
                      materials={materials}
                      format={printFormat}
                    />,
                    { format: printFormat }
                  );
                  if (!isPreviewOnly) reset();
                }}
                className="flex-1 py-3 bg-slate-900 text-white rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-slate-800 transition-all shadow-lg shadow-slate-200 text-xs uppercase tracking-widest"
              >
                <Printer className="w-4 h-4" />
                Print Now
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Print Styles moved to index.css */}
      <USBBarcodeScannerModal 
        isOpen={isUSBScannerOpen}
        onClose={() => setIsUSBScannerOpen(false)}
        onScanSuccess={handleUSBScanSuccess}
      />

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
                          setNewCustomer(prev => ({ ...prev, name: customerSearch }));
                          setIsNewCustomer(true);
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
                        setSelectedCustomer(c);
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
    </main>
  );
}
