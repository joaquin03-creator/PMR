import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { User } from 'firebase/auth';
import { auth, db } from '../firebase';
import { doc, updateDoc } from 'firebase/firestore';
import { UserProfile } from '../types';
import { 
  LayoutDashboard, 
  Truck, 
  Users, 
  Package, 
  DollarSign, 
  BarChart3, 
  LogOut,
  Menu,
  X,
  Wifi,
  WifiOff,
  History,
  FileText,
  Wallet,
  Settings,
  Search
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { cn } from '../lib/utils';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { useSettings } from '../context/SettingsContext';
import { COMPANY_NAME, handleImageError } from '../constants';
import { BrandLogo } from './BrandLogo';
import SpotlightSearch from './SpotlightSearch';

interface LayoutProps {
  user: User;
  profile: UserProfile | null;
}

export default function Layout({ user, profile }: LayoutProps) {
  const { settings } = useSettings();
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isOnline = useNetworkStatus();
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isInput = e.target instanceof HTMLInputElement || 
                      e.target instanceof HTMLTextAreaElement || 
                      (e.target as HTMLElement).isContentEditable;

      // Cmd/Ctrl + K or forward slash '/' when not typing in any inputs
      if (
        ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') ||
        (e.key === '/' && !isInput)
      ) {
        e.preventDefault();
        setSearchOpen(prev => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleLogout = async () => {
    try {
      const hardwareId = localStorage.getItem('pmr_hardware_id') || 'unknown';
      const sessionId = `sess_${hardwareId}_${user.uid}`;
      await updateDoc(doc(db, 'userSessions', sessionId), { 
        status: 'logout',
        lastActiveAt: new Date().toISOString()
      });
    } catch (e) {
      console.warn('Logout session update failed');
    }
    localStorage.removeItem('pm_demo_mode_active');
    localStorage.removeItem('pm_demo_role');
    await auth.signOut();
    navigate('/login');
  };

  const navItems = [
    { name: 'Dashboard', path: '/', icon: LayoutDashboard },
    { name: 'Buy Tickets', path: '/buy-tickets', icon: DollarSign },
    { name: 'Cash Drawer', path: '/cash-drawer', icon: Wallet, permission: 'canManageCash' as const },
    { name: 'Trip Tickets', path: '/trip-tickets', icon: Truck },
    { name: 'Invoices', path: '/invoices', icon: FileText },
    { name: 'Ticket History', path: '/ticket-history', icon: History },
    { name: 'Customers', path: '/customers', icon: Users },
    { name: 'Inventory', path: '/inventory', icon: Package, permission: 'canManageInventory' as const },
    { name: 'Manage Prices', path: '/manage-prices', icon: DollarSign, permission: 'canManagePrices' as const },
    { name: 'Reports', path: '/reports', icon: BarChart3, permission: 'canGenerateReports' as const },
    { name: 'Settings', path: '/settings', icon: Settings, permission: 'canManageUsers' as const },
  ];

  const filteredNavItems = navItems.filter(item => {
    // 1. Managers see everything by default
    if (profile?.role === 'manager') return true;
    
    // 2. For others, check specific permission if defined
    if (item.permission && profile?.permissions) {
      return !!profile.permissions[item.permission];
    }
    
    // 3. If it's a general item with no permission required, show it
    return !item.permission;
  });

  return (
    <div className={cn(
      "flex min-h-screen bg-slate-50 font-sans transition-colors duration-300",
      settings.theme === 'dark' && "dark bg-slate-950"
    )}>
      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 bg-slate-900/50 z-40 lg:hidden" 
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={cn(
        "fixed inset-y-0 left-0 z-50 w-64 bg-slate-900 text-slate-300 transition-transform duration-300 lg:relative lg:translate-x-0 print:hidden",
        sidebarOpen ? "translate-x-0" : "-translate-x-full",
        settings.compactMode && "w-20"
      )}>
        <div className="flex flex-col h-full">
          <div className={cn("p-6 flex flex-col gap-4", settings.compactMode && "p-4 items-center")}>
            <div className={cn(
              "flex items-center justify-center overflow-hidden",
              settings.compactMode ? "w-10 h-10" : "w-full aspect-[4/1]"
            )}>
              <BrandLogo 
                className={cn("w-full h-full object-contain", !settings.companyLogo && "filter grayscale invert brightness-0")} 
                grayscale={!settings.companyLogo}
              />
            </div>
            {!settings.compactMode && (
              <div className="h-px w-full bg-slate-800/30" />
            )}
          </div>

          <nav className={cn("flex-1 px-4 space-y-1.5 py-4", settings.compactMode && "px-2")}>
            {filteredNavItems.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.path;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  onClick={() => setSidebarOpen(false)}
                  title={settings.compactMode ? item.name : undefined}
                  className={cn(
                    "flex items-center gap-3 px-4 py-3.5 rounded-2xl text-sm font-bold transition-all outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900",
                    isActive 
                      ? "bg-blue-600 text-white shadow-xl shadow-blue-900/40" 
                      : "text-slate-400 hover:bg-slate-800/50 hover:text-white",
                    settings.compactMode && "justify-center px-0"
                  )}
                >
                  <Icon className={cn("w-5 h-5 shrink-0", isActive ? "text-white" : "text-slate-500")} />
                  {!settings.compactMode && item.name}
                </Link>
              );
            })}
          </nav>

          <div className={cn("p-4 border-t border-slate-800", settings.compactMode && "p-2")}>
            <div className={cn("flex items-center gap-3 px-3 py-2 mb-4", settings.compactMode && "px-0 justify-center")}>
              <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center overflow-hidden shrink-0">
                {user.photoURL ? (
                  <img src={user.photoURL} alt={user.displayName || ''} referrerPolicy="no-referrer" onError={handleImageError} />
                ) : (
                  <Users className="w-4 h-4" />
                )}
              </div>
              {!settings.compactMode && (
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{user.displayName}</p>
                  <p className="text-xs text-slate-500 truncate capitalize">{profile?.role}</p>
                </div>
              )}
            </div>
            <button
              onClick={handleLogout}
              className={cn(
                "flex items-center gap-3 w-full px-3 py-3 rounded-xl text-sm font-medium text-slate-400 hover:bg-slate-800 hover:text-white transition-all outline-none focus-visible:ring-2 focus-visible:ring-red-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900",
                settings.compactMode && "justify-center px-0"
              )}
              aria-label="Sign out"
            >
              <LogOut className="w-5 h-5 shrink-0" />
              {!settings.compactMode && "Sign Out"}
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className={cn(
          "h-20 bg-white border-b border-slate-200 flex items-center justify-between px-6 lg:px-10 shrink-0 transition-colors duration-300 print:hidden",
          settings.theme === 'dark' && "bg-slate-900 border-slate-800"
        )}>
          <button 
            onClick={() => setSidebarOpen(true)}
            className="p-3 -ml-2 text-slate-500 lg:hidden hover:bg-slate-100 rounded-2xl transition-colors outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            aria-label="Open sidebar"
          >
            <Menu className="w-6 h-6" />
          </button>
          <div className="flex-1 max-w-sm lg:max-w-md mx-4 lg:mx-6 hidden md:block">
            <button
              onClick={() => setSearchOpen(true)}
              className={cn(
                "w-full flex items-center justify-between px-4 py-2.5 bg-slate-100 hover:bg-slate-200/50 border border-slate-200/30 rounded-2xl text-slate-400 hover:text-slate-500 transition-all text-[10px] font-bold uppercase tracking-wider outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
                settings.theme === 'dark' && "bg-slate-800 hover:bg-slate-700/65 border-slate-700/80 text-slate-500 hover:text-slate-400"
              )}
            >
              <div className="flex items-center gap-2.5">
                <Search className="w-4 h-4 text-slate-400 dark:text-slate-500" />
                <span>Search database...</span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <kbd className="px-1.5 py-0.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded text-[9px] font-black tracking-normal">⌘K</kbd>
              </div>
            </button>
          </div>
          <div className="flex-1 md:hidden" />
          <div className="flex items-center gap-6">
            <button
              onClick={() => setSearchOpen(true)}
              className={cn(
                "p-2.5 text-slate-500 hover:bg-slate-100 rounded-2xl md:hidden transition-all outline-none",
                settings.theme === 'dark' && "text-slate-400 hover:bg-slate-800"
              )}
              aria-label="Spotlight Search"
            >
              <Search className="w-5.25 h-5.25" />
            </button>
            <div className={cn(
              "flex items-center gap-2 px-3.5 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest transition-all duration-300",
              isOnline 
                ? "bg-emerald-50 text-emerald-700 border border-emerald-100/80" 
                : "bg-rose-50 text-rose-800 border border-rose-200 animate-pulse",
              settings.theme === 'dark' && (
                isOnline 
                  ? "bg-emerald-950/30 text-emerald-400 border-emerald-800/50" 
                  : "bg-rose-950/30 text-rose-400 border-rose-800"
              )
            )}>
              {isOnline ? (
                <>
                  <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full inline-block animate-pulse" />
                  <Wifi className="w-3.5 h-3.5 text-emerald-500" />
                  <span>Connectivity: Online</span>
                </>
              ) : (
                <>
                  <span className="w-1.5 h-1.5 bg-rose-500 rounded-full inline-block animate-ping" />
                  <WifiOff className="w-3.5 h-3.5 text-rose-500" />
                  <span className="font-extrabold text-rose-700 dark:text-rose-400">Connectivity: Disconnected (Working on Local Cache)</span>
                </>
              )}
            </div>
            <span className={cn(
              "text-xs font-black text-slate-400 uppercase tracking-widest hidden sm:inline",
              settings.theme === 'dark' && "text-slate-500"
            )}>
              {new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
            </span>
          </div>
        </header>

        <main className={cn(
          "flex-1 overflow-y-auto p-4 lg:p-8 transition-colors duration-300 print:p-0",
          settings.theme === 'dark' && "bg-slate-950"
        )}>
          <div className="max-w-7xl mx-auto">
            <Outlet />
          </div>
        </main>
      </div>
      <SpotlightSearch 
        isOpen={searchOpen} 
        onClose={() => setSearchOpen(false)} 
        profile={profile} 
      />
    </div>
  );
}
