import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { auth, db } from '../firebase';
import { collection, getDocs, deleteDoc, doc, writeBatch, addDoc, onSnapshot, updateDoc, setDoc, query, where } from 'firebase/firestore';
import { UserProfile, Material, Customer, UserRole, UserPermissions, UserSession, UserInvite, SystemConfig, BuyTicket } from '../types';
import { 
  Settings as SettingsIcon, 
  Trash2, 
  Upload, 
  Download, 
  AlertTriangle, 
  CheckCircle2, 
  Loader2, 
  FileSpreadsheet,
  Database,
  RefreshCcw,
  RefreshCw,
  UserPlus,
  Package,
  Scan,
  Video,
  Users,
  Shield,
  ShieldAlert,
  Lock,
  ChevronRight,
  UserCheck,
  Fingerprint,
  Activity,
  MonitorSmartphone,
  Globe,
  Clock,
  LogOut,
  Smartphone,
  Monitor,
  Link as LinkIcon,
  Copy,
  Check,
  ExternalLink,
  Plus,
  X,
  Info,
  Eye,
  EyeOff,
  KeyRound,
  ShieldCheck,
  AlertCircle,
  Printer,
  User
} from 'lucide-react';
import { cn } from '../lib/utils';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';
import { logAuditEvent } from '../lib/audit';
import { useToast } from '../context/ToastContext';
import { APP_VERSION } from '../constants';
import { useSettings } from '../context/SettingsContext';
import ManagerPinModal from '../components/ManagerPinModal';
import { initializeApp, getApps } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, setPersistence, inMemoryPersistence, updatePassword, signInWithEmailAndPassword } from 'firebase/auth';
import { app as primaryApp } from '../firebase';
import Papa from 'papaparse';

const getSecondaryAuth = () => {
  let secondaryApp = getApps().find(app => app.name === 'SecondaryApp');
  if (!secondaryApp) {
    secondaryApp = initializeApp(primaryApp.options, 'SecondaryApp');
  }
  return getAuth(secondaryApp);
};

interface SettingsProps {
  profile: UserProfile | null;
}

export default function Settings({ profile }: SettingsProps) {
  const { firestore, local, success, error: toastError, info } = useToast();
  const { settings, updateSettings, resetToDefaults: resetUI } = useSettings();
  const [activeTab, setActiveTab] = useState<'general' | 'users' | 'sessions' | 'system' | 'roles'>('general');
  const [processing, setProcessing] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null);
  const [importType, setImportType] = useState<'materials' | 'customers' | null>(null);
  
  // User Management State
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);
  const [savingUser, setSavingUser] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [resettingPassword, setResettingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);

  useEffect(() => {
    setNewPassword('');
    setShowPassword(false);
    setPasswordError(null);
    setPasswordSuccess(null);
  }, [selectedUser]);

  // Sessions State
  const [sessions, setSessions] = useState<UserSession[]>([]);

  // System Config State
  const [systemConfig, setSystemConfig] = useState<SystemConfig | null>(null);

  // Role Default Templates State
  const [cashierRoleDefaults, setCashierRoleDefaults] = useState<UserPermissions>({
    canManagePrices: false,
    canManageUsers: false,
    canVoidTickets: false,
    canDeleteData: false,
    canManageInventory: false,
    canGenerateReports: false,
    canManageInvoices: false,
    canManageCash: true,
    canApproveChanges: false,
    canOpenCloseSessions: true,
    canRetroactivePriceAdjustments: false,
  });
  const [managerRoleDefaults, setManagerRoleDefaults] = useState<UserPermissions>({
    canManagePrices: true,
    canManageUsers: true,
    canVoidTickets: true,
    canDeleteData: true,
    canManageInventory: true,
    canGenerateReports: true,
    canManageInvoices: true,
    canManageCash: true,
    canApproveChanges: true,
    canOpenCloseSessions: true,
    canRetroactivePriceAdjustments: true,
  });
  const [loadingRoles, setLoadingRoles] = useState(false);

  // Create User State
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [invitePassword, setInvitePassword] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState<UserRole>('cashier');
  const [justCreatedUser, setJustCreatedUser] = useState<{ name: string; email: string; password: string; role: string } | null>(null);
  const [userToDelete, setUserToDelete] = useState<UserProfile | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [isCopied, setIsCopied] = useState(false);

  // Camera Diagnostics State
  const [testingCam, setTestingCam] = useState<'material' | 'customer' | 'entrance' | null>(null);
  const [diagnosticResults, setDiagnosticResults] = useState<Record<string, { status: 'success' | 'checking' | 'error' | 'untested'; detail: string; previewUrl?: string }>>({
    material: { status: 'untested', detail: 'Ready to test' },
    customer: { status: 'untested', detail: 'Ready to test' },
    entrance: { status: 'untested', detail: 'Ready to test' },
  });
  const [localLaptopId, setLocalLaptopId] = useState<string>(() => localStorage.getItem('pm_connected_laptop_id') || 'Register Laptop A');

  // Custom Raw Camera Diagnostics State
  const [customCamIp, setCustomCamIp] = useState('');
  const [customCamPort, setCustomCamPort] = useState('80');
  const [customCamPath, setCustomCamPath] = useState('/cgi-bin/snapshot.cgi?channel=1');
  const [customCamProtocol, setCustomCamProtocol] = useState<'http' | 'https'>('http');
  const [customCamMode, setCustomCamMode] = useState<'no-cors' | 'cors' | 'proxy'>('no-cors');
  const [customDiagStatus, setCustomDiagStatus] = useState<'untested' | 'testing' | 'success' | 'error'>('untested');

  // Compliance Data Repair State
  const [scanningRepair, setScanningRepair] = useState(false);
  const [repairingData, setRepairingData] = useState(false);
  const [repairProgress, setRepairProgress] = useState<{ current: number; total: number } | null>(null);
  const [scanResults, setScanResults] = useState<{
    totalScanned: number;
    completeCount: number;
    repairableTickets: Array<{
      ticketId: string;
      ticketNumber: string;
      customerId: string;
      customerName: string;
      fixIdPhoto: boolean;
      fixCustomerPhoto: boolean;
      idImageUrlToSet?: string;
      customerPhotoUrlToSet?: string;
    }>;
    needsAttentionTickets: Array<{
      ticketId: string;
      ticketNumber: string;
      customerId: string;
      customerName: string;
      missingFields: string[];
    }>;
  } | null>(null);
  const [repairCompleted, setRepairCompleted] = useState(false);
  const [repairSummary, setRepairSummary] = useState<{ repairedCount: number; failedCount: number } | null>(null);
  const [customDiagMsg, setCustomDiagMsg] = useState('');
  const [customDiagDetail, setCustomDiagDetail] = useState('');

  // System Key Hint & Credentials Health Validator States
  const [keyHintInput, setKeyHintInput] = useState('');
  const [savingKeyHint, setSavingKeyHint] = useState(false);
  const [keyHintStatus, setKeyHintStatus] = useState<string | null>(null);
  const [validatorPassword, setValidatorPassword] = useState('');
  const [validatingCredentials, setValidatingCredentials] = useState(false);
  const [validationResult, setValidationResult] = useState<{ success: boolean; message: string } | null>(null);
  const [showOhioPassword, setShowOhioPassword] = useState(false);
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const scrollTarget = searchParams.get('scroll');
    if (scrollTarget === 'compliance-repair') {
      setTimeout(() => {
        document.getElementById('compliance-data-repair-card')?.scrollIntoView({ behavior: 'smooth' });
      }, 300);
    }
  }, [searchParams]);

  // Fetch public key hint on component mount
  useEffect(() => {
    async function fetchHint() {
      try {
        const response = await fetch('/api/auth/system-hint');
        if (response.ok) {
          const data = await response.json();
          if (data && data.hint) {
            setKeyHintInput(data.hint);
          }
        }
      } catch (err) {
        console.warn('Failed to fetch system key hint:', err);
      }
    }
    fetchHint();
  }, []);

  const handleSaveKeyHint = async () => {
    setSavingKeyHint(true);
    setKeyHintStatus(null);
    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) {
        throw new Error('Verification failed. Please log in again.');
      }
      const response = await fetch('/api/auth/system-hint', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`
        },
        body: JSON.stringify({ hint: keyHintInput })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to save hint');
      }
      setKeyHintStatus('Hint saved successfully.');
    } catch (err: any) {
      setKeyHintStatus(`Error: ${err.message}`);
    } finally {
      setSavingKeyHint(false);
    }
  };

  const handleValidateCredentials = async () => {
    setValidatingCredentials(true);
    setValidationResult(null);
    try {
      const userEmail = profile?.email || auth.currentUser?.email;
      if (!userEmail) {
        throw new Error('Active user email not found.');
      }
      const response = await fetch('/api/auth/sign-in', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email: userEmail, password: validatorPassword })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Mismatched credentials');
      }
      setValidationResult({
        success: true,
        message: 'All system credentials tested successfully. Seamless token generated and bypassing all Google standard rate-limits.'
      });
    } catch (err: any) {
      setValidationResult({
        success: false,
        message: err.message || 'Mismatched or incorrect security key credentials.'
      });
    } finally {
      setValidatingCredentials(false);
    }
  };

  useEffect(() => {
    if (!auth.currentUser) return;
    if (activeTab === 'users' && profile?.role === 'manager') {
      const unsub = onSnapshot(collection(db, 'users'), (snapshot) => {
        setUsers(snapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() })) as UserProfile[]);
      }, (error) => handleFirestoreError(error, OperationType.LIST, 'users'));
      return () => {
        try {
          unsub();
        } catch (e) {
          console.warn('unsub users error', e);
        }
      };
    }
  }, [activeTab, profile]);

  const handleCreateUser = async () => {
    if (!inviteEmail || !invitePassword || !inviteName) {
      setStatus({ type: 'error', message: 'Email, password, and name are required.' });
      return;
    }
    
    try {
      setProcessing(true);
      const secondaryAuth = getSecondaryAuth();
      await setPersistence(secondaryAuth, inMemoryPersistence);
      
      let newUser: { uid: string; email: string | null } | null = null;
      let emailAlreadyExists = false;

      try {
        const userCredential = await createUserWithEmailAndPassword(secondaryAuth, inviteEmail, invitePassword);
        newUser = userCredential.user;
      } catch (authErr: any) {
        if (authErr.code === 'auth/email-already-in-use') {
          console.log('User already exists in Firebase Auth, pre-configuring profile under temp document');
          newUser = {
            uid: `temp_${inviteEmail.toLowerCase().trim()}`,
            email: inviteEmail.toLowerCase().trim()
          };
          emailAlreadyExists = true;
        } else {
          throw authErr;
        }
      }

      const defaultPermissions = {
        canManagePrices: inviteRole === 'manager',
        canManageUsers: inviteRole === 'manager',
        canVoidTickets: inviteRole === 'manager',
        canDeleteData: inviteRole === 'manager',
        canManageInventory: inviteRole === 'manager',
        canGenerateReports: inviteRole === 'manager',
        canManageInvoices: inviteRole === 'manager',
        canManageCash: true,
        canApproveChanges: inviteRole === 'manager',
        canOpenCloseSessions: true,
        canRetroactivePriceAdjustments: inviteRole === 'manager',
      };

      const newProfile: UserProfile = {
        uid: newUser.uid,
        email: newUser.email || inviteEmail,
        role: inviteRole,
        displayName: inviteName,
        managerPin: inviteRole === 'manager' ? '1234' : undefined,
        permissions: defaultPermissions,
      };

      await setDoc(doc(db, 'users', newUser.uid), newProfile);
      
      if (!emailAlreadyExists) {
        await secondaryAuth.signOut();
      }
      
      await logAuditEvent(
        'settings',
        newUser.uid,
        'create',
        { after: newProfile },
        `New user account created for ${inviteEmail}${emailAlreadyExists ? ' (linked to existing Auth)' : ''}`
      );

      setJustCreatedUser({
        name: inviteName,
        email: inviteEmail,
        password: emailAlreadyExists ? '[Existing Password]' : invitePassword,
        role: inviteRole
      });
      
      setStatus({ 
        type: 'success', 
        message: emailAlreadyExists 
          ? `Account profile created! Since this email was already registered, the user is now fully authorized. They can log in immediately using their existing password.`
          : 'User account created successfully.' 
      });
      setInviteEmail('');
      setInvitePassword('');
      setInviteName('');
    } catch (error: any) {
      console.error('Failed to create user', error);
      setStatus({ type: 'error', message: error.message || 'Failed to create user account.' });
    } finally {
      setProcessing(false);
    }
  };

  const handleDeleteUserConfirm = async () => {
    if (!userToDelete) return;
    const uid = userToDelete.uid;
    if (uid === profile?.uid) {
      setStatus({ type: 'error', message: 'You cannot delete your own account.' });
      setUserToDelete(null);
      return;
    }

    try {
      setProcessing(true);
      await deleteDoc(doc(db, 'users', uid));
      
      await logAuditEvent(
        'settings',
        uid,
        'delete',
        { before: userToDelete, after: null },
        `User account removed for ${userToDelete.email || uid}`
      );

      if (selectedUser?.uid === uid) {
        setSelectedUser(null);
      }
      setStatus({ type: 'success', message: `User ${userToDelete.displayName || userToDelete.email} successfully removed from the system.` });
      setUserToDelete(null);
      setDeleteConfirmText('');
    } catch (error: any) {
      handleFirestoreError(error, OperationType.DELETE, `users/${uid}`);
      setStatus({ type: 'error', message: 'Failed to delete user profile.' });
    } finally {
      setProcessing(false);
    }
  };

  useEffect(() => {
    if (!auth.currentUser) return;
    if (activeTab === 'sessions' && profile?.role === 'manager') {
      const unsub = onSnapshot(collection(db, 'userSessions'), (snapshot) => {
        const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as UserSession[];
        setSessions(data.sort((a, b) => new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime()));
      }, (error) => handleFirestoreError(error, OperationType.LIST, 'userSessions'));
      return () => {
        try {
          unsub();
        } catch (e) {
          console.warn('unsub userSessions error', e);
        }
      };
    }
  }, [activeTab, profile]);

  useEffect(() => {
    if (!auth.currentUser) return;
    if (activeTab === 'system' && profile?.role === 'manager') {
      const unsub = onSnapshot(doc(db, 'system', 'config'), (snap) => {
        if (snap.exists()) {
          setSystemConfig(snap.data() as SystemConfig);
        }
      }, (error) => handleFirestoreError(error, OperationType.GET, 'system/config'));
      return () => {
        try {
          unsub();
        } catch (e) {
          console.warn('unsub system/config error', e);
        }
      };
    }
  }, [activeTab, profile]);

  const handleUpdateSystemConfig = async (updates: Partial<SystemConfig>) => {
    try {
      setProcessing(true);
      await updateDoc(doc(db, 'system', 'config'), {
        ...updates,
        lastUpdated: new Date().toISOString()
      });
      setStatus({ type: 'success', message: 'System configuration updated.' });
      firestore(
        'System Config Saved',
        'Successfully synchronized and committed hardware & operational settings to Cloud Firestore.'
      );
    } catch (error: any) {
      toastError('Config Save Failed', `Failed to update system config: ${error.message || error}`);
      handleFirestoreError(error, OperationType.UPDATE, 'system/config');
    } finally {
      setProcessing(false);
    }
  };

  const handleScanComplianceData = async () => {
    if (profile?.role !== 'manager') return;
    setScanningRepair(true);
    setRepairCompleted(false);
    setRepairSummary(null);

    try {
      const q = query(collection(db, 'buyTickets'), where('status', '==', 'completed'));
      const ticketsSnap = await getDocs(q);

      const customersSnap = await getDocs(collection(db, 'customers'));
      const customerMap = new Map<string, Customer>();
      customersSnap.docs.forEach(docSnap => {
        customerMap.set(docSnap.id, { id: docSnap.id, ...docSnap.data() } as Customer);
      });

      let completeCount = 0;
      const repairableTickets: Array<{
        ticketId: string;
        ticketNumber: string;
        customerId: string;
        customerName: string;
        fixIdPhoto: boolean;
        fixCustomerPhoto: boolean;
        idImageUrlToSet?: string;
        customerPhotoUrlToSet?: string;
      }> = [];

      const needsAttentionTickets: Array<{
        ticketId: string;
        ticketNumber: string;
        customerId: string;
        customerName: string;
        missingFields: string[];
      }> = [];

      ticketsSnap.docs.forEach(docSnap => {
        const ticket = docSnap.data() as BuyTicket;
        const ticketId = docSnap.id;
        const ticketNumber = ticket.id ? ticket.id.substring(0, 8).toUpperCase() : ticketId.substring(0, 8).toUpperCase();
        const custId = ticket.customerId || '';
        const customer = custId ? customerMap.get(custId) : null;
        const customerName = customer?.name || ticket.createdBy || 'Unknown Seller';

        const hasTicketIdImg = Boolean(ticket.idImageUrl && ticket.idImageUrl.trim() !== '');
        const hasTicketCustImg = Boolean(ticket.customerPhotoUrl && ticket.customerPhotoUrl.trim() !== '');

        const hasCustIdImg = Boolean(customer?.idImageUrl && customer.idImageUrl.trim() !== '');
        const hasCustPhotoImg = Boolean(customer?.photoUrl && customer.photoUrl.trim() !== '');

        if (hasTicketIdImg && hasTicketCustImg) {
          completeCount++;
          return;
        }

        let fixIdPhoto = false;
        let fixCustomerPhoto = false;
        const missingUnfixable: string[] = [];

        if (!hasTicketIdImg) {
          if (hasCustIdImg) {
            fixIdPhoto = true;
          } else {
            missingUnfixable.push('ID Photo');
          }
        }

        if (!hasTicketCustImg) {
          if (hasCustPhotoImg) {
            fixCustomerPhoto = true;
          } else {
            missingUnfixable.push('Seller Photo');
          }
        }

        if (fixIdPhoto || fixCustomerPhoto) {
          repairableTickets.push({
            ticketId,
            ticketNumber,
            customerId: custId,
            customerName,
            fixIdPhoto,
            fixCustomerPhoto,
            idImageUrlToSet: fixIdPhoto ? customer?.idImageUrl : undefined,
            customerPhotoUrlToSet: fixCustomerPhoto ? customer?.photoUrl : undefined,
          });
        }

        if (missingUnfixable.length > 0) {
          needsAttentionTickets.push({
            ticketId,
            ticketNumber,
            customerId: custId,
            customerName,
            missingFields: missingUnfixable,
          });
        }
      });

      setScanResults({
        totalScanned: ticketsSnap.docs.length,
        completeCount,
        repairableTickets,
        needsAttentionTickets,
      });

      setStatus({
        type: 'success',
        message: `Scan complete: ${ticketsSnap.docs.length} tickets scanned, ${repairableTickets.length} repairable, ${needsAttentionTickets.length} need attention.`,
      });
    } catch (err: any) {
      console.error('Failed compliance scan:', err);
      setStatus({
        type: 'error',
        message: `Scan failed: ${err.message || err}`,
      });
    } finally {
      setScanningRepair(false);
    }
  };

  const handleRepairComplianceData = async () => {
    if (profile?.role !== 'manager' || !scanResults || scanResults.repairableTickets.length === 0) return;
    setRepairingData(true);

    const toRepair = scanResults.repairableTickets;
    const BATCH_SIZE = 25;
    let repairedCount = 0;
    let failedCount = 0;

    try {
      for (let i = 0; i < toRepair.length; i += BATCH_SIZE) {
        const chunk = toRepair.slice(i, i + BATCH_SIZE);
        setRepairProgress({ current: Math.min(i + BATCH_SIZE, toRepair.length), total: toRepair.length });

        const batch = writeBatch(db);
        chunk.forEach(item => {
          const ref = doc(db, 'buyTickets', item.ticketId);
          const updates: any = {
            backfilledAt: new Date().toISOString(),
          };
          const backfilledFields: string[] = [];

          if (item.fixIdPhoto && item.idImageUrlToSet) {
            updates.idImageUrl = item.idImageUrlToSet;
            backfilledFields.push('idImageUrl');
          }
          if (item.fixCustomerPhoto && item.customerPhotoUrlToSet) {
            updates.customerPhotoUrl = item.customerPhotoUrlToSet;
            backfilledFields.push('customerPhotoUrl');
          }
          updates.backfilledFields = backfilledFields;
          batch.update(ref, updates);
        });

        try {
          await batch.commit();
          repairedCount += chunk.length;
        } catch (batchErr) {
          console.error('Batch repair failed:', batchErr);
          failedCount += chunk.length;
        }
      }

      await logAuditEvent(
        'settings',
        'COMPLIANCE_DATA_REPAIR',
        'sync',
        {
          before: { repairableCount: toRepair.length },
          after: { repairedCount, failedCount },
        },
        `Repaired ${repairedCount} completed tickets for Ohio compliance (executed by ${profile?.displayName || profile?.email})`
      );

      setRepairCompleted(true);
      setRepairSummary({ repairedCount, failedCount });

      setScanResults(prev => prev ? {
        ...prev,
        repairableTickets: [],
      } : null);

      setStatus({
        type: 'success',
        message: `Repair completed! Repaired ${repairedCount} tickets. ${scanResults.needsAttentionTickets.length} still need attention.`,
      });
    } catch (err: any) {
      console.error('Failed repair execution:', err);
      setStatus({
        type: 'error',
        message: `Repair failed: ${err.message || err}`,
      });
    } finally {
      setRepairingData(false);
      setRepairProgress(null);
    }
  };

  useEffect(() => {
    if (!auth.currentUser) return;
    if (activeTab === 'roles' && profile?.role === 'manager') {
      setLoadingRoles(true);
      const unsub = onSnapshot(doc(db, 'settings', 'roleConfigs'), (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          if (data.cashier) setCashierRoleDefaults(data.cashier);
          if (data.manager) setManagerRoleDefaults(data.manager);
        } else {
          // Initialize self-healing defaults in firestore
          setDoc(doc(db, 'settings', 'roleConfigs'), {
            cashier: {
              canManagePrices: false,
              canManageUsers: false,
              canVoidTickets: false,
              canDeleteData: false,
              canManageInventory: false,
              canGenerateReports: false,
              canManageInvoices: false,
              canManageCash: true,
              canApproveChanges: false,
              canOpenCloseSessions: true,
              canRetroactivePriceAdjustments: false,
            },
            manager: {
              canManagePrices: true,
              canManageUsers: true,
              canVoidTickets: true,
              canDeleteData: true,
              canManageInventory: true,
              canGenerateReports: true,
              canManageInvoices: true,
              canManageCash: true,
              canApproveChanges: true,
              canOpenCloseSessions: true,
              canRetroactivePriceAdjustments: true,
            }
          }).catch(err => console.error("Error creating initial role defaults", err));
        }
        setLoadingRoles(false);
      }, (error) => {
        handleFirestoreError(error, OperationType.GET, 'settings/roleConfigs');
        setLoadingRoles(false);
      });
      return () => {
        try {
          unsub();
        } catch (e) {
          console.warn('unsub settings/roleConfigs error', e);
        }
      };
    }
  }, [activeTab, profile]);

  const handleUpdateRoleDefaults = async (role: 'cashier' | 'manager', permissionKey: keyof UserPermissions, value: boolean) => {
    try {
      setProcessing(true);
      const docRef = doc(db, 'settings', 'roleConfigs');
      const targetDefaults = role === 'cashier' ? cashierRoleDefaults : managerRoleDefaults;
      const updatedDefaults = {
        ...targetDefaults,
        [permissionKey]: value
      };
      
      await setDoc(docRef, {
        [role]: updatedDefaults
      }, { merge: true });
      
      setStatus({ type: 'success', message: `${role.toUpperCase()} role default permissions updated.` });
      firestore(
        'Role Configuration Updated',
        `Successfully updated default permissions for "${role.toUpperCase()}" in Cloud Firestore.`
      );
    } catch (error: any) {
      toastError('Role Config Save Failed', `Failed to update role default permissions: ${error.message || error}`);
    } finally {
      setProcessing(false);
    }
  };

  const handleApplyDefaultsToAll = async (role: 'cashier' | 'manager') => {
    if (!window.confirm(`Are you sure you want to overwrite all existing ${role} accounts' permissions with the current role defaults? This action is irreversible.`)) {
      return;
    }
    
    try {
      setProcessing(true);
      const targetDefaults = role === 'cashier' ? cashierRoleDefaults : managerRoleDefaults;
      
      // Fetch all users with this role
      const usersQuery = query(collection(db, 'users'), where('role', '==', role));
      const querySnap = await getDocs(usersQuery);
      
      let updatedCount = 0;
      for (const userDoc of querySnap.docs) {
        await updateDoc(doc(db, 'users', userDoc.id), {
          permissions: targetDefaults
        });
        updatedCount++;
      }
      
      setStatus({ type: 'success', message: `Applied defaults to ${updatedCount} ${role} accounts.` });
      success(
        'Permissions Applied',
        `Overwrote permissions for all ${updatedCount} existing ${role} team members with the new default template.`
      );
    } catch (error: any) {
      toastError('Apply Defaults Failed', `Failed to apply defaults: ${error.message || error}`);
    } finally {
      setProcessing(false);
    }
  };

  const getCameraUrlForDiagnostic = (camKey: 'material' | 'customer' | 'entrance') => {
    if (settings.cameraBrand === 'reolink') {
      const nvrIp = settings.reolinkNvrIp || '';
      const user = settings.reolinkUsername || 'admin';
      const pass = settings.reolinkPassword || '';
      
      const channels = settings.reolinkChannels || [];
      let channelNum = 0;
      if (camKey === 'customer') channelNum = 1;
      else if (camKey === 'entrance') channelNum = 2;
      
      const matchingCh = channels.find(ch => {
        if (camKey === 'material') return ch.id === 'cam1' || ch.channel === 0 || ch.name.toLowerCase().includes('scale') || ch.name.toLowerCase().includes('material');
        if (camKey === 'customer') return ch.id === 'cam2' || ch.channel === 1 || ch.name.toLowerCase().includes('customer') || ch.name.toLowerCase().includes('face');
        if (camKey === 'entrance') return ch.id === 'cam3' || ch.channel === 2 || ch.name.toLowerCase().includes('entrance') || ch.name.toLowerCase().includes('vehicle');
        return false;
      });
      
      if (matchingCh) {
        channelNum = matchingCh.channel;
      }
      
      let base = nvrIp.trim();
      if (!base) return '';
      if (!base.startsWith('http://') && !base.startsWith('https://')) {
        base = `http://${base}`;
      }
      return `${base}/cgi-bin/api.cgi?cmd=Snap&channel=${channelNum}&user=${user}&password=${pass}`;
    }
    return settings.swannCams[camKey];
  };

  const runCameraDiagnostic = async (camKey: 'material' | 'customer' | 'entrance') => {
    const rawUrl = getCameraUrlForDiagnostic(camKey);
    if (!rawUrl) {
      setDiagnosticResults(prev => ({
        ...prev,
        [camKey]: { status: 'error', detail: 'URL is empty. Enter an IP / CGI endpoint above.' }
      }));
      return;
    }

    setDiagnosticResults(prev => ({
      ...prev,
      [camKey]: { status: 'checking', detail: 'Testing connection...' }
    }));

    const connectionMode = settings.cameraConnectionMode || 'direct';
    const testUrl = connectionMode === 'proxy' 
      ? `/api/camera-proxy?url=${encodeURIComponent(rawUrl)}`
      : rawUrl;

    try {
      if (connectionMode === 'proxy') {
        const response = await fetch(`${testUrl}${testUrl.includes('?') ? '&' : '?'}_t=${Date.now()}`);
        if (!response.ok) {
          let errorDetail = 'Proxy failed to connect to NVR.';
          try {
            const errData = await response.json();
            errorDetail = errData.detail || errData.error || errorDetail;
            if (errData.solution) {
              errorDetail += `\n\nSolution: ${errData.solution}`;
            }
          } catch (_) {
            errorDetail = `HTTP ${response.status}: ${response.statusText}`;
          }
          throw new Error(errorDetail);
        }

        setDiagnosticResults(prev => ({
          ...prev,
          [camKey]: { 
            status: 'success', 
            detail: 'Successful Connection! Connection routed through cloud proxy server.',
            previewUrl: `${testUrl}${testUrl.includes('?') ? '&' : '?'}_t=${Date.now()}`
          }
        }));

        logAuditEvent(
          'settings',
          auth.currentUser?.uid || 'unknown',
          'sync',
          { 
            before: { status: 'testing' },
            after: { result: 'test_success_proxy', camera: camKey, laptop: localLaptopId, brand: settings.cameraBrand }
          }
        ).catch(() => {});
      } else {
        const testImg = new Image();
        let hasTimedOut = false;
        const timeout = setTimeout(() => {
          hasTimedOut = true;
          setDiagnosticResults(prev => ({
            ...prev,
            [camKey]: { 
              status: 'error', 
              detail: 'Timeout. Local Direct mode cannot cross the HTTPS barrier to access an unencrypted local HTTP camera. Allow mixed/insecure content in your browser settings (click the lock icon next to the address bar), or switch to Cloud Proxy Mode.' 
            }
          }));
        }, 6000);

        testImg.onload = () => {
          if (hasTimedOut) return;
          clearTimeout(timeout);
          setDiagnosticResults(prev => ({
            ...prev,
            [camKey]: { 
              status: 'success', 
              detail: 'Successful Connection! Directly loaded local camera frame.',
              previewUrl: `${testUrl}${testUrl.includes('?') ? '&' : '?'}_t=${Date.now()}`
            }
          }));

          logAuditEvent(
            'settings',
            auth.currentUser?.uid || 'unknown',
            'sync',
            { 
              before: { status: 'testing' },
              after: { result: 'test_success_direct', camera: camKey, laptop: localLaptopId, brand: settings.cameraBrand }
            }
          ).catch(() => {});
        };

        testImg.onerror = () => {
          if (hasTimedOut) return;
          clearTimeout(timeout);
          setDiagnosticResults(prev => ({
            ...prev,
            [camKey]: { 
              status: 'error', 
              detail: 'Connection Blocked. Browsers block loading unencrypted http:// cameras inside an encrypted https:// app. Please: (1) Click the lock icon in your browser address bar -> Site Settings -> allow "Insecure Content", (2) Install a browser CORS extension, or (3) Switch to Cloud Proxy Mode with a port-forwarded/public IP.' 
            }
          }));

          logAuditEvent(
            'settings',
            auth.currentUser?.uid || 'unknown',
            'sync',
            { 
              before: { status: 'testing' },
              after: { result: 'test_failed_direct', camera: camKey, laptop: localLaptopId, brand: settings.cameraBrand }
            }
          ).catch(() => {});
        };

        testImg.src = `${testUrl}${testUrl.includes('?') ? '&' : '?'}_t=${Date.now()}`;
      }
    } catch (e: any) {
      setDiagnosticResults(prev => ({
        ...prev,
        [camKey]: { status: 'error', detail: e.message || 'Diagnostic failed' }
      }));
    }
  };

  const runCustomCameraConnectivityCheck = async () => {
    if (!customCamIp.trim()) {
      setCustomDiagStatus('error');
      setCustomDiagMsg('IP address or host is required.');
      setCustomDiagDetail('Please provide a valid IP address or domain name to test.');
      return;
    }

    setCustomDiagStatus('testing');
    setCustomDiagMsg('Initializing diagnostic check...');
    setCustomDiagDetail('Sending packets...');

    // Clean IP address input (remove http/https prefix if user pasted it)
    let cleanedIp = customCamIp.trim();
    if (cleanedIp.startsWith('http://')) {
      cleanedIp = cleanedIp.replace('http://', '');
      setCustomCamProtocol('http');
    } else if (cleanedIp.startsWith('https://')) {
      cleanedIp = cleanedIp.replace('https://', '');
      setCustomCamProtocol('https');
    }

    // Build standard URLs
    const portStr = customCamPort.trim() ? `:${customCamPort.trim()}` : '';
    const fullCameraUrl = `${customCamProtocol}://${cleanedIp}${portStr}${customCamPath}`;

    try {
      if (customCamMode === 'proxy') {
        setCustomDiagMsg('Checking via secure Cloud Proxy...');
        setCustomDiagDetail(`Routing fetch to: /api/camera-proxy?url=${encodeURIComponent(fullCameraUrl)}`);
        
        const proxyUrl = `/api/camera-proxy?url=${encodeURIComponent(fullCameraUrl)}`;
        const response = await fetch(`${proxyUrl}&_t=${Date.now()}`);
        
        if (response.ok) {
          setCustomDiagStatus('success');
          setCustomDiagMsg('Cloud Proxy Ping Success!');
          setCustomDiagDetail(`Successfully retrieved raw image data via the Cloud Run proxy server. The IP is publically reachable and port forwarding is working correctly.`);
        } else {
          let errDetail = 'The proxy received an error response from the camera destination.';
          try {
            const errData = await response.json();
            errDetail = errData.detail || errData.error || errDetail;
            if (errData.solution) {
              errDetail += `\n\nSolution: ${errData.solution}`;
            }
          } catch (_) {
            errDetail = `HTTP Error Code ${response.status}: ${response.statusText}`;
          }
          throw new Error(errDetail);
        }
      } else {
        // no-cors or cors mode
        setCustomDiagMsg(`Pinging camera directly via Browser (${customCamMode} mode)...`);
        setCustomDiagDetail(`Executing fetch("${fullCameraUrl}", { mode: "${customCamMode}" })`);

        // Create an AbortController to handle timeouts
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        try {
          const res = await fetch(fullCameraUrl, {
            mode: customCamMode,
            signal: controller.signal,
            cache: 'no-store'
          });

          clearTimeout(timeoutId);

          // In no-cors mode, a successful network connection returns status 0 (opaque response).
          // If the network request failed (e.g., host offline or DNS failure), the fetch rejects and throws.
          if (customCamMode === 'no-cors') {
            setCustomDiagStatus('success');
            setCustomDiagMsg('Direct Network Ping Success!');
            setCustomDiagDetail(`Reachable! Browser connected successfully over local network. (no-cors mode completed with Status: ${res.status}).\n\nNote: If the camera still doesn't display in standard views, verify the snapshot path, username, and password.`);
          } else {
            // CORS mode
            if (res.ok) {
              setCustomDiagStatus('success');
              setCustomDiagMsg('Direct CORS Connection Success!');
              setCustomDiagDetail(`Excellent! The camera was reached and returned a valid CORS header allowing direct connection.`);
            } else {
              throw new Error(`Direct connection succeeded but returned HTTP status ${res.status}.`);
            }
          }
        } catch (fetchErr: any) {
          clearTimeout(timeoutId);
          if (fetchErr.name === 'AbortError') {
            throw new Error('Connection Timed Out. Ensure the camera is powered on, connected to the same LAN, and your port is correct.');
          }
          throw fetchErr;
        }
      }
    } catch (e: any) {
      setCustomDiagStatus('error');
      setCustomDiagMsg('Connection Test Failed');
      
      let detail = e.message || 'Unknown network error.';
      if (customCamMode !== 'proxy') {
        detail += `\n\nPossible Causes:\n• The app runs on HTTPS and the camera uses unencrypted HTTP. Browsers block "Mixed Content" by default.\n• The IP address/Port is incorrect.\n• You are on a different network (SSID/VLAN) than the NVR camera.`;
      }
      setCustomDiagDetail(detail);
    }
  };

  const handleLaptopIdChange = (id: string) => {
    localStorage.setItem('pm_connected_laptop_id', id);
    setLocalLaptopId(id);
    setStatus({ type: 'success', message: `Laptop registered as: ${id}` });
  };

  const handleTerminateSession = async (sessionId: string) => {
    try {
      await updateDoc(doc(db, 'userSessions', sessionId), { status: 'logout' });
      setStatus({ type: 'success', message: 'Session marked as terminated.' });
      firestore(
        'Session Terminated',
        `Successfully force-logged out active session #${sessionId.slice(0, 8)}... and revoked tokens in Firestore.`
      );
    } catch (error: any) {
      toastError('Revocation Failed', `Failed to terminate active session: ${error.message || error}`);
      handleFirestoreError(error, OperationType.UPDATE, `userSessions/${sessionId}`);
    }
  };

  const handleUpdateUserRole = async (uid: string, newRole: UserRole) => {
    const oldUser = users.find(u => u.uid === uid);
    try {
      setSavingUser(true);
      await updateDoc(doc(db, 'users', uid), { role: newRole });
      
      await logAuditEvent(
        'settings',
        uid,
        'update',
        { 
          before: { role: oldUser?.role },
          after: { role: newRole } 
        },
        `User role updated to ${newRole} for ${oldUser?.email || uid}`
      );
      
      setStatus({ type: 'success', message: 'User role updated successfully.' });
      firestore(
        'User Role Updated',
        `Account role for "${oldUser?.email || 'User'}" updated to ${newRole.toUpperCase()} and committed to Cloud Firestore.`
      );
    } catch (error: any) {
      toastError('Role Update Failed', `Failed to update user role: ${error.message || error}`);
      handleFirestoreError(error, OperationType.UPDATE, `users/${uid}`);
    } finally {
      setSavingUser(false);
    }
  };

  const handleUpdateUserPermissions = async (uid: string, permissions: UserPermissions) => {
    const oldUser = users.find(u => u.uid === uid);
    try {
      setSavingUser(true);
      await updateDoc(doc(db, 'users', uid), { permissions });
      
      await logAuditEvent(
        'settings',
        uid,
        'update',
        { 
          before: { permissions: oldUser?.permissions },
          after: { permissions } 
        },
        `User permissions updated for ${oldUser?.email || uid}`
      );
      
      setStatus({ type: 'success', message: 'User permissions updated successfully.' });
      firestore(
        'Permissions Committed',
        `Granular access control parameters updated for "${oldUser?.email || 'User'}" and committed to Cloud Firestore.`
      );
    } catch (error: any) {
      toastError('Permissions Update Failed', `Failed to update user permissions: ${error.message || error}`);
      handleFirestoreError(error, OperationType.UPDATE, `users/${uid}`);
    } finally {
      setSavingUser(false);
    }
  };

  const handleResetPassword = async (uid: string, targetEmail: string) => {
    if (!newPassword || newPassword.length < 6) {
      setPasswordError('Password must be at least 6 characters long.');
      return;
    }
    
    setResettingPassword(true);
    setPasswordError(null);
    setPasswordSuccess(null);
    
    try {
      // Are we resetting our own password?
      if (uid === auth.currentUser?.uid) {
        await updatePassword(auth.currentUser, newPassword);
        
        await logAuditEvent(
          'settings',
          uid,
          'update',
          { before: { reset: false }, after: { reset: true } },
          `User changed their own account password: ${targetEmail}`
        );
        
        setPasswordSuccess('Password reset successfully!');
        setNewPassword('');
        firestore(
          'Password Changed',
          'Successfully updated your login password in Firebase Auth.'
        );
      } else {
        // Manager resetting another user's password via secure backend administrative bypass
        const idToken = await auth.currentUser?.getIdToken();
        if (!idToken) {
          throw new Error('You must be logged in as a manager to reset employee passwords.');
        }

        const response = await fetch('/api/admin-reset-password', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${idToken}`
          },
          body: JSON.stringify({
            targetUid: uid,
            targetEmail: targetEmail,
            newPassword: newPassword
          })
        });

        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || 'Failed to administratively reset password.');
        }

        await updateDoc(doc(db, 'users', uid), {
          updatedAt: new Date().toISOString()
        });
        
        await logAuditEvent(
          'settings',
          uid,
          'update',
          { before: { reset: false }, after: { reset: true } },
          `Manager administratively reset account password for employee: ${targetEmail}`
        );
        
        setPasswordSuccess(`Success! Password successfully updated in Firebase Auth for ${targetEmail}.`);
        setNewPassword('');

        firestore(
          'Password Reset Done',
          `Successfully reset login password for "${targetEmail}" administratively.`
        );
      }
    } catch (err: any) {
      console.error('Password reset failed:', err);
      setPasswordError(err.message || 'Failed to reset password. Please check your network or permissions.');
      toastError('Reset Failed', `Failed to reset password: ${err.message || err}`);
    } finally {
      setResettingPassword(false);
    }
  };

  const collectionsToReset = [
    'buyTickets',
    'tripTickets',
    'invoices',
    'customers',
    'inventory',
    'systemLogs',
    'auditLogs',
    'pricingSnapshots',
    'doNotBuyList'
  ];

  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showPinModal, setShowPinModal] = useState(false);
  const [resetStep, setResetStep] = useState(0);

  const handleResetData = async () => {
    setProcessing(true);
    setStatus(null);
    setShowResetConfirm(false);

    try {
      for (const collectionName of collectionsToReset) {
        const querySnapshot = await getDocs(collection(db, collectionName));
        const chunks = [];
        const batchSize = 500;
        
        const docs = querySnapshot.docs;
        for (let i = 0; i < docs.length; i += batchSize) {
          chunks.push(docs.slice(i, i + batchSize));
        }

        for (const chunk of chunks) {
          const batch = writeBatch(db);
          chunk.forEach((docSnap) => {
            batch.delete(docSnap.ref);
          });
          await batch.commit();
        }
      }

      await logAuditEvent(
        'settings',
        'system_reset',
        'delete',
        { after: { resetCollections: collectionsToReset } },
        'Full system reset performed. All transactional data cleared.'
      );

      setStatus({ type: 'success', message: 'System reset successful. All transactional data has been cleared.' });
      setResetStep(0);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'multiple_collections');
      setStatus({ type: 'error', message: 'An error occurred during reset.' });
    } finally {
      setProcessing(false);
    }
  };

  const handleImportCSV = async (event: React.ChangeEvent<HTMLInputElement>, type: 'materials' | 'customers') => {
    const file = event.target.files?.[0];
    if (!file) return;

    setProcessing(true);
    setStatus(null);

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        try {
          const data = results.data as any[];
          const batch = writeBatch(db);
          let count = 0;

          for (const row of data) {
            if (type === 'materials') {
              // Basic validation for materials
              if (!row.code || !row.name) continue;
              const materialData = {
                code: row.code,
                name: row.name,
                category: row.category || 'General',
                buyPrice: Number(row.buyPrice) || 0,
                salePrice: Number(row.salePrice) || 0,
                unit: (row.unit?.toLowerCase() === 'ton' ? 'ton' : 'lb') as 'lb' | 'ton',
                updatedAt: new Date().toISOString()
              };
              const newDocRef = doc(collection(db, 'materials'));
              batch.set(newDocRef, materialData);
            } else if (type === 'customers') {
              // Basic validation for customers
              if (!row.name) continue;
              const customerData = {
                name: row.name,
                businessName: row.businessName || '',
                phone: row.phone || '',
                secondaryPhone: row.secondaryPhone || '',
                email: row.email || '',
                address: row.address || '',
                notes: row.notes || '',
                isBuyer: row.isBuyer === 'true' || row.isBuyer === '1' || row.isBuyer === 'yes',
                createdAt: new Date().toISOString()
              };
              const newDocRef = doc(collection(db, 'customers'));
              batch.set(newDocRef, customerData);
            }
            count++;
            
            // Commit in batches of 500
            if (count % 500 === 0) {
              await batch.commit();
            }
          }

          if (count % 500 !== 0) {
            await batch.commit();
          }

          setStatus({ type: 'success', message: `Successfully imported ${count} ${type}.` });
        } catch (error) {
          console.error('Import error:', error);
          setStatus({ type: 'error', message: 'Failed to import data. Check CSV format.' });
        } finally {
          setProcessing(false);
          event.target.value = ''; // Reset file input
        }
      },
      error: (error) => {
        console.error('Parse error:', error);
        setStatus({ type: 'error', message: 'Failed to parse CSV file.' });
        setProcessing(false);
      }
    });
  };

  const downloadTemplate = (type: 'materials' | 'customers') => {
    let headers = [];
    let sample = [];
    
    if (type === 'materials') {
      headers = ['code', 'name', 'category', 'buyPrice', 'salePrice', 'unit'];
      sample = ['C1', 'Copper #1', 'Non-Ferrous', '3.50', '4.20', 'lb'];
    } else {
      headers = ['name', 'businessName', 'phone', 'email', 'address', 'isBuyer'];
      sample = ['John Doe', 'Doe Recycling', '555-0123', 'john@example.com', '123 Metal St', 'true'];
    }

    const csv = Papa.unparse([headers, sample]);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `${type}_template.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-20">
      <div>
        <h1 className="text-4xl font-black text-slate-900 tracking-tight font-display">System Settings</h1>
        <p className="text-slate-500 font-medium mt-1">Manage system data, imports, and maintenance tools.</p>
      </div>

      <div className="flex gap-4 border-b border-slate-200 pb-px">
        <button
          onClick={() => setActiveTab('general')}
          className={cn(
            "px-6 py-3 text-[10px] font-black uppercase tracking-widest transition-all border-b-2",
            activeTab === 'general' ? "border-blue-600 text-blue-600" : "border-transparent text-slate-400 hover:text-slate-600"
          )}
        >
          General Settings
        </button>
        {profile?.permissions?.canManageUsers && (
          <button
            onClick={() => setActiveTab('users')}
            className={cn(
              "px-6 py-3 text-[10px] font-black uppercase tracking-widest transition-all border-b-2",
              activeTab === 'users' ? "border-blue-600 text-blue-600" : "border-transparent text-slate-400 hover:text-slate-600"
            )}
          >
            Users & Roles
          </button>
        )}
        {profile?.permissions?.canGenerateReports && (
          <button
            onClick={() => setActiveTab('sessions')}
            className={cn(
              "px-6 py-3 text-[10px] font-black uppercase tracking-widest transition-all border-b-2",
              activeTab === 'sessions' ? "border-blue-600 text-blue-600" : "border-transparent text-slate-400 hover:text-slate-600"
            )}
          >
            Active Sessions
          </button>
        )}
        {profile?.role === 'manager' && (
          <button
            onClick={() => setActiveTab('system')}
            className={cn(
              "px-6 py-3 text-[10px] font-black uppercase tracking-widest transition-all border-b-2",
              activeTab === 'system' ? "border-blue-600 text-blue-600" : "border-transparent text-slate-400 hover:text-slate-600"
            )}
          >
            System Operations
          </button>
        )}
        {profile?.role === 'manager' && (
          <button
            onClick={() => setActiveTab('roles')}
            className={cn(
              "px-6 py-3 text-[10px] font-black uppercase tracking-widest transition-all border-b-2",
              activeTab === 'roles' ? "border-blue-600 text-blue-600" : "border-transparent text-slate-400 hover:text-slate-600"
            )}
          >
            Role Configurations
          </button>
        )}
      </div>

      {status && (
        <div className={cn(
          "p-6 rounded-2xl border flex items-center gap-4 animate-in fade-in slide-in-from-top-4",
          status.type === 'success' ? "bg-emerald-50 border-emerald-100 text-emerald-800" : "bg-red-50 border-red-100 text-red-800"
        )}>
          {status.type === 'success' ? <CheckCircle2 className="w-6 h-6 text-emerald-600" /> : <AlertTriangle className="w-6 h-6 text-red-600" />}
          <p className="font-bold">{status.message}</p>
        </div>
      )}

      {activeTab === 'general' ? (
        <>
          {/* Branding & Logo Section */}
          <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm space-y-8">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-50 rounded-xl text-blue-600">
                <Upload className="w-5 h-5" />
              </div>
              <h3 className="font-black text-slate-900 uppercase tracking-tight">Branding & Logo</h3>
            </div>

            <div className="flex flex-col md:flex-row gap-8 items-start">
              <div className="w-full md:w-64 aspect-video bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200 flex items-center justify-center overflow-hidden relative group">
                {settings.companyLogo ? (
                  <>
                    <img 
                      src={settings.companyLogo} 
                      alt="Company Logo Preview" 
                      className="max-w-[80%] max-h-[80%] object-contain"
                    />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center transition-all">
                      <button 
                        onClick={() => updateSettings({ companyLogo: '' })}
                        className="p-2 bg-white rounded-full text-red-600 hover:scale-110 transition-transform"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="text-center p-4">
                    <SettingsIcon className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">No Custom Logo</p>
                  </div>
                )}
              </div>

              <div className="flex-1 space-y-4">
                <p className="text-sm text-slate-500 font-medium leading-relaxed">
                  Upload your company logo to be used on tickets, reports, and invoices. 
                  Recommended size: 1000x350px. Supports PNG, JPG, or SVG.
                </p>
                <div className="relative">
                  <input
                    type="file"
                    id="logo-upload"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const reader = new FileReader();
                        reader.onload = (event) => {
                          const base64 = event.target?.result as string;
                          updateSettings({ companyLogo: base64 });
                          setStatus({ type: 'success', message: 'Company logo updated successfully.' });
                        };
                        reader.readAsDataURL(file);
                      }
                    }}
                  />
                  <label
                    htmlFor="logo-upload"
                    className="inline-flex items-center gap-2 px-6 py-3 bg-slate-900 text-white rounded-xl font-bold hover:bg-slate-800 transition-all cursor-pointer shadow-lg shadow-slate-200"
                  >
                    <Upload className="w-4 h-4" />
                    {settings.companyLogo ? 'Change Logo' : 'Upload Logo'}
                  </label>
                </div>
              </div>
            </div>
          </div>

          {/* UI Preferences Section */}
          <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm space-y-8">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-50 rounded-xl text-indigo-600">
            <SettingsIcon className="w-5 h-5" />
          </div>
          <h3 className="font-black text-slate-900 uppercase tracking-tight">Display & Interface</h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Theme */}
          <div className="space-y-3">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Color Theme</label>
            <div className="grid grid-cols-3 gap-2 p-1 bg-slate-100 rounded-2xl">
              {(['light', 'dark', 'system'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => updateSettings({ theme: t })}
                  className={cn(
                    "py-2 px-3 rounded-xl text-xs font-bold capitalize transition-all",
                    settings.theme === t ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Font Size */}
          <div className="space-y-3">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Text Scaling</label>
            <div className="grid grid-cols-4 gap-2 p-1 bg-slate-100 rounded-2xl">
              {(['small', 'medium', 'large', 'xl'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => updateSettings({ fontSize: s })}
                  className={cn(
                    "py-2 px-3 rounded-xl text-[10px] font-black uppercase transition-all",
                    settings.fontSize === s ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                  )}
                >
                  {s.charAt(0)}
                </button>
              ))}
            </div>
          </div>

          {/* Font Family */}
          <div className="space-y-3">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Typography Style</label>
            <div className="grid grid-cols-3 gap-2 p-1 bg-slate-100 rounded-2xl">
              {(['inter', 'outfit', 'mono'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => updateSettings({ fontFamily: f })}
                  className={cn(
                    "py-2 px-3 rounded-xl text-xs font-bold capitalize transition-all",
                    settings.fontFamily === f ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                  )}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          {/* Toggles */}
          <div className="space-y-3">
            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Program Behavior</label>
            <div className="space-y-2">
              <button
                onClick={() => updateSettings({ autoPrint: !settings.autoPrint })}
                className="w-full flex items-center justify-between p-3 bg-slate-50 rounded-xl hover:bg-slate-100 transition-colors"
              >
                <div className="flex flex-col items-start">
                  <span className="text-xs font-bold text-slate-700">Auto-print Invoices</span>
                  <span className="text-[10px] text-slate-500 text-left">Automatically trigger browser printing and closes dialogs after transactions.</span>
                </div>
                <div className={cn(
                  "w-10 h-5 rounded-full transition-colors relative flex-shrink-0",
                  settings.autoPrint ? "bg-blue-600" : "bg-slate-300"
                )}>
                  <div className={cn(
                    "absolute top-1 w-3 h-3 bg-white rounded-full transition-all",
                    settings.autoPrint ? "left-6" : "left-1"
                  )} />
                </div>
              </button>

              <button
                onClick={() => updateSettings({ receiptFormat: settings.receiptFormat === 'letter' ? 'thermal' : 'letter' })}
                className="w-full flex items-center justify-between p-3 bg-slate-50 rounded-xl hover:bg-slate-100 transition-colors"
              >
                <div className="flex flex-col items-start">
                  <span className="text-xs font-bold text-slate-700">Thermal Receipt Format</span>
                  <span className="text-[10px] text-slate-500 text-left">Use 80mm thermal roll format for ticket printing instead of standard Letter size.</span>
                </div>
                <div className={cn(
                  "w-10 h-5 rounded-full transition-colors relative flex-shrink-0",
                  settings.receiptFormat === 'thermal' ? "bg-blue-600" : "bg-slate-300"
                )}>
                  <div className={cn(
                    "absolute top-1 w-3 h-3 bg-white rounded-full transition-all",
                    settings.receiptFormat === 'thermal' ? "left-6" : "left-1"
                  )} />
                </div>
              </button>

              {settings.receiptFormat === 'thermal' && (
                <div className="mt-2 p-4 bg-blue-50/50 border border-blue-100 rounded-xl space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
                  <div className="flex items-center gap-2 pb-2 border-b border-blue-100/50">
                    <Printer className="w-4 h-4 text-blue-600" />
                    <span className="text-xs font-bold text-blue-900 uppercase tracking-wider">Epson TM-T88V & Thermal Printer Settings</span>
                  </div>

                  {/* Paper Width Selection */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Paper Width</label>
                      <div className="flex bg-slate-200 p-1 rounded-lg">
                        <button
                          type="button"
                          onClick={() => updateSettings({ thermalWidth: '80mm' })}
                          className={cn(
                            "flex-1 py-1.5 text-[10px] font-black uppercase rounded-md transition-all",
                            settings.thermalWidth === '80mm' ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-750"
                          )}
                        >
                          80mm (Epson)
                        </button>
                        <button
                          type="button"
                          onClick={() => updateSettings({ thermalWidth: '58mm' })}
                          className={cn(
                            "flex-1 py-1.5 text-[10px] font-black uppercase rounded-md transition-all",
                            settings.thermalWidth === '58mm' ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-750"
                          )}
                        >
                          58mm (Mini)
                        </button>
                      </div>
                    </div>

                    {/* Font Style Selection */}
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Receipt Font</label>
                      <div className="flex bg-slate-200 p-1 rounded-lg">
                        <button
                          type="button"
                          onClick={() => updateSettings({ thermalFont: 'mono' })}
                          className={cn(
                            "flex-1 py-1.5 text-[10px] font-black uppercase rounded-md transition-all",
                            settings.thermalFont === 'mono' ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-750"
                          )}
                        >
                          Classic Mono
                        </button>
                        <button
                          type="button"
                          onClick={() => updateSettings({ thermalFont: 'sans' })}
                          className={cn(
                            "flex-1 py-1.5 text-[10px] font-black uppercase rounded-md transition-all",
                            settings.thermalFont === 'sans' ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-750"
                          )}
                        >
                          Modern Sans
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Density and Barcode Options */}
                  <div className="grid grid-cols-2 gap-4 pt-2">
                    {/* Density Selector */}
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Layout Density</label>
                      <div className="flex bg-slate-200 p-1 rounded-lg">
                        <button
                          type="button"
                          onClick={() => updateSettings({ thermalPrintDensity: 'normal' })}
                          className={cn(
                            "flex-1 py-1.5 text-[10px] font-black uppercase rounded-md transition-all",
                            settings.thermalPrintDensity === 'normal' ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-750"
                          )}
                        >
                          Normal
                        </button>
                        <button
                          type="button"
                          onClick={() => updateSettings({ thermalPrintDensity: 'compact' })}
                          className={cn(
                            "flex-1 py-1.5 text-[10px] font-black uppercase rounded-md transition-all",
                            settings.thermalPrintDensity === 'compact' ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-750"
                          )}
                        >
                          Compact
                        </button>
                      </div>
                    </div>

                    {/* Barcode Toggle */}
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Ticket Barcode</label>
                      <button
                        type="button"
                        onClick={() => updateSettings({ thermalShowBarcode: !settings.thermalShowBarcode })}
                        className="w-full flex items-center justify-between p-1.5 bg-slate-200 rounded-lg text-left"
                      >
                        <span className="text-[10px] font-black uppercase tracking-wider text-slate-600 ml-1">
                          {settings.thermalShowBarcode ? "Enabled" : "Disabled"}
                        </span>
                        <div className={cn(
                          "w-10 h-5 rounded-full transition-colors relative flex-shrink-0",
                          settings.thermalShowBarcode ? "bg-blue-600" : "bg-slate-300"
                        )}>
                          <div className={cn(
                            "absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all",
                            settings.thermalShowBarcode ? "left-5.5" : "left-0.5"
                          )} />
                        </div>
                      </button>
                    </div>
                  </div>
                </div>
              )}
              
              <button
                onClick={() => updateSettings({ debugPrintMode: !settings.debugPrintMode })}
                className="w-full flex items-center justify-between p-3 bg-amber-50 rounded-xl hover:bg-amber-100 transition-colors"
              >
                <div className="flex flex-col items-start">
                  <span className="text-xs font-bold text-amber-700">Print Debug Mode</span>
                  <span className="text-[10px] text-amber-600 text-left">Bypasses window.print() completely preventing browser hijacking, and prevents auto-close of all print previews. Useful for designing and troubleshooting print media CSS locally.</span>
                </div>
                <div className={cn(
                  "w-10 h-5 rounded-full transition-colors relative flex-shrink-0",
                  settings.debugPrintMode ? "bg-amber-600" : "bg-slate-300"
                )}>
                  <div className={cn(
                    "absolute top-1 w-3 h-3 bg-white rounded-full transition-all",
                    settings.debugPrintMode ? "left-6" : "left-1"
                  )} />
                </div>
              </button>
              <button
                onClick={() => updateSettings({ compactMode: !settings.compactMode })}
                className="w-full flex items-center justify-between p-3 bg-slate-50 rounded-xl hover:bg-slate-100 transition-colors"
              >
                <span className="text-xs font-bold text-slate-700">Compact Dashboard</span>
                <div className={cn(
                  "w-10 h-5 rounded-full transition-colors relative",
                  settings.compactMode ? "bg-blue-600" : "bg-slate-300"
                )}>
                  <div className={cn(
                    "absolute top-1 w-3 h-3 bg-white rounded-full transition-all",
                    settings.compactMode ? "left-6" : "left-1"
                  )} />
                </div>
              </button>
            </div>
          </div>
        </div>

        <div className="pt-4 flex justify-end">
          <button
            onClick={resetUI}
            className="text-[10px] font-black text-slate-400 uppercase tracking-widest hover:text-blue-600 transition-colors"
          >
            Reset UI to Defaults
          </button>
        </div>
      </div>

      {/* System Key & Authentication Security Section */}
      <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm space-y-8">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-50 rounded-xl text-blue-600">
            <ShieldCheck className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <h3 className="font-black text-slate-900 uppercase tracking-tight">System Access & Security</h3>
            <p className="text-[10px] text-slate-400 font-bold uppercase">Configure keys, hints, and test credential health</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Left Column: Password/Key Hint Configuration */}
          <div className="space-y-4">
            <h4 className="text-xs font-black text-slate-900 uppercase tracking-tight">Access Recovery Hint</h4>
            <p className="text-xs text-slate-500 font-medium leading-relaxed">
              Provide a subtle hint for staff or cashiers to remember the System Key/Password. This hint will be displayed on the public login page to prevent locked out situations.
            </p>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Current Password Hint</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  className="flex-1 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all text-xs font-bold"
                  placeholder="e.g. Office safe key followed by '03'..."
                  value={keyHintInput}
                  onChange={(e) => setKeyHintInput(e.target.value)}
                />
                <button
                  onClick={handleSaveKeyHint}
                  disabled={savingKeyHint}
                  className="px-5 py-2 bg-slate-900 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-blue-600 transition-all disabled:opacity-50 cursor-pointer"
                >
                  {savingKeyHint ? 'Saving...' : 'Save Hint'}
                </button>
              </div>
              {keyHintStatus && (
                <p className={`text-[10px] font-bold uppercase tracking-wider ${keyHintStatus.includes('successfully') ? 'text-green-600' : 'text-red-500'}`}>
                  {keyHintStatus}
                </p>
              )}
            </div>
          </div>

          {/* Right Column: Password/System Key Health Validator */}
          <div className="space-y-4 p-5 bg-slate-50/50 rounded-3xl border border-slate-100">
            <h4 className="text-xs font-black text-slate-900 uppercase tracking-tight">Credentials Health Validator</h4>
            <p className="text-[10px] text-slate-500 font-bold uppercase leading-relaxed">
              Test your active password / System Key to verify that it is fully synchronized with authentication proxy servers and that your IP routing is running free of Google lockouts.
            </p>

            <div className="space-y-3">
              <div>
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Account Email</label>
                <div className="px-4 py-2 bg-white rounded-xl border border-slate-200 text-xs font-bold text-slate-700 select-all">
                  {profile?.email || auth.currentUser?.email || 'N/A'}
                </div>
              </div>

              <div>
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-1 block">Test Password / Key</label>
                <input
                  type="password"
                  className="w-full px-4 py-2 bg-white border border-slate-200 rounded-xl outline-none focus:border-blue-500 text-xs font-mono font-bold"
                  placeholder="Type your current password..."
                  value={validatorPassword}
                  onChange={(e) => setValidatorPassword(e.target.value)}
                />
              </div>

              <button
                onClick={handleValidateCredentials}
                disabled={validatingCredentials || !validatorPassword}
                className="w-full py-2.5 bg-slate-900 text-white hover:bg-emerald-600 rounded-xl text-[10px] font-black uppercase tracking-widest transition-colors disabled:opacity-45 cursor-pointer"
              >
                {validatingCredentials ? 'Validating Connection...' : 'Validate Credentials'}
              </button>

              {validationResult && (
                <div className={`p-3 rounded-xl border flex items-start gap-2.5 ${
                  validationResult.success 
                    ? 'bg-emerald-50 border-emerald-100 text-emerald-800' 
                    : 'bg-red-50 border-red-100 text-red-800'
                }`}>
                  {validationResult.success ? (
                    <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                  )}
                  <div>
                    <p className="text-[10px] font-bold uppercase leading-relaxed">
                      {validationResult.success ? '✓ Credentials Valid & Active' : '✗ Authentication Failed'}
                    </p>
                    <p className="text-[9px] font-medium leading-relaxed mt-0.5">
                      {validationResult.message}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* State Scrap Registry Integration Section (Ohio Homeland Security) */}
      <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm space-y-8">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-amber-50 rounded-xl text-amber-600">
            <Fingerprint className="w-5 h-5 text-amber-600" />
          </div>
          <div>
            <h3 className="font-black text-slate-900 uppercase tracking-tight">Ohio Dept of Homeland Security</h3>
            <p className="text-[10px] text-slate-400 font-bold uppercase">Scrap Metal Dealer Registry Portal Integration</p>
          </div>
        </div>

        <p className="text-xs text-slate-500 font-medium leading-relaxed max-w-3xl">
          Under Ohio compliance law (ORC § 4737.04), scrap dealers must cross-reference scrap transactions and individuals with the Ohio Department of Homeland Security Scrap Metal database. Save your agency portal link and credentials here. These will be securely displayed and copyable in the Buy Ticket flows to check sellers with a single click.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Left Column: Portal Link & Dealer Identifier */}
          <div className="space-y-4">
            <h4 className="text-xs font-black text-slate-900 uppercase tracking-tight font-display">Portal Connection</h4>
            
            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Database Portal URL</label>
              <div className="flex gap-2">
                <input
                  type="url"
                  className="flex-1 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all text-xs font-bold"
                  placeholder="e.g. https://scrapmetal.dps.ohio.gov/"
                  value={settings.ohioScrapPortalUrl || ''}
                  onChange={(e) => updateSettings({ ohioScrapPortalUrl: e.target.value })}
                />
                <button
                  onClick={() => window.open(settings.ohioScrapPortalUrl, '_blank')}
                  className="px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl flex items-center justify-center gap-2 border border-slate-200 text-xs font-bold transition-all"
                  title="Test Link"
                >
                  <ExternalLink className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Scrap Dealer Registration ID</label>
              <input
                type="text"
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all text-xs font-bold"
                placeholder="e.g. SMD-OH-2026-89421"
                value={settings.ohioScrapDealerId || ''}
                onChange={(e) => updateSettings({ ohioScrapDealerId: e.target.value })}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Hardware Integration Section */}
      <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm space-y-8">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-slate-900 rounded-xl text-white">
            <Scan className="w-5 h-5" />
          </div>
          <h3 className="font-black text-slate-900 uppercase tracking-tight">Hardware Integration</h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">ID Card Scanner (Gemalto CR5400)</label>
              <button
                onClick={() => updateSettings({ scannerEnabled: !settings.scannerEnabled })}
                className={cn(
                  "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest transition-all",
                  settings.scannerEnabled ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"
                )}
              >
                {settings.scannerEnabled ? 'Enabled' : 'Disabled'}
              </button>
            </div>
            
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-500">Scanner Bridge API URL</label>
              <div className="flex gap-2">
                <input 
                  type="text"
                  className="flex-1 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none transition-all text-sm font-medium"
                  placeholder="http://localhost:16272/scan"
                  value={settings.scannerBridgeUrl}
                  onChange={(e) => updateSettings({ scannerBridgeUrl: e.target.value })}
                />
                <button 
                  onClick={() => window.open(settings.scannerBridgeUrl, '_blank')}
                  className="px-4 py-2 bg-slate-100 text-slate-600 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-200 transition-all"
                >
                  Test Bridge
                </button>
              </div>
            </div>
          </div>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Network IP Camera Integration</label>
              <button
                onClick={() => updateSettings({ useSwannCams: !settings.useSwannCams })}
                className={cn(
                  "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest transition-all",
                  settings.useSwannCams ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
                )}
              >
                {settings.useSwannCams ? 'Active' : 'Disabled'}
              </button>
            </div>

            <div className="space-y-1.5 pt-1">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">IP Camera Brand</label>
              <div className="grid grid-cols-3 gap-2">
                {(['swann', 'reolink', 'universal'] as const).map((brand) => (
                  <button
                    key={brand}
                    type="button"
                    onClick={() => updateSettings({ cameraBrand: brand })}
                    className={cn(
                      "py-2.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all border text-center cursor-pointer",
                      settings.cameraBrand === brand 
                        ? "bg-slate-900 border-slate-900 text-white shadow-sm" 
                        : "bg-white border-slate-200 text-slate-500 hover:bg-slate-50"
                    )}
                  >
                    {brand === 'swann' ? 'Swann NVR' : brand === 'reolink' ? 'Reolink' : 'Universal IP'}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5 pt-1">
              <div className="flex items-center gap-1.5 ml-1">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Camera Connection Mode</label>
                <span className="text-[8px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded">CORS-Safe Option</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {(['direct', 'proxy'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => updateSettings({ cameraConnectionMode: mode })}
                    className={cn(
                      "py-2 px-3 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all border text-center cursor-pointer flex flex-col items-center justify-center gap-0.5 min-h-[48px]",
                      settings.cameraConnectionMode === mode 
                        ? "bg-slate-900 border-slate-900 text-white shadow-sm" 
                        : "bg-white border-slate-200 text-slate-500 hover:bg-slate-50"
                    )}
                  >
                    <span>{mode === 'direct' ? 'Direct LAN Mode' : 'Cloud Proxy Mode'}</span>
                    <span className={cn(
                      "text-[8px] font-bold lowercase tracking-normal",
                      settings.cameraConnectionMode === mode ? "text-slate-300 font-medium" : "text-slate-400 font-medium"
                    )}>
                      {mode === 'direct' ? 'Direct Browser to LAN' : 'Secure Proxy via server'}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-4 pt-1">
              {settings.cameraBrand === 'reolink' ? (
                <div className="p-4 bg-slate-900 border border-slate-800 rounded-2xl space-y-4 text-slate-200">
                  <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
                    <Video className="w-4 h-4 text-emerald-400" />
                    <span className="text-[10px] font-black uppercase tracking-wider">Reolink NVR Integration Suite</span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <label className="text-[9px] font-black uppercase tracking-wider text-slate-400">NVR Base IP & Port</label>
                      <input
                        type="text"
                        className="w-full bg-slate-950 border border-slate-850 rounded-xl px-3 py-2 text-xs font-bold text-white outline-none focus:border-emerald-500"
                        placeholder="e.g. http://192.168.1.50:80"
                        value={settings.reolinkNvrIp || ''}
                        onChange={(e) => updateSettings({ reolinkNvrIp: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9px] font-black uppercase tracking-wider text-slate-400">Username</label>
                      <input
                        type="text"
                        className="w-full bg-slate-950 border border-slate-850 rounded-xl px-3 py-2 text-xs font-bold text-white outline-none focus:border-emerald-500"
                        placeholder="admin"
                        value={settings.reolinkUsername || ''}
                        onChange={(e) => updateSettings({ reolinkUsername: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9px] font-black uppercase tracking-wider text-slate-400">Password</label>
                      <input
                        type="password"
                        className="w-full bg-slate-950 border border-slate-850 rounded-xl px-3 py-2 text-xs font-bold text-white outline-none focus:border-emerald-500"
                        placeholder="YourPassword"
                        value={settings.reolinkPassword || ''}
                        onChange={(e) => updateSettings({ reolinkPassword: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="space-y-2 pt-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] font-black uppercase tracking-wider text-slate-400">NVR Channel Map & Enabled Cameras</span>
                      <button
                        type="button"
                        onClick={() => {
                          const channels = settings.reolinkChannels || [];
                          const nextCh = channels.length;
                          const newCh = {
                            id: `cam_${Date.now()}`,
                            name: `Camera ${nextCh + 1} (Ch ${nextCh + 1})`,
                            channel: nextCh,
                            isEnabled: true
                          };
                          updateSettings({ reolinkChannels: [...channels, newCh] });
                        }}
                        className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-[9px] font-black uppercase tracking-wider transition-colors"
                      >
                        + Add Channel
                      </button>
                    </div>

                    <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                      {(settings.reolinkChannels || []).map((ch, idx) => (
                        <div key={ch.id} className="grid grid-cols-12 gap-2 p-2 bg-slate-950/60 rounded-xl border border-slate-800/80 items-center">
                          <div className="col-span-6">
                            <input
                              type="text"
                              className="w-full bg-transparent border-none text-xs font-bold text-white outline-none"
                              value={ch.name}
                              onChange={(e) => {
                                const updated = [...(settings.reolinkChannels || [])];
                                updated[idx] = { ...ch, name: e.target.value };
                                updateSettings({ reolinkChannels: updated });
                              }}
                            />
                          </div>
                          <div className="col-span-3 flex items-center gap-1 bg-slate-900 border border-slate-800 px-2 py-1 rounded">
                            <span className="text-[9px] text-slate-400 uppercase font-bold">CH</span>
                            <input
                              type="number"
                              min="0"
                              max="64"
                              className="bg-transparent border-none w-full text-xs font-bold text-white text-center outline-none"
                              value={ch.channel}
                              onChange={(e) => {
                                const updated = [...(settings.reolinkChannels || [])];
                                updated[idx] = { ...ch, channel: parseInt(e.target.value) || 0 };
                                updateSettings({ reolinkChannels: updated });
                              }}
                            />
                          </div>
                          <div className="col-span-3 flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                const updated = [...(settings.reolinkChannels || [])];
                                updated[idx] = { ...ch, isEnabled: !ch.isEnabled };
                                updateSettings({ reolinkChannels: updated });
                              }}
                              className={cn(
                                "px-2 py-1 text-[9px] font-black uppercase tracking-wider rounded transition-colors",
                                ch.isEnabled ? "bg-emerald-950 text-emerald-400 border border-emerald-800" : "bg-slate-900 text-slate-500 border border-slate-800"
                              )}
                            >
                              {ch.isEnabled ? 'On' : 'Off'}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                const updated = (settings.reolinkChannels || []).filter(c => c.id !== ch.id);
                                updateSettings({ reolinkChannels: updated });
                              }}
                              className="p-1 text-slate-500 hover:text-red-400 transition-colors"
                              title="Delete"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-500 uppercase ml-1">
                      Material Station Cam ({settings.cameraBrand === 'swann' ? 'Swann CGI' : 'Snapshot URL'})
                    </label>
                    <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center gap-2">
                      <Video className="w-4 h-4 text-slate-400" />
                      <input 
                        type="text"
                        className="bg-transparent border-none outline-none text-xs font-bold w-full"
                        placeholder={
                          settings.cameraBrand === 'swann'
                            ? "http://192.168.1.50/cgi-bin/snapshot.cgi?channel=1"
                            : "http://192.168.1.50/snapshot.jpg"
                        }
                        value={settings.swannCams.material}
                        onChange={(e) => updateSettings({ swannCams: { ...settings.swannCams, material: e.target.value } })}
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-500 uppercase ml-1">
                      Customer Face Cam ({settings.cameraBrand === 'swann' ? 'Swann CGI' : 'Snapshot URL'})
                    </label>
                    <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center gap-2">
                      <Video className="w-4 h-4 text-slate-400" />
                      <input 
                        type="text"
                        className="bg-transparent border-none outline-none text-xs font-bold w-full"
                        placeholder={
                          settings.cameraBrand === 'swann'
                            ? "http://192.168.1.50/cgi-bin/snapshot.cgi?channel=2"
                            : "http://192.168.1.50/snapshot.jpg"
                        }
                        value={settings.swannCams.customer}
                        onChange={(e) => updateSettings({ swannCams: { ...settings.swannCams, customer: e.target.value } })}
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] font-black text-slate-500 uppercase ml-1">
                      Entrance/Vehicle Cam ({settings.cameraBrand === 'swann' ? 'Swann CGI' : 'Snapshot URL'})
                    </label>
                    <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center gap-2">
                      <Video className="w-4 h-4 text-slate-400" />
                      <input 
                        type="text"
                        className="bg-transparent border-none outline-none text-xs font-bold w-full"
                        placeholder={
                          settings.cameraBrand === 'swann'
                            ? "http://192.168.1.50/cgi-bin/snapshot.cgi?channel=3"
                            : "http://192.168.1.50/snapshot.jpg"
                        }
                        value={settings.swannCams.entrance}
                        onChange={(e) => updateSettings({ swannCams: { ...settings.swannCams, entrance: e.target.value } })}
                      />
                    </div>
                  </div>
                </>
              )}

              {/* CORS & Network Guidance Note */}
              <div className="p-4 bg-amber-50 rounded-2xl border border-amber-100 space-y-2 mt-2">
                <h4 className="text-[10px] font-black text-amber-900 uppercase tracking-wider flex items-center gap-2">
                  ⚠️ Local IP Connection & CORS Bypassing Options
                </h4>
                <p className="text-[10px] text-amber-800 font-bold leading-normal">
                  Since the PMR app runs on a secure HTTPS domain, browsers strictly block requests directly to standard local HTTP camera IPs (Mixed Content/CORS block). To deploy seamlessly:
                </p>
                <ol className="list-decimal list-inside text-[9px] text-amber-800 font-medium space-y-1 pl-1 leading-normal">
                  <li><strong>Local Hardware Bridge:</strong> Ensure your local Scale/Scanner Bridge (running on localhost) proxies these camera urls directly. Browser sandbox exceptions allow calling localhost hardware bridges.</li>
                  <li><strong>Browser CORS Extension:</strong> On dedicated cashier on-premise PCs, configure an Allow-CORS Chrome extension to permit cross-origin image loads.</li>
                  <li><strong>Local HTTPS Proxy:</strong> Set up a lightweight Nginx local server that maps your camera streams to a signed secure endpoint on your intranet.</li>
                </ol>
              </div>

              {/* Laptop Rotational Station Monitor */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3 mt-4">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                    <MonitorSmartphone className="w-3.5 h-3.5 text-slate-400" />
                    Laptop Rotational Tag
                  </span>
                  <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-[9px] font-bold">Active Station</span>
                </div>
                <p className="text-[10px] text-slate-500 font-medium">
                  Since you use rotating laptops running this cloud-ready web application, assign a label to identify this specific PC. Diagnostics will be logged under this label.
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={localLaptopId}
                    onChange={(e) => handleLaptopIdChange(e.target.value)}
                    placeholder="e.g., Register Workstation Left"
                    className="flex-1 bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-bold outline-none focus:border-blue-500 text-slate-800"
                  />
                </div>
              </div>

              {/* IP Camera Real-Time Connection Diagnostics & Troubleshooting */}
              <div className="p-4 bg-slate-900 text-slate-100 rounded-2xl border border-slate-800 space-y-4 shadow-xl mt-4">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <div className="flex items-center gap-2">
                    <Activity className="w-4 h-4 text-emerald-400 animate-pulse" />
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-200">Local Connection Diagnostics</span>
                  </div>
                  <span className="text-[9px] font-bold text-slate-400">Ohio Compliance Guard</span>
                </div>

                <div className="space-y-3">
                  {(['material', 'customer', 'entrance'] as const).map(camKey => {
                    const res = diagnosticResults[camKey];
                    const url = getCameraUrlForDiagnostic(camKey);
                    const label = camKey === 'material' ? 'Material Station' : camKey === 'customer' ? 'Customer Face' : 'Entrance / Vehicle';
                    
                    return (
                      <div key={camKey} className="p-3 bg-slate-950/60 rounded-xl space-y-2 border border-slate-800">
                        <div className="flex items-center justify-between">
                          <p className="text-[10px] font-black uppercase tracking-wider text-slate-300">{label}</p>
                          <div className="flex items-center gap-1.5">
                            {res.status === 'success' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
                            {res.status === 'error' && <AlertCircle className="w-3.5 h-3.5 text-rose-400" />}
                            {res.status === 'checking' && <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin" />}
                            {res.status === 'untested' && <span className="w-2 h-2 rounded-full bg-slate-600" />}
                            <span className={cn(
                              "text-[9px] font-black uppercase tracking-widest",
                              res.status === 'success' && "text-emerald-400",
                              res.status === 'error' && "text-rose-400",
                              res.status === 'checking' && "text-blue-400",
                              res.status === 'untested' && "text-slate-400"
                            )}>
                              {res.status}
                            </span>
                          </div>
                        </div>

                        {url ? (
                          <div className="space-y-1.5">
                            <p className="text-[9px] font-mono text-slate-400 truncate bg-slate-900 border border-slate-800 px-2 py-1 rounded select-all mb-1">{url}</p>
                            <p className="text-[9px] text-slate-300 leading-normal">{res.detail}</p>
                            
                            <div className="flex gap-2 pt-1">
                              <button
                                type="button"
                                disabled={res.status === 'checking'}
                                onClick={() => runCameraDiagnostic(camKey)}
                                className="px-3 py-1.5 bg-slate-800 text-white rounded-lg text-[9px] font-black uppercase tracking-widest hover:bg-slate-700 active:scale-95 transition-all outline-none"
                              >
                                Test Link
                              </button>
                              
                              {res.previewUrl && (
                                <button
                                  type="button"
                                  onClick={() => window.open(res.previewUrl, '_blank')}
                                  className="px-3 py-1.5 bg-slate-800 text-blue-400 rounded-lg text-[9px] font-black uppercase tracking-widest hover:bg-slate-700 transition-all flex items-center gap-1"
                                >
                                  View Frame <ExternalLink className="w-2.5 h-2.5" />
                                </button>
                              )}
                            </div>

                            {res.status === 'success' && res.previewUrl && (
                              <div className="mt-2 border border-slate-850 rounded-lg overflow-hidden relative group aspect-video bg-slate-900">
                                <img 
                                  src={res.previewUrl} 
                                  alt="Live Test Frame" 
                                  className="w-full h-full object-cover" 
                                  referrerPolicy="no-referrer"
                                  onError={() => {
                                    setDiagnosticResults(prev => ({
                                      ...prev,
                                      [camKey]: { status: 'error', detail: 'Preview load failed. Browser CORS extension might have turned off.' }
                                    }));
                                  }}
                                />
                                <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                  <span className="text-[8px] font-black uppercase tracking-widest text-slate-200">Active Camera Feed</span>
                                </div>
                              </div>
                            )}
                          </div>
                        ) : (
                          <p className="text-[9px] text-slate-500 italic">No URL configured. Fill out input field above to test.</p>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="p-3 bg-blue-950/40 border border-blue-900/50 rounded-xl space-y-1">
                  <h5 className="text-[9px] font-black text-blue-300 uppercase tracking-wider flex items-center gap-1">
                    <Info className="w-3 h-3 text-blue-400" />
                    Rotational Laptop best practices
                  </h5>
                  <p className="text-[9px] text-blue-200 leading-normal font-medium">
                    Since you keep separate laptops in rotation, keep the <strong>Allow CORS</strong> Chrome extension active on their browsers. Always run <strong>Test Link</strong> above to verify communication.
                  </p>
                </div>
              </div>

              {/* Camera Diagnostics & Raw Network Ping Utility */}
              <div className="p-5 bg-white border border-slate-200 rounded-2xl space-y-4 shadow-sm mt-4 text-slate-800">
                <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
                  <Activity className="w-4 h-4 text-blue-600" />
                  <span className="text-xs font-black uppercase tracking-wider text-slate-800">Advanced Camera Diagnostics & Ping</span>
                </div>

                <p className="text-[11px] text-slate-500 font-medium leading-relaxed">
                  Is your camera failing to display? Use this low-level diagnostics tool to send a raw network packet directly from your browser to check if the camera IP is reachable, or test through the cloud proxy.
                </p>

                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-[9px] font-black uppercase text-slate-400 ml-1">Protocol</label>
                      <select
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none cursor-pointer text-slate-700"
                        value={customCamProtocol}
                        onChange={(e) => setCustomCamProtocol(e.target.value as 'http' | 'https')}
                      >
                        <option value="http">http://</option>
                        <option value="https">https://</option>
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[9px] font-black uppercase text-slate-400 ml-1">Port</label>
                      <input
                        type="text"
                        placeholder="e.g. 80"
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none text-slate-700"
                        value={customCamPort}
                        onChange={(e) => setCustomCamPort(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[9px] font-black uppercase text-slate-400 ml-1">IP Address / NVR Hostname</label>
                    <input
                      type="text"
                      placeholder="e.g. 192.168.1.50 or external.ddns.net"
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none text-slate-700"
                      value={customCamIp}
                      onChange={(e) => setCustomCamIp(e.target.value)}
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[9px] font-black uppercase text-slate-400 ml-1">Snapshot Path / URL Path</label>
                    <input
                      type="text"
                      placeholder="e.g. /cgi-bin/snapshot.cgi?channel=1"
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono outline-none text-slate-700"
                      value={customCamPath}
                      onChange={(e) => setCustomCamPath(e.target.value)}
                    />
                  </div>

                  <div className="space-y-1 pt-1">
                    <label className="text-[9px] font-black uppercase text-slate-400 ml-1">Ping Mode</label>
                    <div className="grid grid-cols-3 gap-1">
                      {(['no-cors', 'cors', 'proxy'] as const).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => setCustomCamMode(mode)}
                          className={cn(
                            "py-1.5 px-2 rounded-lg text-[9px] font-black uppercase tracking-wider border text-center transition-all cursor-pointer",
                            customCamMode === mode
                              ? "bg-blue-600 border-blue-600 text-white"
                              : "bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100"
                          )}
                        >
                          {mode === 'no-cors' ? 'Browser Ping' : mode === 'cors' ? 'CORS' : 'Cloud Proxy'}
                        </button>
                      ))}
                    </div>
                    <p className="text-[8px] text-slate-400 leading-normal mt-1 font-medium">
                      {customCamMode === 'no-cors' && '💡 Browser Ping (no-cors) checks LAN connectivity directly. Bypasses browser CORS but returns opaque data.'}
                      {customCamMode === 'cors' && '⚠️ Checks if direct cross-origin loads are allowed. Fails if camera is unencrypted HTTP.'}
                      {customCamMode === 'proxy' && '🔒 Cloud Proxy routes the camera check through our cloud server (bypasses HTTPS/Mixed Content blocks completely).'}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={runCustomCameraConnectivityCheck}
                    disabled={customDiagStatus === 'testing'}
                    className="w-full py-3 bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-black hover:shadow-md active:scale-95 transition-all outline-none flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    {customDiagStatus === 'testing' ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Running Diagnostics...</span>
                      </>
                    ) : (
                      <>
                        <Activity className="w-4 h-4" />
                        <span>Test Camera Connectivity</span>
                      </>
                    )}
                  </button>

                  {/* Test Result Display */}
                  {customDiagStatus !== 'untested' && (
                    <div className={cn(
                      "p-3 rounded-xl border space-y-2 text-left mt-2",
                      customDiagStatus === 'success' && "bg-emerald-50 border-emerald-100 text-emerald-900",
                      customDiagStatus === 'error' && "bg-rose-50 border-rose-100 text-rose-900",
                      customDiagStatus === 'testing' && "bg-blue-50 border-blue-100 text-blue-900"
                    )}>
                      <div className="flex items-center gap-1.5">
                        {customDiagStatus === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-600" />}
                        {customDiagStatus === 'error' && <AlertCircle className="w-4 h-4 text-rose-600" />}
                        {customDiagStatus === 'testing' && <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />}
                        <span className="text-[10px] font-black uppercase tracking-wider">{customDiagMsg}</span>
                      </div>
                      <p className="text-[9px] font-medium leading-relaxed whitespace-pre-line font-mono bg-white/60 p-2 rounded border border-black/5 select-all">
                        {customDiagDetail}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Data Import Section */}
        <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm space-y-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-50 rounded-xl text-blue-600">
              <Upload className="w-5 h-5" />
            </div>
            <h3 className="font-black text-slate-900 uppercase tracking-tight">Data Import</h3>
          </div>
          
          <p className="text-sm text-slate-500 font-medium">
            Seed your database by importing CSV files for materials or customers.
          </p>

          <div className="space-y-4">
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <input
                  type="file"
                  id="import-materials"
                  accept=".csv"
                  className="hidden"
                  onChange={(e) => handleImportCSV(e, 'materials')}
                  disabled={processing}
                />
                <label
                  htmlFor="import-materials"
                  className="flex items-center justify-between p-4 bg-slate-50 border border-slate-200 rounded-2xl cursor-pointer hover:border-blue-300 hover:bg-blue-50 transition-all group h-full"
                >
                  <div className="flex items-center gap-3">
                    <Package className="w-5 h-5 text-slate-400 group-hover:text-blue-600" />
                    <span className="text-sm font-bold text-slate-700">Import Materials</span>
                  </div>
                  <FileSpreadsheet className="w-4 h-4 text-slate-300" />
                </label>
              </div>
              <button 
                onClick={() => downloadTemplate('materials')}
                className="p-4 bg-slate-50 border border-slate-200 rounded-2xl hover:bg-slate-100 transition-all text-slate-400 hover:text-slate-600"
                title="Download Template"
              >
                <Download className="w-5 h-5" />
              </button>
            </div>

            <div className="flex gap-2">
              <div className="flex-1 relative">
                <input
                  type="file"
                  id="import-customers"
                  accept=".csv"
                  className="hidden"
                  onChange={(e) => handleImportCSV(e, 'customers')}
                  disabled={processing}
                />
                <label
                  htmlFor="import-customers"
                  className="flex items-center justify-between p-4 bg-slate-50 border border-slate-200 rounded-2xl cursor-pointer hover:border-blue-300 hover:bg-blue-50 transition-all group h-full"
                >
                  <div className="flex items-center gap-3">
                    <UserPlus className="w-5 h-5 text-slate-400 group-hover:text-blue-600" />
                    <span className="text-sm font-bold text-slate-700">Import Customers</span>
                  </div>
                  <FileSpreadsheet className="w-4 h-4 text-slate-300" />
                </label>
              </div>
              <button 
                onClick={() => downloadTemplate('customers')}
                className="p-4 bg-slate-50 border border-slate-200 rounded-2xl hover:bg-slate-100 transition-all text-slate-400 hover:text-slate-600"
                title="Download Template"
              >
                <Download className="w-5 h-5" />
              </button>
            </div>
          </div>

          <div className="p-4 bg-amber-50 rounded-2xl border border-amber-100">
            <p className="text-[10px] font-black text-amber-800 uppercase tracking-widest mb-1">CSV Format Requirements</p>
            <ul className="text-[10px] text-amber-700 space-y-1 font-bold">
              <li>• Materials: code, name, category, buyPrice, salePrice, unit</li>
              <li>• Customers: name, businessName, phone, email, address, isBuyer</li>
              <li>• Headers must match exactly (case-sensitive)</li>
            </ul>
          </div>
        </div>

        {/* Maintenance Section */}
        <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm space-y-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-50 rounded-xl text-red-600">
              <RefreshCcw className="w-5 h-5" />
            </div>
            <h3 className="font-black text-slate-900 uppercase tracking-tight">System Maintenance</h3>
          </div>

          <p className="text-sm text-slate-500 font-medium">
            Clear transactional data to prepare the system for production use.
          </p>

          <div className="space-y-4 pt-4">
            <button
              onClick={() => setShowPinModal(true)}
              disabled={processing || !profile?.permissions?.canDeleteData}
              className="w-full flex items-center justify-between p-6 bg-white border-2 border-red-100 rounded-3xl hover:bg-red-50 hover:border-red-200 transition-all group disabled:opacity-50 disabled:grayscale disabled:cursor-not-allowed"
            >
              <div className="text-left">
                <p className="font-black text-red-600 uppercase tracking-tight">Factory Reset</p>
                <p className="text-[10px] text-red-400 font-bold uppercase tracking-widest mt-1">
                  {!profile?.permissions?.canDeleteData ? "Permission Required" : "Wipe all tickets & invoices"}
                </p>
              </div>
              {processing ? (
                <Loader2 className="w-6 h-6 text-red-600 animate-spin" />
              ) : (
                <Trash2 className="w-6 h-6 text-red-200 group-hover:text-red-600 transition-colors" />
              )}
            </button>
          </div>

          <ManagerPinModal
            isOpen={showPinModal}
            onClose={() => setShowPinModal(false)}
            onSuccess={() => setShowResetConfirm(true)}
            title="Admin Authorization"
            message="A Manager PIN is required to authorize a full system factory reset. This action cannot be undone."
          />

          {/* Reset Confirmation Modal */}
          {showResetConfirm && (
            <div className="fixed inset-0 bg-slate-900/80 z-[100] flex items-center justify-center p-4 backdrop-blur-sm">
              <div className="bg-white rounded-[2.5rem] w-full max-w-md p-10 shadow-2xl animate-in zoom-in-95 duration-200 space-y-8">
                <div className="flex flex-col items-center text-center space-y-4">
                  <div className="p-4 bg-red-100 rounded-full text-red-600">
                    <AlertTriangle className="w-10 h-10" />
                  </div>
                  <div className="space-y-2">
                    <h2 className="text-2xl font-black text-slate-900 uppercase tracking-tight">Critical Warning</h2>
                    <p className="text-sm text-slate-500 font-medium">
                      {resetStep === 0 
                        ? "This will permanently delete ALL tickets, invoices, customers, and inventory data. This action CANNOT be undone."
                        : "Are you ABSOLUTELY sure? This is your final warning before all transactional data is wiped."}
                    </p>
                  </div>
                </div>

                <div className="flex flex-col gap-3">
                  {resetStep === 0 ? (
                    <button
                      onClick={() => setResetStep(1)}
                      className="w-full py-4 bg-red-600 text-white rounded-2xl font-black text-sm uppercase tracking-widest hover:bg-red-700 transition-all shadow-lg shadow-red-200"
                    >
                      I Understand, Continue
                    </button>
                  ) : (
                    <button
                      onClick={handleResetData}
                      className="w-full py-4 bg-red-900 text-white rounded-2xl font-black text-sm uppercase tracking-widest hover:bg-red-950 transition-all shadow-lg shadow-red-200"
                    >
                      Yes, Wipe All Data
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setShowResetConfirm(false);
                      setResetStep(0);
                    }}
                    className="w-full py-4 bg-slate-100 text-slate-600 rounded-2xl font-black text-sm uppercase tracking-widest hover:bg-slate-200 transition-all"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
              <p className="text-[10px] text-slate-500 font-bold leading-relaxed">
                Resetting will preserve your <span className="text-slate-900">Materials list</span> and <span className="text-slate-900">User accounts</span>. All other data including customer records, history, and inventory will be permanently removed.
              </p>
            </div>
          </div>
        </div>

        {/* Network & System Info */}
          </div>
        </>
      ) : (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Users List */}
            <div className="lg:col-span-1 space-y-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Team Members</h3>
                  <button 
                    onClick={() => setShowInviteModal(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-blue-700 transition-all shadow-lg shadow-blue-200"
                  >
                    <Plus className="w-3 h-3" />
                    Add User
                  </button>
                </div>
                <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden divide-y divide-slate-50">
                  {users.map((u) => (
                    <button
                      key={u.uid}
                      onClick={() => setSelectedUser(u)}
                      className={cn(
                        "w-full text-left p-4 hover:bg-slate-50 transition-all flex items-center gap-3 group",
                        selectedUser?.uid === u.uid ? "bg-blue-50/50" : ""
                      )}
                    >
                      <div className={cn(
                        "w-10 h-10 rounded-xl flex items-center justify-center font-bold relative",
                        u.role === 'manager' ? "bg-amber-100 text-amber-600" : "bg-slate-100 text-slate-500"
                      )}>
                        {u.displayName?.charAt(0) || u.email?.charAt(0).toUpperCase()}
                        {u.role === 'manager' && <Shield className="w-3 h-3 absolute -top-1 -right-1 text-amber-500 fill-amber-500" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-slate-900 truncate">{u.displayName || u.email?.split('@')[0]}</p>
                        <p className="text-[10px] text-slate-400 font-bold uppercase truncate">{u.role}</p>
                      </div>
                      <ChevronRight className={cn(
                        "w-4 h-4 text-slate-300 transition-all",
                        selectedUser?.uid === u.uid ? "translate-x-1 text-blue-500" : "group-hover:translate-x-1"
                      )} />
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* User Details & Permissions */}
            <div className="lg:col-span-2 space-y-6">
              {selectedUser ? (
                <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm space-y-8">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                      <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center text-2xl font-black text-slate-400">
                        {selectedUser.displayName?.charAt(0) || selectedUser.email.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <h2 className="text-2xl font-black text-slate-900 tracking-tight">{selectedUser.displayName || 'System User'}</h2>
                        <p className="text-sm text-slate-500 font-medium">{selectedUser.email}</p>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Access Level</label>
                      <select
                        className="px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                        value={selectedUser.role}
                        onChange={(e) => handleUpdateUserRole(selectedUser.uid, e.target.value as UserRole)}
                        disabled={savingUser || selectedUser.uid === profile?.uid}
                      >
                        <option value="cashier">Cashier</option>
                        <option value="manager">Manager</option>
                      </select>
                    </div>
                  </div>

                  <div className="space-y-6 pt-6 border-t border-slate-100">
                    <div className="flex items-center gap-3">
                      <Lock className="w-5 h-5 text-blue-600" />
                      <h3 className="font-black text-slate-900 uppercase tracking-tight">Granular Permissions</h3>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {Object.entries({
                        canManagePrices: 'Modify material prices',
                        canManageUsers: 'Edit team roles & permissions',
                        canVoidTickets: 'Void or cancel buy tickets',
                        canDeleteData: 'Perform system resets',
                        canManageInventory: 'Update stock levels',
                        canGenerateReports: 'Access analytics & data',
                        canManageInvoices: 'Create & edit sale invoices',
                        canManageCash: 'Manage cash reconciliation',
                        canApproveChanges: 'Authorize manager overrides',
                        canOpenCloseSessions: 'Open & close money drawer',
                        canRetroactivePriceAdjustments: 'Adjust prices on tickets'
                      }).map(([key, label]) => (
                        <button
                          key={key}
                          disabled={savingUser || (key === 'canManageUsers' && selectedUser.uid === profile?.uid)}
                          onClick={() => {
                            const currentPermissions = selectedUser.permissions || {
                              canManagePrices: false,
                              canManageUsers: false,
                              canVoidTickets: false,
                              canDeleteData: false,
                              canManageInventory: false,
                              canGenerateReports: false,
                              canManageInvoices: false,
                              canManageCash: false,
                              canApproveChanges: false,
                              canOpenCloseSessions: false,
                              canRetroactivePriceAdjustments: false,
                            };
                            handleUpdateUserPermissions(selectedUser.uid, {
                              ...currentPermissions,
                              [key]: !currentPermissions[key as keyof UserPermissions]
                            });
                          }}
                          className={cn(
                            "flex items-center justify-between p-4 rounded-2xl border transition-all hover:shadow-sm",
                            selectedUser.permissions?.[key as keyof UserPermissions]
                              ? "bg-blue-50/50 border-blue-100 border-2" 
                              : "bg-white border-slate-100 grayscale opacity-60"
                          )}
                        >
                          <div className="text-left">
                            <p className={cn(
                              "text-sm font-black uppercase tracking-tight",
                              selectedUser.permissions?.[key as keyof UserPermissions] ? "text-blue-900" : "text-slate-500"
                            )}>
                              {key.slice(3).replace(/([A-Z])/g, ' $1').trim()}
                            </p>
                            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">{label}</p>
                          </div>
                          <div className={cn(
                            "w-10 h-5 rounded-full transition-colors relative",
                            selectedUser.permissions?.[key as keyof UserPermissions] ? "bg-blue-600" : "bg-slate-300"
                          )}>
                            <div className={cn(
                              "absolute top-1 w-3 h-3 bg-white rounded-full transition-all",
                              selectedUser.permissions?.[key as keyof UserPermissions] ? "left-6" : "left-1"
                            )} />
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {selectedUser.managerPin ? (
                    <div className="p-6 bg-slate-50 rounded-3xl border border-slate-100 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Fingerprint className="w-5 h-5 text-slate-400" />
                        <div>
                          <p className="text-xs font-bold text-slate-700">Security PIN Assigned</p>
                          <p className="text-[10px] text-slate-400 font-bold uppercase">PIN required for sensitive operations</p>
                        </div>
                      </div>
                      <div className="flex gap-1">
                        {[1, 2, 3, 4].map((i) => (
                          <div key={i} className="w-2 h-2 rounded-full bg-slate-300" />
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="p-6 bg-amber-50 rounded-3xl border border-amber-100 flex items-center gap-3">
                      <AlertTriangle className="w-5 h-5 text-amber-600" />
                      <div>
                        <p className="text-xs font-bold text-amber-800">No Security PIN Set</p>
                        <p className="text-[10px] text-amber-600 font-bold uppercase">This user cannot authorize overrides yet</p>
                      </div>
                    </div>
                  )}

                  {/* Password Reset Section */}
                  <div className="p-6 bg-slate-50/50 rounded-3xl border border-slate-100 space-y-6">
                    <div className="flex items-center gap-3">
                      <KeyRound className="w-5 h-5 text-blue-600" />
                      <div>
                        <h4 className="text-xs font-black text-slate-900 uppercase tracking-tight">Password Reset</h4>
                        <p className="text-[10px] text-slate-400 font-bold uppercase">Perform administrative password reset</p>
                      </div>
                    </div>

                    <div className="space-y-4">
                      {/* Reset form */}
                      <div className="space-y-3">
                        <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block">New Password</label>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            placeholder="Type new password (min. 6 chars)..."
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            disabled={resettingPassword}
                            className="flex-1 px-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-100 transition-colors placeholder:text-slate-300"
                          />
                          <button
                            onClick={() => handleResetPassword(selectedUser.uid, selectedUser.email)}
                            disabled={resettingPassword || !newPassword || newPassword.length < 6}
                            className="px-4 py-2 bg-slate-900 text-white hover:bg-blue-600 rounded-xl text-[10px] font-black uppercase tracking-widest transition-colors disabled:opacity-45 disabled:hover:bg-slate-900 cursor-pointer"
                          >
                            {resettingPassword ? 'Resetting...' : 'Reset Key'}
                          </button>
                        </div>

                        {passwordError && (
                          <p className="text-[9px] font-bold text-red-600 uppercase tracking-wider">{passwordError}</p>
                        )}
                        {passwordSuccess && (
                          <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-100">
                            <p className="text-[9px] font-bold text-emerald-800 leading-relaxed uppercase">{passwordSuccess}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="pt-6 border-t border-slate-100">
                    <button
                      onClick={() => {
                        setUserToDelete(selectedUser);
                        setDeleteConfirmText('');
                      }}
                      disabled={selectedUser.uid === profile?.uid}
                      className="w-full py-4 bg-red-50 text-red-600 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-red-100 transition-all border border-red-100 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Trash2 className="w-4 h-4" />
                      {selectedUser.uid === profile?.uid ? 'Cannot Delete Own Account' : 'Remove User From System'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center p-12 text-center bg-white rounded-[2.5rem] border border-slate-200 border-dashed">
                  <div className="p-4 bg-slate-50 rounded-full text-slate-300 mb-4">
                    <UserCheck className="w-12 h-12" />
                  </div>
                  <h3 className="text-xl font-black text-slate-900 uppercase tracking-tight">User Management</h3>
                  <p className="text-sm text-slate-500 max-w-xs mt-2">Select a team member from the list to manage their roles and granular system permissions.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'sessions' && (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm space-y-8">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-50 rounded-xl text-blue-600">
                  <Activity className="w-5 h-5" />
                </div>
                <h3 className="font-black text-slate-900 uppercase tracking-tight">Login Logs & Sessions</h3>
              </div>
              <div className="flex items-center gap-2 px-4 py-2 bg-slate-50 rounded-2xl border border-slate-100">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                  {sessions.filter(s => s.status === 'active' && (new Date().getTime() - new Date(s.lastActiveAt).getTime()) < 15 * 60 * 1000).length} Currently Active
                </span>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-50">
                    <th className="text-left py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">User</th>
                    <th className="text-left py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Hardware ID</th>
                    <th className="text-left py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Last Activity</th>
                    <th className="text-left py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Status</th>
                    <th className="text-right py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {sessions.map(session => {
                    const lastActive = new Date(session.lastActiveAt);
                    const isOnline = (new Date().getTime() - lastActive.getTime()) < 15 * 60 * 1000 && session.status === 'active';
                    
                    return (
                      <tr key={session.id} className="group hover:bg-slate-50 transition-colors">
                        <td className="py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center font-bold text-slate-400 text-xs">
                              {session.displayName?.charAt(0) || session.userEmail.charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <p className="text-xs font-bold text-slate-900">{session.displayName || 'System User'}</p>
                              <p className="text-[10px] text-slate-400 font-bold">{session.userEmail}</p>
                            </div>
                          </div>
                        </td>
                        <td className="py-4">
                          <div className="flex items-center gap-2 font-mono text-[9px] text-slate-500">
                             {session.userAgent.includes('Mobile') ? <Smartphone className="w-3 h-3 text-slate-400" /> : <Monitor className="w-3 h-3 text-slate-400" />}
                             <span className="truncate max-w-[120px]">
                               {session.hardwareId}
                             </span>
                          </div>
                        </td>
                        <td className="py-4">
                          <div className="flex items-center gap-2 text-[10px] font-bold text-slate-500 uppercase tracking-tight">
                            <Clock className="w-3 h-3" />
                            {new Date(session.lastActiveAt).toLocaleTimeString()}
                          </div>
                        </td>
                        <td className="py-4">
                          {isOnline ? (
                            <span className="px-2 py-1 bg-green-100 text-green-700 rounded-full text-[8px] font-black uppercase tracking-widest">Online</span>
                          ) : (
                            <span className="px-2 py-1 bg-slate-100 text-slate-400 rounded-full text-[8px] font-black uppercase tracking-widest">Offline</span>
                          )}
                        </td>
                        <td className="py-4 text-right">
                          <button
                            onClick={() => handleTerminateSession(session.id)}
                            className="p-2 text-slate-300 hover:text-red-500 transition-colors"
                            title="Terminate Session"
                          >
                            <LogOut className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {sessions.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-12 text-center text-slate-400 font-medium italic">No recent login sessions recorded.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="text-[10px] text-slate-400 italic">
              * Sessions are automatically tracked per device. Hardware ID is unique to each browser instance using this hardware.
            </p>
          </div>
        </div>
      )}

      {/* Add User Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-white rounded-[2.5rem] shadow-2xl max-w-md w-full p-8 space-y-8 animate-in zoom-in-95 duration-300 border border-slate-100">
            {justCreatedUser ? (
              <div className="space-y-6 text-center animate-in fade-in duration-300">
                <div className="w-16 h-16 bg-emerald-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <CheckCircle2 className="w-8 h-8 text-emerald-600" />
                </div>
                <h2 className="text-2xl font-black text-slate-900 tracking-tight">Account Created!</h2>
                <p className="text-xs text-slate-500 font-medium">The new user has been registered in the system. Print or copy their credentials below.</p>
                
                <div className="bg-slate-50 p-6 rounded-3xl border border-slate-100 text-left space-y-4 font-mono text-xs text-slate-700 relative">
                  <div>
                    <span className="text-[10px] uppercase font-black text-slate-400 block tracking-widest">Full Name</span>
                    <span className="text-sm font-bold text-slate-900">{justCreatedUser.name}</span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-black text-slate-400 block tracking-widest">Role</span>
                    <span className="text-sm font-bold text-slate-900 uppercase tracking-wide">{justCreatedUser.role}</span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-black text-slate-400 block tracking-widest">Email Address / Login</span>
                    <span className="text-sm font-bold text-slate-900">{justCreatedUser.email}</span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-black text-slate-400 block tracking-widest">Temporary Password</span>
                    <span className="text-sm font-bold text-slate-900 bg-amber-100/60 px-1.5 py-0.5 rounded">{justCreatedUser.password}</span>
                  </div>
                  {justCreatedUser.role === 'manager' && (
                    <div className="pt-2 border-t border-slate-200">
                      <span className="text-[10px] uppercase font-black text-slate-400 block tracking-widest">Default Manager PIN</span>
                      <span className="text-sm font-bold text-slate-900">1234</span>
                    </div>
                  )}
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    onClick={() => {
                      const text = `--- PREFERRED METALS ACCESS ---\nName: ${justCreatedUser.name}\nRole: ${justCreatedUser.role}\nEmail: ${justCreatedUser.email}\nPassword: ${justCreatedUser.password}\n${justCreatedUser.role === 'manager' ? 'Default PIN: 1234' : ''}`;
                      navigator.clipboard.writeText(text);
                      setIsCopied(true);
                      setTimeout(() => setIsCopied(false), 2000);
                    }}
                    className={cn(
                      "flex-1 py-4 rounded-2xl font-black text-xs uppercase tracking-widest border transition-all flex items-center justify-center gap-2",
                      isCopied 
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200" 
                        : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                    )}
                  >
                    {isCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    {isCopied ? "Copied!" : "Copy Details"}
                  </button>
                  <button
                    onClick={() => {
                      setJustCreatedUser(null);
                      setShowInviteModal(false);
                    }}
                    className="flex-1 py-4 bg-slate-900 text-white hover:bg-slate-800 transition-all rounded-2xl font-black text-xs uppercase tracking-widest"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="text-center space-y-2">
                  <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                    <UserPlus className="w-8 h-8 text-blue-600" />
                  </div>
                  <h2 className="text-2xl font-black text-slate-900 tracking-tight">Add New User</h2>
                  <p className="text-sm text-slate-500 font-medium">Create a local account for a new team member.</p>
                </div>

                <div className="space-y-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Full Name</label>
                    <input
                      type="text"
                      value={inviteName}
                      onChange={(e) => setInviteName(e.target.value)}
                      placeholder="e.g. John Doe"
                      className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Email Address</label>
                    <input
                      type="email"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      placeholder="e.g. employee@gmail.com"
                      className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Temporary Password</label>
                    <input
                      type="password"
                      value={invitePassword}
                      onChange={(e) => setInvitePassword(e.target.value)}
                      placeholder="At least 6 characters"
                      className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Assigned Role</label>
                    <div className="grid grid-cols-2 gap-3">
                      {(['cashier', 'manager'] as UserRole[]).map((role) => (
                        <button
                          key={role}
                          onClick={() => setInviteRole(role)}
                          className={cn(
                            "py-3 rounded-xl text-[10px] font-black uppercase tracking-widest border-2 transition-all",
                            inviteRole === role 
                              ? "bg-blue-50 border-blue-600 text-blue-600 shadow-md" 
                              : "bg-white border-slate-100 text-slate-400 hover:border-slate-200"
                          )}
                        >
                          {role}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="bg-blue-50 rounded-2xl p-4 flex gap-3 border border-blue-100">
                    <Info className="w-5 h-5 text-blue-500 shrink-0" />
                    <p className="text-[10px] text-blue-900 font-bold leading-relaxed">
                      The user will be able to log in immediately using these credentials. Ensure they change their password later.
                    </p>
                  </div>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      setShowInviteModal(false);
                      setJustCreatedUser(null);
                    }}
                    className="flex-1 py-4 bg-slate-100 text-slate-600 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-slate-200 transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCreateUser}
                    disabled={processing}
                    className="flex-1 py-4 bg-blue-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-blue-700 transition-all shadow-xl shadow-blue-200 flex items-center justify-center gap-2"
                  >
                    {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                    Create User
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Delete User Confirmation Modal */}
      {userToDelete && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-white rounded-[2.5rem] shadow-2xl max-w-md w-full p-8 space-y-6 animate-in zoom-in-95 duration-300 border border-red-50 font-sans">
            <div className="text-center space-y-2">
              <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-4 animate-pulse">
                <ShieldAlert className="w-8 h-8 text-red-600" />
              </div>
              <h2 className="text-2xl font-black text-slate-900 tracking-tight">Delete Account?</h2>
              <p className="text-sm text-slate-500 font-medium">Are you sure you want to remove this user from the system?</p>
            </div>

            <div className="bg-red-50/50 p-5 rounded-3xl border border-red-100 text-xs text-red-900 font-bold leading-relaxed space-y-2">
              <p>
                This will permanently delete the profile of <span className="text-slate-900 font-black">{userToDelete.displayName}</span> (<span className="text-slate-900">{userToDelete.email}</span>).
              </p>
              <p>
                They will lose all administrative or cashiering capabilities immediately, and any ongoing login session on any terminal will be voided.
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
                Type <span className="text-red-600 font-black">DELETE</span> to confirm
              </label>
              <input
                type="text"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder="DELETE"
                className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold focus:ring-2 focus:ring-red-500 outline-none transition-all uppercase tracking-widest"
              />
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setUserToDelete(null);
                  setDeleteConfirmText('');
                }}
                className="flex-1 py-4 bg-slate-100 text-slate-600 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-slate-200 transition-all"
              >
                Keep User
              </button>
              <button
                onClick={handleDeleteUserConfirm}
                disabled={processing || deleteConfirmText.trim().toUpperCase() !== 'DELETE'}
                className="flex-1 py-4 bg-red-600 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-red-700 transition-all shadow-xl shadow-red-200 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none"
              >
                {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                Confirm Delete
              </button>
            </div>
          </div>
        </div>
      )}
      {activeTab === 'system' && systemConfig && (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Maintenance Mode */}
            <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm space-y-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-amber-50 rounded-xl text-amber-600">
                    <ShieldAlert className="w-5 h-5" />
                  </div>
                  <h3 className="font-black text-slate-900 uppercase tracking-tight">Maintenace Gate</h3>
                </div>
                <button
                  onClick={() => handleUpdateSystemConfig({ maintenanceMode: !systemConfig.maintenanceMode })}
                  className={cn(
                    "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
                    systemConfig.maintenanceMode ? "bg-amber-500" : "bg-slate-200"
                  )}
                >
                  <span className={cn(
                    "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
                    systemConfig.maintenanceMode ? "translate-x-6" : "translate-x-1"
                  )} />
                </button>
              </div>

              <div className="space-y-4 pt-4 border-t border-slate-50">
                <p className="text-xs text-slate-500 font-medium leading-relaxed">
                  When active, all Cashiers will be redirected to a maintenance screen. Only Managers can bypass this for testing and updates.
                </p>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Maintenance Message</label>
                  <textarea
                    value={systemConfig.maintenanceMessage || ''}
                    onChange={(e) => handleUpdateSystemConfig({ maintenanceMessage: e.target.value })}
                    placeholder="Provide a reason or ETA..."
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-bold focus:ring-2 focus:ring-blue-500 outline-none transition-all resize-none h-24"
                  />
                </div>
              </div>
            </div>

            {/* Version & Update Control */}
            <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm space-y-6">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-50 rounded-xl text-blue-600">
                  <RefreshCw className="w-5 h-5" />
                </div>
                <h3 className="font-black text-slate-900 uppercase tracking-tight">Software Updates</h3>
              </div>

              <div className="space-y-6">
                <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                  <div>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Local Version</p>
                    <p className="text-sm font-black text-slate-900">{APP_VERSION}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Global Live Version</p>
                    <p className="text-sm font-black text-blue-600">{systemConfig.currentVersion}</p>
                  </div>
                </div>

                <div className="space-y-3">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Release New Version</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      id="newVersionInput"
                      placeholder="e.g. 1.1.0"
                      className="flex-1 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                    />
                    <button
                      onClick={() => {
                        const val = (document.getElementById('newVersionInput') as HTMLInputElement).value;
                        if (val) handleUpdateSystemConfig({ currentVersion: val });
                      }}
                      className="px-6 py-3 bg-blue-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-blue-700 transition-all shadow-lg shadow-blue-200"
                    >
                      Update
                    </button>
                  </div>
                  <p className="text-[9px] text-slate-400 italic">
                    Pushing a new version will prompt all active users to reload their browser to receive the update.
                  </p>
                </div>
              </div>
            </div>

            {/* Global Announcements */}
            <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm space-y-6 lg:col-span-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-indigo-50 rounded-xl text-indigo-600">
                    <Globe className="w-5 h-5" />
                  </div>
                  <h3 className="font-black text-slate-900 uppercase tracking-tight">System-wide Announcements</h3>
                </div>
                <button
                  onClick={() => handleUpdateSystemConfig({ 
                    announcement: { 
                      ...systemConfig.announcement!, 
                      active: !systemConfig.announcement?.active 
                    } 
                  })}
                  className={cn(
                    "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
                    systemConfig.announcement?.active ? "bg-indigo-500" : "bg-slate-200"
                  )}
                >
                  <span className={cn(
                    "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
                    systemConfig.announcement?.active ? "translate-x-6" : "translate-x-1"
                  )} />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-6 pt-4 border-t border-slate-50">
                <div className="md:col-span-3 space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Banner Message</label>
                  <input
                    type="text"
                    value={systemConfig.announcement?.message || ''}
                    onChange={(e) => handleUpdateSystemConfig({ 
                      announcement: { ...systemConfig.announcement!, message: e.target.value } 
                    })}
                    placeholder="e.g. Software update at 6:00 PM EST..."
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Type</label>
                  <select
                    value={systemConfig.announcement?.type || 'info'}
                    onChange={(e) => handleUpdateSystemConfig({ 
                      announcement: { ...systemConfig.announcement!, type: e.target.value as any } 
                    })}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                  >
                    <option value="info">Information (Blue)</option>
                    <option value="warning">Warning (Amber)</option>
                    <option value="error">Critical (Red)</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Compliance Data Repair Card */}
            <div 
              id="compliance-data-repair-card"
              className={cn(
                "bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm space-y-6 lg:col-span-2 relative overflow-hidden transition-all",
                profile?.role !== 'manager' && "opacity-75 bg-slate-50/50"
              )}
            >
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-emerald-50 rounded-xl text-emerald-600">
                    <ShieldCheck className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-black text-slate-900 uppercase tracking-tight">Compliance Data Repair</h3>
                      {profile?.role !== 'manager' && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                          <Lock className="w-3 h-3" />
                          Manager only
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 font-medium mt-0.5">
                      Checks older tickets for missing ID photos and seller photos, and fills them in from customer profiles where possible.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    disabled={scanningRepair || repairingData || profile?.role !== 'manager'}
                    onClick={handleScanComplianceData}
                    className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-bold rounded-xl transition-all shadow-md inline-flex items-center gap-2"
                  >
                    {scanningRepair ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Scanning...
                      </>
                    ) : (
                      <>
                        <Scan className="w-4 h-4" />
                        Scan Tickets
                      </>
                    )}
                  </button>

                  {scanResults && scanResults.repairableTickets.length > 0 && (
                    <button
                      disabled={repairingData || profile?.role !== 'manager'}
                      onClick={handleRepairComplianceData}
                      className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold rounded-xl transition-all shadow-md shadow-emerald-600/20 inline-flex items-center gap-2"
                    >
                      {repairingData ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          {repairProgress ? `Repairing ${repairProgress.current} of ${repairProgress.total}...` : 'Repairing...'}
                        </>
                      ) : (
                        <>
                          <RefreshCw className="w-4 h-4" />
                          Repair {scanResults.repairableTickets.length} Tickets
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>

              {/* Scan Results Display */}
              {scanResults && (
                <div className="pt-4 border-t border-slate-100 space-y-4">
                  <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 space-y-2">
                    <p className="text-sm font-bold text-slate-900">
                      Scanned <span className="font-extrabold text-blue-600">{scanResults.totalScanned}</span> tickets.
                    </p>
                    <ul className="text-xs text-slate-600 space-y-1 font-medium pl-2">
                      <li className="flex items-center gap-2 text-emerald-700 font-semibold">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                        <span><strong className="font-black">{scanResults.completeCount}</strong> are fully complete — no action needed.</span>
                      </li>
                      <li className="flex items-center gap-2 text-blue-700 font-semibold">
                        <RefreshCw className="w-4 h-4 text-blue-600 shrink-0" />
                        <span><strong className="font-black">{scanResults.repairableTickets.length}</strong> can be repaired automatically.</span>
                      </li>
                      <li className="flex items-center gap-2 text-amber-700 font-semibold">
                        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                        <span><strong className="font-black">{scanResults.needsAttentionTickets.length}</strong> need attention (no image available on ticket or customer profile).</span>
                      </li>
                    </ul>
                  </div>

                  {repairCompleted && repairSummary && (
                    <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center justify-between text-emerald-900">
                      <div className="flex items-center gap-3">
                        <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                        <p className="text-xs font-bold">
                          Repaired <span className="font-black">{repairSummary.repairedCount}</span> tickets. {scanResults.needsAttentionTickets.length} still need attention.
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Needs Attention List */}
                  {scanResults.needsAttentionTickets.length > 0 && (
                    <div className="space-y-3 pt-2">
                      <div className="flex items-center justify-between">
                        <h4 className="text-xs font-black uppercase tracking-wider text-slate-700 flex items-center gap-2">
                          <AlertCircle className="w-4 h-4 text-amber-500" />
                          Tickets Needing Manual Attention ({scanResults.needsAttentionTickets.length})
                        </h4>
                        <span className="text-[10px] text-slate-400 font-semibold">
                          These tickets cannot be made compliant retroactively
                        </span>
                      </div>

                      <div className="max-h-60 overflow-y-auto border border-slate-200 rounded-2xl divide-y divide-slate-100 bg-white shadow-inner">
                        {scanResults.needsAttentionTickets.map((item) => (
                          <div key={item.ticketId} className="p-3.5 flex items-center justify-between text-xs hover:bg-slate-50 transition-colors">
                            <div>
                              <span className="font-bold text-slate-900 mr-2">
                                Ticket #{item.ticketNumber}
                              </span>
                              <span className="text-slate-600 font-medium">
                                ({item.customerName})
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mr-1">Missing:</span>
                              {item.missingFields.map((field) => (
                                <span key={field} className="px-2 py-0.5 bg-rose-50 text-rose-700 border border-rose-200 font-bold text-[10px] rounded-lg">
                                  {field}
                                </span>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {activeTab === 'roles' && (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Cashier Defaults card */}
            <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm space-y-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-50 rounded-xl text-blue-600">
                    <User className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-black text-slate-900 uppercase tracking-tight">Cashier Default Template</h3>
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Applied automatically to new cashiers</p>
                  </div>
                </div>
                <button
                  disabled={processing}
                  onClick={() => handleApplyDefaultsToAll('cashier')}
                  className="px-4 py-2 bg-slate-900 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-800 transition-all flex items-center gap-2"
                >
                  Apply to All Existing
                </button>
              </div>

              <div className="space-y-3 pt-4 border-t border-slate-50 grid grid-cols-1 gap-3">
                {Object.entries({
                  canManagePrices: 'Modify material prices',
                  canManageUsers: 'Edit team roles & permissions',
                  canVoidTickets: 'Void or cancel buy tickets',
                  canDeleteData: 'Perform system resets',
                  canManageInventory: 'Update stock levels',
                  canGenerateReports: 'Access analytics & data',
                  canManageInvoices: 'Create & edit sale invoices',
                  canManageCash: 'Manage cash reconciliation',
                  canApproveChanges: 'Authorize manager overrides',
                  canOpenCloseSessions: 'Open & close money drawer',
                  canRetroactivePriceAdjustments: 'Adjust prices on tickets'
                }).map(([key, label]) => {
                  const val = cashierRoleDefaults[key as keyof UserPermissions];
                  return (
                    <button
                      key={`cashier-${key}`}
                      disabled={processing}
                      onClick={() => handleUpdateRoleDefaults('cashier', key as keyof UserPermissions, !val)}
                      className={cn(
                        "flex items-center justify-between p-4 rounded-2xl border transition-all hover:shadow-sm",
                        val ? "bg-blue-50/50 border-blue-100 border-2" : "bg-white border-slate-100 grayscale opacity-60"
                      )}
                    >
                      <div className="text-left">
                        <p className={cn(
                          "text-xs font-black uppercase tracking-tight",
                          val ? "text-blue-900" : "text-slate-500"
                        )}>
                          {key.slice(3).replace(/([A-Z])/g, ' $1').trim()}
                        </p>
                        <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest">{label}</p>
                      </div>
                      <div className={cn(
                        "w-10 h-5 rounded-full transition-colors relative",
                        val ? "bg-blue-600" : "bg-slate-300"
                      )}>
                        <div className={cn(
                          "absolute top-1 w-3 h-3 bg-white rounded-full transition-all",
                          val ? "left-6" : "left-1"
                        )} />
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Manager Defaults card */}
            <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm space-y-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-purple-50 rounded-xl text-purple-600">
                    <ShieldCheck className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-black text-slate-900 uppercase tracking-tight">Manager Default Template</h3>
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Applied automatically to new managers</p>
                  </div>
                </div>
                <button
                  disabled={processing}
                  onClick={() => handleApplyDefaultsToAll('manager')}
                  className="px-4 py-2 bg-slate-900 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-800 transition-all flex items-center gap-2"
                >
                  Apply to All Existing
                </button>
              </div>

              <div className="space-y-3 pt-4 border-t border-slate-50 grid grid-cols-1 gap-3">
                {Object.entries({
                  canManagePrices: 'Modify material prices',
                  canManageUsers: 'Edit team roles & permissions',
                  canVoidTickets: 'Void or cancel buy tickets',
                  canDeleteData: 'Perform system resets',
                  canManageInventory: 'Update stock levels',
                  canGenerateReports: 'Access analytics & data',
                  canManageInvoices: 'Create & edit sale invoices',
                  canManageCash: 'Manage cash reconciliation',
                  canApproveChanges: 'Authorize manager overrides',
                  canOpenCloseSessions: 'Open & close money drawer',
                  canRetroactivePriceAdjustments: 'Adjust prices on tickets'
                }).map(([key, label]) => {
                  const val = managerRoleDefaults[key as keyof UserPermissions];
                  return (
                    <button
                      key={`manager-${key}`}
                      disabled={processing}
                      onClick={() => handleUpdateRoleDefaults('manager', key as keyof UserPermissions, !val)}
                      className={cn(
                        "flex items-center justify-between p-4 rounded-2xl border transition-all hover:shadow-sm",
                        val ? "bg-purple-50/50 border-purple-100 border-2" : "bg-white border-slate-100 grayscale opacity-60"
                      )}
                    >
                      <div className="text-left">
                        <p className={cn(
                          "text-xs font-black uppercase tracking-tight",
                          val ? "text-purple-900" : "text-slate-500"
                        )}>
                          {key.slice(3).replace(/([A-Z])/g, ' $1').trim()}
                        </p>
                        <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest">{label}</p>
                      </div>
                      <div className={cn(
                        "w-10 h-5 rounded-full transition-colors relative",
                        val ? "bg-purple-600" : "bg-slate-300"
                      )}>
                        <div className={cn(
                          "absolute top-1 w-3 h-3 bg-white rounded-full transition-all",
                          val ? "left-6" : "left-1"
                        )} />
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
