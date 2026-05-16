import { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, getDocs, deleteDoc, doc, writeBatch, addDoc, onSnapshot, updateDoc, setDoc } from 'firebase/firestore';
import { UserProfile, Material, Customer, UserRole, UserPermissions, UserSession, UserInvite, SystemConfig } from '../types';
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
  Info
} from 'lucide-react';
import { cn } from '../lib/utils';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';
import { logAuditEvent } from '../lib/audit';
import { APP_VERSION } from '../constants';
import { useSettings } from '../context/SettingsContext';
import ManagerPinModal from '../components/ManagerPinModal';
import { initializeApp, getApps } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword } from 'firebase/auth';
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
  const { settings, updateSettings, resetToDefaults: resetUI } = useSettings();
  const [activeTab, setActiveTab] = useState<'general' | 'users' | 'sessions' | 'system'>('general');
  const [processing, setProcessing] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null);
  const [importType, setImportType] = useState<'materials' | 'customers' | null>(null);
  
  // User Management State
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);
  const [savingUser, setSavingUser] = useState(false);

  // Sessions State
  const [sessions, setSessions] = useState<UserSession[]>([]);

  // System Config State
  const [systemConfig, setSystemConfig] = useState<SystemConfig | null>(null);

  // Create User State
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [invitePassword, setInvitePassword] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState<UserRole>('cashier');

  useEffect(() => {
    if (activeTab === 'users' && profile?.role === 'manager') {
      const unsub = onSnapshot(collection(db, 'users'), (snapshot) => {
        setUsers(snapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() })) as UserProfile[]);
      }, (error) => handleFirestoreError(error, OperationType.LIST, 'users'));
      return () => unsub();
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
      const userCredential = await createUserWithEmailAndPassword(secondaryAuth, inviteEmail, invitePassword);
      const newUser = userCredential.user;

      const defaultPermissions = {
        canManagePrices: inviteRole === 'manager',
        canManageUsers: inviteRole === 'manager',
        canVoidTickets: inviteRole === 'manager',
        canDeleteData: inviteRole === 'manager',
        canManageInventory: inviteRole === 'manager',
        canGenerateReports: inviteRole === 'manager',
        canManageInvoices: inviteRole === 'manager',
        canManageCash: inviteRole === 'manager',
        canApproveChanges: inviteRole === 'manager',
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
      
      await secondaryAuth.signOut();
      
      await logAuditEvent(
        'settings',
        newUser.uid,
        'create',
        { after: newProfile },
        `New user account created for ${inviteEmail}`
      );

      setStatus({ type: 'success', message: 'User account created successfully.' });
      setInviteEmail('');
      setInvitePassword('');
      setInviteName('');
      setShowInviteModal(false);
    } catch (error: any) {
      console.error('Failed to create user', error);
      setStatus({ type: 'error', message: error.message || 'Failed to create user account.' });
    } finally {
      setProcessing(false);
    }
  };

  const handleDeleteUser = async (uid: string) => {
    if (uid === profile?.uid) {
      setStatus({ type: 'error', message: 'You cannot delete your own account.' });
      return;
    }
    if (window.confirm("Are you sure you want to remove this user from the system? They will immediately lose access.")) {
      try {
        await deleteDoc(doc(db, 'users', uid));
        if (selectedUser?.uid === uid) {
          setSelectedUser(null);
        }
        setStatus({ type: 'success', message: 'User successfully removed from system.' });
      } catch (error: any) {
        handleFirestoreError(error, OperationType.DELETE, `users/${uid}`);
        setStatus({ type: 'error', message: 'Failed to delete user profile.' });
      }
    }
  };

  useEffect(() => {
    if (activeTab === 'sessions' && profile?.role === 'manager') {
      const unsub = onSnapshot(collection(db, 'userSessions'), (snapshot) => {
        const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as UserSession[];
        setSessions(data.sort((a, b) => new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime()));
      }, (error) => handleFirestoreError(error, OperationType.LIST, 'userSessions'));
      return () => unsub();
    }
  }, [activeTab, profile]);

  useEffect(() => {
    if (activeTab === 'system' && profile?.role === 'manager') {
      const unsub = onSnapshot(doc(db, 'system', 'config'), (snap) => {
        if (snap.exists()) {
          setSystemConfig(snap.data() as SystemConfig);
        }
      }, (error) => handleFirestoreError(error, OperationType.GET, 'system/config'));
      return () => unsub();
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
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'system/config');
    } finally {
      setProcessing(false);
    }
  };

  const handleTerminateSession = async (sessionId: string) => {
    try {
      await updateDoc(doc(db, 'userSessions', sessionId), { status: 'logout' });
      setStatus({ type: 'success', message: 'Session marked as terminated.' });
    } catch (error) {
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
    } catch (error) {
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
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${uid}`);
    } finally {
      setSavingUser(false);
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
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Swann Surveillance Cameras (Network)</label>
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

            <div className="space-y-4 pt-2">
              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-500 uppercase ml-1">Material Station Cam (Snapshot URL)</label>
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center gap-2">
                  <Video className="w-4 h-4 text-slate-400" />
                  <input 
                    type="text"
                    className="bg-transparent border-none outline-none text-xs font-bold w-full"
                    placeholder="http://192.168.1.50/cgi-bin/snapshot.cgi?channel=1"
                    value={settings.swannCams.material}
                    onChange={(e) => updateSettings({ swannCams: { ...settings.swannCams, material: e.target.value } })}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-500 uppercase ml-1">Customer Face Cam (Snapshot URL)</label>
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center gap-2">
                  <Video className="w-4 h-4 text-slate-400" />
                  <input 
                    type="text"
                    className="bg-transparent border-none outline-none text-xs font-bold w-full"
                    placeholder="http://192.168.1.50/cgi-bin/snapshot.cgi?channel=2"
                    value={settings.swannCams.customer}
                    onChange={(e) => updateSettings({ swannCams: { ...settings.swannCams, customer: e.target.value } })}
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-black text-slate-500 uppercase ml-1">Entrance/Vehicle Cam (Snapshot URL)</label>
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center gap-2">
                  <Video className="w-4 h-4 text-slate-400" />
                  <input 
                    type="text"
                    className="bg-transparent border-none outline-none text-xs font-bold w-full"
                    placeholder="http://192.168.1.50/cgi-bin/snapshot.cgi?channel=3"
                    value={settings.swannCams.entrance}
                    onChange={(e) => updateSettings({ swannCams: { ...settings.swannCams, entrance: e.target.value } })}
                  />
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
                        canApproveChanges: 'Authorize manager overrides'
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

                  <div className="pt-6 border-t border-slate-100">
                    <button
                      onClick={() => handleDeleteUser(selectedUser.uid)}
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
                onClick={() => setShowInviteModal(false)}
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
          </div>
        </div>
      )}
    </div>
  );
}
