import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { onAuthStateChanged, User, setPersistence, browserLocalPersistence } from 'firebase/auth';
import { useEffect, useState } from 'react';
import { auth, db } from './firebase';
import { doc, getDoc, setDoc, updateDoc, onSnapshot, deleteDoc, collection, query, where, deleteField } from 'firebase/firestore';
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
import { ShieldAlert, Info, AlertTriangle, RefreshCw, Loader2, Monitor, Smartphone } from 'lucide-react';
import { cn } from './lib/utils';

import { SettingsProvider } from './context/SettingsContext';
import { ToastProvider } from './context/ToastContext';

const ALLOWED_ADMIN_EMAILS = [
  'tiffany@preferredmetalsrecycling.com',
  'info@preferredmetalsrecycling.com',
  'joaquinrodriguez3333@gmail.com'
];

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingStatus, setLoadingStatus] = useState<string>('Initializing...');
  const [showBypass, setShowBypass] = useState(false);
  const [systemConfig, setSystemConfig] = useState<SystemConfig | null>(null);
  const [activeSessions, setActiveSessions] = useState<UserSession[]>([]);
  const [sessionLimitExceeded, setSessionLimitExceeded] = useState(false);

  // One-time security cleanup for legacy credential cache keys
  useEffect(() => {
    localStorage.removeItem('cachedPassword');
    localStorage.removeItem('pm_force_manager_password');
  }, []);

  // Subscribe to Global System Config
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'system', 'config'), (snap) => {
      if (snap.exists()) {
        const data = snap.data() as SystemConfig;
        setSystemConfig(data);
        
        const userEmailClean = user?.email?.toLowerCase().trim();
        const isApprovedAdmin = !!userEmailClean && ALLOWED_ADMIN_EMAILS.includes(userEmailClean);

        // Auto-sync version if manager is logged in and version mismatch exists
        if (data.currentVersion !== APP_VERSION && (profile?.role === 'manager' || isApprovedAdmin)) {
          updateDoc(doc(db, 'system', 'config'), { 
            currentVersion: APP_VERSION,
            lastUpdated: new Date().toISOString()
          }).catch(err => console.error('Failed to auto-sync version:', err));
        }
      } else if (profile?.role === 'manager' || (user?.email && ALLOWED_ADMIN_EMAILS.includes(user.email.toLowerCase().trim()))) {
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
      const errMsg = error.message || String(error);
      const isQuotaError = errMsg.toLowerCase().includes('quota') || errMsg.toLowerCase().includes('limit exceeded');
      if (isQuotaError) {
        console.warn('System config subscription bypassed due to Firestore quota limits (applying fallback):', errMsg);
        setSystemConfig({
          maintenanceMode: false,
          currentVersion: APP_VERSION,
          minSupportedVersion: APP_VERSION,
          lastUpdated: new Date().toISOString()
        });
      } else {
        console.error('System config subscription error:', error);
      }
    });
    return () => {
      try {
        unsub();
      } catch (err) {
        console.warn('unsub system/config error:', err);
      }
    };
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

    const checkDemoBypass = (firebaseUser: User | null): boolean => {
      const isDemoBypass = localStorage.getItem('pm_demo_mode_active') === 'true';
      if (isDemoBypass) {
        const demoRole = (localStorage.getItem('pm_demo_role') as UserRole) || 'manager';
        
        const demoUser = {
          uid: firebaseUser?.uid || `demo_uid_${demoRole}`,
          email: firebaseUser?.email || `demo-${demoRole}@preferredmetalsrecycling.com`,
          displayName: firebaseUser?.displayName || (demoRole === 'manager' ? 'On-Duty Manager' : 'On-Duty Cashier'),
          photoURL: firebaseUser?.photoURL || null,
          isAnonymous: firebaseUser?.isAnonymous || false,
          emailVerified: firebaseUser?.emailVerified || true,
        } as unknown as User;

        const defaultPermissions = {
          canManagePrices: demoRole === 'manager',
          canManageUsers: demoRole === 'manager',
          canVoidTickets: demoRole === 'manager',
          canDeleteData: demoRole === 'manager',
          canManageInventory: demoRole === 'manager',
          canGenerateReports: demoRole === 'manager',
          canManageInvoices: demoRole === 'manager',
          canManageCash: true,
          canApproveChanges: demoRole === 'manager',
          canOpenCloseSessions: true,
          canRetroactivePriceAdjustments: demoRole === 'manager',
        };

        const demoProfile: UserProfile = {
          uid: demoUser.uid,
          email: demoUser.email || '',
          role: demoRole,
          displayName: demoRole === 'manager' ? 'On-Duty Manager' : 'On-Duty Cashier',
          managerPin: '1234',
          permissions: defaultPermissions,
        };

        if (firebaseUser) {
          setDoc(doc(db, 'users', firebaseUser.uid), demoProfile).catch(fsErr => {
            console.warn('Silent warning setting demo profile in Firestore:', fsErr);
          });
        }

        setUser(demoUser);
        setProfile(demoProfile);
        setLoading(false);
        return true;
      }
      return false;
    };

    // Run check immediately to bypass any network/auth provider latency
    checkDemoBypass(auth.currentUser);

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (checkDemoBypass(firebaseUser)) {
        return;
      }
      
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
          const userEmail = firebaseUser.email?.toLowerCase().trim();
          const isDemo = firebaseUser.isAnonymous || (userEmail?.startsWith('demo-') && userEmail?.endsWith('@preferredmetalsrecycling.com'));

          if (isDemo) {
            clearTimeout(loadingTimeout);
            const demoRole: UserRole = userEmail?.includes('manager') ? 'manager' : 'cashier';
            const defaultPermissions = {
              canManagePrices: demoRole === 'manager',
              canManageUsers: demoRole === 'manager',
              canVoidTickets: demoRole === 'manager',
              canDeleteData: demoRole === 'manager',
              canManageInventory: demoRole === 'manager',
              canGenerateReports: demoRole === 'manager',
              canManageInvoices: demoRole === 'manager',
              canManageCash: true,
              canApproveChanges: demoRole === 'manager',
              canOpenCloseSessions: true,
              canRetroactivePriceAdjustments: demoRole === 'manager',
            };
            
            const demoProfile: UserProfile = {
              uid: firebaseUser.uid,
              email: firebaseUser.email || `demo-${demoRole}@preferredmetalsrecycling.com`,
              role: demoRole,
              displayName: demoRole === 'manager' ? 'On-Duty Manager' : 'On-Duty Cashier',
              managerPin: '1234',
              permissions: defaultPermissions,
            };

            // Force update / insert in users database to satisfy security rules
            try {
              await setDoc(doc(db, 'users', firebaseUser.uid), demoProfile);
            } catch (fsErr) {
              console.warn('Silent warning setting demo profile in Firestore:', fsErr);
            }

            setProfile(demoProfile);
            setLoading(false);
            return;
          }

          let userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
          
          if (!userDoc.exists() && firebaseUser.email) {
            const userEmail = firebaseUser.email.toLowerCase().trim();
            const tempDocId = `temp_${userEmail}`;
            let tempDoc = null;
            try {
              tempDoc = await getDoc(doc(db, 'users', tempDocId));
            } catch (tempErr) {
              console.warn('Silent/permissible error checking for temporary profile document:', tempErr);
            }
            
            if (tempDoc && tempDoc.exists()) {
              setLoadingStatus('Claiming your authorized profile...');
              const tempData = tempDoc.data();
              const linkedProfile = {
                ...tempData,
                uid: firebaseUser.uid
              };
              
              await setDoc(doc(db, 'users', firebaseUser.uid), linkedProfile);
              try {
                await deleteDoc(doc(db, 'users', tempDocId));
              } catch (delErr) {
                console.warn('Could not clean up temporary authorization profile document:', delErr);
              }
              
              // Refetch userDoc to proceed with standard load
              userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
            }
          }

          clearTimeout(loadingTimeout);
          
          if (userDoc.exists()) {
            setLoadingStatus('Profile Found. Loading Dashboard...');
            const rawData = userDoc.data() as any;
            
            // Security cleanup: strip legacy cachedPassword field if present in Firestore
            if (rawData.cachedPassword !== undefined) {
              try {
                await updateDoc(doc(db, 'users', firebaseUser.uid), { cachedPassword: deleteField() });
              } catch (cleanErr) {
                console.warn('Failed to strip cachedPassword field from Firestore user document:', cleanErr);
              }
              delete rawData.cachedPassword;
            }

            const data = rawData as UserProfile;
            
            // Migration: Ensure existing managers have permissions
            const defaultPermissions = {
              canManagePrices: data.role === 'manager',
              canManageUsers: data.role === 'manager',
              canVoidTickets: data.role === 'manager',
              canDeleteData: data.role === 'manager',
              canManageInventory: data.role === 'manager',
              canGenerateReports: data.role === 'manager',
              canManageInvoices: data.role === 'manager',
              canManageCash: true,
              canApproveChanges: data.role === 'manager',
              canOpenCloseSessions: true,
              canRetroactivePriceAdjustments: data.role === 'manager',
              ...(data.permissions || {}) // Preserve existing settings
            };
            
            const needsUpdate = !data.permissions || Object.keys(defaultPermissions).length !== Object.keys(data.permissions).length;

            if (needsUpdate) {
              await updateDoc(doc(db, 'users', firebaseUser.uid), { permissions: defaultPermissions });
              data.permissions = defaultPermissions;
            }
            
            setProfile(data);
          } else {
            setLoadingStatus('New User. Checking Credentials...');
            // Check for invite
            const urlParams = new URLSearchParams(window.location.search);
            const inviteId = urlParams.get('invite') || localStorage.getItem('pm_invite_token');
            const userEmail = firebaseUser.email?.toLowerCase().trim();
            const isOwner = !!userEmail && ALLOWED_ADMIN_EMAILS.includes(userEmail);
            
            let allowedToRegister = false;
            let targetRole: UserRole = 'cashier';
            let inviteRef = null;

            if (firebaseUser.isAnonymous) {
              allowedToRegister = true;
              const demoRole = localStorage.getItem('pm_demo_role') as UserRole || 'manager';
              targetRole = demoRole;
            } else if (isOwner) {
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
              const isDemo = firebaseUser.isAnonymous;
              const defaultPermissions = {
                canManagePrices: targetRole === 'manager',
                canManageUsers: targetRole === 'manager',
                canVoidTickets: targetRole === 'manager',
                canDeleteData: targetRole === 'manager',
                canManageInventory: targetRole === 'manager',
                canGenerateReports: targetRole === 'manager',
                canManageInvoices: targetRole === 'manager',
                canManageCash: true, // Allow cash drawer management for demo roles
                canApproveChanges: targetRole === 'manager',
                canOpenCloseSessions: true,
                canRetroactivePriceAdjustments: targetRole === 'manager',
              };
              
              const newProfile: UserProfile = {
                uid: firebaseUser.uid,
                email: firebaseUser.email || `demo-${targetRole}@preferredmetalsrecycling.com`,
                role: targetRole,
                displayName: firebaseUser.displayName || (isDemo ? (targetRole === 'manager' ? 'On-Duty Manager' : 'On-Duty Cashier') : isOwner ? 'Master Manager' : 'Employee'),
                ...(isDemo && targetRole === 'manager' ? { managerPin: '1234' } : {}),
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
          setLoading(false);
          try {
            handleFirestoreError(error, OperationType.WRITE, `users/${firebaseUser.uid}`);
          } catch (err) {
            // Prevent re-throw from resetting/hanging react state flow
          }
        }
      } else {
        setLoadingStatus('Ready.');
        setProfile(null);
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  // Session Tracking & Presence with maximum 3 instances limit
  useEffect(() => {
    let unsubSessions: (() => void) | null = null;
    let heartbeat: NodeJS.Timeout | null = null;

    if (user && profile && !user.uid.startsWith('demo_uid_')) {
      const hardwareId = localStorage.getItem('pmr_hardware_id') || 'unknown';
      const userAgent = navigator.userAgent;
      const sessionId = `sess_${hardwareId}_${user.uid}`;
      
      const sessionData: Partial<UserSession> = {
        userId: user.uid,
        userEmail: user.email || '',
        displayName: profile.displayName || user.displayName || user.email?.split('@')[0] || 'User',
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
          try {
            handleFirestoreError(error, OperationType.WRITE, `userSessions/${sessionId}`);
          } catch (err) {
            // Logged as JSON inside handleFirestoreError
          }
        }
      };

      logSession();

      // Subscribe to sessions to monitor session limit and real-time termination
      const q = query(
        collection(db, 'userSessions'),
        where('userId', '==', user.uid)
      );

      unsubSessions = onSnapshot(q, (snapshot) => {
        const userSessList: UserSession[] = [];
        snapshot.forEach((docSnap) => {
          userSessList.push({ id: docSnap.id, ...docSnap.data() } as UserSession);
        });

        // Filter active sessions: status is active AND was active in the last 15 minutes,
        // or it's the current session (which we keep active)
        const activeSessList = userSessList.filter(s => {
          if (s.id === sessionId) return true;
          const isRecentlyActive = (Date.now() - new Date(s.lastActiveAt).getTime()) < 15 * 60 * 1000;
          return s.status === 'active' && isRecentlyActive;
        });

        // Sort descending by last active time so that the most recently active session is first
        activeSessList.sort((a, b) => new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime());

        // Check if our session has been terminated or logged out
        const mySession = userSessList.find(s => s.id === sessionId);
        if (mySession && mySession.status !== 'active') {
          // Logged out or session terminated remotely
          auth.signOut();
          window.location.href = '/login?error=session_terminated';
          return;
        }

        // Limit checking: must be at least 2, but no more than 3!
        // We limit to max 3 active.
        // If there are more than 3 active sessions, does this current session fail to be in the top 3?
        const top3 = activeSessList.slice(0, 3);
        const isCurrentInTop3 = top3.some(s => s.id === sessionId);

        if (activeSessList.length > 3 && !isCurrentInTop3) {
          setSessionLimitExceeded(true);
        } else {
          setSessionLimitExceeded(false);
        }

        setActiveSessions(activeSessList);
      }, (err) => {
        console.warn('Real-time session updates subscription failed:', err);
      });

      // Heartbeat every 5 minutes (or 2 minutes) to keep session alive
      heartbeat = setInterval(async () => {
        try {
          await updateDoc(doc(db, 'userSessions', sessionId), {
            lastActiveAt: new Date().toISOString()
          });
        } catch (error) {
          console.warn('Session heartbeat failed:', error);
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
        if (heartbeat) clearInterval(heartbeat);
        if (unsubSessions) {
          try {
            unsubSessions();
          } catch (err) {
            console.warn('unsub userSessions error:', err);
          }
        }
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

  const parseUserAgent = (ua: string) => {
    if (!ua) return 'Unknown Device';
    if (ua.includes('iPad')) return 'iPad (iOS)';
    if (ua.includes('iPhone')) return 'iPhone (iOS)';
    if (ua.includes('Android')) return 'Android Device';
    if (ua.includes('Macintosh')) return 'Mac (macOS)';
    if (ua.includes('Windows')) return 'Windows PC';
    if (ua.includes('Linux')) return 'Linux Computer';
    return 'Desktop Device';
  };

  const parseBrowser = (ua: string) => {
    if (!ua) return 'Web Browser';
    if (ua.includes('Chrome') && ua.includes('Safari') && !ua.includes('Edg') && !ua.includes('OPR')) return 'Google Chrome';
    if (ua.includes('Safari') && !ua.includes('Chrome')) return 'Apple Safari';
    if (ua.includes('Firefox')) return 'Mozilla Firefox';
    if (ua.includes('Edg')) return 'Microsoft Edge';
    return 'Web Browser';
  };

  // Session Limit Exceeded Gate (At least 2 instances, no more than 3)
  if (sessionLimitExceeded && user) {
    const hardwareId = localStorage.getItem('pmr_hardware_id') || 'unknown';
    const currentSessionId = `sess_${hardwareId}_${user.uid}`;
    
    // Function to terminate a specific session
    const handleTerminateSpecific = async (sessId: string) => {
      try {
        await updateDoc(doc(db, 'userSessions', sessId), {
          status: 'logout',
          lastActiveAt: new Date().toISOString()
        });
      } catch (err) {
        console.error("Termination failed:", err);
      }
    };

    // Function to automatically terminate the oldest sibling session
    const handleTerminateOldest = async () => {
      const otherSessions = activeSessions.filter(s => s.id !== currentSessionId);
      if (otherSessions.length > 0) {
        // Sort oldest first
        otherSessions.sort((a, b) => new Date(a.lastActiveAt).getTime() - new Date(b.lastActiveAt).getTime());
        await handleTerminateSpecific(otherSessions[0].id);
      } else {
        // Fallback to terminating any session
        const oldest = activeSessions[activeSessions.length - 1];
        if (oldest) {
          await handleTerminateSpecific(oldest.id);
        }
      }
    };

    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 p-6">
        <div className="w-full max-w-xl bg-white shadow-2xl rounded-3xl border border-slate-100 overflow-hidden text-slate-800 animate-in fade-in duration-300">
          
          {/* Top warning header */}
          <div className="p-8 bg-slate-900 text-white flex items-center gap-4">
            <div className="p-3 bg-amber-500 rounded-2xl text-slate-900 shrink-0 shadow-lg shadow-amber-500/20">
              <ShieldAlert className="w-8 h-8" />
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-500">Security Guard</p>
              <h1 className="text-xl font-black uppercase tracking-tight">Active Session Limit Reached</h1>
            </div>
          </div>

          <div className="p-8 space-y-6">
            <p className="text-xs text-slate-500 font-bold uppercase leading-relaxed">
              Preferred Metals limits concurrent active app instances per account to a <span className="text-slate-900 border-b border-dashed border-slate-300">maximum of 3</span> to protect pricing records, avoid invoice state race conditions, and preserve offline stability.
            </p>

            <div className="p-4 bg-amber-50/60 border border-amber-100/80 rounded-2xl space-y-1">
              <p className="text-[10px] font-black text-amber-800 uppercase tracking-wider">Current Instance Status</p>
              <p className="text-xs text-amber-700 font-medium">
                You are trying to register a 4th instance on this device. You must release/terminate at least one established session below to authorize access.
              </p>
            </div>

            {/* List of active sessions */}
            <div className="space-y-3">
              <h2 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Established Active Sessions</h2>
              <div className="space-y-2.5 max-h-56 overflow-y-auto pr-1">
                {activeSessions.map((s) => {
                  const isCurrent = s.id === currentSessionId;
                  const deviceType = parseUserAgent(s.userAgent);
                  const browserType = parseBrowser(s.userAgent);
                  
                  return (
                    <div 
                      key={s.id} 
                      className={cn(
                        "p-4 rounded-2xl border transition-all flex items-center justify-between gap-4",
                        isCurrent 
                          ? "bg-blue-50/30 border-blue-200/60" 
                          : "bg-slate-50/50 border-slate-100 hover:border-slate-200"
                      )}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={cn(
                          "p-2 rounded-xl shrink-0",
                          isCurrent ? "bg-blue-100 text-blue-600" : "bg-white text-slate-500 border border-slate-100"
                        )}>
                          {deviceType.includes('iPad') || deviceType.includes('iPhone') ? (
                            <Smartphone className="w-5 h-5" />
                          ) : (
                            <Monitor className="w-5 h-5" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-black text-slate-900">{deviceType}</span>
                            <span className="text-[8px] font-black uppercase bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded tracking-wider">
                              {browserType}
                            </span>
                            {isCurrent && (
                              <span className="text-[8px] font-black uppercase bg-blue-600 text-white px-1.5 py-0.5 rounded tracking-wider animate-pulse">
                                This Device
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 mt-0.5 text-[9px] text-slate-400 font-bold uppercase">
                            <span>UID/HW: <span className="font-mono">{s.hardwareId.substring(0, 10)}...</span></span>
                            <span>•</span>
                            <span>Active: {new Date(s.lastActiveAt).toLocaleTimeString()}</span>
                          </div>
                        </div>
                      </div>

                      {!isCurrent && (
                        <button
                          onClick={() => handleTerminateSpecific(s.id)}
                          className="px-3 py-2 bg-white hover:bg-red-50 text-slate-600 hover:text-red-600 border border-slate-200 hover:border-red-100 rounded-xl text-[9px] font-black uppercase tracking-widest transition-colors cursor-pointer"
                        >
                          Terminate
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Quick Actions */}
            <div className="pt-4 border-t border-slate-100 flex flex-col sm:flex-row gap-3">
              <button
                onClick={handleTerminateOldest}
                className="flex-1 py-4 bg-slate-900 hover:bg-blue-600 text-white rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all hover:scale-[1.01] active:scale-95 shadow-lg shadow-slate-900/10 hover:shadow-blue-600/10 cursor-pointer"
              >
                Log Out Oldest Active Terminal
              </button>
              <button
                onClick={() => {
                  auth.signOut();
                  window.location.href = '/login';
                }}
                className="px-6 py-4 bg-slate-50 hover:bg-slate-100 text-slate-500 hover:text-slate-700 border border-slate-200/60 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 cursor-pointer"
              >
                Sign Out
              </button>
            </div>

          </div>

        </div>
      </div>
    );
  }

  const isLoginPage = window.location.pathname === '/login' || window.location.pathname === '/';
  const isUpdateAvailable = systemConfig && systemConfig.currentVersion !== APP_VERSION && !isLoginPage;

  return (
    <ErrorBoundary>
      <SettingsProvider>
        <ToastProvider>
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
                  <Route element={<ProtectedRoute profile={profile} allowedRoles={['manager', 'cashier']} permission="canManageCash" />}>
                    <Route path="cash-drawer" element={<CashDrawer profile={profile} />} />
                  </Route>
                  <Route element={<ProtectedRoute profile={profile} allowedRoles={['manager']} permission="canManageUsers" />}>
                    <Route path="settings" element={<Settings profile={profile} onProfileUpdate={(updated) => setProfile(updated)} />} />
                  </Route>
                </Route>
              </Route>
            </Routes>
          </div>
        </Router>
      </ToastProvider>
    </SettingsProvider>
  </ErrorBoundary>
  );
}
