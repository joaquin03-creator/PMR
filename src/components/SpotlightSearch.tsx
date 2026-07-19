import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, onSnapshot, query, orderBy, limit } from 'firebase/firestore';
import { db } from '../firebase';
import { 
  Search, 
  LayoutDashboard, 
  DollarSign, 
  Wallet, 
  Truck, 
  FileText, 
  History, 
  Users, 
  Package, 
  Settings as SettingsIcon, 
  BarChart3,
  Moon,
  Sun,
  Printer,
  Scan,
  CornerDownLeft,
  X,
  User,
  Activity,
  Maximize2,
  Minimize2,
  FileCheck
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useSettings } from '../context/SettingsContext';
import { Material, Customer, BuyTicket, UserProfile } from '../types';

interface SpotlightSearchProps {
  isOpen: boolean;
  onClose: () => void;
  profile: UserProfile | null;
}

interface SearchItem {
  id: string;
  title: string;
  subtitle?: string;
  category: 'Pages' | 'Materials' | 'Customers' | 'Tickets' | 'Toggles';
  icon: any;
  action: () => void;
  badge?: string;
  badgeColor?: string;
}

export default function SpotlightSearch({ isOpen, onClose, profile }: SpotlightSearchProps) {
  const navigate = useNavigate();
  const { settings, updateSettings } = useSettings();
  const [searchQuery, setSearchQuery] = useState('');
  const [materials, setMaterials] = useState<Material[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [tickets, setTickets] = useState<BuyTicket[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Initialize data subscriptions only when open to preserve resources
  useEffect(() => {
    if (!isOpen) return;

    const unsubMaterials = onSnapshot(collection(db, 'materials'), (snap) => {
      setMaterials(snap.docs.map(d => ({ id: d.id, ...d.data() })) as Material[]);
    });

    const unsubCustomers = onSnapshot(collection(db, 'customers'), (snap) => {
      setCustomers(snap.docs.map(d => ({ id: d.id, ...d.data() })) as Customer[]);
    });

    const unsubTickets = onSnapshot(
      query(collection(db, 'buyTickets'), orderBy('timestamp', 'desc'), limit(150)),
      (snap) => {
        setTickets(snap.docs.map(d => ({ id: d.id, ...d.data() })) as BuyTicket[]);
      }
    );

    return () => {
      try { unsubMaterials(); } catch (e) { console.warn('unsubMaterials error', e); }
      try { unsubCustomers(); } catch (e) { console.warn('unsubCustomers error', e); }
      try { unsubTickets(); } catch (e) { console.warn('unsubTickets error', e); }
    };
  }, [isOpen]);

  // Focus input automatically on open
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setSelectedIndex(0);
      setSearchQuery('');
    }
  }, [isOpen]);

  // Handle keyboard events in results panel
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(prev => Math.min(prev + 1, filteredItems.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(prev => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filteredItems[selectedIndex]) {
          filteredItems[selectedIndex].action();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, selectedIndex, searchQuery, materials, customers, tickets]);

  // Focus selected element so it scrolls into view if list is long
  useEffect(() => {
    const activeEl = containerRef.current?.querySelector('[data-active="true"]');
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  // Helper roles
  const isManager = profile?.role === 'manager';

  // Navigation Items
  const navItems = useMemo(() => {
    const items = [
      { name: 'Dashboard', path: '/', icon: LayoutDashboard },
      { name: 'Buy Tickets', path: '/buy-tickets', icon: DollarSign },
      { name: 'Cash Drawer', path: '/cash-drawer', icon: Wallet, permission: 'canManageCash' },
      { name: 'Trip Tickets', path: '/trip-tickets', icon: Truck },
      { name: 'Invoices', path: '/invoices', icon: FileText, permission: 'canManageInvoices' },
      { name: 'Ticket History', path: '/ticket-history', icon: History },
      { name: 'Customers', path: '/customers', icon: Users },
      { name: 'Inventory', path: '/inventory', icon: Package, permission: 'canManageInventory' },
      { name: 'Manage Prices', path: '/manage-prices', icon: DollarSign, permission: 'canManagePrices' },
      { name: 'Reports', path: '/reports', icon: BarChart3, permission: 'canGenerateReports' },
      { name: 'Settings & Users', path: '/settings', icon: SettingsIcon, permission: 'canManageUsers' },
    ];

    return items
      .filter(item => {
        if (isManager) return true;
        if (item.permission && profile?.permissions) {
          return !!(profile.permissions as any)[item.permission];
        }
        return !item.permission;
      })
      .map(item => ({
        id: `page_${item.path}`,
        title: item.name,
        subtitle: `Navigate to ${item.name} View`,
        category: 'Pages' as const,
        icon: item.icon,
        action: () => {
          navigate(item.path);
          onClose();
        }
      }));
  }, [profile, isManager, navigate, onClose]);

  // Toggles and settings interactions
  const configToggles = useMemo((): SearchItem[] => {
    return [
      {
        id: 'toggle_theme',
        title: settings.theme === 'dark' ? 'Switch to Light Theme' : 'Switch to Dark Theme',
        subtitle: `Currently using ${settings.theme === 'dark' ? 'Dark' : 'Light'} Mode`,
        category: 'Toggles',
        icon: settings.theme === 'dark' ? Sun : Moon,
        action: () => {
          updateSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' });
        },
        badge: settings.theme === 'dark' ? 'Dark' : 'Light',
        badgeColor: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400'
      },
      {
        id: 'toggle_compact',
        title: settings.compactMode ? 'Disable Compact UI' : 'Enable Compact UI Layout',
        subtitle: `Toggles small padding and condensed side bar`,
        category: 'Toggles',
        icon: settings.compactMode ? Minimize2 : Maximize2,
        action: () => {
          updateSettings({ compactMode: !settings.compactMode });
        },
        badge: settings.compactMode ? 'Compact' : 'Standard',
        badgeColor: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400'
      },
      {
        id: 'toggle_autoprint',
        title: settings.autoPrint ? 'Disable Auto Print' : 'Enable Auto-Print for New Tickets',
        subtitle: 'Bypass print previews to speed up yard scales',
        category: 'Toggles',
        icon: Printer,
        action: () => {
          updateSettings({ autoPrint: !settings.autoPrint });
        },
        badge: settings.autoPrint ? 'Auto' : 'Manual',
        badgeColor: settings.autoPrint ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400' : 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-400'
      },
      {
        id: 'toggle_scanner',
        title: settings.scannerEnabled ? 'Disable Hardware ID Scanner' : 'Enable Hardware ID Scanner integration',
        subtitle: 'Connect USB Barcode or Driver License Reader bridge',
        category: 'Toggles',
        icon: Scan,
        action: () => {
          updateSettings({ scannerEnabled: !settings.scannerEnabled });
        },
        badge: settings.scannerEnabled ? 'Enabled' : 'Disabled',
        badgeColor: settings.scannerEnabled ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400' : 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-400'
      }
    ];
  }, [settings, updateSettings]);

  // Master Matching List
  const filteredItems = useMemo((): SearchItem[] => {
    const queryStr = searchQuery.trim().toLowerCase();

    // If empty query, show quick navigation links and toggles
    if (!queryStr) {
      return [...navItems, ...configToggles];
    }

    const matchedPages = navItems.filter(item => 
      item.title.toLowerCase().includes(queryStr) || 
      item.subtitle?.toLowerCase().includes(queryStr)
    );

    const matchedToggles = configToggles.filter(item =>
      item.title.toLowerCase().includes(queryStr) ||
      item.subtitle?.toLowerCase().includes(queryStr)
    );

    const matchedMaterials = materials
      .filter(m => 
        m.name.toLowerCase().includes(queryStr) || 
        m.code.toLowerCase().includes(queryStr) || 
        m.category.toLowerCase().includes(queryStr)
      )
      .slice(0, 10)
      .map(m => ({
        id: `mat_${m.id}`,
        title: `${m.name} (${m.code})`,
        subtitle: `Price: $${m.buyPrice.toFixed(2)}/${m.unit} • Category: ${m.category}`,
        category: 'Materials' as const,
        icon: Package,
        action: () => {
          // If manager, take them to edit is ideal
          if (isManager) {
            navigate(`/manage-prices?search=${encodeURIComponent(m.code)}`);
          } else {
            navigate(`/buy-tickets?materialId=${encodeURIComponent(m.id)}`);
          }
          onClose();
        },
        badge: `$${m.buyPrice.toFixed(2)}`,
        badgeColor: 'bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400'
      }));

    const matchedCustomers = customers
      .filter(c => 
        c.name.toLowerCase().includes(queryStr) || 
        c.businessName?.toLowerCase().includes(queryStr) || 
        c.phone?.includes(queryStr) ||
        c.email?.toLowerCase().includes(queryStr)
      )
      .slice(0, 10)
      .map(c => ({
        id: `ust_${c.id}`,
        title: c.name,
        subtitle: [
          c.businessName ? `Org: ${c.businessName}` : null,
          c.phone ? `Phone: ${c.phone}` : null,
          c.verifiedStatus ? `Status: ${c.verifiedStatus.toUpperCase()}` : null
        ].filter(Boolean).join(' • '),
        category: 'Customers' as const,
        icon: User,
        action: () => {
          navigate(`/customers?id=${c.id}`);
          onClose();
        },
        badge: c.customerType || 'individual',
        badgeColor: 'bg-blue-500/10 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400'
      }));

    const matchedTickets = tickets
      .filter(t => {
        // Find matching customer name
        const custName = customers.find(c => c.id === t.customerId)?.name || '';
        return (
          t.id.toLowerCase().includes(queryStr) ||
          custName.toLowerCase().includes(queryStr) ||
          t.vehiclePlate?.toLowerCase().includes(queryStr) ||
          t.paymentMethod?.toLowerCase().includes(queryStr)
        );
      })
      .slice(0, 10)
      .map(t => {
        const custName = customers.find(c => c.id === t.customerId)?.name || 'Unknown Customer';
        const dateStr = new Date(t.timestamp).toLocaleDateString();
        return {
          id: `tick_${t.id}`,
          title: `Ticket ID: ${t.id.toUpperCase().slice(-8)}`,
          subtitle: `Customer: ${custName} • Total: $${t.totalAmount.toFixed(2)} • Created: ${dateStr}`,
          category: 'Tickets' as const,
          icon: FileCheck,
          action: () => {
            navigate(`/ticket-history?id=${t.id}`);
            onClose();
          },
          badge: t.status ? t.status.toUpperCase() : 'COMPLETED',
          badgeColor: t.status === 'voided' ? 'bg-rose-500/10 text-rose-600 dark:bg-rose-500/20 dark:text-rose-400' : 'bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400'
        };
      });

    return [...matchedPages, ...matchedToggles, ...matchedMaterials, ...matchedCustomers, ...matchedTickets];
  }, [searchQuery, navItems, configToggles, materials, customers, tickets, isManager, navigate, onClose]);

  // Group items by category for stunning visual breakdown
  const groupedItems = useMemo(() => {
    const groups: Record<string, SearchItem[]> = {};
    filteredItems.forEach(item => {
      if (!groups[item.category]) {
        groups[item.category] = [];
      }
      groups[item.category].push(item);
    });
    return groups;
  }, [filteredItems]);

  // Order categories are mapped for flat index selection
  const flatGroupedItems = useMemo(() => {
    const flat: SearchItem[] = [];
    const orderedCategories = ['Pages', 'Toggles', 'Materials', 'Customers', 'Tickets'];
    orderedCategories.forEach(cat => {
      if (groupedItems[cat]) {
        flat.push(...groupedItems[cat]);
      }
    });
    return flat;
  }, [groupedItems]);

  // Correct index mappings if selectedIndex is out of bounds
  useEffect(() => {
    if (selectedIndex >= filteredItems.length) {
      setSelectedIndex(0);
    }
  }, [filteredItems, selectedIndex]);

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 bg-slate-900/60 dark:bg-slate-950/80 z-[3000] backdrop-blur-md flex items-start justify-center p-4 pt-[12vh] transition-all animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div 
        ref={containerRef}
        className="w-full max-w-2xl bg-white dark:bg-slate-900 rounded-3xl shadow-[0_25px_60px_-15px_rgba(0,0,0,0.3)] dark:shadow-[0_25px_60px_-15px_rgba(0,0,0,0.8)] overflow-hidden border border-slate-200/50 dark:border-slate-800 animate-in zoom-in-95 duration-200 flex flex-col max-h-[70vh] relative"
      >
        {/* Search Input Box */}
        <div className="relative border-b border-slate-100 dark:border-slate-800 shrink-0">
          <Search className="absolute left-6 top-1/2 -translate-y-1/2 w-6 h-6 text-slate-400" />
          <input
            ref={inputRef}
            type="text"
            className="w-full pl-16 pr-24 py-5 bg-transparent text-slate-900 dark:text-white placeholder-slate-400 font-medium text-lg focus:outline-none focus:ring-0 uppercase tracking-wide"
            placeholder="Type code, customer, ticket, or setting..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setSelectedIndex(0);
            }}
          />
          <div className="absolute right-6 top-1/2 -translate-y-1/2 flex items-center gap-2">
            <span className="hidden sm:inline-block px-2 py-1 bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 rounded-lg text-[10px] font-black uppercase tracking-wide select-none">ESC to quit</span>
            <button 
              onClick={onClose}
              className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
              aria-label="Close search"
            >
              <X className="w-5 h-5 text-slate-400" />
            </button>
          </div>
        </div>

        {/* Results Stream */}
        <div className="flex-1 overflow-y-auto divide-y divide-slate-100/30 dark:divide-slate-800/20 pr-1">
          {filteredItems.length > 0 ? (
            Object.entries(groupedItems).map(([category, items]) => (
              <div key={category} className="p-3">
                <h4 className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-[0.2em] px-3 py-2 mb-1">
                  {category === 'Toggles' ? 'Quick Controls & Commands' : category}
                </h4>
                <div className="space-y-0.5">
                  {items.map((item) => {
                    // Find actual index in the flat array to match key bindings
                    const flatIdx = filteredItems.findIndex(f => f.id === item.id);
                    const isSelected = flatIdx === selectedIndex;
                    const Icon = item.icon;

                    return (
                      <button
                        key={item.id}
                        data-active={isSelected}
                        onClick={() => item.action()}
                        onMouseEnter={() => setSelectedIndex(flatIdx)}
                        className={cn(
                          "w-full text-left px-4 py-3 rounded-2xl flex items-center justify-between transition-all outline-none",
                          isSelected 
                            ? "bg-blue-600 text-white shadow-lg shadow-blue-500/20 shadow-offset-2 scale-[1.01]" 
                            : "bg-transparent text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/40"
                        )}
                      >
                        <div className="flex items-center gap-4 min-w-0">
                          <div className={cn(
                            "w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border transition-colors",
                            isSelected 
                              ? "bg-blue-700 border-blue-500 text-white" 
                              : "bg-slate-50 dark:bg-slate-800/60 border-slate-200/50 dark:border-slate-800 text-slate-400 dark:text-slate-500"
                          )}>
                            <Icon className="w-5 h-5" />
                          </div>
                          <div className="min-w-0">
                            <p className={cn(
                              "text-sm font-bold tracking-tight uppercase leading-snug",
                              isSelected ? "text-white" : "text-slate-900 dark:text-white"
                            )}>
                              {item.title}
                            </p>
                            {item.subtitle && (
                              <p className={cn(
                                "text-xs font-medium truncate mt-0.5 max-w-sm sm:max-w-md md:max-w-lg",
                                isSelected ? "text-blue-100" : "text-slate-400 dark:text-slate-500"
                              )}>
                                {item.subtitle}
                              </p>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-3 shrink-0">
                          {item.badge && (
                            <span className={cn(
                              "px-2 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-wider",
                              isSelected ? "bg-white/20 text-white" : item.badgeColor
                            )}>
                              {item.badge}
                            </span>
                          )}
                          <CornerDownLeft className={cn(
                            "w-4 h-4 transition-all",
                            isSelected ? "text-white/80 translate-x-0 opacity-100" : "text-slate-300 dark:text-slate-700 translate-x-1 opacity-0 group-hover:opacity-100"
                          )} />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          ) : (
            <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
              <div className="w-16 h-16 bg-slate-50 dark:bg-slate-800/50 rounded-3xl flex items-center justify-center text-slate-400 dark:text-slate-600 mb-4 border border-dashed border-slate-200 dark:border-slate-800">
                <Activity className="w-6 h-6 animate-pulse" />
              </div>
              <h4 className="text-md font-bold text-slate-800 dark:text-slate-300">No match found</h4>
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 max-w-xs leading-relaxed">
                Could not find any pages, toggles, customers, materials or ticket IDs matching "{searchQuery}"
              </p>
            </div>
          )}
        </div>

        {/* Footer info bar */}
        <div className="px-6 py-3.5 bg-slate-50 dark:bg-slate-950/20 border-t border-slate-100 dark:border-slate-800 shrink-0 flex items-center justify-between text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-widest">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1"><kbd className="px-1.5 py-0.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700/60 rounded">↓↑</kbd> Navigate</span>
            <span className="flex items-center gap-1"><kbd className="px-1.5 py-0.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700/60 rounded">Enter</kbd> Select</span>
          </div>
          <div className="flex items-center gap-2">
            <span>Preferred Metals Search Engine</span>
          </div>
        </div>
      </div>
    </div>
  );
}
