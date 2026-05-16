import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { onAuthStateChanged, User, setPersistence, browserLocalPersistence } from 'firebase/auth';
import { useEffect, useState } from 'react';
import { auth, db } from './firebase';
import { doc, getDoc, setDoc, updateDoc, onSnapshot } from 'firebase/firestore';
import { UserProfile, UserRole, SystemConfig } from './types';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import ManagePrices from './pages/ManagePrices';
import Inventory from './pages/Inventory';
import Reports from './pages/Reports';
import BuyTickets from './pages/BuyTickets';
import TripTickets from './pages/TripTickets';
import Invoices from './pages/Invoices';
import Customers from './pages/Customers';
import TicketHistory from './pages/TicketHistory';
import CashDrawer from './pages/CashDrawer';
import Settings from './pages/Settings';

import { handleFirestoreError, OperationType } from './lib/firestore-errors';
import { UserSession } from './types';

import ProtectedRoute from './components/ProtectedRoute';
import ErrorBoundary from './components/ErrorBoundary';
import { APP_VERSION, COMPANY_NAME } from './constants';
import { ShieldAlert, Info, AlertTriangle, RefreshCw, Loader2 } from 'lucide-react';
import { cn } from './lib/utils';

import { SettingsProvider } from './context/SettingsContext';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingStatus, setLoadingStatus] = useState<string>('Initializing...');
  const [showBypass, setShowBypass] = useState(false);
  const [systemConfig, setSystemConfig] = useState<SystemConfig | null>(null);

  // Subscribe to Global System Config
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'system', 'config'), (snap) => {
      if (snap.exists()) {
        const data = snap.data() as SystemConfig;
        setSystemConfig(data);
        
        // Auto-sync version if manager is logged in and version mismatch exists
        if (data.currentVersion !== APP_VERSION && (profile?.role === 'manager' || user?.email === 'joaquinrodriguez3333@gmail.com')) {
          updateDoc(doc(db, 'system', 'config'), { 
            currentVersion: APP_VERSION,
            lastUpdated: new Date().toISOString()
          }).catch(err => console.error('Failed to auto-sync version:', err));
        }
      } else if (profile?.role === 'manager' || user?.email === 'joaquinrodriguez3333@gmail.com') {
        // Only managers should try to initialize it to avoid permission errors for cashiers
        const initialConfig: SystemConfig = {
          maintenanceMode: false,
          currentVersion: APP_VERSION,
          minSupportedVersion: APP_VERSION,
          lastUpdated: new Date().toISOString()
        };
        setDoc(doc(db, 'system', 'config'), initialConfig).catch(err => {
          console.warn('System config initialization failed (expected for non-managers):', err);
        });
        setSystemConfig(initialConfig);
      }
    }, (error) => {
      console.error('System config subscription error:', error);
    });
    return () => unsub();
  }, [profile, user]);

  useEffect(() => {
    // Set persistence to local (survives browser restarts)
    setLoadingStatus('Configuring Security...');
    setPersistence(auth, browserLocalPersistence).catch(err => {
      console.error('Auth persistence error:', err);
    });

    // Hardware Recognition: Store a unique ID for this device
    setLoadingStatus('Checking Hardware ID...');
    let hardwareId = localStorage.getItem('pmr_hardware_id');
    if (!hardwareId) {
      hardwareId = `hw_${Math.random().toString(36).substring(2, 15)}_${Date.now()}`;
      localStorage.setItem('pmr_hardware_id', hardwareId);
    }

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      
      // Safety timeout for loading state
      const loadingTimeout = setTimeout(() => {
        if (loading) {
          console.warn('Profile loading timed out');
          setLoadingStatus('Account verification taking longer than usual...');
          setShowBypass(true);
        }
      }, 2000);

      if (firebaseUser) {
        setLoadingStatus('Authenticated. Fetching Profile...');
        try {
          const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
          clearTimeout(loadingTimeout);
          
          if (userDoc.exists()) {
            setLoadingStatus('Profile Found. Loading Dashboard...');
            const data = userDoc.data() as UserProfile;
            
            // Migration: Ensure existing managers have permissions
            if (data.role === 'manager') {
              const defaultPermissions = {
                canManagePrices: true,
                canManageUsers: true,
                canVoidTickets: true,
                canDeleteData: true,
                canManageInventory: true,
                canGenerateReports: true,
                canManageInvoices: true,
                canManageCash: true, // New permission
                canApproveChanges: true,
                ...(data.permissions || {}) // Preserve existing settings
              };
              
              const needsUpdate = !data.permissions || Object.keys(defaultPermissions).length !== Object.keys(data.permissions).length;

              if (needsUpdate) {
                await updateDoc(doc(db, 'users', firebaseUser.uid), { permissions: defaultPermissions });
                data.permissions = defaultPermissions;
              }
            }
            
            setProfile(data);
          } else {
            setLoadingStatus('New User. Checking Credentials...');
            // Check for invite
            const urlParams = new URLSearchParams(window.location.search);
            const inviteId = urlParams.get('invite') || localStorage.getItem('pm_invite_token');
            const userEmail = firebaseUser.email?.toLowerCase().trim();
            const isOwner = userEmail === 'joaquinrodriguez3333@gmail.com' || userEmail === 'joaquin03@icloud.com' || userEmail?.startsWith('dev_') || userEmail === 'admin@preferredmetals.com';
            
            let allowedToRegister = false;
            let targetRole: UserRole = 'cashier';
            let inviteRef = null;

            if (isOwner) {
              allowedToRegister = true;
              targetRole = 'manager';
            } else if (inviteId) {
              const checkInviteRef = doc(db, 'userInvites', inviteId);
              const inviteSnap = await getDoc(checkInviteRef);
              
              if (inviteSnap.exists()) {
                const inviteData = inviteSnap.data();
                const now = new Date();
                const expiration = new Date(inviteData.expiresAt);
                
                if (!inviteData.used && expiration > now) {
                  if (!inviteData.email || inviteData.email === firebaseUser.email) {
                    allowedToRegister = true;
                    targetRole = inviteData.role;
                    inviteRef = checkInviteRef;
                  }
                }
              }
            }

            if (allowedToRegister) {
              setLoadingStatus('Creating Authorized Profile...');
              localStorage.removeItem('pm_invite_token'); // Clear token after use
              const defaultPermissions = {
                canManagePrices: targetRole === 'manager',
                canManageUsers: targetRole === 'manager',
                canVoidTickets: targetRole === 'manager',
                canDeleteData: targetRole === 'manager',
                canManageInventory: targetRole === 'manager',
                canGenerateReports: targetRole === 'manager',
                canManageInvoices: targetRole === 'manager',
                canManageCash: targetRole === 'manager',
                canApproveChanges: targetRole === 'manager',
              };
              
              const newProfile: UserProfile = {
                uid: firebaseUser.uid,
                email: firebaseUser.email || '',
                role: targetRole,
                displayName: firebaseUser.displayName || (isOwner ? 'Master Manager' : 'Employee'),
                managerPin: isOwner ? '1234' : undefined,
                permissions: defaultPermissions,
              };
              
              try {
                await setDoc(doc(db, 'users', firebaseUser.uid), newProfile);
                if (inviteRef) {
                  await updateDoc(inviteRef, { used: true });
                }
                setProfile(newProfile);
              } catch (regErr: any) {
                console.error('Registration/Invite consumed error:', regErr);
                setLoadingStatus(`Error: ${regErr.message || 'Access Denied'}`);
                // Auto logout on fatal registration error to allow re-trying
                setTimeout(() => auth.signOut(), 3000);
                return;
              }
            } else {
              setLoadingStatus('Access Denied. Logging out...');
              await auth.signOut();
              window.location.href = `/login?error=no_invite&email=${encodeURIComponent(firebaseUser.email || '')}`;
              return;
            }
          }
          setLoading(false);
        } catch (error) {
          console.error('Error in profile handler:', error);
          setLoadingStatus('Error loading profile. Check internet connection.');
          handleFirestoreError(error, OperationType.WRITE, `users/${firebaseUser.uid}`);
          setLoading(false);
        }
      } else {
        setLoadingStatus('Ready.');
        setProfile(null);
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  // Session Tracking & Presence
  useEffect(() => {
    if (user && profile) {
      const hardwareId = localStorage.getItem('pmr_hardware_id') || 'unknown';
      const userAgent = navigator.userAgent;
      const sessionId = `sess_${hardwareId}_${user.uid}`;
      
      const sessionData: Partial<UserSession> = {
        userId: user.uid,
        userEmail: user.email || '',
        displayName: profile.displayName || user.displayName || user.email?.split('@')[0],
        hardwareId,
        userAgent,
        loginAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
        status: 'active'
      };

      // Create/Update session record
      const logSession = async () => {
        try {
          await setDoc(doc(db, 'userSessions', sessionId), sessionData, { merge: true });
        } catch (error) {
          console.error('Session logging error:', error);
        }
      };

      logSession();

      // Heartbeat every 5 minutes to keep session "active"
      const heartbeat = setInterval(async () => {
        try {
          await updateDoc(doc(db, 'userSessions', sessionId), {
            lastActiveAt: new Date().toISOString()
          });
        } catch (error) {
          // If doc was deleted or no permission
          console.warn('Session heartbeat failed');
        }
      }, 5 * 60 * 1000);

      const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
          updateDoc(doc(db, 'userSessions', sessionId), {
            lastActiveAt: new Date().toISOString()
          }).catch(() => {});
        }
      };

      document.addEventListener('visibilitychange', handleVisibilityChange);

      return () => {
        clearInterval(heartbeat);
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      };
    }
  }, [user, profile]);

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center p-8 text-center">
        <div className="relative mb-8">
          <div className="w-16 h-16 border-4 border-slate-100 rounded-full animate-pulse" />
          <Loader2 className="w-16 h-16 text-blue-600 animate-spin absolute inset-0" />
        </div>
        <div className="space-y-4 max-w-xs">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] animate-pulse">
            {loadingStatus}
          </p>
          <div className="h-1 w-32 bg-slate-100 rounded-full mx-auto overflow-hidden">
            <div className="h-full bg-blue-500 w-1/2 rounded-full animate-[shimmer_2s_infinite]" />
          </div>
          
          {showBypass && (
            <div className="pt-8 space-y-4 animate-in fade-in duration-700">
              <p className="text-[11px] text-slate-500 font-medium italic">
                Browser is taking too long to verify your profile.
              </p>
              <button 
                onClick={() => setLoading(false)}
                className="w-full py-4 text-[10px] font-black uppercase tracking-widest text-blue-600 hover:text-blue-700 bg-blue-50/50 rounded-2xl border border-blue-100 transition-all hover:scale-[1.02]"
              >
                Stuck? Click to Force Dashboard
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Maintenance Mode Gate
  if (systemConfig?.maintenanceMode && profile?.role !== 'manager') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 p-6 text-center">
        <div className="w-24 h-24 bg-amber-100 rounded-full flex items-center justify-center mb-6 text-amber-600 shadow-xl shadow-amber-200/50">
          <ShieldAlert className="w-12 h-12" />
        </div>
        <h1 className="text-3xl font-black text-slate-900 uppercase tracking-tight mb-4">System Maintenance</h1>
        <p className="text-slate-500 max-w-md font-medium leading-relaxed">
          {systemConfig.maintenanceMessage || "Preferred Metals is currently undergoing a scheduled system update. We'll be back online shortly."}
        </p>
        <div className="mt-10 pt-10 border-t border-slate-200 w-full max-w-xs">
          <p className="text-[10px] font-black text-slate-300 uppercase tracking-[0.2em]">
            &copy; {new Date().getFullYear()} Preferred Metals & Recycling
          </p>
        </div>
      </div>
    );
  }

  const isLoginPage = window.location.pathname === '/login' || window.location.pathname === '/';
  const isUpdateAvailable = systemConfig && systemConfig.currentVersion !== APP_VERSION && !isLoginPage;

  return (
    <ErrorBoundary>
      <SettingsProvider>
        <Router>
          <div className="relative min-h-screen">
            {/* Announcement Banner */}
            {systemConfig?.announcement?.active && (
              <div className={cn(
                "sticky top-0 z-[1000] px-4 py-2 flex items-center justify-center gap-3 text-[10px] font-black uppercase tracking-[0.2em] shadow-lg",
                systemConfig.announcement.type === 'info' ? "bg-blue-600 text-white" :
                systemConfig.announcement.type === 'warning' ? "bg-amber-500 text-white" :
                "bg-red-600 text-white"
              )}>
                {systemConfig.announcement.type === 'info' ? <Info className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
                <span>{systemConfig.announcement.message}</span>
              </div>
            )}

            {/* Application Update Banner (distinct from platform) */}
            {isUpdateAvailable && (
              <div className="sticky top-0 z-[1001] bg-slate-900/95 backdrop-blur-sm text-white px-4 py-3 flex items-center justify-center gap-8 shadow-2xl border-b border-slate-800 animate-in slide-in-from-top-full duration-500 select-none">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-500 rounded-xl shadow-lg shadow-blue-500/20">
                    <RefreshCw className="w-4 h-4 animate-spin-slow" />
                  </div>
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-white">Application Refresh Required</p>
                    <p className="text-[8px] text-slate-400 font-bold uppercase tracking-tight">System version changed to V{systemConfig.currentVersion}</p>
                  </div>
                </div>
                <button 
                  onClick={() => window.location.reload()}
                  className="px-6 py-2 bg-white text-slate-900 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-100 transition-all active:scale-95 shadow-xl shadow-white/10"
                >
                  Confirm & Sync
                </button>
              </div>
            )}

            <Routes>
              <Route path="/login" element={!user ? <Login /> : <Navigate to="/" />} />
              <Route
                path="/"
                element={user ? <Layout user={user} profile={profile} /> : <Navigate to="/login" />}
              >
                <Route index element={<Dashboard profile={profile} />} />
                <Route path="buy-tickets" element={<BuyTickets profile={profile} />} />
                <Route path="trip-tickets" element={<TripTickets profile={profile} />} />
                <Route path="customers" element={<Customers profile={profile} />} />
                <Route path="ticket-history" element={<TicketHistory profile={profile} />} />
                
                {/* Manager/Permission Protected Routes */}
                <Route element={<ProtectedRoute profile={profile} />}>
                  <Route element={<ProtectedRoute profile={profile} allowedRoles={['manager']} permission="canManageInvoices" />}>
                    <Route path="invoices" element={<Invoices profile={profile} />} />
                  </Route>
                  <Route element={<ProtectedRoute profile={profile} allowedRoles={['manager']} permission="canManageInventory" />}>
                    <Route path="inventory" element={<Inventory profile={profile} />} />
                  </Route>
                  <Route element={<ProtectedRoute profile={profile} allowedRoles={['manager']} permission="canManagePrices" />}>
                    <Route path="manage-prices" element={<ManagePrices profile={profile} />} />
                  </Route>
                  <Route element={<ProtectedRoute profile={profile} allowedRoles={['manager']} permission="canGenerateReports" />}>
                    <Route path="reports" element={<Reports profile={profile} />} />
                  </Route>
                  <Route element={<ProtectedRoute profile={profile} allowedRoles={['manager']} permission="canManageCash" />}>
                    <Route path="cash-drawer" element={<CashDrawer profile={profile} />} />
                  </Route>
                  <Route element={<ProtectedRoute profile={profile} allowedRoles={['manager']} permission="canManageUsers" />}>
                    <Route path="settings" element={<Settings profile={profile} />} />
                  </Route>
                </Route>
              </Route>
            </Routes>
          </div>
        </Router>
      </SettingsProvider>
    </ErrorBoundary>
  );
}
