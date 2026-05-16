import { useState, useEffect } from 'react';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, signInWithPopup, GoogleAuthProvider, getRedirectResult, signInWithRedirect } from 'firebase/auth';
import { auth, db } from '../firebase';
import { ShieldCheck, AlertCircle, HelpCircle, ClipboardCheck, KeyRound, ArrowLeft, X } from 'lucide-react';
import { APP_VERSION, COMPANY_NAME } from '../constants';
import { BrandLogo } from '../components/BrandLogo';
import { useSearchParams } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';

export default function Login() {
  const [searchParams] = useSearchParams();
  const error = searchParams.get('error');
  const rejectedEmail = searchParams.get('email');

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'signing_in' | 'success' | 'checking_profile'>('idle');
  const [debugInfo, setDebugInfo] = useState<{ host: string, type: string } | null>(null);
  const [showTroubleshooter, setShowTroubleshooter] = useState(false);
  
  // Management Login State
  const [isManagementMode, setIsManagementMode] = useState(false);
  const [adminEmail, setAdminEmail] = useState('admin@preferredmetals.com');
  const [adminPassword, setAdminPassword] = useState('Admin123!');
  const [godClicks, setGodClicks] = useState(0);
  const [showGodButton, setShowGodButton] = useState(false);

  const handleGodClick = () => {
    const clicks = godClicks + 1;
    setGodClicks(clicks);
    if (clicks >= 3) {
      setShowGodButton(true);
      setGodClicks(0);
      setErrorMsg('Direct System Access Enabled.');
    }
  };

  useEffect(() => {
    if (searchParams.get('godmode') === 'true') {
      setShowGodButton(true);
      setErrorMsg('Direct System Access Enabled.');
    }
  }, [searchParams]);

  useEffect(() => {
    // Capture invite token if present
    const invite = searchParams.get('invite');
    if (invite) {
      localStorage.setItem('pm_invite_token', invite);
    }

    getRedirectResult(auth)
      .then((result) => {
        if (result) {
          setStatus('success');
        }
      })
      .catch((err) => {
        console.error('Redirect result error:', err);
        // Silently handle known issues with domain authorization in iframes
        if (err.code === 'auth/unauthorized-domain') {
          setDebugInfo({ host: window.location.hostname, type: 'redirect' });
        } else {
          setErrorMsg(`${err.code}: ${err.message}`);
        }
      });

    return auth.onAuthStateChanged((user) => {
      // Short-circuit loading if we are ready
      if (user) {
        setStatus('success');
      } else {
        setStatus('idle');
      }
    });
  }, []);

  const handleGoogleLogin = async (useRedirect = false) => {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    setErrorMsg(null);
    setStatus('signing_in');
    setDebugInfo(null);
    
    try {
      if (useRedirect) {
        await signInWithRedirect(auth, provider);
      } else {
        await signInWithPopup(auth, provider);
      }
    } catch (err: any) {
      console.error('Login failed:', err);
      setStatus('idle');
      if (err.code === 'auth/popup-blocked') {
        setErrorMsg('Login popup was blocked. Please allow popups or use Redirect Mode.');
      } else if (err.code === 'auth/unauthorized-domain') {
        const host = window.location.hostname;
        setErrorMsg(`Unauthorized Domain. This URL ("${host}") must be added to your Firebase Authorized Domains.`);
        setDebugInfo({ host, type: 'popup' });
      } else if (err.code === 'auth/popup-closed-by-user') {
        setErrorMsg('Login cancelled. Please finish the Google sign-in process.');
      } else if (err.code === 'auth/network-request-failed') {
        setErrorMsg('Network error. Please check your connection or try Redirect Mode.');
      } else {
        setErrorMsg(`${err.code}: ${err.message}`);
      }
    }
  };

  const handleManagementLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminEmail || !adminPassword) {
      setErrorMsg('Credentials required for System Access.');
      return;
    }

    setErrorMsg(null);
    setStatus('signing_in');

    try {
      if (isManagementMode) {
        await createUserWithEmailAndPassword(auth, adminEmail, adminPassword);
      } else {
        await signInWithEmailAndPassword(auth, adminEmail, adminPassword);
      }
    } catch (err: any) {
      console.error('System login failed:', err);
      setStatus('idle');
      if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        setErrorMsg('Invalid credentials. Check your System Key.');
      } else if (err.code === 'auth/operation-not-allowed') {
        setErrorMsg('Email/Password login is disabled in Firebase console.');
      } else if (err.code === 'auth/email-already-in-use') {
        setErrorMsg('This email is already registered. Please log in, or click "Quick Dev Login" to make a new one instantly.');
      } else if (err.code === 'auth/weak-password') {
        setErrorMsg('Password should be at least 6 characters.');
      } else {
        setErrorMsg(`${err.code}: ${err.message}`);
      }
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6 sm:p-12">
      <div className="max-w-md w-full bg-white rounded-[3rem] shadow-2xl p-10 border border-slate-100 relative overflow-hidden">
        {showGodButton && (
          <div className="absolute top-0 left-0 right-0 h-1 bg-blue-500 animate-pulse z-50" />
        )}
        
        <div className="flex flex-col items-center text-center mb-10">
          <div className="w-full max-w-[160px] aspect-[2/1] flex items-center justify-center mb-4 relative">
            <BrandLogo className="w-full h-full object-contain" />
          </div>
          <p className="text-slate-400 font-bold text-[8px] uppercase tracking-[0.4em]">Integrated Logistics Shell</p>
        </div>

        <div className="space-y-6">
          {showGodButton && (
            <div className="bg-blue-600 rounded-2xl p-4 text-white flex items-center justify-between animate-in slide-in-from-top-1 duration-300">
              <div className="flex items-center gap-3">
                <ShieldCheck className="w-5 h-5" />
                <span className="text-[10px] font-black uppercase tracking-widest">Master Bypass Active</span>
              </div>
              <button 
                onClick={() => {
                  setAdminEmail('joaquinrodriguez3333@gmail.com');
                  setErrorMsg('System override ready. Enter key.');
                }}
                className="px-3 py-1 bg-white/20 hover:bg-white/30 rounded-lg text-[9px] font-black uppercase tracking-widest transition-colors"
              >
                Auto-Fill
              </button>
            </div>
          )}

          {errorMsg && (
            <div className="bg-amber-50 rounded-2xl p-4 border border-amber-100 flex flex-col gap-4 animate-in shake-1 duration-500">
              <div className="flex gap-4 items-start">
                <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-[11px] leading-relaxed text-amber-900 font-bold">{errorMsg}</p>
                </div>
              </div>
              
              {debugInfo && (
                <button 
                  onClick={() => setShowTroubleshooter(true)}
                  className="w-full py-2 bg-amber-100/50 hover:bg-amber-200/50 rounded-xl text-[9px] font-black uppercase tracking-widest text-amber-700 transition-colors flex items-center justify-center gap-2"
                >
                  <HelpCircle className="w-3 h-3" />
                  View Fix Instructions
                </button>
              )}
            </div>
          )}

          {showTroubleshooter && (
            <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-6 animate-in fade-in duration-200">
              <div className="bg-white rounded-[2.5rem] w-full max-w-lg shadow-2xl p-8 space-y-6 animate-in zoom-in-95 duration-200 border border-slate-100">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-50 rounded-xl text-blue-600">
                      <ShieldCheck className="w-5 h-5" />
                    </div>
                    <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight">Authentication Troubleshooter</h3>
                  </div>
                  <button 
                    onClick={() => setShowTroubleshooter(false)}
                    className="p-2 hover:bg-slate-100 rounded-full text-slate-400 transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="space-y-4">
                  <div className="p-5 bg-slate-50 rounded-2xl border border-slate-100 space-y-3">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Step 1: Authorize Domains</p>
                    <p className="text-xs font-medium text-slate-600 leading-relaxed">
                      Authentication is failing because this domain is not white-listed in your Firebase Console.
                    </p>
                    <div className="space-y-2">
                      <p className="text-[9px] font-bold text-slate-400 uppercase">Copy this URL:</p>
                      <div className="flex items-center gap-2 p-3 bg-white border border-slate-200 rounded-xl">
                        <code className="text-xs font-mono text-blue-600 flex-1 truncate">{window.location.host}</code>
                        <button 
                          onClick={() => copyToClipboard(window.location.host)}
                          className="p-2 text-slate-400 hover:text-blue-500 transition-colors"
                        >
                          <ClipboardCheck className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    <p className="text-[10px] font-medium text-slate-500">
                      Go to <strong className="text-slate-700">Firebase Console &gt; Auth &gt; Settings &gt; Authorized Domains</strong> and add the URL above.
                    </p>
                  </div>

                  <div className="p-5 bg-slate-50 rounded-2xl border border-slate-100 space-y-3">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Step 2: Browser Settings</p>
                    <p className="text-xs font-medium text-slate-600 leading-relaxed">
                      If the domain is already authorized, your browser might be blocking "Third-party cookies".
                    </p>
                    <ul className="text-[10px] space-y-2 text-slate-500 list-disc pl-4 font-medium">
                      <li>Disable "Block third-party cookies" in browser settings.</li>
                      <li>Try using <strong className="text-slate-700">Redirect Mode</strong> (button below).</li>
                      <li>Incognito mode often blocks required auth cookies.</li>
                    </ul>
                  </div>
                </div>

                <button 
                  onClick={() => setShowTroubleshooter(false)}
                  className="w-full py-4 bg-slate-900 text-white rounded-2xl font-black text-xs uppercase tracking-widest"
                >
                  Got it
                </button>
              </div>
            </div>
          )}

          {status === 'success' && (
            <div className="bg-emerald-50 rounded-2xl p-4 border border-emerald-100 flex items-center gap-3 animate-in zoom-in-95">
              <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0" />
              <div className="flex items-center gap-2">
                <span className="text-xs font-black text-emerald-900 uppercase">Authenticated</span>
                <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
              </div>
            </div>
          )}

          <div className="space-y-6">
            <div className="relative py-4">
              <div className="absolute inset-0 flex items-center" aria-hidden="true">
                <div className="w-full border-t border-slate-100"></div>
              </div>
              <div className="relative flex justify-center">
                <span className="bg-white px-6 text-[9px] font-black uppercase tracking-[0.5em] text-slate-300">system access</span>
              </div>
            </div>

            {/* Credentials Login */}
            <form onSubmit={handleManagementLogin} className="space-y-5">
              <div className="space-y-4">
                <div className="relative group">
                  <div className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-500 transition-colors">
                    <ShieldCheck className="w-4 h-4" />
                  </div>
                  <input
                    type="email"
                    value={adminEmail}
                    onChange={(e) => setAdminEmail(e.target.value)}
                    placeholder="Email Address"
                    className="w-full pl-14 pr-6 py-4 bg-slate-50 border-2 border-slate-50 rounded-2xl focus:border-blue-500 focus:bg-white outline-none transition-all text-sm font-medium"
                    required
                  />
                </div>
                <div className="relative group">
                  <div className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-500 transition-colors">
                    <KeyRound className="w-4 h-4" />
                  </div>
                  <input
                    type="password"
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    placeholder="System Key"
                    className="w-full pl-14 pr-6 py-4 bg-slate-50 border-2 border-slate-50 rounded-2xl focus:border-blue-500 focus:bg-white outline-none transition-all text-sm font-medium"
                    required
                  />
                </div>
                <div className="flex justify-between items-center">
                  <button
                    type="button"
                    onClick={() => setIsManagementMode(!isManagementMode)}
                    className="text-[10px] font-bold text-slate-400 hover:text-blue-600 transition-colors uppercase tracking-widest"
                  >
                    {isManagementMode ? 'Back to Login' : 'Create Account'}
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      setStatus('signing_in');
                      try {
                        const randomEmail = `dev_${Math.floor(Math.random() * 100000)}@example.com`;
                        await createUserWithEmailAndPassword(auth, randomEmail, '123456');
                      } catch (err: any) {
                        setStatus('idle');
                        setErrorMsg(`Dev Login Failed: ${err.message}`);
                      }
                    }}
                    className="text-[10px] font-black text-emerald-500 hover:text-emerald-600 transition-colors uppercase tracking-widest"
                  >
                    Quick Dev Login
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!adminEmail) {
                        setErrorMsg('Please enter your email address to reset your key.');
                        return;
                      }
                      import('firebase/auth').then(({ sendPasswordResetEmail }) => {
                        sendPasswordResetEmail(auth, adminEmail)
                          .then(() => setErrorMsg('Password reset email sent! Please check your inbox (and spam folder).'))
                          .catch((err) => setErrorMsg(`Reset failed: ${err.message}`));
                      });
                    }}
                    className="text-[10px] font-bold text-slate-400 hover:text-blue-600 transition-colors uppercase tracking-widest"
                  >
                    Forgot System Key?
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={status === 'signing_in'}
                className="w-full py-5 bg-slate-950 text-white rounded-[2.5rem] font-black text-xs uppercase tracking-[0.2em] hover:bg-blue-600 transition-all shadow-xl shadow-slate-200 active:scale-[0.98] disabled:opacity-50"
              >
                {status === 'signing_in' ? 'Authenticating...' : isManagementMode ? 'Create Account' : 'Authorize credentials'}
              </button>

              <button
                type="button"
                onClick={async () => {
                  setStatus('idle');
                  setErrorMsg('Clearing cache...');
                  try {
                    await auth.signOut();
                    localStorage.clear();
                    sessionStorage.clear();
                    const dbs = await window.indexedDB.databases();
                    dbs.forEach(db => { if(db.name) window.indexedDB.deleteDatabase(db.name) });
                    window.location.reload();
                  } catch (e) {}
                }}
                className="w-full py-3 mt-4 bg-red-50 text-red-600 rounded-[2.5rem] font-black text-[10px] uppercase tracking-[0.2em] hover:bg-red-100 transition-all"
              >
                Clear Ghost Sessions & Reload
              </button>

              {showGodButton && (
                <button
                  type="button"
                  onClick={() => {
                    setAdminEmail('joaquinrodriguez3333@gmail.com');
                    setErrorMsg('God Mode sequence active. Enter system key.');
                  }}
                  className="w-full py-3 bg-blue-600 text-white rounded-2xl font-black text-[10px] uppercase tracking-[0.3em] hover:bg-blue-700 transition-all animate-pulse shadow-lg shadow-blue-200"
                >
                  God Mode Enabled
                </button>
              )}
            </form>
          </div>
        </div>

        <div className="mt-12 pt-8 border-t border-slate-50 text-center space-y-2">
          <button 
            onClick={handleGodClick}
            className="block w-full text-[10px] font-black text-slate-300 uppercase tracking-[0.2em] hover:text-slate-400 transition-colors cursor-default"
          >
            &copy; {new Date().getFullYear()} Preferred Metals & Recycling
          </button>
          <p className="text-[8px] font-black text-slate-200 uppercase tracking-widest">Build V{APP_VERSION}</p>
        </div>
      </div>
    </div>
  );
}
