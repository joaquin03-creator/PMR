import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { auth, db } from '../firebase';
import { collection, onSnapshot, query, where, addDoc, doc, updateDoc, deleteDoc, getDocs, orderBy, limit, deleteField } from 'firebase/firestore';
import { CashSession, CashTransaction, BuyTicket, UserProfile, Material, AuditLog } from '../types';
import { 
  Wallet, 
  Banknote, 
  Fuel, 
  Receipt, 
  ArrowDownCircle, 
  ArrowUpCircle, 
  History, 
  Loader2, 
  Plus, 
  X, 
  CheckCircle2, 
  AlertCircle,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Clock,
  Lock,
  Calendar,
  Save,
  Trash2,
  Edit2,
  RotateCcw,
  Activity,
  ShieldCheck,
  Eye,
  Printer,
  FileSpreadsheet,
  Copy,
  Search,
  Filter,
  AlertTriangle,
  ShieldAlert,
  Truck,
  Wrench,
  ShoppingCart,
  Users,
  Zap,
  Tag,
  Check,
  ChevronRight,
  Sparkles,
  ArrowRight
} from 'lucide-react';
import { ResponsiveContainer, BarChart, Bar, Cell, XAxis, YAxis, Tooltip as RechartsTooltip, ReferenceLine, CartesianGrid } from 'recharts';
import { cn } from '../lib/utils';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';
import { logAuditEvent } from '../lib/audit';
import { useToast } from '../context/ToastContext';

interface CashDrawerProps {
  profile: UserProfile | null;
}

interface DenominationCount {
  hundreds: number;
  fifties: number;
  twenties: number;
  tens: number;
  fives: number;
  ones: number;
  dollarCoins: number;
  halfDollars: number;
  quarters: number;
  dimes: number;
  nickels: number;
}

const denominationsList: { key: keyof DenominationCount; label: string; value: number; isCoin: boolean }[] = [
  { key: 'hundreds', label: 'Hundreds ($100)', value: 100, isCoin: false },
  { key: 'fifties', label: 'Fifties ($50)', value: 50, isCoin: false },
  { key: 'twenties', label: 'Twenties ($20)', value: 20, isCoin: false },
  { key: 'tens', label: 'Tens ($10)', value: 10, isCoin: false },
  { key: 'fives', label: 'Fives ($5)', value: 5, isCoin: false },
  { key: 'ones', label: 'Ones ($1)', value: 1, isCoin: false },
  { key: 'dollarCoins', label: 'Dollar Coins ($1)', value: 1, isCoin: true },
  { key: 'halfDollars', label: 'Half Dollars (50¢)', value: 0.5, isCoin: true },
  { key: 'quarters', label: 'Quarters (25¢)', value: 0.25, isCoin: true },
  { key: 'dimes', label: 'Dimes (10¢)', value: 0.1, isCoin: true },
  { key: 'nickels', label: 'Nickels (5¢)', value: 0.05, isCoin: true },
];

const initialDenominations: DenominationCount = {
  hundreds: 0,
  fifties: 0,
  twenties: 0,
  tens: 0,
  fives: 0,
  ones: 0,
  dollarCoins: 0,
  halfDollars: 0,
  quarters: 0,
  dimes: 0,
  nickels: 0,
};

const ensureDenomTotals = (denoms: DenominationCount | undefined | null): DenominationCount => {
  if (!denoms) return { ...initialDenominations };
  
  // Check if they look like counts or totals.
  // If any bill key has a value > 0 and < its denomination value,
  // it MUST be a count, because you can't have a total of $5 in hundreds (unless it's a count of 5, which means $500).
  let isCount = false;
  const billsToCheck: { key: keyof DenominationCount; val: number }[] = [
    { key: 'hundreds', val: 100 },
    { key: 'fifties', val: 50 },
    { key: 'twenties', val: 20 },
    { key: 'tens', val: 10 },
    { key: 'fives', val: 5 }
  ];
  
  for (const item of billsToCheck) {
    const v = denoms[item.key] || 0;
    if (v > 0 && v < item.val) {
      isCount = true;
      break;
    }
  }
  
  const converted = { ...initialDenominations };
  if (isCount) {
    denominationsList.forEach(d => {
      converted[d.key] = Math.round((denoms[d.key] || 0) * d.value * 100) / 100;
    });
  } else {
    denominationsList.forEach(d => {
      converted[d.key] = Math.round((denoms[d.key] || 0) * 100) / 100;
    });
  }
  return converted;
};

interface DenominationEditorProps {
  values: DenominationCount;
  onChange: (newValues: DenominationCount) => void;
}

function DenominationEditor({ values, onChange }: DenominationEditorProps) {
  const updateCount = (key: keyof DenominationCount, change: number) => {
    const denom = denominationsList.find(d => d.key === key)!;
    const currentVal = values[key] || 0;
    const val = Math.max(0, currentVal + (change * denom.value));
    onChange({ ...values, [key]: Math.round(val * 100) / 100 });
  };

  const handleInputChange = (key: keyof DenominationCount, valStr: string) => {
    const parsed = parseFloat(valStr);
    const val = isNaN(parsed) || parsed < 0 ? 0 : Math.round(parsed * 100) / 100;
    onChange({ ...values, [key]: val });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, key: keyof DenominationCount) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      updateCount(key, 1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      updateCount(key, -1);
    }
  };

  const bills = denominationsList.filter(d => !d.isCoin);
  const coins = denominationsList.filter(d => d.isCoin);

  return (
    <div className="space-y-6">
      {/* Informative Help Banner */}
      <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl flex items-start gap-3 shadow-xs">
        <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
        <div className="space-y-1">
          <h4 className="text-xs font-black text-amber-900 uppercase tracking-wide">Enter Money Totals in Dollars</h4>
          <p className="text-[11px] text-amber-700 font-medium leading-relaxed">
            Please enter the <strong>total dollar value</strong> for each denomination, not the individual bill or coin counts. 
            Use the <strong>+ / -</strong> buttons or up/down arrows to quickly increment or decrement by each bill ($100, $50, $20, $10, $5, $1) and coin (50¢, 25¢, 10¢, 5¢) value.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Bills */}
        <div className="space-y-3">
          <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 pb-2">Paper Bills</h4>
          <div className="space-y-2">
            {bills.map(denom => {
              const totalVal = values[denom.key] || 0;
              return (
                <div key={denom.key} className="flex items-center justify-between p-2.5 bg-slate-50/60 rounded-2xl border border-slate-100 shadow-sm hover:border-slate-200 transition-all">
                  <span className="text-xs font-bold text-slate-700 truncate w-32 shrink-0 pr-1">{denom.label}</span>
                  <div className="flex items-center gap-1.5 shrink-0 flex-nowrap">
                    <button
                      type="button"
                      onClick={() => updateCount(denom.key, -1)}
                      disabled={totalVal <= 0}
                      className="w-8 h-8 flex items-center justify-center bg-white border border-slate-200 rounded-lg font-bold hover:bg-slate-50 active:scale-95 disabled:opacity-30 disabled:pointer-events-none transition-all text-slate-600 shadow-sm"
                      title={`Subtract $${denom.value}`}
                    >
                      -
                    </button>
                    <div 
                      onClick={(e) => {
                        const input = e.currentTarget.querySelector('input');
                        if (input) input.focus();
                      }}
                      className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg px-2 py-1 shadow-sm w-28 justify-center cursor-text focus-within:ring-2 focus-within:ring-amber-500/20 focus-within:border-amber-500 transition-all"
                    >
                      <span className="text-xs font-black text-slate-400 shrink-0">$</span>
                      <input
                        type="number"
                        min="0"
                        step={denom.value}
                        value={totalVal || ''}
                        onChange={(e) => handleInputChange(denom.key, e.target.value)}
                        onKeyDown={(e) => handleKeyDown(e, denom.key)}
                        placeholder="0"
                        className="w-16 text-left font-mono font-black text-xs outline-none bg-transparent"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => updateCount(denom.key, 1)}
                      className="w-8 h-8 flex items-center justify-center bg-white border border-slate-200 rounded-lg font-bold hover:bg-slate-50 active:scale-95 transition-all text-slate-600 shadow-sm"
                      title={`Add $${denom.value}`}
                    >
                      +
                    </button>
                    <span className="w-20 text-right font-mono font-black text-slate-900 text-xs shrink-0 pl-1">
                      ${Math.round(totalVal).toLocaleString()}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Coins / Change */}
        <div className="space-y-3">
          <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 pb-2">Coins &amp; Change</h4>
          <div className="space-y-2">
            {coins.map(denom => {
              const totalVal = values[denom.key] || 0;
              return (
                <div key={denom.key} className="flex items-center justify-between p-2.5 bg-slate-50/60 rounded-2xl border border-slate-100 shadow-sm hover:border-slate-200 transition-all">
                  <span className="text-xs font-bold text-slate-700 truncate w-32 shrink-0 pr-1">{denom.label}</span>
                  <div className="flex items-center gap-1.5 shrink-0 flex-nowrap">
                    <button
                      type="button"
                      onClick={() => updateCount(denom.key, -1)}
                      disabled={totalVal <= 0}
                      className="w-8 h-8 flex items-center justify-center bg-white border border-slate-200 rounded-lg font-bold hover:bg-slate-50 active:scale-95 disabled:opacity-30 disabled:pointer-events-none transition-all text-slate-600 shadow-sm"
                      title={`Subtract $${denom.value < 1 ? `${Math.round(denom.value * 100)}¢` : `$${denom.value}`}`}
                    >
                      -
                    </button>
                    <div 
                      onClick={(e) => {
                        const input = e.currentTarget.querySelector('input');
                        if (input) input.focus();
                      }}
                      className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg px-2 py-1 shadow-sm w-28 justify-center cursor-text focus-within:ring-2 focus-within:ring-amber-500/20 focus-within:border-amber-500 transition-all"
                    >
                      <span className="text-xs font-black text-slate-400 shrink-0">$</span>
                      <input
                        type="number"
                        min="0"
                        step={denom.value}
                        value={totalVal || ''}
                        onChange={(e) => handleInputChange(denom.key, e.target.value)}
                        onKeyDown={(e) => handleKeyDown(e, denom.key)}
                        placeholder="0.00"
                        className="w-16 text-left font-mono font-black text-xs outline-none bg-transparent"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => updateCount(denom.key, 1)}
                      className="w-8 h-8 flex items-center justify-center bg-white border border-slate-200 rounded-lg font-bold hover:bg-slate-50 active:scale-95 transition-all text-slate-600 shadow-sm"
                      title={`Add $${denom.value < 1 ? `${Math.round(denom.value * 100)}¢` : `$${denom.value}`}`}
                    >
                      +
                    </button>
                    <span className="w-20 text-right font-mono font-black text-slate-900 text-xs shrink-0 pl-1">
                      ${totalVal.toFixed(2)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex justify-end pt-2">
        <button
          type="button"
          onClick={() => onChange(initialDenominations)}
          className="text-xs text-red-500 hover:text-red-600 font-bold uppercase tracking-wider"
        >
          Clear All counts
        </button>
      </div>
    </div>
  );
}

const getShortageStatus = (overShortVal: number, ticketCount: number) => {
  const overShort = Math.round(overShortVal * 100) / 100;
  if (overShort >= 0) {
    return {
      type: 'over' as const,
      colorClass: 'bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 shadow-xs',
      textClass: 'text-emerald-600',
      badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-100',
      label: 'Balanced/Overage',
      isTolerance: false,
      maxExpected: 0
    };
  }
  
  // It's a shortage (negative value)
  const absShortage = Math.abs(overShort);
  // Calculate maximum rounding shortage: up to 4 cents per ticket (payouts rounded to the nearest nickel/dime)
  const maxExpectedShortage = Math.round((ticketCount * 0.04) * 100) / 100;
  // Allow a minimum base tolerance of 10 cents or 4 cents per ticket
  const toleranceLimit = Math.max(0.10, maxExpectedShortage);
  
  if (absShortage <= toleranceLimit) {
    return {
      type: 'tolerance' as const,
      colorClass: 'bg-amber-500/15 text-amber-600 border border-amber-500/20 shadow-xs',
      textClass: 'text-amber-500 font-bold',
      badgeClass: 'bg-amber-50 text-amber-700 border-amber-200',
      label: 'Rounding Tolerance',
      isTolerance: true,
      maxExpected: toleranceLimit
    };
  }
  
  return {
    type: 'short' as const,
    colorClass: 'bg-red-500/15 text-red-600 border border-red-500/20 shadow-xs',
    textClass: 'text-red-600 font-bold',
    badgeClass: 'bg-red-50 text-red-700 border-red-100',
    label: 'Shortage Discrepancy',
    isTolerance: false,
    maxExpected: toleranceLimit
  };
};

export default function CashDrawer({ profile }: CashDrawerProps) {
  const { firestore, local, success, error: toastError, info } = useToast();
  const [activeSession, setActiveSession] = useState<CashSession | null>(null);
  const [selectedSession, setSelectedSession] = useState<CashSession | null>(null);
  const [transactions, setTransactions] = useState<CashTransaction[]>([]);
  const [buyTickets, setBuyTickets] = useState<BuyTicket[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  
  const [showInflowModal, setShowInflowModal] = useState(false);
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [showStartModal, setShowStartModal] = useState(false);
  const [showEditOpeningModal, setShowEditOpeningModal] = useState(false);
  
  // Expense submittal and confirmation sequence states
  const [expenseStep, setExpenseStep] = useState<'form' | 'confirm' | 'submitting' | 'success'>('form');
  const [expenseCategory, setExpenseCategory] = useState<string>('Fuel');
  const [customCategory, setCustomCategory] = useState<string>('');
  const [expenseAmount, setExpenseAmount] = useState<string>('');
  const [expensePayee, setExpensePayee] = useState<string>('');
  const [expenseNotes, setExpenseNotes] = useState<string>('');
  const [expenseSubmittalMsg, setExpenseSubmittalMsg] = useState<string>('');
  const [confirmedExpenseTx, setConfirmedExpenseTx] = useState<{
    id: string;
    category: string;
    amount: number;
    notes: string;
    timestamp: string;
    sessionDate: string;
    previousBalance: number;
    newBalance: number;
  } | null>(null);

  // Inflow / Bank Run submittal and confirmation sequence states
  const [inflowStep, setInflowStep] = useState<'form' | 'confirm' | 'submitting' | 'success'>('form');
  const [inflowCategory, setInflowCategory] = useState<string>('Bank Run');
  const [customInflowCategory, setCustomInflowCategory] = useState<string>('');
  const [inflowAmount, setInflowAmount] = useState<string>('');
  const [inflowSource, setInflowSource] = useState<string>('');
  const [inflowNotes, setInflowNotes] = useState<string>('');
  const [inflowSubmittalMsg, setInflowSubmittalMsg] = useState<string>('');
  const [confirmedInflowTx, setConfirmedInflowTx] = useState<{
    id: string;
    category: string;
    amount: number;
    notes: string;
    timestamp: string;
    sessionDate: string;
    previousBalance: number;
    newBalance: number;
  } | null>(null);

  // Ledger item highlight tracking
  const [highlightedTxId, setHighlightedTxId] = useState<string | null>(null);
  
  const [history, setHistory] = useState<CashSession[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [historyTab, setHistoryTab] = useState<'tracker' | 'ledgers' | 'audits'>('tracker');

  // Retroactive session states
  const [showRetroactiveModal, setShowRetroactiveModal] = useState(false);
  const [isManualRetro, setIsManualRetro] = useState(false);
  const [retroactiveDate, setRetroactiveDate] = useState<string>('');
  const [retroStatus, setRetroStatus] = useState<'open' | 'closed'>('closed');
  const [retroNotes, setRetroNotes] = useState<string>('');
  const [retroBankRun, setRetroBankRun] = useState<string>('');
  const [useRetroOpeningDenoms, setUseRetroOpeningDenoms] = useState(false);
  const [retroOpeningDenoms, setRetroOpeningDenoms] = useState<DenominationCount>(initialDenominations);
  const [quickRetroOpeningCash, setQuickRetroOpeningCash] = useState<string>('');
  const [useRetroClosingDenoms, setUseRetroClosingDenoms] = useState(false);
  const [retroClosingDenoms, setRetroClosingDenoms] = useState<DenominationCount>(initialDenominations);
  const [quickRetroClosingCash, setQuickRetroClosingCash] = useState<string>('');

  // Audit logs & recent tickets
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [auditSearch, setAuditSearch] = useState<string>('');
  const [auditFilterAction, setAuditFilterAction] = useState<string>('all');
  const [recentTickets, setRecentTickets] = useState<BuyTicket[]>([]);

  // States for counting denominations
  const [openingDenoms, setOpeningDenoms] = useState<DenominationCount>(initialDenominations);
  const [useOpeningDenoms, setUseOpeningDenoms] = useState(true);
  const [quickOpeningCash, setQuickOpeningCash] = useState<string>('');

  const [closingDenoms, setClosingDenoms] = useState<DenominationCount>(initialDenominations);
  const [useClosingDenoms, setUseClosingDenoms] = useState(true);

  // State to view a session's recorded denominations breakdown
  const [viewingDenoms, setViewingDenoms] = useState<{
    title: string;
    denoms: DenominationCount;
    closedBy?: string;
  } | null>(null);

  const todayStr = useMemo(() => {
    return new Date().toLocaleDateString('en-CA');
  }, []);

  const mostRecentClosedSession = useMemo(() => {
    if (history.length === 0) return null;
    
    // Filter for historical sessions (prior to today) and sort descending safely
    const priorSessions = [...history]
      .filter(s => s.date && s.date < todayStr)
      .sort((a, b) => {
        const dateA = a.date || '';
        const dateB = b.date || '';
        return dateB.localeCompare(dateA);
      });
      
    if (priorSessions.length === 0) return null;

    // Find the most recent closed session
    const lastClosed = priorSessions.find(s => s.status === 'closed');
    const absoluteNewest = priorSessions[0];

    // If the absolute newest session prior to today was left open but has physical manual count entered, use it!
    if (absoluteNewest && absoluteNewest.status !== 'closed' && (absoluteNewest.closingDenominations || absoluteNewest.actualCash)) {
      return absoluteNewest;
    }

    return lastClosed || absoluteNewest || null;
  }, [history, todayStr]);

  // Daily Balance Sheet view modes and physical counts
  const [viewMode, setViewMode] = useState<'dashboard' | 'balance_sheet' | 'daily_purchase_report'>('balance_sheet');
  const [sheetDenoms, setSheetDenoms] = useState<DenominationCount>(initialDenominations);
  const [editedOpeningCash, setEditedOpeningCash] = useState<number>(0);
  const [editedOpeningDenoms, setEditedOpeningDenoms] = useState<DenominationCount>(initialDenominations);
  const [denomEditTab, setDenomEditTab] = useState<'closing' | 'opening'>('closing');

  // States for real-time auto-saving and verification
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isInitialLoadRef = useRef(true);
  const prevSessionIdRef = useRef<string | null>(null);

  // States for Verification Form in Audit
  const [verificationComment, setVerificationComment] = useState('');
  const [verificationStatus, setVerificationStatus] = useState<'unverified' | 'verified' | 'disputed'>('unverified');
  const [isSubmittingVerification, setIsSubmittingVerification] = useState(false);
  const [isEditingVerification, setIsEditingVerification] = useState(false);

  // Sync state values when selectedSession changes
  useEffect(() => {
    if (selectedSession) {
      setEditedOpeningCash(selectedSession.openingCash || 0);
      setVerificationComment(selectedSession.verificationComment || '');
      setVerificationStatus(selectedSession.verificationStatus || 'unverified');
      setIsEditingVerification(false);
      setDenomEditTab('closing');

      if (prevSessionIdRef.current !== selectedSession.id) {
        isInitialLoadRef.current = true;
        prevSessionIdRef.current = selectedSession.id;
      }

      // Load opening denominations
      if (selectedSession.openingDenominations) {
        setEditedOpeningDenoms(ensureDenomTotals(selectedSession.openingDenominations));
      } else {
        const savedOpeningDraft = localStorage.getItem(`cash_opening_denoms_draft_${selectedSession.id}`);
        if (savedOpeningDraft) {
          try {
            setEditedOpeningDenoms(JSON.parse(savedOpeningDraft));
          } catch {
            setEditedOpeningDenoms(initialDenominations);
          }
        } else {
          setEditedOpeningDenoms(initialDenominations);
        }
      }

      // Load from Firestore first
      if (selectedSession.closingDenominations) {
        setSheetDenoms(ensureDenomTotals(selectedSession.closingDenominations));
      } else {
        // Fallback: check localStorage for local unsaved progress
        const savedDraft = localStorage.getItem(`cash_sheet_denoms_draft_${selectedSession.id}`);
        if (savedDraft) {
          try {
            setSheetDenoms(JSON.parse(savedDraft));
          } catch {
            setSheetDenoms(initialDenominations);
          }
        } else {
          setSheetDenoms(initialDenominations);
        }
      }
    } else {
      setEditedOpeningCash(0);
      setEditedOpeningDenoms(initialDenominations);
      setSheetDenoms(initialDenominations);
      setVerificationComment('');
      setVerificationStatus('unverified');
      prevSessionIdRef.current = null;
      setDenomEditTab('closing');
    }
  }, [selectedSession?.id, selectedSession?.status]);

  // Auto-save sheetDenoms, editedOpeningCash, and editedOpeningDenoms to localStorage (immediately) and Firestore (debounced)
  useEffect(() => {
    if (!selectedSession || !profile) return;

    // Save to localStorage immediately on every change!
    try {
      localStorage.setItem(`cash_sheet_denoms_draft_${selectedSession.id}`, JSON.stringify(sheetDenoms));
      localStorage.setItem(`cash_opening_denoms_draft_${selectedSession.id}`, JSON.stringify(editedOpeningDenoms));
      localStorage.setItem(`cash_opening_cash_draft_${selectedSession.id}`, editedOpeningCash.toString());
    } catch (e) {
      console.error("Failed to save drafts to localStorage:", e);
    }

    // Skip the first update when selectedSession changes (initial mount or tab change)
    if (isInitialLoadRef.current) {
      isInitialLoadRef.current = false;
      return;
    }

    const isTodayOpen = activeSession?.status === 'open' && selectedSession.id === activeSession.id;
    const isManager = profile.role === 'manager';
    // STRICT SAFETY FIX: NEVER auto-save to Firestore for closed sessions!
    // Auto-save must ONLY run if the selected session is currently OPEN.
    if (!selectedSession || !profile || selectedSession.status !== 'open') return;

    setAutoSaveStatus('saving');

    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
    }

    autoSaveTimeoutRef.current = setTimeout(async () => {
      const openingCash = Math.round(editedOpeningCash * 100) / 100;
      const expectedCashVal = Math.round((openingCash + totalReplenishments - totalPayouts - totalExpenses) * 100) / 100;
      const actualCash = Math.round(calculateDenomTotal(sheetDenoms) * 100) / 100;
      const overShort = Math.round((actualCash - expectedCashVal) * 100) / 100;

      const oldOpeningCash = selectedSession.openingCash;
      const oldActualCash = selectedSession.actualCash;
      const oldOpeningDenoms = selectedSession.openingDenominations;
      const oldClosingDenoms = selectedSession.closingDenominations;

      // Check if anything actually changed
      const openingCashChanged = Math.abs(oldOpeningCash - openingCash) > 0.001;
      const closingDenomsChanged = JSON.stringify(oldClosingDenoms) !== JSON.stringify(sheetDenoms);
      const openingDenomsChanged = JSON.stringify(oldOpeningDenoms) !== JSON.stringify(editedOpeningDenoms);
      const actualCashChanged = Math.abs((oldActualCash || 0) - actualCash) > 0.001;

      if (!openingCashChanged && !closingDenomsChanged && !openingDenomsChanged && !actualCashChanged) {
        setAutoSaveStatus('saved');
        return;
      }

      try {
        const updateData: any = {
          openingCash,
          expectedCash: expectedCashVal,
          actualCash,
          overShort,
          closingDenominations: sheetDenoms
        };

        if (selectedSession.openingDenominations || openingDenomsChanged) {
          updateData.openingDenominations = editedOpeningDenoms;
        }

        await updateDoc(doc(db, 'cashSessions', selectedSession.id), updateData);
        setAutoSaveStatus('saved');

        // Update selectedSession in state silently so UI matches calculations
        setSelectedSession(prev => prev ? {
          ...prev,
          ...updateData
        } : null);

        // Track in Audit Log with details
        const changes: string[] = [];
        if (openingCashChanged) {
          changes.push(`Opening Cash: $${oldOpeningCash.toFixed(2)} → $${openingCash.toFixed(2)}`);
        }
        if (openingDenomsChanged) {
          changes.push(`Opening Denoms adjusted`);
        }
        if (closingDenomsChanged || actualCashChanged) {
          changes.push(`Closing Cash: $${(oldActualCash || 0).toFixed(2)} → $${actualCash.toFixed(2)}`);
        }

        await logAuditEvent(
          'cashDrawer',
          selectedSession.id,
          'adjustment',
          {
            before: {
              openingCash: oldOpeningCash,
              actualCash: oldActualCash || null,
              openingDenominations: oldOpeningDenoms || null,
              closingDenominations: oldClosingDenoms || null
            },
            after: {
              openingCash,
              actualCash,
              openingDenominations: selectedSession.openingDenominations || openingDenomsChanged ? editedOpeningDenoms : null,
              closingDenominations: sheetDenoms
            }
          },
          `Live-edit update of session ${selectedSession.date} by ${profile.email || 'Manager'}: ${changes.join(', ')}`
        );
      } catch (err) {
        console.error("Auto-save failed:", err);
        setAutoSaveStatus('error');
      }
    }, 1500); // 1.5s debounce

    return () => {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
    };
  }, [sheetDenoms, editedOpeningCash, editedOpeningDenoms, selectedSession?.id]);

  // Save closingDenoms to localStorage immediately on every change!
  useEffect(() => {
    if (activeSession) {
      try {
        localStorage.setItem(`cash_close_denoms_draft_${activeSession.id}`, JSON.stringify(closingDenoms));
      } catch (e) {
        console.error("Failed to save close draft to localStorage:", e);
      }
    }
  }, [closingDenoms, activeSession?.id]);

  // Load closingDenoms from draft when modal opens
  useEffect(() => {
    if (showCloseModal && activeSession) {
      const saved = localStorage.getItem(`cash_close_denoms_draft_${activeSession.id}`);
      if (saved) {
        try {
          setClosingDenoms(JSON.parse(saved));
        } catch {
          setClosingDenoms(activeSession.closingDenominations ? ensureDenomTotals(activeSession.closingDenominations) : sheetDenoms);
        }
      } else {
        setClosingDenoms(activeSession.closingDenominations ? ensureDenomTotals(activeSession.closingDenominations) : sheetDenoms);
      }
    }
  }, [showCloseModal, activeSession?.id]);

  // Save openingDenoms to localStorage immediately on every change!
  useEffect(() => {
    try {
      localStorage.setItem(`cash_open_denoms_draft`, JSON.stringify(openingDenoms));
    } catch (e) {
      console.error("Failed to save open draft to localStorage:", e);
    }
  }, [openingDenoms]);

  // Load openingDenoms from draft on page mount
  useEffect(() => {
    const saved = localStorage.getItem(`cash_open_denoms_draft`);
    if (saved) {
      try {
        setOpeningDenoms(JSON.parse(saved));
      } catch {
        setOpeningDenoms(initialDenominations);
      }
    }
  }, []);

  // Pre-populate opening count from previous closed day's manual closing count breakdown when modal opens
  useEffect(() => {
    if (showStartModal && mostRecentClosedSession) {
      if (mostRecentClosedSession.closingDenominations) {
        setOpeningDenoms(ensureDenomTotals(mostRecentClosedSession.closingDenominations));
      } else {
        setOpeningDenoms({
          ...initialDenominations,
          ones: mostRecentClosedSession.actualCash || 0
        });
      }
      setQuickOpeningCash((mostRecentClosedSession.actualCash || 0).toFixed(2));
    }
  }, [showStartModal, mostRecentClosedSession]);

  // Verification Form Submit Handler
  const handleVerifySession = async (status: 'verified' | 'disputed') => {
    if (!selectedSession || !profile) return;
    setIsSubmittingVerification(true);
    try {
      const now = new Date().toISOString();
      await updateDoc(doc(db, 'cashSessions', selectedSession.id), {
        verificationStatus: status,
        verifiedBy: profile.email,
        verifiedAt: now,
        verificationComment
      });

      // Track in Audit Log
      await logAuditEvent(
        'cashDrawer',
        selectedSession.id,
        'update',
        {
          before: {
            verificationStatus: selectedSession.verificationStatus || null,
            verificationComment: selectedSession.verificationComment || null
          },
          after: {
            verificationStatus: status,
            verificationComment
          }
        },
        `Manager audit verification for ${selectedSession.date}: Status updated to ${status === 'verified' ? 'Verified & Approved' : 'Disputed / Flagged'}. Notes: ${verificationComment || 'None'}`
      );

      setSelectedSession(prev => prev ? {
        ...prev,
        verificationStatus: status,
        verifiedBy: profile.email,
        verifiedAt: now,
        verificationComment
      } : null);

      setIsEditingVerification(false);
      firestore(
        'Audit Verified',
        `Session audit verification committed to Cloud Firestore as ${status === 'verified' ? 'Verified & Approved' : 'Disputed / Flagged'}.`
      );
    } catch (error: any) {
      toastError('Verification Failed', `Failed to submit audit verification: ${error.message || error}`);
      handleFirestoreError(error, OperationType.UPDATE, 'cashSessions');
    } finally {
      setIsSubmittingVerification(false);
    }
  };

  const renderAutoSaveBadge = () => {
    switch (autoSaveStatus) {
      case 'saving':
        return (
          <span className="inline-flex items-center gap-1 text-[9px] font-black text-blue-500 uppercase tracking-widest bg-blue-50 border border-blue-200/50 px-2 py-0.5 rounded-full">
            <Loader2 className="w-2.5 h-2.5 animate-spin" />
            Saving...
          </span>
        );
      case 'saved':
        return (
          <span className="inline-flex items-center gap-1 text-[9px] font-black text-emerald-500 uppercase tracking-widest bg-emerald-50 border border-emerald-200/50 px-2 py-0.5 rounded-full">
            <CheckCircle2 className="w-2.5 h-2.5 text-emerald-500 animate-pulse" />
            Auto-saved
          </span>
        );
      case 'error':
        return (
          <span className="inline-flex items-center gap-1 text-[9px] font-black text-red-500 uppercase tracking-widest bg-red-50 border border-red-200/50 px-2 py-0.5 rounded-full">
            <AlertTriangle className="w-2.5 h-2.5 text-red-500" />
            Save Error
          </span>
        );
      default:
        return null;
    }
  };

  const sheetLedgerItems = useMemo(() => {
    const items: {
      id?: string;
      cashIn: number | null;
      cashOut: number | null;
      description: string;
      initials: string;
      timestamp: string;
    }[] = [];

    // Add manual inflows
    transactions.filter(t => t.type === 'inflow').forEach(t => {
      items.push({
        id: t.id,
        cashIn: t.amount,
        cashOut: null,
        description: t.notes || t.category || 'Cash Inflow',
        initials: (t.performedBy || 'SYS').substring(0, 3).toUpperCase(),
        timestamp: t.timestamp
      });
    });

    // Add manual expenses
    transactions.filter(t => t.type === 'expense').forEach(t => {
      items.push({
        id: t.id,
        cashIn: null,
        cashOut: t.amount,
        description: t.notes || t.category || 'Expense Outlay',
        initials: (t.performedBy || 'SYS').substring(0, 3).toUpperCase(),
        timestamp: t.timestamp
      });
    });

    // Add buy ticket cash payouts (aggregated into one total line item)
    if (buyTickets.length > 0) {
      const totalTicketsAmount = buyTickets.reduce((sum, t) => sum + t.totalAmount, 0);
      const latestTimestamp = buyTickets.reduce((latest, t) => {
        if (!latest) return t.timestamp;
        return new Date(t.timestamp).getTime() > new Date(latest).getTime() ? t.timestamp : latest;
      }, buyTickets[0]?.timestamp || '');

      items.push({
        cashIn: null,
        cashOut: totalTicketsAmount,
        description: `Material Purchases (${buyTickets.length} Ticket${buyTickets.length === 1 ? '' : 's'})`,
        initials: 'SYS',
        timestamp: latestTimestamp
      });
    }

    // Sort chronologically
    return items.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }, [transactions, buyTickets]);

  const handleSheetDenomChange = (key: keyof DenominationCount, value: number) => {
    if (!selectedSession) return;
    setSheetDenoms(prev => ({
      ...prev,
      [key]: Math.max(0, value)
    }));
  };

  const handleSaveSheetCount = async () => {
    if (!selectedSession || !profile) return;
    setProcessing(true);
    const openingCash = Math.round(editedOpeningCash * 100) / 100;
    const expectedCashVal = Math.round((openingCash + totalReplenishments - totalPayouts - totalExpenses) * 100) / 100;
    const actualCash = Math.round(calculateDenomTotal(sheetDenoms) * 100) / 100;
    const overShort = Math.round((actualCash - expectedCashVal) * 100) / 100;
    try {
      await updateDoc(doc(db, 'cashSessions', selectedSession.id), {
        openingCash,
        expectedCash: expectedCashVal,
        actualCash,
        overShort,
        closingDenominations: sheetDenoms
      });

      // Track in Audit Log
      await logAuditEvent(
        'cashDrawer',
        selectedSession.id,
        selectedSession.status === 'closed' ? 'adjustment' : 'update',
        {
          before: { 
            openingCash: selectedSession.openingCash,
            expectedCash: selectedSession.expectedCash,
            actualCash: selectedSession.actualCash || null, 
            overShort: selectedSession.overShort || null,
            closingDenominations: selectedSession.closingDenominations || null
          },
          after: { 
            openingCash,
            expectedCash: expectedCashVal,
            actualCash, 
            overShort,
            closingDenominations: sheetDenoms
          }
        },
        selectedSession.status === 'closed'
          ? `Manager audit adjustment of physical counts for ${selectedSession.date}. Opening Cash: $${openingCash.toLocaleString(undefined, { minimumFractionDigits: 2 })}. Corrected Closing Cash: $${actualCash.toLocaleString(undefined, { minimumFractionDigits: 2 })}. Over/Short: $${overShort.toLocaleString(undefined, { minimumFractionDigits: 2 })}`
          : `Updated physical counts via digital Daily Balance Sheet. Opening: $${openingCash.toLocaleString(undefined, { minimumFractionDigits: 2 })}. Closing Cash: $${actualCash.toLocaleString(undefined, { minimumFractionDigits: 2 })}. Over/Short: $${overShort.toLocaleString(undefined, { minimumFractionDigits: 2 })}`
      );

      // Force-update selectedSession in local state so the rest of the UI gets updated immediately
      setSelectedSession(prev => prev ? {
        ...prev,
        openingCash,
        expectedCash: expectedCashVal,
        actualCash,
        overShort,
        closingDenominations: sheetDenoms
      } : null);

      firestore(
        selectedSession.status === 'closed' ? 'Audit Counts Saved' : 'Counts Committed',
        selectedSession.status === 'closed'
          ? `Historical physical cash counts & opening balance updated & committed successfully to Cloud Firestore.`
          : `Physical cash counts saved & successfully committed to Cloud Firestore.`
      );
    } catch (error: any) {
      toastError('Save Counts Failed', `Failed to save physical cash counts: ${error.message || error}`);
      handleFirestoreError(error, OperationType.UPDATE, 'cashSessions');
    } finally {
      setProcessing(false);
    }
  };

  const handleExportSheetCsv = () => {
    if (!selectedSession) return;
    
    const dateStr = selectedSession.date;
    let csvContent = "";
    
    // Header
    csvContent += "PREFERRED METALS & RECYCLING,,DAILY BALANCE SHEET\n";
    csvContent += `DATE: ${dateStr},,\n\n`;
    
    // Table Headers
    csvContent += "CASH IN,CASH OUT,DESCRIPTION,INITIALS\n";
    
    // Table Rows
    sheetLedgerItems.forEach(item => {
      const inVal = item.cashIn ? item.cashIn.toFixed(2) : "";
      const outVal = item.cashOut ? item.cashOut.toFixed(2) : "";
      const desc = `"${item.description.replace(/"/g, '""')}"`;
      csvContent += `${inVal},${outVal},${desc},${item.initials}\n`;
    });
    
    // Add empty rows to make it look like physical paper template
    const emptyRowCount = Math.max(0, 15 - sheetLedgerItems.length);
    for (let i = 0; i < emptyRowCount; i++) {
      csvContent += ",,,\n";
    }
    
    csvContent += "\n";
     // Bottom left totals vs Bottom right denominations
    const sDenoms = ensureDenomTotals(sheetDenoms);
    const onHand = selectedSession.actualCash !== undefined && selectedSession.actualCash !== null ? selectedSession.actualCash : calculateDenomTotal(sDenoms);
    const billsTotal = 
      (sDenoms.hundreds || 0) +
      (sDenoms.fifties || 0) +
      (sDenoms.twenties || 0) +
      (sDenoms.tens || 0) +
      (sDenoms.fives || 0) +
      (sDenoms.ones || 0);
      
    const coinsTotal = 
      (sDenoms.dollarCoins || 0) +
      (sDenoms.halfDollars || 0) +
      (sDenoms.quarters || 0) +
      (sDenoms.dimes || 0) +
      (sDenoms.nickels || 0);

    csvContent += `TOTAL CASH IN,${totalReplenishments.toFixed(2)},,DENOMINATIONS,QUANTITY,TOTAL\n`;
    csvContent += `Beginning Cash,${selectedSession.openingCash.toFixed(2)},,100's,${Math.round(sDenoms.hundreds / 100)},${sDenoms.hundreds.toFixed(2)}\n`;
    csvContent += `Grand Total,${(totalReplenishments + selectedSession.openingCash).toFixed(2)},,50's,${Math.round(sDenoms.fifties / 50)},${sDenoms.fifties.toFixed(2)}\n`;
    csvContent += `Total Cash OUT,${(totalPayouts + totalExpenses).toFixed(2)},,20's,${Math.round(sDenoms.twenties / 20)},${sDenoms.twenties.toFixed(2)}\n`;
    csvContent += `End Balance,${expectedCash.toFixed(2)},,10s,${Math.round(sDenoms.tens / 10)},${sDenoms.tens.toFixed(2)}\n`;
    csvContent += `,,,5's,${Math.round(sDenoms.fives / 5)},${sDenoms.fives.toFixed(2)}\n`;
    csvContent += `Total Cash On-Hand,${onHand.toFixed(2)},,1's,${Math.round(sDenoms.ones / 1)},${sDenoms.ones.toFixed(2)}\n`;
    csvContent += `Over/Short,${(onHand - expectedCash).toFixed(2)},,Dollar Coins,${Math.round(sDenoms.dollarCoins / 1)},${sDenoms.dollarCoins.toFixed(2)}\n`;
    csvContent += `,,,Halves,${Math.round(sDenoms.halfDollars / 0.5)},${sDenoms.halfDollars.toFixed(2)}\n`;
    csvContent += `,,,Quarters,${Math.round(sDenoms.quarters / 0.25)},${sDenoms.quarters.toFixed(2)}\n`;
    csvContent += `,,,Dimes,${Math.round(sDenoms.dimes / 0.1)},${sDenoms.dimes.toFixed(2)}\n`;
    csvContent += `,,,Nickels,${Math.round(sDenoms.nickels / 0.05)},${sDenoms.nickels.toFixed(2)}\n`;
    csvContent += `,,,,,,\n`;
    csvContent += `,,,TOTAL BILLS,,${billsTotal.toFixed(2)}\n`;
    csvContent += `,,,TOTAL COINS,,${coinsTotal.toFixed(2)}\n`;
    csvContent += `,,,COIN/BILL COUNT TOTAL,,${onHand.toFixed(2)}\n`;
    
    // Download Link
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `daily_balance_sheet_${dateStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  useEffect(() => {
    if (!auth.currentUser) return;

    // 1. Subscribe to today's active session
    const unsubSession = onSnapshot(
      query(collection(db, 'cashSessions'), where('date', '==', todayStr), limit(1)),
      (snapshot) => {
        if (!snapshot.empty) {
          const sess = { id: snapshot.docs[0].id, ...snapshot.docs[0].data() } as CashSession;
          setActiveSession(sess);
          setSelectedSession(prev => {
            if (!prev || prev.id === sess.id || prev.date === todayStr) {
              return sess;
            }
            return prev;
          });
        } else {
          setActiveSession(null);
          setSelectedSession(prev => {
            if (!prev || prev.date === todayStr) {
              return null;
            }
            return prev;
          });
        }
        setLoading(false);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'cashSessions')
    );

    // 2. Historical sessions
    const unsubHistory = onSnapshot(
      query(collection(db, 'cashSessions'), orderBy('date', 'desc'), limit(30)),
      (snapshot) => {
        setHistory(snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as CashSession[]);
      }
    );

    return () => {
      try {
        unsubSession();
      } catch (e) {
        console.warn('unsubSession error', e);
      }
      try {
        unsubHistory();
      } catch (e) {
        console.warn('unsubHistory error', e);
      }
    };
  }, [todayStr, profile]);

  // Keep selectedSession synchronized with history/activeSession updates
  useEffect(() => {
    if (selectedSession) {
      if (activeSession && selectedSession.id === activeSession.id) {
        if (JSON.stringify(selectedSession) !== JSON.stringify(activeSession)) {
          setSelectedSession(activeSession);
        }
      } else {
        const updated = history.find(s => s.id === selectedSession.id);
        if (updated && JSON.stringify(updated) !== JSON.stringify(selectedSession)) {
          setSelectedSession(updated);
        }
      }
    }
  }, [history, activeSession, selectedSession]);

  // Subscribe to audit logs for cash Drawer/Transaction activity
  useEffect(() => {
    if (!auth.currentUser) return;
    const q = query(
      collection(db, 'auditLogs'),
      orderBy('timestamp', 'desc'),
      limit(300)
    );
    const unsubAudit = onSnapshot(q, (snapshot) => {
      const logs = snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as AuditLog[];
      const cashLogs = logs.filter(l => l.entityType === 'cashDrawer' || l.entityType === 'cashTransaction');
      setAuditLogs(cashLogs);
    }, (error) => {
      console.error("Error subscribing to audit logs:", error);
    });
    return () => unsubAudit();
  }, [profile]);

  // Subscribe to historical Buy Tickets for the last 14 days to identify missing days
  useEffect(() => {
    if (!auth.currentUser) return;
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
    
    const unsubRecentTickets = onSnapshot(
      query(
        collection(db, 'buyTickets'),
        where('timestamp', '>=', fourteenDaysAgo.toISOString())
      ),
      (snapshot) => {
        setRecentTickets(snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as BuyTicket[]);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'buyTickets')
    );
    return () => unsubRecentTickets();
  }, [profile]);

  // Subscribe to transactions for the selected session
  useEffect(() => {
    if (!auth.currentUser) return;

    if (selectedSession) {
      const unsubTx = onSnapshot(
        query(collection(db, 'cashTransactions'), where('sessionId', '==', selectedSession.id), orderBy('timestamp', 'desc')),
        (snapshot) => {
          setTransactions(snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as CashTransaction[]);
        }
      );
      return () => {
        try {
          unsubTx();
        } catch (e) {
          console.warn('unsubTx error', e);
        }
      };
    } else {
      setTransactions([]);
    }
  }, [selectedSession?.id, profile]);

  const getTicketLocalDate = useCallback((timestampStr?: string) => {
    if (!timestampStr) return '';
    const d = new Date(timestampStr);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-CA');
  }, []);

  // Subscribe to Buy Tickets for the active/selected session's date
  useEffect(() => {
    if (!auth.currentUser) return;

    const targetDate = selectedSession ? selectedSession.date : todayStr;
    const startOfDay = new Date(`${targetDate}T00:00:00`);
    const endOfDay = new Date(`${targetDate}T23:59:59.999`);

    const unsubTickets = onSnapshot(
      query(
        collection(db, 'buyTickets'),
        where('timestamp', '>=', startOfDay.toISOString()),
        where('timestamp', '<=', endOfDay.toISOString())
      ),
      (snapshot) => {
        const tickets = snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as BuyTicket[];
        setBuyTickets(tickets.filter(t => t.status !== 'voided' && t.status !== 'cancelled'));
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'buyTickets')
    );

    return () => {
      try {
        unsubTickets();
      } catch (e) {
        console.warn('unsubTickets error', e);
      }
    };
  }, [selectedSession?.date, todayStr, profile]);

  // Subscribe to Materials
  useEffect(() => {
    if (!auth.currentUser) return;
    const unsubMaterials = onSnapshot(
      collection(db, 'materials'),
      (snapshot) => {
        setMaterials(snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as Material[]);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'materials')
    );
    return () => {
      try {
        unsubMaterials();
      } catch (e) {
        console.warn('unsubMaterials error', e);
      }
    };
  }, [profile]);

  // Money Tracker Calculations
  const closedSessions = useMemo(() => history.filter(s => s.status === 'closed'), [history]);

  const perfectMatchRate = useMemo(() => {
    if (closedSessions.length === 0) return 0;
    const matches = closedSessions.filter(s => Math.abs(s.overShort || 0) < 0.05).length;
    return Math.round((matches / closedSessions.length) * 100);
  }, [closedSessions]);

  const netDiscrepancy = useMemo(() => {
    const sum = closedSessions.reduce((sum, s) => sum + (s.overShort || 0), 0);
    return Math.round(sum * 100) / 100;
  }, [closedSessions]);

  const averageDailyDrift = useMemo(() => {
    if (closedSessions.length === 0) return 0;
    const sum = closedSessions.reduce((sum, s) => sum + Math.abs(s.overShort || 0), 0);
    return Math.round((sum / closedSessions.length) * 100) / 100;
  }, [closedSessions]);

  const missingReconciliationDays = useMemo(() => {
    const ticketDates = new Set<string>();
    recentTickets.forEach(t => {
      if (t.timestamp && t.status !== 'voided' && t.status !== 'cancelled') {
        const dateStr = getTicketLocalDate(t.timestamp);
        if (dateStr) ticketDates.add(dateStr);
      }
    });

    const sessionDates = new Set(history.map(s => s.date));
    const missing: { date: string; ticketCount: number; totalPayout: number }[] = [];
    
    ticketDates.forEach(date => {
      if (!sessionDates.has(date) && date !== todayStr) {
        const dayTickets = recentTickets.filter(t => getTicketLocalDate(t.timestamp) === date && t.status !== 'voided' && t.status !== 'cancelled');
        if (dayTickets.length > 0) {
          missing.push({
            date,
            ticketCount: dayTickets.length,
            totalPayout: Math.round(dayTickets.reduce((sum, t) => sum + (t.totalAmount || 0), 0) * 100) / 100
          });
        }
      }
    });

    return missing.sort((a, b) => b.date.localeCompare(a.date));
  }, [recentTickets, history, todayStr, getTicketLocalDate]);

  const chartData = useMemo(() => {
    const sortedClosed = [...closedSessions]
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-15);
    return sortedClosed.map(s => ({
      date: s.date,
      'Over / Short': Math.round((s.overShort || 0) * 100) / 100
    }));
  }, [closedSessions]);

  const filteredAuditLogs = useMemo(() => {
    return auditLogs.filter(log => {
      const matchesSearch = !auditSearch || 
        log.notes?.toLowerCase().includes(auditSearch.toLowerCase()) ||
        log.performedBy.toLowerCase().includes(auditSearch.toLowerCase()) ||
        log.id.toLowerCase().includes(auditSearch.toLowerCase());
        
      const matchesAction = auditFilterAction === 'all' || log.action === auditFilterAction;
      
      return matchesSearch && matchesAction;
    });
  }, [auditLogs, auditSearch, auditFilterAction]);

  const dailyPurchaseReportData = useMemo(() => {
    // Group purchases by materialId
    const grouped: Record<string, {
      materialId: string;
      code: string;
      name: string;
      category: string;
      unit: string;
      totalWeight: number;
      totalPaid: number;
      ticketCount: number;
      salePrice: number;
    }> = {};

    let totalTickets = buyTickets.length;
    let totalWeightOverall = 0;
    let totalPaidOverall = 0;
    let totalExpectedProfitOverall = 0;

    const ticketIdsByMaterial: Record<string, Set<string>> = {};

    buyTickets.forEach(ticket => {
      ticket.materials.forEach(item => {
        const mat = materials.find(m => m.id === item.materialId);
        const code = mat?.code || 'Unknown';
        const name = mat?.name || item.notes || 'Unknown Material';
        const category = mat?.category || 'Uncategorized';
        const unit = mat?.unit || 'lb';
        const salePrice = mat?.salePrice || 0;

        const netWeight = item.netWeight || 0;
        const totalPaid = item.totalAmount || 0;

        if (!grouped[item.materialId]) {
          grouped[item.materialId] = {
            materialId: item.materialId,
            code,
            name,
            category,
            unit,
            totalWeight: 0,
            totalPaid: 0,
            ticketCount: 0,
            salePrice
          };
          ticketIdsByMaterial[item.materialId] = new Set();
        }

        grouped[item.materialId].totalWeight += netWeight;
        grouped[item.materialId].totalPaid += totalPaid;
        ticketIdsByMaterial[item.materialId].add(ticket.id);
      });
    });

    // Populate ticket counts and calculate overall totals
    const items = Object.values(grouped).map(group => {
      group.ticketCount = ticketIdsByMaterial[group.materialId]?.size || 0;
      
      const expectedSellValue = group.salePrice * group.totalWeight;
      const expectedProfit = expectedSellValue - group.totalPaid;

      totalWeightOverall += group.totalWeight;
      totalPaidOverall += group.totalPaid;
      totalExpectedProfitOverall += expectedProfit;

      return {
        ...group,
        expectedSellValue,
        expectedProfit,
        avgBuyPrice: group.totalWeight > 0 ? group.totalPaid / group.totalWeight : 0
      };
    }).sort((a, b) => b.totalPaid - a.totalPaid); // Sort by total paid descending

    return {
      items,
      totalTickets,
      totalWeightOverall,
      totalPaidOverall,
      totalExpectedProfitOverall
    };
  }, [buyTickets, materials]);

  const totalPayouts = useMemo(() => {
    const val = buyTickets.reduce((sum, t) => sum + t.totalAmount, 0);
    return Math.round(val * 100) / 100;
  }, [buyTickets]);

  const totalReplenishments = useMemo(() => {
    const val = transactions.filter(t => t.type === 'inflow').reduce((sum, t) => sum + t.amount, 0);
    return Math.round(val * 100) / 100;
  }, [transactions]);

  const totalExpenses = useMemo(() => {
    const val = transactions.filter(t => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0);
    return Math.round(val * 100) / 100;
  }, [transactions]);

  const bankWithdrawalsTotal = useMemo(() => {
    return transactions
      .filter(t => t.type === 'inflow' && (
        t.category?.toLowerCase() === 'bank run' || 
        t.category?.toLowerCase() === 'bank withdrawal' || 
        t.category?.toLowerCase() === 'cash in'
      ))
      .reduce((sum, t) => sum + t.amount, 0);
  }, [transactions]);

  const otherInflowsTotal = useMemo(() => {
    return transactions
      .filter(t => t.type === 'inflow' && !(
        t.category?.toLowerCase() === 'bank run' || 
        t.category?.toLowerCase() === 'bank withdrawal' || 
        t.category?.toLowerCase() === 'cash in'
      ))
      .reduce((sum, t) => sum + t.amount, 0);
  }, [transactions]);

  const expensesByCategory = useMemo(() => {
    const counts: Record<string, number> = {};
    transactions.filter(t => t.type === 'expense').forEach(t => {
      const cat = t.category || 'Other';
      counts[cat] = (counts[cat] || 0) + t.amount;
    });
    return counts;
  }, [transactions]);

  const previousSession = useMemo(() => {
    if (!selectedSession || history.length === 0) return null;
    const sortedHistory = [...history].sort((a, b) => b.date.localeCompare(a.date));
    return sortedHistory.find(s => s.date < selectedSession.date) || null;
  }, [selectedSession, history]);

  const expectedCash = useMemo(() => {
    if (!selectedSession) return 0;
    const val = selectedSession.openingCash + totalReplenishments - totalPayouts - totalExpenses;
    return Math.round(val * 100) / 100;
  }, [selectedSession, totalReplenishments, totalPayouts, totalExpenses]);

  const sheetExpectedCash = useMemo(() => {
    if (!selectedSession) return 0;
    const val = editedOpeningCash + totalReplenishments - totalPayouts - totalExpenses;
    return Math.round(val * 100) / 100;
  }, [selectedSession, editedOpeningCash, totalReplenishments, totalPayouts, totalExpenses]);

  // Update expected cash in session document when calculated values change
  useEffect(() => {
    if (selectedSession?.id && Math.abs((selectedSession.expectedCash || 0) - expectedCash) > 0.01) {
      updateDoc(doc(db, 'cashSessions', selectedSession.id), { expectedCash })
        .catch((err) => console.error('Failed to update expected cash in background:', err));
      setSelectedSession(prev => prev && prev.id === selectedSession.id ? { ...prev, expectedCash } : prev);
    }
  }, [expectedCash, selectedSession?.id, selectedSession?.expectedCash]);

  const calculateDenomTotal = (denoms: DenominationCount) => {
    const d = ensureDenomTotals(denoms);
    const sum = (
      (d.hundreds || 0) +
      (d.fifties || 0) +
      (d.twenties || 0) +
      (d.tens || 0) +
      (d.fives || 0) +
      (d.ones || 0) +
      (d.dollarCoins || 0) +
      (d.halfDollars || 0) +
      (d.quarters || 0) +
      (d.dimes || 0) +
      (d.nickels || 0)
    );
    return Math.round(sum * 100) / 100;
  };

  const handleStartDay = async (e: React.FormEvent<HTMLFormElement>) => {
    if (!profile) return;
    e.preventDefault();
    setProcessing(true);
    
    const formData = new FormData(e.currentTarget);
    let openingCash = 0;
    if (useOpeningDenoms) {
      openingCash = calculateDenomTotal(openingDenoms);
    } else {
      openingCash = parseFloat(formData.get('openingCash') as string) || 0;
    }
    openingCash = Math.round(openingCash * 100) / 100;
    
    try {
      const docRef = await addDoc(collection(db, 'cashSessions'), {
        date: todayStr,
        status: 'open',
        openingCash,
        expectedCash: openingCash,
        openedAt: new Date().toISOString(),
        openedBy: profile.email,
        ...(useOpeningDenoms ? { openingDenominations: openingDenoms } : {})
      } as Omit<CashSession, 'id'>);

      // Track in Audit Log
      await logAuditEvent(
        'cashDrawer',
        docRef.id,
        'open',
        { after: { openingCash, date: todayStr } },
        `Opened cash drawer session for ${todayStr} with starting cash of $${openingCash.toLocaleString(undefined, { minimumFractionDigits: 2 })}`
      );

      setShowStartModal(false);
      firestore(
        'Shift Opened',
        `Successfully initialized new cash drawer session for ${todayStr} with starting balance of $${openingCash.toFixed(2)}.`
      );
    } catch (error: any) {
      toastError('Shift Open Failed', `Failed to open cash drawer session: ${error.message || error}`);
      handleFirestoreError(error, OperationType.CREATE, 'cashSessions');
    } finally {
      setProcessing(false);
    }
  };

  const handleCreateRetroactiveSession = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!profile) return;
    setProcessing(true);

    try {
      if (!retroactiveDate) {
        toastError('Missing Date', 'Please select a valid date for retroactive session creation.');
        setProcessing(false);
        return;
      }

      // Check duplicate
      const q = query(collection(db, 'cashSessions'), where('date', '==', retroactiveDate));
      const snap = await getDocs(q);
      if (!snap.empty) {
        toastError('Session Exists', `A cash drawer session for ${retroactiveDate} already exists!`);
        setProcessing(false);
        return;
      }

      // Calculate Opening
      let openingCash = 0;
      if (useRetroOpeningDenoms) {
        openingCash = calculateDenomTotal(retroOpeningDenoms);
      } else {
        openingCash = parseFloat(quickRetroOpeningCash) || 0;
      }
      openingCash = Math.round(openingCash * 100) / 100;

      // Calculate Expected Cash
      const initialBankRunAmount = parseFloat(retroBankRun) || 0;
      let expectedCash = openingCash + initialBankRunAmount;
      if (retroStatus === 'closed') {
        const startOfDay = new Date(`${retroactiveDate}T00:00:00`);
        const endOfDay = new Date(`${retroactiveDate}T23:59:59.999`);

        if (isNaN(startOfDay.getTime()) || isNaN(endOfDay.getTime())) {
          toastError('Invalid Date', 'Invalid target date. Please select a valid calendar date.');
          setProcessing(false);
          return;
        }

        const ticketsSnap = await getDocs(
          query(
            collection(db, 'buyTickets'),
            where('timestamp', '>=', startOfDay.toISOString()),
            where('timestamp', '<=', endOfDay.toISOString())
          )
        );

        const dayTickets = ticketsSnap.docs.map(d => d.data() as BuyTicket)
          .filter(t => t.status !== 'voided' && t.status !== 'cancelled');
        const dayPayouts = dayTickets.reduce((sum, t) => sum + (t.totalAmount || 0), 0);
        expectedCash = Math.round((openingCash + initialBankRunAmount - dayPayouts) * 100) / 100;
      }

      // Calculate Actual / OverShort
      let actualCash = 0;
      let overShort = 0;
      let closingDenominationsData = {};
      if (retroStatus === 'closed') {
        if (useRetroClosingDenoms) {
          actualCash = calculateDenomTotal(retroClosingDenoms);
          closingDenominationsData = { closingDenominations: retroClosingDenoms };
        } else {
          actualCash = parseFloat(quickRetroClosingCash) || 0;
        }
        actualCash = Math.round(actualCash * 100) / 100;
        overShort = Math.round((actualCash - expectedCash) * 100) / 100;
      }

      const sessionDoc: Omit<CashSession, 'id'> = {
        date: retroactiveDate,
        status: retroStatus,
        openingCash,
        expectedCash,
        openedAt: `${retroactiveDate}T08:00:00.000Z`,
        openedBy: profile.email,
        ...(useRetroOpeningDenoms ? { openingDenominations: retroOpeningDenoms } : {}),
        ...(retroStatus === 'closed' ? {
          actualCash,
          overShort,
          closedAt: `${retroactiveDate}T17:00:00.000Z`,
          closedBy: profile.email,
          notes: retroNotes,
          ...closingDenominationsData
        } : {})
      };

      const docRef = await addDoc(collection(db, 'cashSessions'), sessionDoc);

      if (initialBankRunAmount > 0) {
        await addDoc(collection(db, 'cashTransactions'), {
          sessionId: docRef.id,
          type: 'inflow',
          category: 'Bank Run',
          amount: initialBankRunAmount,
          notes: 'Initial bank run deposit registered during retroactive session setup',
          timestamp: `${retroactiveDate}T09:00:00.000Z`,
          performedBy: profile.email
        });
      }

      await logAuditEvent(
        'cashDrawer',
        docRef.id,
        retroStatus === 'open' ? 'open' : 'close',
        { after: sessionDoc },
        `Retroactively created cash drawer session for ${retroactiveDate} with status: ${retroStatus}. Opening cash: $${openingCash.toLocaleString()}${initialBankRunAmount > 0 ? `, Initial Bank Run: $${initialBankRunAmount.toLocaleString()}` : ''}${retroStatus === 'closed' ? `, Actual cash: $${actualCash.toLocaleString()}, Over/Short: $${overShort.toLocaleString()}` : ''}`
      );

      // Reset & Close
      setShowRetroactiveModal(false);
      setRetroNotes('');
      setRetroBankRun('');
      setQuickRetroOpeningCash('');
      setQuickRetroClosingCash('');
      setRetroOpeningDenoms({ ...initialDenominations });
      setRetroClosingDenoms({ ...initialDenominations });
      
      const newSessionWithId = { id: docRef.id, ...sessionDoc } as CashSession;
      setSelectedSession(newSessionWithId);
      setShowHistory(false);
      setViewMode('balance_sheet');

      firestore(
        'Retroactive Shift Saved',
        `Retroactive cash drawer session for ${retroactiveDate} has been committed to Cloud Firestore.`
      );
    } catch (error: any) {
      toastError('Retroactive Save Failed', `Failed to save retroactive session: ${error.message || error}`);
      handleFirestoreError(error, OperationType.CREATE, 'cashSessions');
    } finally {
      setProcessing(false);
    }
  };


  const [editingTransaction, setEditingTransaction] = useState<CashTransaction | null>(null);

  const handleQuickCloseSession = async (session: CashSession) => {
    if (!profile) return;
    setProcessing(true);
    try {
      const now = new Date().toISOString();
      const updatePayload: Record<string, any> = {
        status: 'closed',
        closedAt: now,
        closedBy: profile.email
      };

      await updateDoc(doc(db, 'cashSessions', session.id), updatePayload);

      await logAuditEvent(
        'cashDrawer',
        session.id,
        'close',
        {
          before: { status: 'open' },
          after: { status: 'closed', closedBy: profile.email }
        },
        `Retroactively closed session for ${session.date} from ledger history.`
      );
      
      firestore('Session Closed', `Successfully finalized reconciliation for ${session.date}.`);
    } catch (err: any) {
      toastError('Failed to close session', err.message || err);
    } finally {
      setProcessing(false);
    }
  };

  const handleEditTransaction = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingTransaction || !profile) return;
    setProcessing(true);
    
    const formData = new FormData(e.currentTarget);
    const rawAmount = parseFloat(formData.get('amount') as string);
    const amount = isNaN(rawAmount) ? 0 : Math.round(rawAmount * 100) / 100;
    const category = formData.get('category') as string;
    const notes = formData.get('notes') as string;
    
    try {
      const oldAmount = editingTransaction.amount;
      const oldCategory = editingTransaction.category;
      
      await updateDoc(doc(db, 'cashTransactions', editingTransaction.id), {
        category,
        amount,
        notes
      });

      // Track in Audit Log
      await logAuditEvent(
        'cashTransaction',
        editingTransaction.id,
        'update',
        { 
          before: { amount: oldAmount, category: oldCategory, notes: editingTransaction.notes }, 
          after: { amount, category, notes } 
        },
        `Updated ${editingTransaction.type} transaction: amount ${oldAmount} -> ${amount}, category ${oldCategory} -> ${category}`
      );
      
      firestore(
        'Transaction Updated',
        `Successfully updated ${editingTransaction.type} of ${amount.toFixed(2)}.`
      );
      setEditingTransaction(null);
    } catch (error: any) {
      toastError('Update Failed', `Failed to update transaction: ${error.message || error}`);
      handleFirestoreError(error, OperationType.UPDATE, 'cashTransactions');
    } finally {
      setProcessing(false);
    }
  };

  // Modal Opener & Reset Helpers
  const handleOpenExpenseModal = () => {
    setExpenseStep('form');
    setExpenseCategory('Fuel');
    setCustomCategory('');
    setExpenseAmount('');
    setExpensePayee('');
    setExpenseNotes('');
    setConfirmedExpenseTx(null);
    setShowExpenseModal(true);
  };

  const handleOpenInflowModal = () => {
    setInflowStep('form');
    setInflowCategory('Bank Run');
    setCustomInflowCategory('');
    setInflowAmount('');
    setInflowSource('');
    setInflowNotes('');
    setConfirmedInflowTx(null);
    setShowInflowModal(true);
  };

  // Expense Workflow Step Transitions
  const handleProceedToExpenseConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    const targetSession = selectedSession || activeSession;
    if (!targetSession) {
      toastError('No Active Session', 'Please open today\'s cash drawer session or select an active session before recording expenses.');
      return;
    }
    if (!profile) {
      toastError('Authentication Required', 'Please ensure you are signed in.');
      return;
    }

    const rawAmount = parseFloat(expenseAmount);
    if (isNaN(rawAmount) || rawAmount <= 0) {
      toastError('Invalid Amount', 'Please enter a valid expense amount greater than $0.00');
      return;
    }

    const finalCategory = expenseCategory === 'Other' && customCategory.trim() ? customCategory.trim() : expenseCategory;
    if (!finalCategory) {
      toastError('Category Required', 'Please select or enter an expense category.');
      return;
    }

    setExpenseStep('confirm');
  };

  const handleExecuteExpenseSubmit = async () => {
    const targetSession = selectedSession || activeSession;
    if (!targetSession || !profile) {
      toastError('Error', 'No active session or user profile found.');
      return;
    }

    const rawAmount = parseFloat(expenseAmount);
    if (isNaN(rawAmount) || rawAmount <= 0) {
      toastError('Invalid Amount', 'Please enter a valid expense amount.');
      return;
    }
    const amount = Math.round(rawAmount * 100) / 100;
    const finalCategory = expenseCategory === 'Other' && customCategory.trim() ? customCategory.trim() : expenseCategory;
    
    let combinedNotes = expenseNotes.trim();
    if (expensePayee.trim()) {
      combinedNotes = `Payee: ${expensePayee.trim()}${combinedNotes ? ` | ${combinedNotes}` : ''}`;
    }

    const previousBalance = expectedCash;
    const newBalance = Math.max(0, previousBalance - amount);

    setExpenseStep('submitting');
    setExpenseSubmittalMsg('Posting expense to ledger in Firestore...');

    try {
      const sessionDateStr = targetSession.date || todayStr;
      const timePart = new Date().toISOString().split('T')[1] || '12:00:00.000Z';
      const txTimestamp = `${sessionDateStr}T${timePart}`;

      const docRef = await addDoc(collection(db, 'cashTransactions'), {
        sessionId: targetSession.id,
        type: 'expense',
        category: finalCategory,
        amount,
        notes: combinedNotes,
        timestamp: txTimestamp,
        performedBy: profile.email
      } as Omit<CashTransaction, 'id'>);

      setExpenseSubmittalMsg('Recording audit log entry...');

      // Track in Audit Log
      await logAuditEvent(
        'cashTransaction',
        docRef.id,
        'adjustment',
        { after: { type: 'expense', category: finalCategory, amount, notes: combinedNotes, sessionId: targetSession.id } },
        `Cash drawer expense for session ${targetSession.date}: Logged expense payout of $${amount.toLocaleString(undefined, { minimumFractionDigits: 2 })} (${finalCategory}). Payee/Notes: ${combinedNotes || 'None'}`
      );

      setExpenseSubmittalMsg('Finalizing ledger confirmation...');

      setConfirmedExpenseTx({
        id: docRef.id,
        category: finalCategory,
        amount,
        notes: combinedNotes,
        timestamp: txTimestamp,
        sessionDate: targetSession.date,
        previousBalance,
        newBalance
      });

      setExpenseStep('success');

      firestore(
        'Expense Recorded',
        `Successfully logged expense of $${amount.toFixed(2)} (${finalCategory}) for session on ${targetSession.date}.`
      );
    } catch (error: any) {
      setExpenseStep('confirm');
      toastError('Expense Failed', `Failed to log cash expense: ${error.message || error}`);
      handleFirestoreError(error, OperationType.CREATE, 'cashTransactions');
    }
  };

  const handleFinishExpense = (txId?: string) => {
    if (txId) {
      setHighlightedTxId(txId);
      setTimeout(() => {
        setHighlightedTxId(null);
      }, 4500);
    }
    setShowExpenseModal(false);
    setExpenseStep('form');
  };

  const handleResetForAnotherExpense = () => {
    setExpenseStep('form');
    setExpenseAmount('');
    setExpensePayee('');
    setExpenseNotes('');
    setConfirmedExpenseTx(null);
  };

  // Inflow / Bank Run Workflow Step Transitions
  const handleProceedToInflowConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    const targetSession = selectedSession || activeSession;
    if (!targetSession) {
      toastError('No Active Session', 'Please open today\'s cash drawer session or select an active session before recording bank runs.');
      return;
    }
    if (!profile) {
      toastError('Authentication Required', 'Please ensure you are signed in.');
      return;
    }

    const rawAmount = parseFloat(inflowAmount);
    if (isNaN(rawAmount) || rawAmount <= 0) {
      toastError('Invalid Amount', 'Please enter a valid deposit amount greater than $0.00');
      return;
    }

    const finalCategory = inflowCategory === 'Other' && customInflowCategory.trim() ? customInflowCategory.trim() : inflowCategory;
    if (!finalCategory) {
      toastError('Category Required', 'Please select or enter a category.');
      return;
    }

    setInflowStep('confirm');
  };

  const handleExecuteInflowSubmit = async () => {
    const targetSession = selectedSession || activeSession;
    if (!targetSession || !profile) {
      toastError('Error', 'No active session or user profile found.');
      return;
    }

    const rawAmount = parseFloat(inflowAmount);
    if (isNaN(rawAmount) || rawAmount <= 0) {
      toastError('Invalid Amount', 'Please enter a valid deposit amount.');
      return;
    }
    const amount = Math.round(rawAmount * 100) / 100;
    const finalCategory = inflowCategory === 'Other' && customInflowCategory.trim() ? customInflowCategory.trim() : inflowCategory;
    
    let combinedNotes = inflowNotes.trim();
    if (inflowSource.trim()) {
      combinedNotes = `Source: ${inflowSource.trim()}${combinedNotes ? ` | ${combinedNotes}` : ''}`;
    }

    const previousBalance = expectedCash;
    const newBalance = previousBalance + amount;

    setInflowStep('submitting');
    setInflowSubmittalMsg('Posting deposit to ledger in Firestore...');

    try {
      const sessionDateStr = targetSession.date || todayStr;
      const timePart = new Date().toISOString().split('T')[1] || '12:00:00.000Z';
      const txTimestamp = `${sessionDateStr}T${timePart}`;

      const docRef = await addDoc(collection(db, 'cashTransactions'), {
        sessionId: targetSession.id,
        type: 'inflow',
        category: finalCategory,
        amount,
        notes: combinedNotes,
        timestamp: txTimestamp,
        performedBy: profile.email
      } as Omit<CashTransaction, 'id'>);

      setInflowSubmittalMsg('Recording audit log entry...');

      await logAuditEvent(
        'cashTransaction',
        docRef.id,
        'adjustment',
        { after: { type: 'inflow', category: finalCategory, amount, notes: combinedNotes, sessionId: targetSession.id } },
        `Cash drawer deposit/bank run for session ${targetSession.date}: Logged inflow of $${amount.toLocaleString(undefined, { minimumFractionDigits: 2 })} (${finalCategory}). Source/Notes: ${combinedNotes || 'None'}`
      );

      setInflowSubmittalMsg('Finalizing ledger confirmation...');

      setConfirmedInflowTx({
        id: docRef.id,
        category: finalCategory,
        amount,
        notes: combinedNotes,
        timestamp: txTimestamp,
        sessionDate: targetSession.date,
        previousBalance,
        newBalance
      });

      setInflowStep('success');

      firestore(
        'Bank Run Recorded',
        `Successfully logged cash deposit of $${amount.toFixed(2)} (${finalCategory}) for session on ${targetSession.date}.`
      );
    } catch (error: any) {
      setInflowStep('confirm');
      toastError('Deposit Failed', `Failed to log cash deposit: ${error.message || error}`);
      handleFirestoreError(error, OperationType.CREATE, 'cashTransactions');
    }
  };

  const handleFinishInflow = (txId?: string) => {
    if (txId) {
      setHighlightedTxId(txId);
      setTimeout(() => {
        setHighlightedTxId(null);
      }, 4500);
    }
    setShowInflowModal(false);
    setInflowStep('form');
  };

  const handleResetForAnotherInflow = () => {
    setInflowStep('form');
    setInflowAmount('');
    setInflowSource('');
    setInflowNotes('');
    setConfirmedInflowTx(null);
  };

  const handleCloseDay = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const targetSession = selectedSession || activeSession;
    if (!targetSession || !profile) return;
    setProcessing(true);
    
    const formData = new FormData(e.currentTarget);
    let actualCash = 0;
    if (useClosingDenoms) {
      actualCash = calculateDenomTotal(closingDenoms);
    } else {
      actualCash = parseFloat(formData.get('actualCash') as string) || 0;
    }
    actualCash = Math.round(actualCash * 100) / 100;
    const notes = formData.get('notes') as string;
    const expectedVal = Math.round((targetSession.openingCash + totalReplenishments - totalPayouts - totalExpenses) * 100) / 100;
    const overShort = Math.round((actualCash - expectedVal) * 100) / 100;
    
    try {
      const closedData = {
        status: 'closed' as const,
        actualCash,
        expectedCash: expectedVal,
        overShort,
        closedAt: new Date().toISOString(),
        closedBy: profile.email,
        notes: notes || targetSession.notes || '',
        ...(useClosingDenoms ? { closingDenominations: closingDenoms } : {})
      };

      await updateDoc(doc(db, 'cashSessions', targetSession.id), closedData);

      // Track in Audit Log
      await logAuditEvent(
        'cashDrawer',
        targetSession.id,
        'close',
        {
          before: { status: targetSession.status, expectedCash: targetSession.expectedCash },
          after: { status: 'closed', actualCash, overShort, notes }
        },
        `Closed and finalized cash drawer session for ${targetSession.date || todayStr}. Actual cash counted: $${actualCash.toLocaleString(undefined, { minimumFractionDigits: 2 })}. Over/Short: $${overShort.toLocaleString(undefined, { minimumFractionDigits: 2 })}. Notes: ${notes || 'None'}`
      );

      setSelectedSession(prev => prev && prev.id === targetSession.id ? { ...prev, ...closedData } : prev);
      if (activeSession && activeSession.id === targetSession.id) {
        setActiveSession(prev => prev ? { ...prev, ...closedData } : null);
      }

      setShowCloseModal(false);
      firestore(
        'Shift Closed',
        `Successfully closed and committed cash drawer session for ${targetSession.date || todayStr}. Counted: $${actualCash.toFixed(2)}.`
      );
    } catch (error: any) {
      toastError('Shift Close Failed', `Failed to close session: ${error.message || error}`);
      handleFirestoreError(error, OperationType.UPDATE, 'cashSessions');
    } finally {
      setProcessing(false);
    }
  };

  const handleReOpenSession = async () => {
    const targetSession = selectedSession || activeSession;
    if (!targetSession || !profile) return;
    setProcessing(true);
    try {
      await updateDoc(doc(db, 'cashSessions', targetSession.id), {
        status: 'open',
        actualCash: deleteField(),
        overShort: deleteField(),
        closedAt: deleteField(),
        closedBy: deleteField(),
        closingDenominations: deleteField()
      });

      // Track in Audit Log
      await logAuditEvent(
        'cashDrawer',
        targetSession.id,
        'open',
        {
          before: { status: 'closed' },
          after: { status: 'open' }
        },
        `Re-opened cash drawer session for ${targetSession.date}`
      );

      setSelectedSession(prev => prev && prev.id === targetSession.id ? {
        ...prev,
        status: 'open',
        actualCash: undefined,
        overShort: undefined,
        closedAt: undefined,
        closedBy: undefined,
        closingDenominations: undefined
      } : prev);

      if (activeSession && activeSession.id === targetSession.id) {
        setActiveSession(prev => prev ? {
          ...prev,
          status: 'open',
          actualCash: undefined,
          overShort: undefined,
          closedAt: undefined,
          closedBy: undefined,
          closingDenominations: undefined
        } : null);
      }

      firestore(
        'Session Reopened',
        `Cash drawer session for ${targetSession.date} is now reopened & active.`
      );
    } catch (error: any) {
      toastError('Reopen Failed', `Failed to reopen session: ${error.message || error}`);
      handleFirestoreError(error, OperationType.UPDATE, 'cashSessions');
    } finally {
      setProcessing(false);
    }
  };

  const handleUpdateOpeningCash = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedSession || !profile) return;
    setProcessing(true);
    const formData = new FormData(e.currentTarget);
    const rawOpening = parseFloat(formData.get('openingCash') as string);
    const openingCash = isNaN(rawOpening) ? 0 : Math.round(rawOpening * 100) / 100;
    try {
      const oldOpening = selectedSession.openingCash;
      await updateDoc(doc(db, 'cashSessions', selectedSession.id), {
        openingCash
      });

      // Track in Audit Log
      await logAuditEvent(
        'cashDrawer',
        selectedSession.id,
        'adjustment',
        {
          before: { openingCash: oldOpening },
          after: { openingCash }
        },
        `Updated starting cash for ${selectedSession.date} from $${oldOpening.toLocaleString(undefined, { minimumFractionDigits: 2 })} to $${openingCash.toLocaleString(undefined, { minimumFractionDigits: 2 })}`
      );

      setSelectedSession(prev => prev && prev.id === selectedSession.id ? { ...prev, openingCash } : prev);
      setEditedOpeningCash(openingCash);

      setShowEditOpeningModal(false);
      firestore(
        'Opening Balance Updated',
        `Committed opening balance change to Firestore: $${oldOpening.toFixed(2)} -> $${openingCash.toFixed(2)}.`
      );
    } catch (error: any) {
      toastError('Update Failed', `Failed to update opening cash: ${error.message || error}`);
      handleFirestoreError(error, OperationType.UPDATE, 'cashSessions');
    } finally {
      setProcessing(false);
    }
  };

  const handleDeleteTransaction = async (id: string) => {
    const tx = transactions.find(t => t.id === id);
    if (!tx) return;
    if (!window.confirm('Are you sure you want to delete this transaction? This will affect your expected balance.')) return;
    try {
      await deleteDoc(doc(db, 'cashTransactions', id));

      // Track in Audit Log
      await logAuditEvent(
        'cashTransaction',
        id,
        'delete',
        { before: tx, after: null },
        `Deleted cash drawer transaction of $${tx.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })} ${tx.type === 'inflow' ? 'Inflow' : 'Expense'} (${tx.category}) originally logged by ${tx.performedBy}`
      );

      firestore(
        'Transaction Deleted',
        `Successfully deleted $${tx.amount.toFixed(2)} ${tx.type === 'inflow' ? 'Inflow' : 'Expense'} transaction from Cloud Firestore.`
      );
    } catch (error: any) {
      toastError('Delete Failed', `Failed to delete transaction: ${error.message || error}`);
      handleFirestoreError(error, OperationType.DELETE, 'cashTransactions');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (profile?.role !== 'manager' && !profile?.permissions?.canManageCash) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-8">
        <div className="p-6 bg-red-50 rounded-full text-red-600 mb-6">
          <Lock className="w-12 h-12" />
        </div>
        <h2 className="text-2xl font-black text-slate-900 uppercase tracking-tight">Access Restricted</h2>
        <p className="text-slate-500 mt-2 max-w-md">You do not have the required permissions to manage cash reconciliation. Please contact your manager.</p>
      </div>
    );
  }

  return (
    <main className="space-y-8 pb-20">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 print:hidden">
        <div>
          <h1 className="text-4xl font-black text-slate-900 tracking-tight font-display uppercase">Cash Reconciliation</h1>
          <p className="text-slate-500 font-medium mt-1">Manage Safe and Register liquidity for {todayStr}.</p>
        </div>
        <button 
          onClick={() => setShowHistory(!showHistory)}
          className={cn(
            "flex items-center gap-2 px-6 py-3 rounded-2xl font-black text-xs uppercase tracking-widest transition-all",
            showHistory ? "bg-slate-900 text-white shadow-xl shadow-slate-900/20" : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
          )}
        >
          <History className="w-4 h-4" />
          {showHistory ? 'View Today' : 'Reconciliation History'}
        </button>
      </div>

      {showHistory ? (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
          {/* Tabs for History sub-sections */}
          <div className="flex bg-slate-100 p-1 rounded-2xl max-w-lg border border-slate-200/50">
            <button
              type="button"
              onClick={() => setHistoryTab('tracker')}
              className={cn(
                "flex-1 py-2.5 text-[11px] font-black uppercase tracking-widest rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer",
                historyTab === 'tracker' ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
              )}
            >
              <TrendingDown className="w-3.5 h-3.5" />
              Match Tracker & Gaps
            </button>
            <button
              type="button"
              onClick={() => setHistoryTab('ledgers')}
              className={cn(
                "flex-1 py-2.5 text-[11px] font-black uppercase tracking-widest rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer",
                historyTab === 'ledgers' ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
              )}
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              Historical Ledgers
            </button>
            <button
              type="button"
              onClick={() => setHistoryTab('audits')}
              className={cn(
                "flex-1 py-2.5 text-[11px] font-black uppercase tracking-widest rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer",
                historyTab === 'audits' ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
              )}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              Audit Trail Logs
            </button>
          </div>

          {/* Sub-section contents */}
          {historyTab === 'tracker' && (
            <div className="space-y-6 animate-in fade-in duration-200">
              {/* KPIs Grid */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-white rounded-[1.5rem] p-5 border border-slate-200 shadow-sm">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Perfect Match Rate</span>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-black text-slate-900 font-mono">{perfectMatchRate}%</span>
                    <span className="text-xs font-semibold text-emerald-600">({closedSessions.length} sessions)</span>
                  </div>
                  <p className="text-[10px] text-slate-500 mt-2">Closed sessions matching cash drawer counts perfectly.</p>
                </div>

                <div className="bg-white rounded-[1.5rem] p-5 border border-slate-200 shadow-sm">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Net Over / Short</span>
                  <div className="flex items-baseline gap-2">
                    <span className={cn(
                      "text-3xl font-black font-mono",
                      netDiscrepancy < 0 ? "text-red-600" : netDiscrepancy > 0 ? "text-emerald-600" : "text-slate-900"
                    )}>
                      {netDiscrepancy > 0 ? '+' : ''}${netDiscrepancy.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-500 mt-2">Cumulative net register discrepancies across history.</p>
                </div>

                <div className="bg-white rounded-[1.5rem] p-5 border border-slate-200 shadow-sm">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Average Daily Drift</span>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-black text-slate-900 font-mono">
                      ${averageDailyDrift.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-500 mt-2">Average absolute discrepancy deviation per session.</p>
                </div>

                <div className="bg-white rounded-[1.5rem] p-5 border border-slate-200 shadow-sm">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Unresolved Gaps</span>
                  <div className="flex items-baseline gap-2">
                    <span className={cn(
                      "text-3xl font-black font-mono",
                      missingReconciliationDays.length > 0 ? "text-amber-600" : "text-slate-900"
                    )}>
                      {missingReconciliationDays.length} Days
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-500 mt-2">Active business days lacking cash reconciliation sessions.</p>
                </div>
              </div>

              {/* Missing Gaps Alert & Quick Resolvers */}
              {missingReconciliationDays.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-3xl p-6 shadow-sm space-y-4">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
                    <div className="space-y-1">
                      <h4 className="text-sm font-black text-amber-900 uppercase tracking-wide">Gaps Detected in Reconciliation history</h4>
                      <p className="text-xs text-amber-700 font-medium">
                        The following days had cash transactions (buy tickets created) but no cash drawer session was opened or closed. Resolve these gaps to complete your financial audits.
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {missingReconciliationDays.map(gap => (
                      <div key={gap.date} className="bg-white/80 backdrop-blur-sm p-4 rounded-2xl border border-amber-100 flex items-center justify-between shadow-xs">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-800 text-sm">{gap.date}</span>
                            <span className="text-[9px] font-black px-1.5 py-0.5 bg-amber-100 text-amber-800 rounded uppercase tracking-wider">
                              Unreconciled
                            </span>
                          </div>
                          <div className="flex gap-4 mt-1 text-xs text-slate-500 font-semibold font-mono">
                            <span>Tickets: {gap.ticketCount}</span>
                            <span>Payouts: ${gap.totalPayout.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                          </div>
                        </div>
                        {profile?.role === 'manager' && (
                          <button
                            type="button"
                            onClick={() => {
                              setIsManualRetro(false);
                              setRetroactiveDate(gap.date);
                              setRetroStatus('closed');
                              setRetroOpeningDenoms({ ...initialDenominations });
                              setRetroClosingDenoms({ ...initialDenominations });
                              setUseRetroOpeningDenoms(false);
                              setUseRetroClosingDenoms(false);
                              setQuickRetroOpeningCash('');
                              setQuickRetroClosingCash('');
                              setRetroNotes(`Retroactive resolution for missing day ${gap.date}`);
                              setShowRetroactiveModal(true);
                            }}
                            className="px-3.5 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all cursor-pointer shadow-xs"
                          >
                            Resolve Day
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Action and Visual Trends Row */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2">
                  {/* Trends Chart */}
                  <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm space-y-4">
                    <div className="flex justify-between items-center">
                      <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider">Over/Short Daily Trends (Past 15 Closed Days)</h3>
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Values in USD</span>
                    </div>
                    <div className="h-64 w-full">
                      {chartData.length === 0 ? (
                        <div className="h-full flex items-center justify-center text-xs font-semibold text-slate-400">
                          No trend data available.
                        </div>
                      ) : (
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                            <XAxis dataKey="date" tick={{ fontSize: 10, fontWeight: 'bold', fill: '#64748b' }} stroke="#cbd5e1" />
                            <YAxis tick={{ fontSize: 10, fontWeight: 'bold', fill: '#64748b' }} stroke="#cbd5e1" />
                            <RechartsTooltip 
                              contentStyle={{ backgroundColor: '#0f172a', borderRadius: '16px', border: 'none', color: '#fff' }}
                              labelStyle={{ fontWeight: 'bold', fontSize: '11px', color: '#94a3b8' }}
                              itemStyle={{ fontWeight: 'black', fontSize: '13px', color: '#3b82f6' }}
                            />
                            <ReferenceLine y={0} stroke="#cbd5e1" strokeWidth={1.5} />
                            <Bar dataKey="Over / Short" radius={[4, 4, 0, 0]}>
                              {chartData.map((entry: any, index: number) => {
                                const val = entry['Over / Short'];
                                const tCount = recentTickets.filter(t => t.timestamp && getTicketLocalDate(t.timestamp) === entry.date && t.status !== 'voided' && t.status !== 'cancelled').length;
                                const status = getShortageStatus(val, tCount);
                                
                                let color = '#94a3b8'; // balanced
                                if (val > 0) {
                                  color = '#10b981'; // green for overage
                                } else if (val < 0) {
                                  if (status.isTolerance) {
                                    color = '#f59e0b'; // amber/yellow for penny-rounding tolerance
                                  } else {
                                    color = '#ef4444'; // red for actual shortage
                                  }
                                }
                                return (
                                  <Cell key={`cell-${index}`} fill={color} />
                                );
                              })}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                  </div>
                </div>

                {/* Add Retroactive Session action card */}
                {profile?.role === 'manager' && (
                  <div className="bg-slate-900 text-white rounded-3xl p-6 border border-slate-800 flex flex-col justify-between shadow-xl">
                    <div className="space-y-4">
                      <div className="p-3.5 bg-amber-500 rounded-2xl text-slate-900 inline-block shrink-0 shadow-lg shadow-amber-500/20">
                        <Calendar className="w-5 h-5" />
                      </div>
                      <div className="space-y-2">
                        <h4 className="text-base font-black uppercase tracking-tight text-white">Manual Retroactive Session</h4>
                        <p className="text-slate-400 text-xs font-semibold leading-relaxed">
                          Need to register a session for a custom past date? Initialize a historical open/closed ledger to match tickets and record physical cash counts.
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setIsManualRetro(true);
                        setRetroactiveDate('');
                        setRetroStatus('closed');
                        setRetroOpeningDenoms({ ...initialDenominations });
                        setRetroClosingDenoms({ ...initialDenominations });
                        setUseRetroOpeningDenoms(false);
                        setUseRetroClosingDenoms(false);
                        setQuickRetroOpeningCash('');
                        setQuickRetroClosingCash('');
                        setRetroNotes('');
                        setShowRetroactiveModal(true);
                      }}
                      className="w-full mt-6 py-4 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black uppercase tracking-widest text-xs rounded-xl transition-all shadow-md active:scale-95 cursor-pointer animate-none"
                    >
                      Add Retroactive Session
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {historyTab === 'ledgers' && (
            <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-sm animate-in fade-in duration-200 overflow-x-auto">
              <table className="w-full text-left min-w-[700px]">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100">
                    <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Date</th>
                    <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Status</th>
                    <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Expected</th>
                    <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Actual</th>
                    <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Diff</th>
                    <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {history.map(session => (
                    <tr key={session.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-slate-100 rounded-xl shrink-0">
                            <Calendar className="w-4 h-4 text-slate-500" />
                          </div>
                          <div className="flex flex-col">
                            <span className="font-bold text-slate-900">{session.date}</span>
                            <div className="flex gap-1.5 mt-1">
                              {session.openingDenominations && (
                                <button
                                  type="button"
                                  onClick={() => setViewingDenoms({
                                    title: `Opening Count Breakdown (${session.date})`,
                                    denoms: session.openingDenominations!,
                                    closedBy: session.closedBy
                                  })}
                                  className="px-2 py-0.5 bg-blue-50 hover:bg-blue-100 text-blue-600 rounded text-[9px] font-black uppercase tracking-wider transition-all cursor-pointer"
                                >
                                  Opening Breakdown
                                </button>
                              )}
                              {session.closingDenominations && (
                                <button
                                  type="button"
                                  onClick={() => setViewingDenoms({
                                    title: `Closing Count Breakdown (${session.date})`,
                                    denoms: session.closingDenominations!,
                                    closedBy: session.closedBy
                                  })}
                                  className="px-2 py-0.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-600 rounded text-[9px] font-black uppercase tracking-wider transition-all cursor-pointer"
                                >
                                  Closing Breakdown
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className={cn(
                          "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest",
                          session.status === 'open' ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-600"
                        )}>
                          {session.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right font-mono font-bold text-slate-900">
                        ${session.expectedCash.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-6 py-4 text-right font-mono font-bold text-slate-900">
                        {session.actualCash ? `$${session.actualCash.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : '-'}
                      </td>
                      <td className="px-6 py-4 text-right">
                        {session.overShort !== undefined ? (
                          (() => {
                            const tCount = recentTickets.filter(t => t.timestamp && getTicketLocalDate(t.timestamp) === session.date && t.status !== 'voided' && t.status !== 'cancelled').length;
                            const status = getShortageStatus(session.overShort, tCount);
                            return (
                              <div className="flex flex-col items-end">
                                <span className={cn("font-mono font-bold", status.textClass)}>
                                  {session.overShort > 0 ? '+' : ''}{session.overShort.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                </span>
                                {status.isTolerance && (
                                  <span className="text-[8px] font-black uppercase text-amber-500 tracking-wider">
                                    Rounding Tol
                                  </span>
                                )}
                              </div>
                            );
                          })()
                        ) : (
                          <span className="text-slate-400 font-bold">-</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {session.status === 'open' && session.date !== todayStr && session.actualCash !== undefined && (
                            <button
                              type="button"
                              onClick={() => {
                                if (window.confirm(`Are you sure you want to finalize and close the session for ${session.date}?`)) {
                                  handleQuickCloseSession(session);
                                }
                              }}
                              className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all cursor-pointer shadow-sm"
                            >
                              Close Day
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedSession(session);
                              setShowHistory(false);
                            }}
                            className="px-3.5 py-2 bg-slate-900 hover:bg-blue-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all cursor-pointer"
                          >
                            View Ledger
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {historyTab === 'audits' && (
            <div className="space-y-4 animate-in fade-in duration-200">
              {/* Search & Filter bar */}
              <div className="bg-white p-4 rounded-3xl border border-slate-200 shadow-sm flex flex-col md:flex-row gap-4 items-center">
                <div className="relative flex-1 w-full">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search logs by email, notes, session ID..."
                    value={auditSearch}
                    onChange={(e) => setAuditSearch(e.target.value)}
                    className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-semibold focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 outline-none transition-all"
                  />
                </div>
                <div className="flex items-center gap-2 w-full md:w-auto shrink-0 border-l md:border-l-0 pl-0 md:pl-0 border-slate-200">
                  <Filter className="w-4 h-4 text-slate-500 shrink-0" />
                  <select
                    value={auditFilterAction}
                    onChange={(e) => setAuditFilterAction(e.target.value)}
                    className="flex-1 md:flex-initial py-3 px-4 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-bold outline-none cursor-pointer focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all text-slate-700"
                  >
                    <option value="all">All Actions</option>
                    <option value="open">Openings</option>
                    <option value="close">Closings</option>
                    <option value="adjustment">Adjustments / Edits</option>
                  </select>
                </div>
              </div>

              {/* Logs Feed */}
              <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-sm">
                <div className="divide-y divide-slate-100 max-h-[500px] overflow-y-auto">
                  {filteredAuditLogs.length === 0 ? (
                    <div className="p-8 text-center text-xs font-bold text-slate-400 uppercase tracking-widest">
                      No matching audit logs found.
                    </div>
                  ) : (
                    filteredAuditLogs.map(log => (
                      <div key={log.id} className="p-5 hover:bg-slate-50/50 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-4 text-xs">
                        <div className="space-y-1.5 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={cn(
                              "px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider",
                              log.action === 'open' ? "bg-blue-100 text-blue-800" :
                              log.action === 'close' ? "bg-purple-100 text-purple-800" :
                              "bg-amber-100 text-amber-800"
                            )}>
                              {log.action}
                            </span>
                            <span className="font-mono text-slate-400 font-bold">Ref: {log.entityId.slice(0, 8)}...</span>
                            <span className="text-slate-500 font-bold">• By {log.performedBy}</span>
                          </div>
                          <p className="font-medium text-slate-800 text-xs leading-relaxed">{log.notes || 'No description provided'}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <span className="font-mono font-bold text-slate-400 block">
                            {new Date(log.timestamp).toLocaleDateString()}
                          </span>
                          <span className="font-mono text-[10px] text-slate-400 mt-0.5 block">
                            {new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        <>
          {selectedSession && activeSession?.id !== selectedSession.id && (
            <div className="bg-slate-900 text-white px-6 py-5 rounded-[2rem] flex flex-col sm:flex-row items-center justify-between gap-4 border border-slate-800 shadow-2xl animate-in slide-in-from-top-4 mb-6 print:hidden">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-amber-500 rounded-2xl text-slate-900 shrink-0 shadow-lg shadow-amber-500/20">
                  <History className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-xs font-black uppercase tracking-widest text-amber-500">
                    {profile?.role === 'manager' ? 'Historical Archive - Manager Audit' : 'Historical Archive View'}
                  </h4>
                  <p className="text-[10px] text-slate-400 font-bold uppercase mt-0.5 leading-normal">
                    {profile?.role === 'manager'
                      ? `Viewing cash ledger record for ${selectedSession.date}. Manager Audit Mode: You may edit opening balance, closing denominations, and save adjustments.`
                      : `Viewing cash ledger record for ${selectedSession.date}. Any modifications are disabled (Read-Only).`
                    }
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0 flex-wrap">
                <button
                  type="button"
                  onClick={handleOpenInflowModal}
                  className="px-4 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-xl font-black text-[10px] uppercase tracking-widest flex items-center gap-2 transition-all shadow-md cursor-pointer active:scale-95"
                >
                  <ArrowUpCircle className="w-4 h-4" />
                  Record Bank Run
                </button>
                <button
                  type="button"
                  onClick={handleOpenExpenseModal}
                  className="px-4 py-2.5 bg-rose-500 hover:bg-rose-400 text-white rounded-xl font-black text-[10px] uppercase tracking-widest flex items-center gap-2 transition-all shadow-md cursor-pointer active:scale-95"
                >
                  <ArrowDownCircle className="w-4 h-4" />
                  Record Expense
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedSession(activeSession);
                    setShowHistory(false);
                  }}
                  className="px-5 py-2.5 bg-white text-slate-900 hover:bg-slate-100 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 shadow-lg shrink-0 cursor-pointer"
                >
                  Back to Today
                </button>
              </div>
            </div>
          )}

          {!selectedSession ? (
            <div className="bg-white rounded-[2.5rem] p-12 border-2 border-dashed border-slate-200 flex flex-col items-center justify-center text-center space-y-6 max-w-2xl mx-auto shadow-sm">
              <div className="p-8 bg-blue-50 rounded-[2rem] text-blue-600 shadow-inner">
                <Wallet className="w-16 h-16" strokeWidth={1.5} />
              </div>
              <div className="space-y-2">
                <h2 className="text-3xl font-black text-slate-900 uppercase tracking-tight font-display">Start Cash Session</h2>
                <p className="text-slate-500 font-medium max-w-sm mx-auto uppercase text-xs tracking-widest leading-relaxed">
                  Enter your combined opening cash from the safe and register to begin tracking for today.
                </p>
              </div>
              {profile?.role === 'cashier' && !profile?.permissions?.canOpenCloseSessions ? (
                <div className="p-5 bg-red-50 border border-red-200 rounded-2xl text-red-700 text-xs font-semibold max-w-sm mx-auto">
                  You do not have permission to initialize or open new cash sessions. Please contact a manager.
                </div>
              ) : (
                <button 
                  onClick={() => setShowStartModal(true)}
                  className="px-10 py-5 bg-blue-600 text-white rounded-3xl font-black text-sm uppercase tracking-widest hover:bg-blue-700 transition-all shadow-2xl shadow-blue-200 flex items-center gap-3 hover:-translate-y-1 active:scale-95"
                >
                  <Plus className="w-5 h-5" />
                  Initialize Opening Cash
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4">
              {/* Segmented Control View Toggle */}
              <div className="flex bg-slate-100 p-1.5 rounded-[1.5rem] border border-slate-200/50 max-w-2xl print:hidden">
                <button
                  type="button"
                  onClick={() => setViewMode('balance_sheet')}
                  className={cn(
                    "flex-1 py-3 px-4 text-[11px] font-black uppercase tracking-wider rounded-2xl transition-all flex items-center justify-center gap-2",
                    viewMode === 'balance_sheet' ? "bg-white text-slate-900 shadow-sm border border-slate-200/20" : "text-slate-500 hover:text-slate-800"
                  )}
                >
                  <FileSpreadsheet className="w-4 h-4 text-green-600" />
                  Daily Balance Sheet
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('dashboard')}
                  className={cn(
                    "flex-1 py-3 px-4 text-[11px] font-black uppercase tracking-wider rounded-2xl transition-all flex items-center justify-center gap-2",
                    viewMode === 'dashboard' ? "bg-white text-slate-900 shadow-sm border border-slate-200/20" : "text-slate-500 hover:text-slate-800"
                  )}
                >
                  <Activity className="w-4 h-4 text-slate-600" />
                  Register Dashboard
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('daily_purchase_report')}
                  className={cn(
                    "flex-1 py-3 px-4 text-[11px] font-black uppercase tracking-wider rounded-2xl transition-all flex items-center justify-center gap-2",
                    viewMode === 'daily_purchase_report' ? "bg-white text-slate-900 shadow-sm border border-slate-200/20" : "text-slate-500 hover:text-slate-800"
                  )}
                >
                  <TrendingUp className="w-4 h-4 text-blue-600" />
                  Purchases & Profits
                </button>
              </div>

              {/* Quick Actions Toolbar */}
              <div className="bg-slate-900 text-white p-5 rounded-[2rem] border border-slate-800 shadow-xl flex flex-wrap items-center justify-between gap-4 print:hidden">
                <div className="flex items-center gap-3.5">
                  <div className="p-3 bg-blue-500/20 text-blue-400 rounded-2xl border border-blue-500/30">
                    <Wallet className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="text-xs font-black uppercase tracking-wider text-white">
                      Active Session: {selectedSession.date}
                    </span>
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest block">
                      Status: {selectedSession.status.toUpperCase()}
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleOpenInflowModal}
                    className="px-4 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-xl font-black text-[10px] uppercase tracking-widest flex items-center gap-2 transition-all shadow-md cursor-pointer active:scale-95"
                  >
                    <ArrowUpCircle className="w-4 h-4" />
                    Bank Run / Inflow
                  </button>
                  <button
                    type="button"
                    onClick={handleOpenExpenseModal}
                    className="px-4 py-2.5 bg-rose-500 hover:bg-rose-400 text-white rounded-xl font-black text-[10px] uppercase tracking-widest flex items-center gap-2 transition-all shadow-md cursor-pointer active:scale-95"
                  >
                    <ArrowDownCircle className="w-4 h-4" />
                    Payout / Expense
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowEditOpeningModal(true)}
                    className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl font-black text-[10px] uppercase tracking-widest flex items-center gap-2 transition-all border border-slate-700 cursor-pointer active:scale-95"
                  >
                    <Edit2 className="w-4 h-4 text-blue-400" />
                    Edit Starting Cash
                  </button>
                  {selectedSession.status === 'open' ? (
                    <button
                      type="button"
                      onClick={() => setShowCloseModal(true)}
                      className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-black text-[10px] uppercase tracking-widest flex items-center gap-2 transition-all shadow-md cursor-pointer active:scale-95"
                    >
                      <CheckCircle2 className="w-4 h-4 text-emerald-300" />
                      Finalize Reconciliation
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm('Re-open this session to make adjustments?')) {
                          handleReOpenSession();
                        }
                      }}
                      className="px-4 py-2.5 bg-amber-600/30 hover:bg-amber-600/40 text-amber-300 border border-amber-500/30 rounded-xl font-black text-[10px] uppercase tracking-widest flex items-center gap-2 transition-all cursor-pointer active:scale-95"
                    >
                      <RotateCcw className="w-4 h-4 text-amber-300" />
                      Re-open Session
                    </button>
                  )}
                </div>
              </div>

              {viewMode === 'dashboard' ? (
                <>
                  {/* Stat Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <div className="bg-white rounded-[2rem] p-8 border border-slate-200 shadow-sm relative overflow-hidden group">
                  <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:scale-110 transition-transform">
                    <History className="w-20 h-20" />
                  </div>
                  <div className="flex items-center justify-between mb-4">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Opening Cash</p>
                    {profile?.role === 'manager' && (
                      <button 
                        onClick={() => setShowEditOpeningModal(true)}
                        className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-blue-600 transition-all"
                        title="Edit Opening Cash"
                      >
                        <Edit2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                   <h3 className="text-3xl font-black text-slate-900 font-mono">
                    ${selectedSession.openingCash.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </h3>
                  {selectedSession.openingDenominations && (
                    <button
                      onClick={() => setViewingDenoms({
                        title: 'Opening Cash Count Breakdown',
                        denoms: selectedSession.openingDenominations!,
                        closedBy: selectedSession.closedBy
                      })}
                      className="mt-2 inline-flex items-center gap-1.5 px-3 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-full text-[10px] font-black uppercase tracking-widest transition-all"
                    >
                      <Eye className="w-3 h-3" />
                      View Count Breakdown
                    </button>
                  )}
                  <div className="mt-4 flex items-center gap-2 text-slate-400">
                    <Clock className="w-4 h-4" />
                    <span className="text-[10px] font-bold uppercase tracking-widest">{new Date(selectedSession.openedAt).toLocaleTimeString()}</span>
                  </div>
                </div>

                <div className="bg-white rounded-[2rem] p-8 border border-slate-200 shadow-sm relative overflow-hidden group border-l-4 border-l-emerald-500">
                  <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:scale-110 transition-transform">
                    <ArrowUpCircle className="w-20 h-20 text-emerald-500" />
                  </div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Total Inflows</p>
                  <h3 className="text-3xl font-black text-emerald-600 font-mono">
                    +${totalReplenishments.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </h3>
                  <div className="mt-4 flex flex-col gap-0.5 text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                    <span>Bank Withdrawals: ${bankWithdrawalsTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                    <span>Other Inflows: ${otherInflowsTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                </div>

                <div className="bg-white rounded-[2rem] p-8 border border-slate-200 shadow-sm relative overflow-hidden group border-l-4 border-l-red-500">
                  <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:scale-110 transition-transform">
                    <ArrowDownCircle className="w-20 h-20 text-red-500" />
                  </div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Total Payouts</p>
                  <h3 className="text-3xl font-black text-red-600 font-mono">
                    -${(totalPayouts + totalExpenses).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </h3>
                  <div className="mt-4 flex items-center gap-3">
                    <div className="flex flex-col">
                      <span className="text-[10px] font-black text-slate-400 uppercase">Materials: ${totalPayouts.toFixed(2)}</span>
                      <span className="text-[10px] font-black text-slate-400 uppercase">Expenses: ${totalExpenses.toFixed(2)}</span>
                    </div>
                  </div>
                </div>

                <div className="bg-slate-900 rounded-[2rem] p-8 border border-slate-800 shadow-2xl relative overflow-hidden group">
                  <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:scale-110 transition-transform">
                    <DollarSign className="w-20 h-20 text-blue-400" />
                  </div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Expected Balance</p>
                  <h3 className="text-3xl font-black text-white font-mono">
                    ${expectedCash.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </h3>
                  <div className={cn(
                    "mt-4 inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest",
                    selectedSession.status === 'open' ? "bg-blue-500/20 text-blue-400" : "bg-emerald-500/20 text-emerald-400"
                  )}>
                    <div className={cn("w-1.5 h-1.5 rounded-full", selectedSession.status === 'open' ? "bg-blue-400 animate-pulse" : "bg-emerald-400")} />
                    Session {selectedSession.status}
                  </div>
                </div>
              </div>
              
              {/* High-Level Material vs. Non-Material Purchases Summary */}
              <div className="bg-white rounded-[2rem] p-8 border border-slate-200 shadow-sm space-y-6">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 pb-5">
                  <div>
                    <h3 className="text-xl font-black text-slate-900 uppercase tracking-tight">Purchase Summary & Spend Analysis</h3>
                    <p className="text-slate-400 text-xs font-black uppercase tracking-widest mt-0.5">
                      Contrasting Material Purchases (Ticket Payouts) vs. Non-Material Purchases (Expenses)
                    </p>
                  </div>
                  <div className="text-right">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-widest block">Total Expenditures Today</span>
                    <span className="text-2xl font-black text-slate-900 font-mono">${(totalPayouts + totalExpenses).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  {/* Spend Ratio and Comparison Bar */}
                  <div className="space-y-6">
                    <div className="flex justify-between items-end">
                      <div>
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Spending Distribution</p>
                        <h4 className="text-lg font-black text-slate-800 uppercase tracking-tight mt-1">Material vs Non-Material</h4>
                      </div>
                      <div className="text-right font-mono text-xs font-bold text-slate-500">
                        <span>{buyTickets.length} Tickets / {transactions.filter(t => t.type === 'expense').length} Expenses</span>
                      </div>
                    </div>

                    {/* Proportional Progress Bar */}
                    <div className="h-4 w-full bg-slate-100 rounded-full overflow-hidden flex shadow-inner">
                      {totalPayouts + totalExpenses > 0 ? (
                        <>
                          <div 
                            style={{ width: `${(totalPayouts / (totalPayouts + totalExpenses)) * 100}%` }} 
                            className="bg-blue-600 h-full transition-all duration-500"
                            title={`Material Purchases: $${totalPayouts.toLocaleString()}`}
                          />
                          <div 
                            style={{ width: `${(totalExpenses / (totalPayouts + totalExpenses)) * 100}%` }} 
                            className="bg-amber-500 h-full transition-all duration-500"
                            title={`Non-Material Expenses: $${totalExpenses.toLocaleString()}`}
                          />
                        </>
                      ) : (
                        <div className="w-full bg-slate-200 h-full text-center text-[10px] text-slate-400 font-bold uppercase py-0.5">No Purchases Logged</div>
                      )}
                    </div>

                    {/* Spend Ratio Legend & Details */}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-4 bg-blue-50/50 border border-blue-100/50 rounded-2xl">
                        <div className="flex items-center gap-2 mb-1">
                          <div className="w-2.5 h-2.5 rounded-full bg-blue-600" />
                          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Material Purchases</span>
                        </div>
                        <p className="text-lg font-black text-blue-700 font-mono">
                          ${totalPayouts.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </p>
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mt-1">
                          {totalPayouts + totalExpenses > 0 ? ((totalPayouts / (totalPayouts + totalExpenses)) * 100).toFixed(1) : '0.0'}% of today's spend
                        </span>
                      </div>

                      <div className="p-4 bg-amber-50/50 border border-amber-100/50 rounded-2xl">
                        <div className="flex items-center gap-2 mb-1">
                          <div className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Non-Material Spent</span>
                        </div>
                        <p className="text-lg font-black text-amber-700 font-mono">
                          ${totalExpenses.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </p>
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mt-1">
                          {totalPayouts + totalExpenses > 0 ? ((totalExpenses / (totalPayouts + totalExpenses)) * 100).toFixed(1) : '0.0'}% of today's spend
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Non-Material Expenses Breakdown by Category */}
                  <div className="space-y-4">
                    <div className="flex justify-between items-center border-b border-slate-100 pb-2">
                      <span className="text-xs font-black text-slate-400 uppercase tracking-widest">Non-Material Spent Breakdown</span>
                      <span className="text-[10px] font-mono font-bold text-slate-500">Categorized Totals</span>
                    </div>

                    {Object.keys(expensesByCategory).length === 0 ? (
                      <div className="py-8 text-center text-slate-400 text-xs font-black uppercase tracking-widest bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                        No non-material expenses logged today.
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {Object.entries(expensesByCategory).map(([category, amount]) => {
                          const pct = totalExpenses > 0 ? (amount / totalExpenses) * 100 : 0;
                          return (
                            <div key={category} className="space-y-1">
                              <div className="flex justify-between text-xs">
                                <span className="font-bold text-slate-700 uppercase tracking-wide">{category}</span>
                                <span className="font-mono font-black text-slate-900">${amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                              </div>
                              <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                                <div style={{ width: `${pct}%` }} className="bg-amber-500 h-full rounded-full" />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Actions & List View */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                {/* Daily Log */}
                <div className="lg:col-span-8 space-y-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-3 bg-white border border-slate-200 rounded-2xl shadow-sm">
                        <History className="w-5 h-5 text-slate-600" />
                      </div>
                      <h3 className="text-xl font-black text-slate-900 uppercase tracking-tight">
                        {selectedSession.id === activeSession?.id ? "Today's Transactions" : "Session Transactions"}
                      </h3>
                    </div>
                    <div className="flex gap-2">
                      <button 
                        onClick={handleOpenInflowModal}
                        className="px-4 py-2 bg-emerald-50 text-emerald-700 rounded-xl font-black text-[10px] uppercase tracking-widest border border-emerald-100 hover:bg-emerald-100 transition-all flex items-center gap-2 cursor-pointer active:scale-95"
                      >
                        <ArrowUpCircle className="w-4 h-4" />
                        Bank Run
                      </button>
                      <button 
                        onClick={handleOpenExpenseModal}
                        className="px-4 py-2 bg-red-50 text-red-700 rounded-xl font-black text-[10px] uppercase tracking-widest border border-red-100 hover:bg-red-100 transition-all flex items-center gap-2 cursor-pointer active:scale-95"
                      >
                        <ArrowDownCircle className="w-4 h-4" />
                        Expense
                      </button>
                    </div>
                  </div>

                  <div className="bg-white rounded-[2rem] border border-slate-200 overflow-hidden shadow-sm">
                    {transactions.length === 0 ? (
                      <div className="p-12 text-center space-y-4">
                        <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto text-slate-300">
                          <Receipt className="w-8 h-8" />
                        </div>
                        <p className="text-slate-400 font-bold uppercase text-xs tracking-widest">No manual transactions logged yet today.</p>
                      </div>
                    ) : (
                      <div className="divide-y divide-slate-50">
                        {transactions.map(tx => {
                          const isHighlighted = highlightedTxId === tx.id;
                          return (
                            <div 
                              key={tx.id} 
                              className={cn(
                                "p-6 flex items-center justify-between transition-all duration-500",
                                isHighlighted 
                                  ? "bg-amber-50/90 ring-2 ring-amber-500 rounded-2xl shadow-lg" 
                                  : "hover:bg-slate-50/50"
                              )}
                            >
                              <div className="flex items-center gap-4">
                                <div className={cn(
                                  "p-3 rounded-2xl",
                                  tx.type === 'inflow' ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600"
                                )}>
                                  {tx.category === 'Fuel' ? <Fuel className="w-5 h-5" /> : tx.type === 'inflow' ? <Banknote className="w-5 h-5" /> : <Receipt className="w-5 h-5" />}
                                </div>
                                <div>
                                  <div className="flex items-center gap-2">
                                    <p className="font-black text-slate-900 uppercase tracking-tight">{tx.category}</p>
                                    <span className="px-2 py-0.5 bg-slate-100 text-slate-500 rounded text-[8px] font-black uppercase tracking-widest">{new Date(tx.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit'})}</span>
                                    {isHighlighted && (
                                      <span className="px-2 py-0.5 bg-emerald-600 text-white rounded text-[8px] font-black uppercase tracking-widest animate-pulse flex items-center gap-1">
                                        <Check className="w-2.5 h-2.5" /> Just Logged
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-slate-500 text-xs font-medium">{tx.notes || 'No description'}</p>
                                </div>
                              </div>
                              <div className="flex items-center gap-6">
                                <div className="text-right">
                                  <p className={cn(
                                    "font-mono font-black text-lg",
                                    tx.type === 'inflow' ? "text-emerald-600" : "text-red-600"
                                  )}>
                                    {tx.type === 'inflow' ? '+' : '-'}${tx.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                  </p>
                                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{tx.performedBy.split('@')[0]}</p>
                                </div>

                                {(profile?.role === 'manager' || selectedSession) && (
                                  <div className="flex items-center gap-1">
                                    <button 
                                      onClick={() => setEditingTransaction(tx)}
                                      className="p-2 text-slate-300 hover:text-blue-500 hover:bg-blue-50 rounded-xl transition-all"
                                      title="Edit Transaction"
                                    >
                                      <Edit2 className="w-4 h-4" />
                                    </button>
                                    <button 
                                      onClick={() => handleDeleteTransaction(tx.id)}
                                      className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                                      title="Delete Transaction"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  </div>
                                )}

                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>

                {/* Sidebar Summary */}
                <div className="lg:col-span-4 space-y-6">
                  <div className="bg-slate-900 rounded-[2rem] p-8 text-white shadow-2xl relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-4 opacity-10">
                      <Activity className="w-16 h-16" />
                    </div>
                    <h3 className="text-xl font-black uppercase tracking-tight mb-8 font-display">End of Day Audit</h3>
                    
                    <div className="space-y-6">
                      <div className="flex items-center justify-between py-3 border-b border-white/5">
                        <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Expected In Safe/Drawer</span>
                        <span className="font-mono font-black text-xl">${expectedCash.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                      </div>
                      
                      {selectedSession.status === 'open' ? (
                        <div className="space-y-4 pt-4">
                          <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest leading-relaxed">
                            Ready to count your physical cash and verify the balance? This will finalize the session.
                          </p>
                          {profile?.role === 'cashier' && !profile?.permissions?.canOpenCloseSessions ? (
                            <div className="p-4 bg-white/5 border border-white/10 rounded-2xl text-slate-400 text-xs font-semibold text-center">
                              You do not have permission to close cash sessions. Please contact a manager.
                            </div>
                          ) : (
                            <button 
                              onClick={() => setShowCloseModal(true)}
                              className="w-full py-5 bg-white text-slate-900 rounded-3xl font-black text-xs uppercase tracking-widest hover:bg-slate-100 transition-all shadow-xl flex items-center justify-center gap-2 group/btn"
                            >
                              <CheckCircle2 className="w-4 h-4 text-emerald-600 group-hover/btn:scale-110 transition-transform" />
                              Finalize Reconciliation
                            </button>
                          )}
                        </div>
                      ) : (
                        <div className="space-y-6 pt-4">
                          <div className="p-6 bg-white/5 rounded-3xl border border-white/10 space-y-4">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold text-slate-400 uppercase">Physical Count</span>
                              <span className="font-mono font-black">${selectedSession.actualCash?.toLocaleString()}</span>
                            </div>
                            {(() => {
                              const overShort = selectedSession.overShort || 0;
                              const status = getShortageStatus(overShort, buyTickets.length);
                              return (
                                <div className="space-y-2">
                                  <div className="flex items-center justify-between">
                                    <span className="text-xs font-bold text-slate-400 uppercase">Over/Short</span>
                                    <div className="flex flex-col items-end">
                                      <span className={cn(
                                        "p-2 rounded-xl font-mono font-black",
                                        status.colorClass
                                      )}>
                                        {overShort > 0 ? '+' : ''}{overShort.toFixed(2)}
                                      </span>
                                    </div>
                                  </div>
                                  {status.isTolerance && (
                                    <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-2xl text-[9px] font-black uppercase tracking-widest text-amber-500 flex items-center gap-2">
                                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                                      <span>Penny Rounding Tolerance ({buyTickets.length} tickets)</span>
                                    </div>
                                  )}
                                </div>
                              );
                            })()}
                          </div>
                          {selectedSession.closingDenominations && (
                            <button
                              onClick={() => setViewingDenoms({
                                title: 'Closing Physical Cash Count Breakdown',
                                denoms: selectedSession.closingDenominations!,
                                closedBy: selectedSession.closedBy
                              })}
                              className="w-full py-2.5 bg-white/5 hover:bg-white/10 text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-1.5 border border-white/10"
                            >
                              <Eye className="w-3.5 h-3.5 text-blue-300" />
                              View Physical Breakdown
                            </button>
                          )}
                          <div className="flex flex-col gap-3 pt-4">
                            <div className="flex items-center gap-3 p-4 bg-emerald-500/10 rounded-2xl border border-emerald-500/20">
                              <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0" />
                              <p className="text-[10px] font-black text-emerald-400 uppercase tracking-widest">
                                This session is finalized. Reconciliation record is archived.
                              </p>
                            </div>
                            {(profile?.role === 'manager' || selectedSession) && (
                              <button 
                                onClick={() => {
                                  if (window.confirm('Are you sure you want to re-open this session? This will remove the final actual count and over/short calculation.')) {
                                    handleReOpenSession();
                                  }
                                }}
                                className="w-full py-3 bg-white/5 hover:bg-white/10 text-white rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all flex items-center justify-center gap-2 border border-white/10"
                              >
                                <RotateCcw className="w-4 h-4" />
                                Re-open for changes
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Physical Cash Count Editor Card on Dashboard */}
                  <div className="bg-white rounded-[2rem] p-8 border border-slate-200 shadow-sm space-y-6">
                    <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest">Physical Cash Count</h3>
                          {renderAutoSaveBadge()}
                        </div>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-0.5">Edit drawer denominations</p>
                      </div>
                      <span className="font-mono font-black text-xs text-slate-900 bg-slate-50 px-2.5 py-1 rounded-lg border border-slate-200">
                        ${calculateDenomTotal(sheetDenoms).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </span>
                    </div>

                    <div className="space-y-4 max-h-[420px] overflow-y-auto pr-1">
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">Paper Bills</span>
                      <div className="space-y-2">
                        {[
                          { key: 'hundreds', label: "100's ($100)", value: 100 },
                          { key: 'fifties', label: "50's ($50)", value: 50 },
                          { key: 'twenties', label: "20's ($20)", value: 20 },
                          { key: 'tens', label: "10's ($10)", value: 10 },
                          { key: 'fives', label: "5's ($5)", value: 5 },
                          { key: 'ones', label: "1's ($1)", value: 1 }
                        ].map(denom => {
                          const totalVal = sheetDenoms[denom.key as keyof DenominationCount] || 0;
                          const updateSheetCount = (change: number) => {
                            const val = Math.max(0, Math.round((totalVal + (change * denom.value)) * 100) / 100);
                            handleSheetDenomChange(denom.key as keyof DenominationCount, val);
                          };

                          return (
                            <div key={denom.key} className="flex items-center justify-between bg-slate-50 p-2 rounded-xl border border-slate-200/60">
                              <div className="flex flex-col">
                                <span className="font-bold text-slate-700 text-xs font-mono">{denom.label}</span>
                                {totalVal > 0 && (
                                  <span className="text-[9px] text-slate-500 font-bold uppercase tracking-wider">
                                    Total: ${Math.round(totalVal).toLocaleString()}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => updateSheetCount(-1)}
                                  disabled={totalVal <= 0}
                                  className="w-6 h-6 flex items-center justify-center bg-white border border-slate-200 rounded text-slate-600 font-bold text-xs hover:bg-slate-100 disabled:opacity-30 disabled:pointer-events-none active:scale-95 transition-all shadow-xs"
                                  title={`Subtract $${denom.value}`}
                                >
                                  -
                                </button>
                                <div className="relative">
                                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-xs">$</span>
                                  <input
                                    type="number"
                                    step={denom.value}
                                    min="0"
                                    disabled={false}
                                    value={totalVal || ''}
                                    onChange={(e) => handleSheetDenomChange(denom.key as keyof DenominationCount, Math.round((parseFloat(e.target.value) || 0) * 100) / 100)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'ArrowUp') {
                                        e.preventDefault();
                                        updateSheetCount(1);
                                      } else if (e.key === 'ArrowDown') {
                                        e.preventDefault();
                                        updateSheetCount(-1);
                                      }
                                    }}
                                    className="w-20 pl-5 pr-1 py-1 bg-white border border-slate-300 rounded-lg text-slate-900 font-mono font-bold text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none disabled:opacity-70 disabled:bg-slate-100"
                                    placeholder="0"
                                  />
                                </div>
                                <button
                                  type="button"
                                  onClick={() => updateSheetCount(1)}
                                  className="w-6 h-6 flex items-center justify-center bg-white border border-slate-200 rounded text-slate-600 font-bold text-xs hover:bg-slate-100 active:scale-95 transition-all shadow-xs"
                                  title={`Add $${denom.value}`}
                                >
                                  +
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider block mt-4">Loose Coins</span>
                      <div className="space-y-2">
                        {[
                          { key: 'dollarCoins', label: "Dollar Coins ($1)", value: 1 },
                          { key: 'halfDollars', label: "Halves (50¢)", value: 0.5 },
                          { key: 'quarters', label: "Quarters (25¢)", value: 0.25 },
                          { key: 'dimes', label: "Dimes (10¢)", value: 0.1 },
                          { key: 'nickels', label: "Nickels (5¢)", value: 0.05 }
                        ].map(denom => {
                          const totalVal = sheetDenoms[denom.key as keyof DenominationCount] || 0;
                          const updateSheetCount = (change: number) => {
                            const val = Math.max(0, Math.round((totalVal + (change * denom.value)) * 100) / 100);
                            handleSheetDenomChange(denom.key as keyof DenominationCount, val);
                          };

                          return (
                            <div key={denom.key} className="flex items-center justify-between bg-slate-50 p-2 rounded-xl border border-slate-200/60">
                              <div className="flex flex-col">
                                <span className="font-bold text-slate-700 text-xs font-mono">{denom.label}</span>
                                {totalVal > 0 && (
                                  <span className="text-[9px] text-slate-500 font-bold uppercase tracking-wider">
                                    Total: ${totalVal.toFixed(2)}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => updateSheetCount(-1)}
                                  disabled={totalVal <= 0}
                                  className="w-6 h-6 flex items-center justify-center bg-white border border-slate-200 rounded text-slate-600 font-bold text-xs hover:bg-slate-100 disabled:opacity-30 disabled:pointer-events-none active:scale-95 transition-all shadow-xs"
                                  title={`Subtract $${denom.value < 1 ? `${Math.round(denom.value * 100)}¢` : `$${denom.value}`}`}
                                >
                                  -
                                </button>
                                <div className="relative">
                                  <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-xs">$</span>
                                  <input
                                    type="number"
                                    step={denom.value}
                                    min="0"
                                    disabled={false}
                                    value={totalVal || ''}
                                    onChange={(e) => handleSheetDenomChange(denom.key as keyof DenominationCount, Math.round((parseFloat(e.target.value) || 0) * 100) / 100)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'ArrowUp') {
                                        e.preventDefault();
                                        updateSheetCount(1);
                                      } else if (e.key === 'ArrowDown') {
                                        e.preventDefault();
                                        updateSheetCount(-1);
                                      }
                                    }}
                                    className="w-20 pl-5 pr-1 py-1 bg-white border border-slate-300 rounded-lg text-slate-900 font-mono font-bold text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none disabled:opacity-70 disabled:bg-slate-100"
                                    placeholder="0.00"
                                  />
                                </div>
                                <button
                                  type="button"
                                  onClick={() => updateSheetCount(1)}
                                  className="w-6 h-6 flex items-center justify-center bg-white border border-slate-200 rounded text-slate-600 font-bold text-xs hover:bg-slate-100 active:scale-95 transition-all shadow-xs"
                                  title={`Add $${denom.value < 1 ? `${Math.round(denom.value * 100)}¢` : `$${denom.value}`}`}
                                >
                                  +
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className="pt-2 border-t border-slate-100 space-y-2">
                      <div className="flex justify-between items-center text-xs">
                        <span className="font-bold text-slate-400 uppercase">Coin & Bill Total</span>
                        <span className="font-mono font-black text-slate-900">
                          ${calculateDenomTotal(sheetDenoms).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                      <div className="flex justify-between items-center text-xs pb-2">
                        <span className="font-bold text-slate-400 uppercase">Over / Short</span>
                        <span className={cn(
                          "font-mono font-black px-2 py-0.5 rounded",
                          (calculateDenomTotal(sheetDenoms) - expectedCash) < 0 
                            ? "bg-red-50 text-red-700 border border-red-100" 
                            : "bg-emerald-50 text-emerald-700 border border-emerald-100"
                        )}>
                          {calculateDenomTotal(sheetDenoms) - expectedCash >= 0 ? '+' : ''}
                          {(calculateDenomTotal(sheetDenoms) - expectedCash).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </span>
                      </div>

                      {(selectedSession || profile?.role === 'manager') && (
                        <button
                          type="button"
                          onClick={handleSaveSheetCount}
                          disabled={processing}
                          className="w-full py-4 bg-slate-950 hover:bg-slate-900 text-white rounded-2xl font-black text-xs uppercase tracking-widest transition-all flex items-center justify-center gap-2 shadow-lg disabled:opacity-50"
                        >
                          <Save className="w-4 h-4 text-emerald-400" />
                          {processing ? 'Saving...' : selectedSession.status === 'closed' ? 'Save Audit Changes' : 'Save Physical Count'}
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="bg-white rounded-[2rem] p-8 border border-slate-200 shadow-sm">
                    <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest mb-6">Security & Notes</h3>
                    <div className="space-y-4">
                      {selectedSession.notes && (
                        <div className="p-4 bg-slate-50 rounded-2xl italic text-slate-600 text-sm border border-slate-100">
                          "{selectedSession.notes}"
                        </div>
                      )}
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-relaxed">
                        Session audits include all bank run replenishments and non-buying expenses. These records are tied to the manager who closed the day.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : viewMode === 'balance_sheet' ? (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
              {/* Action Bar (Hidden on Print) */}
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-4 rounded-3xl border border-slate-200 shadow-sm print:hidden">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-emerald-50 rounded-2xl text-emerald-600 border border-emerald-100 shadow-sm">
                    <FileSpreadsheet className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-black text-slate-900 uppercase tracking-tight">Interactive Daily Sheet</h2>
                    <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest mt-0.5">Automated from register transactions</p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2.5 w-full sm:w-auto">
                  <button
                    type="button"
                    onClick={handleOpenInflowModal}
                    className="flex-1 sm:flex-initial flex items-center justify-center gap-2 px-4 py-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-black text-[10px] uppercase tracking-widest transition-all shadow-md cursor-pointer active:scale-95"
                  >
                    <ArrowUpCircle className="w-4 h-4" />
                    Record Bank Run
                  </button>
                  <button
                    type="button"
                    onClick={handleOpenExpenseModal}
                    className="flex-1 sm:flex-initial flex items-center justify-center gap-2 px-4 py-3 bg-rose-600 hover:bg-rose-500 text-white rounded-xl font-black text-[10px] uppercase tracking-widest transition-all shadow-md cursor-pointer active:scale-95"
                  >
                    <ArrowDownCircle className="w-4 h-4" />
                    Record Expense
                  </button>
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="flex-1 sm:flex-initial flex items-center justify-center gap-2 px-4 py-3 bg-slate-900 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-800 transition-all shadow-lg"
                  >
                    <Printer className="w-4 h-4 text-slate-300" />
                    Print Template
                  </button>
                  <button
                    type="button"
                    onClick={handleExportSheetCsv}
                    className="flex-1 sm:flex-initial flex items-center justify-center gap-2 px-4 py-3 bg-green-50 hover:bg-green-100 text-green-700 border border-green-200 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all"
                  >
                    <FileSpreadsheet className="w-4 h-4 text-green-600" />
                    Export for Sheets
                  </button>
                </div>
              </div>

              {/* Physical Form Replica */}
              <div className="bg-white border border-slate-300 rounded-[2.5rem] p-6 md:p-10 shadow-lg relative overflow-hidden print:border-none print:shadow-none print:p-0 print:m-0">
                
                {/* Sheet Header */}
                <div className="flex flex-row justify-between items-start border-b border-slate-300 pb-6 mb-8">
                  <div>
                    <h2 className="text-lg font-black text-slate-900 uppercase tracking-widest font-sans">Preferred Metals & Recycling</h2>
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">Daily Balance Sheet Ledger</p>
                  </div>
                  <div className="text-right">
                    <h2 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Date / Ledger Session</h2>
                    <div className="mt-1 text-slate-900 font-mono font-black text-sm bg-slate-50 border border-slate-200 px-4 py-2 rounded-xl">
                      {selectedSession.date}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                  
                  {/* Left Column: Transaction Ledger & Summary */}
                  <div className="lg:col-span-7 space-y-8">
                    <div>
                      <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-3">Recorded Inflows & Outlays</h3>
                      <div className="border border-slate-300 rounded-2xl overflow-hidden shadow-sm">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="bg-slate-900 text-white border-b border-slate-300">
                              <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-right w-[110px]">Cash In</th>
                              <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-right w-[110px]">Cash Out</th>
                              <th className="px-4 py-3 text-[10px] font-black uppercase tracking-widest">Description</th>
                              <th className="px-2 py-3 text-[10px] font-black uppercase tracking-widest text-center w-[60px]">Initials</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200">
                            {(() => {
                              const rows = [...sheetLedgerItems];
                              const emptyRowCount = Math.max(0, 15 - rows.length);
                              for (let i = 0; i < emptyRowCount; i++) {
                                rows.push({
                                  cashIn: null,
                                  cashOut: null,
                                  description: '',
                                  initials: '',
                                  timestamp: ''
                                });
                              }
                              return rows.map((item, idx) => {
                                const isRowHighlighted = Boolean(item.id && item.id === highlightedTxId);
                                return (
                                  <tr 
                                    key={idx} 
                                    className={cn(
                                      "h-10 transition-all duration-500",
                                      isRowHighlighted ? "bg-amber-100/90 ring-2 ring-amber-500 font-bold" : "hover:bg-slate-50/40"
                                    )}
                                  >
                                    <td className="px-4 py-2 text-right font-mono font-black text-xs text-emerald-600 bg-emerald-50/10 border-r border-slate-200">
                                      {item.cashIn !== null ? `$${item.cashIn.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : ''}
                                    </td>
                                    <td className="px-4 py-2 text-right font-mono font-black text-xs text-red-600 bg-red-50/10 border-r border-slate-200">
                                      {item.cashOut !== null ? `$${item.cashOut.toLocaleString(undefined, { minimumFractionDigits: 2 })}` : ''}
                                    </td>
                                    <td className="px-4 py-2 text-slate-700 text-[11px] font-medium truncate max-w-[200px] border-r border-slate-200">
                                      <div className="flex items-center gap-1.5">
                                        <span>{item.description || <span className="text-slate-200">----------------------------</span>}</span>
                                        {isRowHighlighted && (
                                          <span className="px-1.5 py-0.5 bg-amber-500 text-white rounded text-[8px] font-black uppercase tracking-wider animate-pulse">
                                            NEW
                                          </span>
                                        )}
                                      </div>
                                    </td>
                                    <td className="px-2 py-2 text-center font-mono text-[11px] font-black text-slate-400">
                                      {item.initials || '-'}
                                    </td>
                                  </tr>
                                );
                              });
                            })()}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* Summary Metrics (Bottom Left) */}
                    <div className="bg-slate-50 rounded-3xl p-6 border border-slate-300 space-y-4 shadow-inner">
                      <h4 className="text-xs font-black text-slate-800 uppercase tracking-widest pb-2 border-b border-slate-200">Summary Reconciliation</h4>
                      
                      <div className="grid grid-cols-2 gap-4 text-xs">
                        <div className="flex justify-between items-center py-1.5">
                          <span className="font-bold text-slate-500 uppercase">Total Cash IN</span>
                          <span className="font-mono font-black text-slate-900">+${totalReplenishments.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                        </div>
                        <div className="flex justify-between items-center py-1.5">
                          <span className="font-bold text-slate-500 uppercase">Beginning Cash</span>
                          {profile?.role === 'manager' ? (
                            <div className="relative">
                              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 font-bold font-mono text-xs">$</span>
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                value={editedOpeningCash || ''}
                                onChange={(e) => {
                                  const parsed = parseFloat(e.target.value) || 0;
                                  setEditedOpeningCash(Math.max(0, Math.round(parsed * 100) / 100));
                                }}
                                className="w-28 pl-5 pr-2 py-1 bg-white border border-slate-300 rounded-lg text-slate-900 font-mono font-black text-right focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
                                placeholder="0.00"
                              />
                            </div>
                          ) : (
                            <span className="font-mono font-black text-slate-900">+${editedOpeningCash.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                          )}
                        </div>
                        <div className="flex justify-between items-center py-1.5 border-t border-dashed border-slate-200">
                          <span className="font-bold text-slate-500 uppercase">Grand Total</span>
                          <span className="font-mono font-black text-slate-900">=${(totalReplenishments + editedOpeningCash).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                        </div>
                        <div className="flex justify-between items-center py-1.5 border-t border-dashed border-slate-200">
                          <span className="font-bold text-slate-500 uppercase">Total Cash OUT</span>
                          <span className="font-mono font-black text-slate-900">-${(totalPayouts + totalExpenses).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                        </div>
                        <div className="flex justify-between items-center py-2.5 border-t-2 border-slate-300 col-span-2">
                          <span className="font-black text-slate-800 uppercase text-xs">Calculated End Balance</span>
                          <span className="font-mono font-black text-slate-900 text-sm">${sheetExpectedCash.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                        </div>
                        <div className="flex justify-between items-center py-1.5 border-t border-dashed border-slate-200 col-span-2">
                          <span className="font-bold text-slate-500 uppercase">Total Cash On-Hand (Physical)</span>
                          <span className="font-mono font-black text-slate-900 text-sm">
                            ${calculateDenomTotal(sheetDenoms).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </span>
                        </div>
                        <div className="flex justify-between items-center py-2.5 border-t-2 border-slate-300 col-span-2 bg-white rounded-xl px-4 border border-slate-200">
                          <span className="font-black text-slate-800 uppercase text-xs">Over / Short</span>
                          <span className={cn(
                            "font-mono font-black text-sm px-2.5 py-1 rounded-lg",
                            (calculateDenomTotal(sheetDenoms) - sheetExpectedCash) < 0 
                              ? "bg-red-50 text-red-700 border border-red-100" 
                              : "bg-emerald-50 text-emerald-700 border border-emerald-100"
                          )}>
                            {calculateDenomTotal(sheetDenoms) - sheetExpectedCash >= 0 ? '+' : ''}
                            {(calculateDenomTotal(sheetDenoms) - sheetExpectedCash).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Carryover Reconciliation Card */}
                    {previousSession && (
                      <div className="bg-slate-50 rounded-3xl p-6 border border-slate-300 space-y-3 shadow-inner">
                        <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                          <h4 className="text-xs font-black text-slate-800 uppercase tracking-widest">Carryover Verification</h4>
                          <span className="text-[9px] font-black uppercase text-slate-400 bg-slate-200 px-2 py-0.5 rounded-md">
                            vs {previousSession.date}
                          </span>
                        </div>
                        <div className="space-y-2 text-xs">
                          <div className="flex justify-between items-center py-1">
                            <span className="font-bold text-slate-500 uppercase">Previous Day Closing Cash</span>
                            <span className="font-mono font-black text-slate-900">${previousSession.actualCash?.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                          </div>
                          <div className="flex justify-between items-center py-1">
                            <span className="font-bold text-slate-500 uppercase">Today Opening Cash</span>
                            <span className="font-mono font-black text-slate-900">${selectedSession.openingCash.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                          </div>
                          {(() => {
                            const carryoverDiff = selectedSession.openingCash - (previousSession.actualCash || 0);
                            const isMatch = Math.abs(carryoverDiff) < 0.01;
                            return (
                              <div className="flex justify-between items-center py-2 border-t border-dashed border-slate-200">
                                <span className="font-black text-slate-800 uppercase text-[10px]">Carryover Discrepancy</span>
                                <span className={cn(
                                  "font-mono font-black text-xs px-2 py-0.5 rounded",
                                  isMatch 
                                    ? "bg-emerald-100 text-emerald-800" 
                                    : "bg-amber-100 text-amber-800"
                                )}>
                                  {isMatch ? "Matched Perfectly" : `${carryoverDiff >= 0 ? '+' : ''}${carryoverDiff.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
                                </span>
                              </div>
                            );
                          })()}
                        </div>
                      </div>
                    )}

                    {/* Manager Audit Verification Card */}
                    {selectedSession.status === 'closed' && (
                      <div className="bg-white rounded-3xl p-6 border-2 border-slate-200 space-y-4 shadow-sm relative overflow-hidden">
                        <div className="flex items-center gap-3 border-b border-slate-100 pb-3">
                          <div className="p-2 bg-blue-50 text-blue-600 rounded-xl">
                            <ShieldCheck className="w-5 h-5" />
                          </div>
                          <div>
                            <h4 className="text-xs font-black text-slate-800 uppercase tracking-widest">Manager Audit & Sign-Off</h4>
                            <p className="text-[9px] text-slate-400 font-bold uppercase tracking-wider mt-0.5">End-of-day financial verification</p>
                          </div>
                        </div>

                        {selectedSession.verificationStatus && selectedSession.verificationStatus !== 'unverified' && !isEditingVerification ? (
                          <div className="space-y-4">
                            <div className={cn(
                              "p-4 rounded-2xl flex items-start gap-3",
                              selectedSession.verificationStatus === 'verified' 
                                ? "bg-emerald-50 text-emerald-800 border border-emerald-100" 
                                : "bg-rose-50 text-rose-800 border border-rose-100"
                            )}>
                              {selectedSession.verificationStatus === 'verified' ? (
                                <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-600 mt-0.5" />
                              ) : (
                                <AlertTriangle className="w-5 h-5 shrink-0 text-rose-600 mt-0.5" />
                              )}
                              <div>
                                <span className="font-black text-xs uppercase tracking-wider block">
                                  {selectedSession.verificationStatus === 'verified' ? 'Verified & Approved' : 'Disputed & Flagged'}
                                </span>
                                <p className="text-[10px] opacity-90 font-semibold mt-1">
                                  Signed off by <span className="font-mono font-bold text-[11px]">{selectedSession.verifiedBy}</span> on{' '}
                                  {selectedSession.verifiedAt ? new Date(selectedSession.verifiedAt).toLocaleString() : 'unknown date'}.
                                </p>
                              </div>
                            </div>

                            {selectedSession.verificationComment && (
                              <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                                <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider block mb-1">Audit Notes</span>
                                <p className="text-xs text-slate-700 font-medium whitespace-pre-wrap">{selectedSession.verificationComment}</p>
                              </div>
                            )}

                            {profile?.role === 'manager' && (
                              <button
                                type="button"
                                onClick={() => {
                                  setVerificationStatus(selectedSession.verificationStatus || 'unverified');
                                  setVerificationComment(selectedSession.verificationComment || '');
                                  setIsEditingVerification(true);
                                }}
                                className="w-full py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all cursor-pointer border border-slate-200"
                              >
                                Edit Audit Sign-off Decisions
                              </button>
                            )}
                          </div>
                        ) : (
                          <div className="space-y-4">
                            {profile?.role !== 'manager' ? (
                              <div className="bg-amber-50/50 border border-amber-200 text-amber-800 p-4 rounded-2xl flex items-center gap-3">
                                <AlertTriangle className="w-5 h-5 shrink-0 text-amber-500" />
                                <span className="text-[10px] font-bold uppercase tracking-wider">
                                  Pending manager review. Only users with Manager role can sign-off or dispute closing audits.
                                </span>
                              </div>
                            ) : (
                              <div className="space-y-4">
                                <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider block">Select Audit Determination</span>
                                <div className="grid grid-cols-2 gap-3">
                                  <button
                                    type="button"
                                    onClick={() => setVerificationStatus('verified')}
                                    className={cn(
                                      "p-4 rounded-2xl border-2 transition-all flex flex-col items-center text-center gap-1.5 cursor-pointer",
                                      verificationStatus === 'verified'
                                        ? "bg-emerald-50 border-emerald-500 text-emerald-800 shadow-sm"
                                        : "bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100"
                                    )}
                                  >
                                    <CheckCircle2 className={cn("w-5 h-5", verificationStatus === 'verified' ? "text-emerald-600" : "text-slate-400")} />
                                    <span className="font-black text-[10px] uppercase tracking-wider">Approve & Sign-off</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setVerificationStatus('disputed')}
                                    className={cn(
                                      "p-4 rounded-2xl border-2 transition-all flex flex-col items-center text-center gap-1.5 cursor-pointer",
                                      verificationStatus === 'disputed'
                                        ? "bg-rose-50 border-rose-500 text-rose-800 shadow-sm"
                                        : "bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100"
                                    )}
                                  >
                                    <AlertTriangle className={cn("w-5 h-5", verificationStatus === 'disputed' ? "text-rose-600" : "text-slate-400")} />
                                    <span className="font-black text-[10px] uppercase tracking-wider">Flag Discrepancy</span>
                                  </button>
                                </div>

                                <div className="space-y-1">
                                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider block">Audit Comments & Explanations</span>
                                  <textarea
                                    value={verificationComment}
                                    onChange={(e) => setVerificationComment(e.target.value)}
                                    placeholder="Enter review notes, explanations of variance, or sign-off remarks..."
                                    rows={3}
                                    className="w-full px-3.5 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all placeholder:text-slate-400 font-medium"
                                  />
                                </div>

                                <div className="flex gap-2">
                                  {isEditingVerification && (
                                    <button
                                      type="button"
                                      disabled={isSubmittingVerification}
                                      onClick={() => setIsEditingVerification(false)}
                                      className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all cursor-pointer border border-slate-200"
                                    >
                                      Cancel
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    disabled={verificationStatus === 'unverified' || isSubmittingVerification}
                                    onClick={() => handleVerifySession(verificationStatus as 'verified' | 'disputed')}
                                    className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 text-white rounded-xl font-black text-[10px] uppercase tracking-widest transition-all shadow-md shadow-blue-500/10 cursor-pointer"
                                  >
                                    {isSubmittingVerification ? 'Submitting...' : 'Submit Audit Sign-off'}
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Right Column: Physical Denomination Inventory Counts */}
                  <div className="lg:col-span-5 space-y-6">
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex flex-col gap-1.5">
                          <div className="flex items-center gap-2">
                            <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">Physical Inventory Count</h3>
                            {renderAutoSaveBadge()}
                          </div>
                          {profile?.role === 'manager' && (
                            <div className="flex bg-slate-200 p-0.5 rounded-lg text-[9px] font-black uppercase tracking-widest mt-1">
                              <button
                                type="button"
                                onClick={() => setDenomEditTab('closing')}
                                className={cn(
                                  "px-2.5 py-1 rounded transition-all cursor-pointer",
                                  denomEditTab === 'closing' ? "bg-white text-slate-900 shadow-sm font-black" : "text-slate-500 hover:text-slate-800 font-bold"
                                )}
                              >
                                Cash Close (Closing)
                              </button>
                              <button
                                type="button"
                                onClick={() => setDenomEditTab('opening')}
                                className={cn(
                                  "px-2.5 py-1 rounded transition-all cursor-pointer",
                                  denomEditTab === 'opening' ? "bg-white text-slate-900 shadow-sm font-black" : "text-slate-500 hover:text-slate-800 font-bold"
                                )}
                              >
                                Cash Start (Starting)
                              </button>
                            </div>
                          )}
                        </div>
                        <span className="text-[9px] font-bold text-slate-400 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-full uppercase">
                          {denomEditTab === 'closing' ? (selectedSession.status === 'open' ? 'Live Count' : 'Archived Count') : 'Starting Count'}
                        </span>
                      </div>
                      
                      <div className="border border-slate-300 rounded-2xl overflow-hidden shadow-sm bg-slate-50">
                        {/* Bills Group */}
                        <div className="p-4 border-b border-slate-200 space-y-3 bg-white">
                          <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">Paper Bills</span>
                          <div className="space-y-2">
                            {[
                              { key: 'hundreds', label: "100's ($100)", value: 100 },
                              { key: 'fifties', label: "50's ($50)", value: 50 },
                              { key: 'twenties', label: "20's ($20)", value: 20 },
                              { key: 'tens', label: "10's ($10)", value: 10 },
                              { key: 'fives', label: "5's ($5)", value: 5 },
                              { key: 'ones', label: "1's ($1)", value: 1 }
                            ].map(denom => {
                              const currentDenoms = denomEditTab === 'opening' ? editedOpeningDenoms : sheetDenoms;
                              const totalVal = currentDenoms[denom.key as keyof DenominationCount] || 0;

                              const updateModalCount = (change: number) => {
                                const val = Math.max(0, Math.round((totalVal + (change * denom.value)) * 100) / 100);
                                if (denomEditTab === 'opening') {
                                  const updatedOpening = { ...editedOpeningDenoms, [denom.key]: val };
                                  setEditedOpeningDenoms(updatedOpening);
                                  const newTotal = calculateDenomTotal(updatedOpening);
                                  setEditedOpeningCash(Math.round(newTotal * 100) / 100);
                                } else {
                                  handleSheetDenomChange(denom.key as keyof DenominationCount, val);
                                }
                              };

                              return (
                                <div key={denom.key} className="flex items-center justify-between bg-slate-50 p-2 rounded-xl border border-slate-200">
                                  <div className="flex flex-col">
                                    <span className="font-black text-slate-700 text-xs font-mono">{denom.label}</span>
                                    <span className="text-[9px] text-slate-500 font-bold uppercase tracking-wider">
                                      {totalVal > 0 ? `Total: $${Math.round(totalVal).toLocaleString()}` : 'Total Value'}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-1">
                                    <button
                                      type="button"
                                      onClick={() => updateModalCount(-1)}
                                      disabled={totalVal <= 0}
                                      className="w-7 h-7 flex items-center justify-center bg-white border border-slate-200 rounded-lg text-slate-600 font-bold text-xs hover:bg-slate-100 disabled:opacity-30 disabled:pointer-events-none active:scale-95 transition-all shadow-xs"
                                      title={`Subtract $${denom.value}`}
                                    >
                                      -
                                    </button>
                                    <div className="relative">
                                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-xs">$</span>
                                      <input
                                        type="number"
                                        step={denom.value}
                                        min="0"
                                        disabled={false}
                                        value={totalVal || ''}
                                        onChange={(e) => {
                                          const val = Math.round((parseFloat(e.target.value) || 0) * 100) / 100;
                                          if (denomEditTab === 'opening') {
                                            const updatedOpening = { ...editedOpeningDenoms, [denom.key]: Math.max(0, val) };
                                            setEditedOpeningDenoms(updatedOpening);
                                            const newTotal = calculateDenomTotal(updatedOpening);
                                            setEditedOpeningCash(Math.round(newTotal * 100) / 100);
                                          } else {
                                            handleSheetDenomChange(denom.key as keyof DenominationCount, val);
                                          }
                                        }}
                                        onKeyDown={(e) => {
                                          if (e.key === 'ArrowUp') {
                                            e.preventDefault();
                                            updateModalCount(1);
                                          } else if (e.key === 'ArrowDown') {
                                            e.preventDefault();
                                            updateModalCount(-1);
                                          }
                                        }}
                                        className="w-24 pl-6 pr-2 py-1 bg-white border border-slate-300 rounded-lg text-slate-900 font-mono font-bold text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none disabled:opacity-70 disabled:bg-slate-100"
                                        placeholder="0"
                                      />
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => updateModalCount(1)}
                                      className="w-7 h-7 flex items-center justify-center bg-white border border-slate-200 rounded-lg text-slate-600 font-bold text-xs hover:bg-slate-100 active:scale-95 transition-all shadow-xs"
                                      title={`Add $${denom.value}`}
                                    >
                                      +
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        {/* Coins Group */}
                        <div className="p-4 space-y-3 bg-white border-b border-slate-200">
                          <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">Loose Coins</span>
                          <div className="space-y-2">
                            {[
                              { key: 'dollarCoins', label: "Dollar Coins ($1)", value: 1 },
                              { key: 'halfDollars', label: "Halves (50¢)", value: 0.5 },
                              { key: 'quarters', label: "Quarters (25¢)", value: 0.25 },
                              { key: 'dimes', label: "Dimes (10¢)", value: 0.1 },
                              { key: 'nickels', label: "Nickels (5¢)", value: 0.05 }
                            ].map(denom => {
                              const currentDenoms = denomEditTab === 'opening' ? editedOpeningDenoms : sheetDenoms;
                              const totalVal = currentDenoms[denom.key as keyof DenominationCount] || 0;

                              const updateModalCount = (change: number) => {
                                const val = Math.max(0, Math.round((totalVal + (change * denom.value)) * 100) / 100);
                                if (denomEditTab === 'opening') {
                                  const updatedOpening = { ...editedOpeningDenoms, [denom.key]: val };
                                  setEditedOpeningDenoms(updatedOpening);
                                  const newTotal = calculateDenomTotal(updatedOpening);
                                  setEditedOpeningCash(Math.round(newTotal * 100) / 100);
                                } else {
                                  handleSheetDenomChange(denom.key as keyof DenominationCount, val);
                                }
                              };

                              return (
                                <div key={denom.key} className="flex items-center justify-between bg-slate-50 p-2 rounded-xl border border-slate-200">
                                  <div className="flex flex-col">
                                    <span className="font-black text-slate-700 text-xs font-mono">{denom.label}</span>
                                    <span className="text-[9px] text-slate-500 font-bold uppercase tracking-wider">
                                      {totalVal > 0 ? `Total: $${totalVal.toFixed(2)}` : 'Total Value'}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-1">
                                    <button
                                      type="button"
                                      onClick={() => updateModalCount(-1)}
                                      disabled={totalVal <= 0}
                                      className="w-7 h-7 flex items-center justify-center bg-white border border-slate-200 rounded-lg text-slate-600 font-bold text-xs hover:bg-slate-100 disabled:opacity-30 disabled:pointer-events-none active:scale-95 transition-all shadow-xs"
                                      title={`Subtract $${denom.value < 1 ? `${Math.round(denom.value * 100)}¢` : `$${denom.value}`}`}
                                    >
                                      -
                                    </button>
                                    <div className="relative">
                                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-xs">$</span>
                                      <input
                                        type="number"
                                        step={denom.value}
                                        min="0"
                                        disabled={false}
                                        value={totalVal || ''}
                                        onChange={(e) => {
                                          const val = Math.round((parseFloat(e.target.value) || 0) * 100) / 100;
                                          if (denomEditTab === 'opening') {
                                            const updatedOpening = { ...editedOpeningDenoms, [denom.key]: Math.max(0, val) };
                                            setEditedOpeningDenoms(updatedOpening);
                                            const newTotal = calculateDenomTotal(updatedOpening);
                                            setEditedOpeningCash(Math.round(newTotal * 100) / 100);
                                          } else {
                                            handleSheetDenomChange(denom.key as keyof DenominationCount, val);
                                          }
                                        }}
                                        onKeyDown={(e) => {
                                          if (e.key === 'ArrowUp') {
                                            e.preventDefault();
                                            updateModalCount(1);
                                          } else if (e.key === 'ArrowDown') {
                                            e.preventDefault();
                                            updateModalCount(-1);
                                          }
                                        }}
                                        className="w-24 pl-6 pr-2 py-1 bg-white border border-slate-300 rounded-lg text-slate-900 font-mono font-bold text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none disabled:opacity-70 disabled:bg-slate-100"
                                        placeholder="0.00"
                                      />
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => updateModalCount(1)}
                                      className="w-7 h-7 flex items-center justify-center bg-white border border-slate-200 rounded-lg text-slate-600 font-bold text-xs hover:bg-slate-100 active:scale-95 transition-all shadow-xs"
                                      title={`Add $${denom.value < 1 ? `${Math.round(denom.value * 100)}¢` : `$${denom.value}`}`}
                                    >
                                      +
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        {/* Totals Summary */}
                        <div className="p-4 bg-slate-100 space-y-2">
                          <div className="flex justify-between items-center text-xs">
                            <span className="font-bold text-slate-500 uppercase">Total Bills</span>
                            <span className="font-mono font-black text-slate-900">
                              ${Math.round(
                                ((denomEditTab === 'opening' ? editedOpeningDenoms : sheetDenoms).hundreds || 0) +
                                ((denomEditTab === 'opening' ? editedOpeningDenoms : sheetDenoms).fifties || 0) +
                                ((denomEditTab === 'opening' ? editedOpeningDenoms : sheetDenoms).twenties || 0) +
                                ((denomEditTab === 'opening' ? editedOpeningDenoms : sheetDenoms).tens || 0) +
                                ((denomEditTab === 'opening' ? editedOpeningDenoms : sheetDenoms).fives || 0) +
                                ((denomEditTab === 'opening' ? editedOpeningDenoms : sheetDenoms).ones || 0)
                              ).toLocaleString()}
                            </span>
                          </div>
                          <div className="flex justify-between items-center text-xs">
                            <span className="font-bold text-slate-500 uppercase">Total Coins</span>
                            <span className="font-mono font-black text-slate-900">
                              ${(
                                ((denomEditTab === 'opening' ? editedOpeningDenoms : sheetDenoms).dollarCoins || 0) +
                                ((denomEditTab === 'opening' ? editedOpeningDenoms : sheetDenoms).halfDollars || 0) +
                                ((denomEditTab === 'opening' ? editedOpeningDenoms : sheetDenoms).quarters || 0) +
                                ((denomEditTab === 'opening' ? editedOpeningDenoms : sheetDenoms).dimes || 0) +
                                ((denomEditTab === 'opening' ? editedOpeningDenoms : sheetDenoms).nickels || 0)
                              ).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                          </div>
                          <div className="flex justify-between items-center pt-2.5 border-t border-slate-300">
                            <span className="font-black text-slate-800 uppercase text-xs">Coin / Bill Total</span>
                            <span className="font-mono font-black text-slate-900 text-sm">
                              ${calculateDenomTotal(denomEditTab === 'opening' ? editedOpeningDenoms : sheetDenoms).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                            </span>
                          </div>
                        </div>
                      </div>
                      
                      {(selectedSession || profile?.role === 'manager') && (
                        <button
                          type="button"
                          onClick={handleSaveSheetCount}
                          disabled={processing}
                          className="mt-4 w-full py-4 bg-slate-950 hover:bg-slate-900 text-white rounded-2xl font-black text-xs uppercase tracking-widest transition-all flex items-center justify-center gap-2 shadow-lg disabled:opacity-50 cursor-pointer"
                        >
                          <Save className="w-4 h-4 text-emerald-400" />
                          {selectedSession.status === 'closed' ? 'Save Audit Changes' : 'Save Physical Count'}
                        </button>
                      )}
                    </div>
                  </div>

                </div>
              </div>

              {/* Session Audit Revision Trail Timeline */}
              <div className="bg-white rounded-[2.5rem] border border-slate-200 p-8 shadow-sm print:hidden">
                <div className="flex items-center gap-3 border-b border-slate-100 pb-4 mb-6">
                  <div className="p-2.5 bg-amber-50 rounded-xl text-amber-600 border border-amber-100 shadow-sm">
                    <History className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest">Audit Revision Trail & Timeline</h3>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mt-0.5">Chronological record of session adjustments, updates, and verification decisions</p>
                  </div>
                </div>

                {(() => {
                  const filteredLogs = auditLogs
                    .filter(log => log.entityId === selectedSession.id && log.entityType === 'cashDrawer')
                    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

                  if (filteredLogs.length === 0) {
                    return (
                      <div className="text-center py-8 text-slate-400 text-xs font-bold uppercase tracking-wider">
                        No historical adjustments or audits have been logged for this session.
                      </div>
                    );
                  }

                  return (
                    <div className="relative border-l-2 border-slate-100 pl-6 ml-3 space-y-6">
                      {filteredLogs.map((log) => {
                        let actionColor = "bg-blue-500 text-blue-500";
                        if (log.action === 'close') actionColor = "bg-red-500 text-red-500";
                        if (log.action === 'open') actionColor = "bg-emerald-500 text-emerald-500";
                        if (log.action === 'adjustment') actionColor = "bg-amber-500 text-amber-500";

                        return (
                          <div key={log.id} className="relative group animate-in fade-in duration-200">
                            {/* Dot on Timeline */}
                            <span className={cn(
                              "absolute -left-[31px] top-1.5 w-2 h-2 rounded-full ring-4 ring-white",
                              actionColor.split(' ')[0]
                            )} />

                            <div className="bg-slate-50 border border-slate-200/60 p-4 rounded-2xl hover:border-slate-300 hover:bg-slate-100/30 transition-all">
                              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 mb-2">
                                <div className="flex items-center gap-2">
                                  <span className={cn(
                                    "px-2 py-0.5 text-[8px] font-black uppercase tracking-widest rounded-md",
                                    log.action === 'close' ? "bg-red-50 text-red-700 border border-red-100" :
                                    log.action === 'open' ? "bg-emerald-50 text-emerald-700 border border-emerald-100" :
                                    log.action === 'adjustment' ? "bg-amber-50 text-amber-700 border border-amber-100" :
                                    "bg-blue-50 text-blue-700 border border-blue-100"
                                  )}>
                                    {log.action}
                                  </span>
                                  <span className="text-[10px] text-slate-500 font-bold uppercase">
                                    by <span className="font-mono text-slate-700">{log.performedBy}</span>
                                  </span>
                                </div>
                                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">
                                  {new Date(log.timestamp).toLocaleString()}
                                </span>
                              </div>

                              <p className="text-xs text-slate-700 font-medium leading-relaxed mb-2">{log.notes}</p>

                              {/* Changes Breakdown */}
                              {log.changes && (log.changes.before || log.changes.after) && (
                                <div className="mt-3 bg-white border border-slate-200/50 rounded-xl p-3 text-[10px] space-y-2">
                                  <span className="font-black text-[9px] text-slate-400 uppercase tracking-wider block border-b border-slate-100 pb-1">Modified Parameters</span>
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[10px] font-mono">
                                    {log.changes.before && Object.keys(log.changes.before).length > 0 && (
                                      <div className="bg-rose-50/50 p-2 rounded-lg border border-rose-100 text-rose-800">
                                        <span className="font-bold uppercase text-[8px] text-rose-500 block mb-1">Previous Values</span>
                                        <pre className="whitespace-pre-wrap font-sans text-[10px] font-semibold leading-normal">
                                          {JSON.stringify(log.changes.before, null, 2)}
                                        </pre>
                                      </div>
                                    )}
                                    {log.changes.after && Object.keys(log.changes.after).length > 0 && (
                                      <div className="bg-emerald-50/50 p-2 rounded-lg border border-emerald-100 text-emerald-800">
                                        <span className="font-bold uppercase text-[8px] text-emerald-500 block mb-1">Updated Values</span>
                                        <pre className="whitespace-pre-wrap font-sans text-[10px] font-semibold leading-normal">
                                          {JSON.stringify(log.changes.after, null, 2)}
                                        </pre>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            </div>
          ) : (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
              {/* Action Bar (Hidden on Print) */}
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-4 rounded-3xl border border-slate-200 shadow-sm print:hidden">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-blue-50 rounded-2xl text-blue-600 border border-blue-100 shadow-sm">
                    <TrendingUp className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-black text-slate-900 uppercase tracking-tight">Purchases & Expected Profits</h2>
                    <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest mt-0.5">Based on daily ticket purchases and sell prices</p>
                  </div>
                </div>
                <div className="flex items-center gap-2.5 w-full sm:w-auto">
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="flex-1 sm:flex-initial flex items-center justify-center gap-2 px-5 py-3 bg-slate-900 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-slate-800 transition-all shadow-lg"
                  >
                    <Printer className="w-4 h-4 text-slate-300" />
                    Print Report
                  </button>
                </div>
              </div>

              {/* Printable Page Replica */}
              <div className="bg-white border border-slate-300 rounded-[2.5rem] p-6 md:p-10 shadow-lg relative overflow-hidden print:border-none print:shadow-none print:p-0 print:m-0">
                
                {/* Header */}
                <div className="flex flex-row justify-between items-start border-b border-slate-300 pb-6 mb-8">
                  <div>
                    <h2 className="text-lg font-black text-slate-900 uppercase tracking-widest font-sans">Preferred Metals & Recycling</h2>
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">Daily Purchases & Expected Profits Report</p>
                  </div>
                  <div className="text-right">
                    <h2 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Date / Ledger Session</h2>
                    <div className="mt-1 text-slate-900 font-mono font-black text-sm bg-slate-50 border border-slate-200 px-4 py-2 rounded-xl">
                      {selectedSession.date}
                    </div>
                  </div>
                </div>

                {/* Summary KPI Cards */}
                <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
                  <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6 flex flex-col justify-between print:border-slate-300">
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Completed Tickets</span>
                    <h4 className="text-2xl font-mono font-black text-slate-800 mt-2">
                      {dailyPurchaseReportData.totalTickets}
                    </h4>
                  </div>

                  <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6 flex flex-col justify-between print:border-slate-300">
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Total Weight Purchased</span>
                    <h4 className="text-2xl font-mono font-black text-slate-800 mt-2">
                      {dailyPurchaseReportData.totalWeightOverall.toLocaleString(undefined, { maximumFractionDigits: 1 })} lbs
                    </h4>
                  </div>

                  <div className="bg-slate-50 border border-slate-200 rounded-2xl p-6 flex flex-col justify-between print:border-slate-300">
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Total Amount Paid</span>
                    <h4 className="text-2xl font-mono font-black text-red-600 mt-2">
                      ${dailyPurchaseReportData.totalPaidOverall.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </h4>
                  </div>

                  <div className="bg-blue-50/50 border border-blue-100 rounded-2xl p-6 flex flex-col justify-between print:border-blue-200">
                    <span className="text-[9px] font-black text-blue-500 uppercase tracking-widest">Expected Profits</span>
                    <h4 className="text-2xl font-mono font-black text-blue-700 mt-2">
                      ${dailyPurchaseReportData.totalExpectedProfitOverall.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </h4>
                  </div>
                </div>

                {/* Granular Table */}
                <div className="space-y-4">
                  <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">Material Breakdown</h3>
                  <div className="border border-slate-300 rounded-2xl overflow-hidden shadow-sm">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-950 text-white border-b border-slate-300">
                          <th className="px-4 py-3.5 text-[10px] font-black uppercase tracking-widest">Material Code & Name</th>
                          <th className="px-4 py-3.5 text-[10px] font-black uppercase tracking-widest text-center">Tickets</th>
                          <th className="px-4 py-3.5 text-[10px] font-black uppercase tracking-widest text-right">Qty Purchased</th>
                          <th className="px-4 py-3.5 text-[10px] font-black uppercase tracking-widest text-right">Avg Buy Rate</th>
                          <th className="px-4 py-3.5 text-[10px] font-black uppercase tracking-widest text-right">Total Paid</th>
                          <th className="px-4 py-3.5 text-[10px] font-black uppercase tracking-widest text-right">Active Sell Rate</th>
                          <th className="px-4 py-3.5 text-[10px] font-black uppercase tracking-widest text-right">Expected Sell Value</th>
                          <th className="px-4 py-3.5 text-[10px] font-black uppercase tracking-widest text-right bg-blue-900/10 text-blue-900">Expected Profit</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {dailyPurchaseReportData.items.length === 0 ? (
                          <tr>
                            <td colSpan={8} className="px-4 py-8 text-center text-slate-400 italic text-xs font-medium">
                              No material purchases recorded for this session.
                            </td>
                          </tr>
                        ) : (
                          dailyPurchaseReportData.items.map((item) => (
                            <tr key={item.materialId} className="hover:bg-slate-50/50">
                              <td className="px-4 py-3 text-xs font-bold text-slate-800">
                                <div className="flex flex-col">
                                  <span>{item.code} - {item.name}</span>
                                  <span className="text-[9px] text-slate-400 font-medium">{item.category}</span>
                                </div>
                              </td>
                              <td className="px-4 py-3 text-xs text-center font-bold text-slate-600">
                                {item.ticketCount}
                              </td>
                              <td className="px-4 py-3 text-xs text-right font-mono text-slate-700">
                                {item.totalWeight.toLocaleString(undefined, { maximumFractionDigits: 1 })} {item.unit}
                              </td>
                              <td className="px-4 py-3 text-xs text-right font-mono text-slate-600">
                                ${item.avgBuyPrice.toFixed(4)}/{item.unit}
                              </td>
                              <td className="px-4 py-3 text-xs text-right font-mono text-red-600 font-bold">
                                ${item.totalPaid.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                              </td>
                              <td className="px-4 py-3 text-xs text-right font-mono text-slate-600">
                                ${item.salePrice.toFixed(2)}/{item.unit}
                              </td>
                              <td className="px-4 py-3 text-xs text-right font-mono text-slate-700">
                                ${item.expectedSellValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                              </td>
                              <td className="px-4 py-3 text-xs text-right font-mono text-blue-700 font-black bg-blue-50/30">
                                ${item.expectedProfit.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                      <tfoot>
                        <tr className="bg-slate-100 font-bold border-t-2 border-slate-300">
                          <td className="px-4 py-4 text-xs font-black text-slate-900 uppercase">
                            Report Totals
                          </td>
                          <td className="px-4 py-4 text-xs text-center font-mono font-black text-slate-800">
                            {dailyPurchaseReportData.totalTickets}
                          </td>
                          <td className="px-4 py-4 text-xs text-right font-mono font-black text-slate-800">
                            {dailyPurchaseReportData.totalWeightOverall.toLocaleString(undefined, { maximumFractionDigits: 1 })} lbs
                          </td>
                          <td className="px-4 py-4 text-xs text-right">
                            {/* Empty */}
                          </td>
                          <td className="px-4 py-4 text-xs text-right font-mono font-black text-red-700">
                            ${dailyPurchaseReportData.totalPaidOverall.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </td>
                          <td className="px-4 py-4 text-xs text-right">
                            {/* Empty */}
                          </td>
                          <td className="px-4 py-4 text-xs text-right font-mono font-black text-slate-800">
                            ${(dailyPurchaseReportData.totalPaidOverall + dailyPurchaseReportData.totalExpectedProfitOverall).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </td>
                          <td className="px-4 py-4 text-xs text-right font-mono font-black text-blue-800 bg-blue-100/50">
                            ${dailyPurchaseReportData.totalExpectedProfitOverall.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>

                {/* Footer disclaimer / notes */}
                <div className="mt-8 pt-6 border-t border-slate-200 flex flex-col md:flex-row justify-between items-start md:items-center text-[10px] text-slate-400 font-bold uppercase tracking-widest gap-4">
                  <div>
                    Generated automatically from non-voided register tickets
                  </div>
                  <div>
                    Printed at: {new Date().toLocaleString()}
                  </div>
                </div>

              </div>
            </div>
          )}
          </div>
          )}
        </>
      )}

      {/* MODALS */}
      {/* Start Session Modal */}
      {showStartModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-50 overflow-y-auto flex items-start justify-center p-4 sm:p-6 md:p-10">
          <div className="bg-white rounded-[2.5rem] p-6 md:p-10 max-w-4xl w-full shadow-2xl animate-in zoom-in-95 duration-200 border border-slate-200 my-8 sm:my-12">
            <div className="space-y-2 mb-6">
              <h3 className="text-2xl font-black text-slate-900 uppercase tracking-tight">Open Ledger</h3>
              <p className="text-slate-500 font-medium text-xs uppercase tracking-widest">Combined Safe + Register Total</p>
            </div>

            {profile?.role === 'cashier' && (
              <div className="mb-6 p-5 bg-amber-50 border border-amber-200 rounded-[1.5rem] flex gap-3.5 items-start text-xs shadow-sm">
                <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <h4 className="font-black text-amber-900 uppercase tracking-tight text-[11px]">Cashier Account Disclaimer</h4>
                  <p className="text-amber-700 font-bold leading-relaxed">
                    You are initializing the daily opening cash as a Cashier. Once submitted, you will not have permission to modify or delete this opening count. Please verify all physical cash counts carefully. Any retroactive adjustments or corrections will require direct Manager approval and override PIN authentication.
                  </p>
                </div>
              </div>
            )}

            {mostRecentClosedSession && (
              <div className="mb-6 p-5 bg-amber-50/60 border border-amber-200/80 rounded-3xl flex items-center justify-between text-xs shadow-sm">
                <div>
                  <span className="font-bold text-slate-500 uppercase block tracking-wider text-[10px]">Previous Day Close ({mostRecentClosedSession.date})</span>
                  <span className="font-mono font-black text-amber-900 text-base">
                    ${mostRecentClosedSession.actualCash?.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (useOpeningDenoms) {
                      if (mostRecentClosedSession.closingDenominations) {
                        setOpeningDenoms(ensureDenomTotals(mostRecentClosedSession.closingDenominations));
                      } else {
                        // fallback if no denom breakdown was stored
                        setOpeningDenoms({
                          ...initialDenominations,
                          ones: mostRecentClosedSession.actualCash || 0
                        });
                      }
                    } else {
                      setQuickOpeningCash((mostRecentClosedSession.actualCash || 0).toFixed(2));
                    }
                  }}
                  className="px-4 py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-1.5 shadow-sm active:scale-95"
                >
                  <Copy className="w-3.5 h-3.5" />
                  Copy Closing Count
                </button>
              </div>
            )}

            {/* Segmented Control */}
            <div className="flex bg-slate-100 p-1 rounded-2xl mb-8">
              <button
                type="button"
                onClick={() => setUseOpeningDenoms(true)}
                className={cn(
                  "flex-1 py-3 text-xs font-black uppercase tracking-widest rounded-xl transition-all",
                  useOpeningDenoms ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
                )}
              >
                Count Denominations
              </button>
              <button
                type="button"
                onClick={() => setUseOpeningDenoms(false)}
                className={cn(
                  "flex-1 py-3 text-xs font-black uppercase tracking-widest rounded-xl transition-all",
                  !useOpeningDenoms ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
                )}
              >
                Quick Cash Input
              </button>
            </div>

            <form onSubmit={handleStartDay} className="space-y-6">
              {useOpeningDenoms ? (
                <div className="space-y-6">
                  <DenominationEditor values={openingDenoms} onChange={setOpeningDenoms} />
                  
                  <div className="p-6 bg-blue-50 border border-blue-100 rounded-3xl text-center space-y-1">
                    <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest">Calculated Starting Total</p>
                    <p className="text-3xl font-black text-blue-600 font-mono">
                      ${calculateDenomTotal(openingDenoms).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Starting Amount ($)</label>
                  <div className="relative">
                    <DollarSign className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
                    <input 
                      name="openingCash" 
                      type="number" 
                      step="0.01" 
                      required 
                      autoFocus
                      value={quickOpeningCash}
                      onChange={(e) => setQuickOpeningCash(e.target.value)}
                      className="w-full pl-14 pr-6 py-5 bg-slate-50 border border-slate-200 rounded-[1.5rem] text-xl font-mono font-black focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 outline-none transition-all"
                      placeholder="0.00"
                    />
                  </div>
                </div>
              )}

              <div className="flex gap-3 pt-4 border-t border-slate-100">
                <button type="button" onClick={() => setShowStartModal(false)} className="flex-1 px-8 py-5 text-slate-500 font-black text-xs uppercase tracking-widest hover:bg-slate-50 rounded-[1.5rem] transition-all">Cancel</button>
                <button disabled={processing} type="submit" className="flex-[2] px-8 py-5 bg-blue-600 text-white font-black text-xs uppercase tracking-widest rounded-[1.5rem] hover:bg-blue-700 shadow-xl shadow-blue-200 flex items-center justify-center gap-2">
                  {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Open Session
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Replenish (Inflow) Modal with 4-Step Submittal & Confirmation Sequence */}
      {showInflowModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-50 overflow-y-auto flex items-start justify-center p-4 sm:p-6 md:p-10">
          <div className="bg-white rounded-[2.5rem] p-6 sm:p-10 max-w-lg w-full shadow-2xl animate-in zoom-in-95 duration-200 border border-slate-200 my-8 sm:my-12">
            
            {/* Step 1: Input Details */}
            {inflowStep === 'form' && (
              <form onSubmit={handleProceedToInflowConfirm} className="space-y-6">
                <div className="flex items-center justify-between pb-4 border-b border-slate-100">
                  <div className="flex items-center gap-3">
                    <div className="p-3 bg-emerald-50 rounded-2xl text-emerald-600">
                      <ArrowUpCircle className="w-7 h-7" />
                    </div>
                    <div>
                      <h3 className="text-xl font-black text-slate-900 uppercase tracking-tight">Record Bank Run</h3>
                      <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest">Deposit / Cash Inflow to Drawer</p>
                    </div>
                  </div>
                  <button 
                    type="button" 
                    onClick={() => setShowInflowModal(false)}
                    className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-all"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Session Target Indicator */}
                <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200/80 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-slate-400" />
                    <span className="font-bold text-slate-600">Session: <strong className="text-slate-900">{selectedSession?.date || activeSession?.date || todayStr}</strong></span>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Current Cash</span>
                    <span className="font-mono font-black text-emerald-600">${expectedCash.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                </div>

                {/* Category Preset Selector */}
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Inflow Category</label>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { label: 'Bank Run', icon: Banknote },
                      { label: 'Bank Withdrawal', icon: DollarSign },
                      { label: 'Cash In', icon: ArrowUpCircle },
                      { label: 'Owner Inflow', icon: Users },
                      { label: 'Other', icon: Tag }
                    ].map(cat => {
                      const isSelected = inflowCategory === cat.label;
                      const Icon = cat.icon;
                      return (
                        <button
                          key={cat.label}
                          type="button"
                          onClick={() => setInflowCategory(cat.label)}
                          className={cn(
                            "flex items-center gap-2.5 px-3.5 py-3 rounded-xl border text-xs font-black uppercase tracking-wider transition-all text-left",
                            isSelected 
                              ? "bg-emerald-600 text-white border-emerald-600 shadow-md shadow-emerald-200" 
                              : "bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200"
                          )}
                        >
                          <Icon className={cn("w-4 h-4", isSelected ? "text-white" : "text-emerald-600")} />
                          <span className="truncate">{cat.label}</span>
                        </button>
                      );
                    })}
                  </div>

                  {inflowCategory === 'Other' && (
                    <div className="pt-2 animate-in fade-in-50 duration-200">
                      <input
                        type="text"
                        value={customInflowCategory}
                        onChange={(e) => setCustomInflowCategory(e.target.value)}
                        placeholder="Enter custom inflow category..."
                        required
                        className="w-full px-4 py-3 bg-slate-50 border border-emerald-300 rounded-xl text-xs font-bold text-slate-900 outline-none focus:ring-2 focus:ring-emerald-500/20"
                      />
                    </div>
                  )}
                </div>

                {/* Amount Input with Shortcuts */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Deposit Amount</label>
                    {inflowAmount && parseFloat(inflowAmount) > 0 && (
                      <span className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">
                        +${(parseFloat(inflowAmount) || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </span>
                    )}
                  </div>
                  <div className="relative">
                    <DollarSign className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-400 w-6 h-6" />
                    <input 
                      type="number" 
                      step="0.01" 
                      min="0.01"
                      required 
                      autoFocus
                      value={inflowAmount}
                      onChange={(e) => setInflowAmount(e.target.value)}
                      className="w-full pl-14 pr-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-2xl font-mono font-black focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500 outline-none transition-all"
                      placeholder="0.00"
                    />
                  </div>

                  {/* Quick Preset Buttons */}
                  <div className="flex items-center gap-1.5 pt-1 overflow-x-auto pb-1">
                    {[500, 1000, 2000, 5000, 10000].map(val => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => {
                          const curr = parseFloat(inflowAmount) || 0;
                          setInflowAmount((curr + val).toFixed(2));
                        }}
                        className="px-2.5 py-1 bg-slate-100 hover:bg-emerald-50 hover:text-emerald-700 border border-slate-200 rounded-lg text-[10px] font-mono font-bold text-slate-600 transition-all shrink-0"
                      >
                        +${val.toLocaleString()}
                      </button>
                    ))}
                    {inflowAmount && (
                      <button
                        type="button"
                        onClick={() => setInflowAmount('')}
                        className="px-2 py-1 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all shrink-0"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </div>

                {/* Source Bank / Origin */}
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Source / Bank Institution</label>
                  <input 
                    type="text"
                    value={inflowSource}
                    onChange={(e) => setInflowSource(e.target.value)}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:ring-2 focus:ring-slate-200 outline-none" 
                    placeholder="e.g. Fifth Third Bank (Vault Withdrawal), Chase Branch #10" 
                  />
                </div>

                {/* Internal Memo / Notes */}
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Memo / Internal Notes</label>
                  <input 
                    type="text"
                    value={inflowNotes}
                    onChange={(e) => setInflowNotes(e.target.value)}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:ring-2 focus:ring-slate-200 outline-none" 
                    placeholder="e.g. Mid-day cash replenishment for heavy commercial purchasing" 
                  />
                </div>

                {/* Live Balance Projection */}
                {parseFloat(inflowAmount) > 0 && (
                  <div className="p-4 bg-emerald-50/70 border border-emerald-200 rounded-2xl space-y-2 text-xs animate-in fade-in-50 duration-200">
                    <span className="text-[10px] font-black text-emerald-800 uppercase tracking-widest block">Projected Balance Impact</span>
                    <div className="flex items-center justify-between font-mono">
                      <span className="text-slate-600 font-bold">Current: ${expectedCash.toFixed(2)}</span>
                      <span className="text-emerald-700 font-black">+${parseFloat(inflowAmount).toFixed(2)}</span>
                      <span className="text-slate-900 font-black">Result: ${(expectedCash + parseFloat(inflowAmount)).toFixed(2)}</span>
                    </div>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex gap-3 pt-2">
                  <button 
                    type="button" 
                    onClick={() => setShowInflowModal(false)} 
                    className="flex-1 px-6 py-4 text-slate-500 font-bold uppercase text-xs tracking-widest hover:bg-slate-50 rounded-2xl transition-all"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit" 
                    className="flex-[2] bg-emerald-600 hover:bg-emerald-500 text-white px-6 py-4 rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl shadow-emerald-200 flex items-center justify-center gap-2 cursor-pointer transition-all active:scale-95"
                  >
                    <span>Review & Confirm</span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </form>
            )}

            {/* Step 2: Verification Confirmation */}
            {inflowStep === 'confirm' && (
              <div className="space-y-6">
                <div className="flex items-center gap-3 pb-4 border-b border-slate-100">
                  <div className="p-3 bg-emerald-50 rounded-2xl text-emerald-600">
                    <ShieldCheck className="w-7 h-7" />
                  </div>
                  <div>
                    <h3 className="text-xl font-black text-slate-900 uppercase tracking-tight">Confirm Bank Run Deposit</h3>
                    <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest">Verify details before writing to ledger</p>
                  </div>
                </div>

                {/* Big Verification Card */}
                <div className="p-6 bg-slate-900 text-white rounded-3xl space-y-5 shadow-xl">
                  <div className="text-center space-y-1">
                    <span className="text-[10px] font-black text-emerald-400 uppercase tracking-widest block">Deposit Amount</span>
                    <p className="font-mono text-3xl sm:text-4xl font-black text-emerald-400">
                      +${(parseFloat(inflowAmount) || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </p>
                  </div>

                  <div className="p-4 bg-slate-800/80 rounded-2xl space-y-2.5 text-xs">
                    <div className="flex justify-between items-center pb-2 border-b border-slate-700">
                      <span className="text-slate-400 font-bold uppercase text-[10px]">Category</span>
                      <span className="font-black text-white uppercase">{inflowCategory === 'Other' && customInflowCategory ? customInflowCategory : inflowCategory}</span>
                    </div>
                    {inflowSource && (
                      <div className="flex justify-between items-center pb-2 border-b border-slate-700">
                        <span className="text-slate-400 font-bold uppercase text-[10px]">Bank / Source</span>
                        <span className="font-medium text-slate-200 truncate max-w-[200px]">{inflowSource}</span>
                      </div>
                    )}
                    {inflowNotes && (
                      <div className="flex justify-between items-center pb-2 border-b border-slate-700">
                        <span className="text-slate-400 font-bold uppercase text-[10px]">Notes / Memo</span>
                        <span className="font-medium text-slate-200 truncate max-w-[200px]">{inflowNotes}</span>
                      </div>
                    )}
                    <div className="flex justify-between items-center pb-2 border-b border-slate-700">
                      <span className="text-slate-400 font-bold uppercase text-[10px]">Session Date</span>
                      <span className="font-bold text-slate-200">{selectedSession?.date || activeSession?.date || todayStr}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-400 font-bold uppercase text-[10px]">Recorded By</span>
                      <span className="font-bold text-slate-300 font-mono text-[11px]">{profile?.email}</span>
                    </div>
                  </div>

                  <div className="p-3.5 bg-emerald-950/40 border border-emerald-800/50 rounded-2xl flex items-center justify-between text-xs">
                    <span className="text-emerald-300 font-bold uppercase text-[10px]">Drawer Balance Impact</span>
                    <span className="font-mono font-bold text-emerald-400">
                      ${expectedCash.toFixed(2)} → ${(expectedCash + (parseFloat(inflowAmount) || 0)).toFixed(2)}
                    </span>
                  </div>
                </div>

                <div className="flex gap-3 pt-2">
                  <button 
                    type="button" 
                    onClick={() => setInflowStep('form')}
                    className="flex-1 px-6 py-4 text-slate-600 font-bold uppercase text-xs tracking-widest hover:bg-slate-100 rounded-2xl transition-all"
                  >
                    ← Edit Details
                  </button>
                  <button 
                    type="button"
                    onClick={handleExecuteInflowSubmit}
                    className="flex-[2] bg-emerald-600 hover:bg-emerald-500 text-white px-6 py-4 rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl shadow-emerald-200 flex items-center justify-center gap-2 cursor-pointer transition-all active:scale-95"
                  >
                    <Check className="w-4 h-4" />
                    <span>Confirm & Post Deposit</span>
                  </button>
                </div>
              </div>
            )}

            {/* Step 3: Submitting State */}
            {inflowStep === 'submitting' && (
              <div className="py-12 px-4 text-center space-y-6 animate-in fade-in-50 duration-200">
                <div className="w-20 h-20 bg-emerald-50 rounded-full flex items-center justify-center mx-auto text-emerald-600">
                  <Loader2 className="w-10 h-10 animate-spin" />
                </div>
                <div className="space-y-2">
                  <h3 className="text-2xl font-black text-slate-900 uppercase tracking-tight">Writing to Ledger...</h3>
                  <p className="text-slate-500 text-xs font-medium">{inflowSubmittalMsg || 'Synchronizing cash transactions...'}</p>
                </div>
                <div className="w-48 h-1.5 bg-slate-100 rounded-full mx-auto overflow-hidden">
                  <div className="h-full bg-emerald-500 rounded-full animate-pulse w-full" />
                </div>
              </div>
            )}

            {/* Step 4: Success Receipt */}
            {inflowStep === 'success' && confirmedInflowTx && (
              <div className="space-y-6 animate-in zoom-in-95 duration-200">
                <div className="text-center space-y-2">
                  <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-3 shadow-inner">
                    <CheckCircle2 className="w-10 h-10" />
                  </div>
                  <span className="px-3 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full text-[10px] font-black uppercase tracking-widest inline-block">
                    Deposit Logged Successfully
                  </span>
                  <h3 className="text-2xl font-black text-slate-900 uppercase tracking-tight">Posted to Cash Ledger</h3>
                  <p className="text-slate-500 text-xs">Transaction ID: <strong className="font-mono text-slate-700">#TX-{confirmedInflowTx.id.substring(0, 8).toUpperCase()}</strong></p>
                </div>

                {/* Receipt Breakdown */}
                <div className="p-5 bg-slate-50 rounded-2xl border border-slate-200 space-y-3 text-xs">
                  <div className="flex justify-between items-center pb-2 border-b border-slate-200">
                    <span className="text-slate-500 font-bold uppercase text-[10px]">Category</span>
                    <span className="font-black text-slate-900 uppercase">{confirmedInflowTx.category}</span>
                  </div>
                  <div className="flex justify-between items-center pb-2 border-b border-slate-200">
                    <span className="text-slate-500 font-bold uppercase text-[10px]">Deposit Amount</span>
                    <span className="font-mono font-black text-emerald-600 text-base">+${confirmedInflowTx.amount.toFixed(2)}</span>
                  </div>
                  {confirmedInflowTx.notes && (
                    <div className="flex justify-between items-center pb-2 border-b border-slate-200">
                      <span className="text-slate-500 font-bold uppercase text-[10px]">Source & Notes</span>
                      <span className="font-medium text-slate-700 text-right truncate max-w-[200px]">{confirmedInflowTx.notes}</span>
                    </div>
                  )}
                  <div className="flex justify-between items-center pt-1">
                    <span className="text-slate-500 font-bold uppercase text-[10px]">Updated Cash Drawer Balance</span>
                    <span className="font-mono font-black text-slate-900 text-sm">${confirmedInflowTx.newBalance.toFixed(2)}</span>
                  </div>
                </div>

                {/* Finish / Record Another Actions */}
                <div className="space-y-2.5 pt-2">
                  <button
                    type="button"
                    onClick={() => handleFinishInflow(confirmedInflowTx.id)}
                    className="w-full bg-slate-900 hover:bg-slate-800 text-white px-6 py-4 rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl flex items-center justify-center gap-2 cursor-pointer transition-all active:scale-95"
                  >
                    <Check className="w-4 h-4 text-emerald-400" />
                    <span>Done & View on Ledger</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleResetForAnotherInflow}
                    className="w-full bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 px-6 py-3 rounded-2xl font-bold text-xs uppercase tracking-widest transition-all"
                  >
                    + Record Another Deposit
                  </button>
                </div>
              </div>
            )}

          </div>
        </div>
      )}

      {/* Expense Modal with 4-Step Submittal & Confirmation Sequence */}
      {showExpenseModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-50 overflow-y-auto flex items-start justify-center p-4 sm:p-6 md:p-10">
          <div className="bg-white rounded-[2.5rem] p-6 sm:p-10 max-w-lg w-full shadow-2xl animate-in zoom-in-95 duration-200 border border-slate-200 my-8 sm:my-12">
            
            {/* Step 1: Expense Input Form */}
            {expenseStep === 'form' && (
              <form onSubmit={handleProceedToExpenseConfirm} className="space-y-6">
                <div className="flex items-center justify-between pb-4 border-b border-slate-100">
                  <div className="flex items-center gap-3">
                    <div className="p-3 bg-red-50 rounded-2xl text-red-600">
                      <ArrowDownCircle className="w-7 h-7" />
                    </div>
                    <div>
                      <h3 className="text-xl font-black text-slate-900 uppercase tracking-tight">Record Expense</h3>
                      <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest">Non-Material Outflow from Cash Drawer</p>
                    </div>
                  </div>
                  <button 
                    type="button" 
                    onClick={() => setShowExpenseModal(false)}
                    className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-all"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Session Target Indicator */}
                <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200/80 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-slate-400" />
                    <span className="font-bold text-slate-600">Session: <strong className="text-slate-900">{selectedSession?.date || activeSession?.date || todayStr}</strong></span>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Available Cash</span>
                    <span className="font-mono font-black text-slate-900">${expectedCash.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  </div>
                </div>

                {/* Category Preset Selector */}
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Expense Category</label>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { label: 'Fuel', icon: Fuel },
                      { label: 'Vendor Payout', icon: Truck },
                      { label: 'Yard Supplies', icon: ShoppingCart },
                      { label: 'Equipment Repair', icon: Wrench },
                      { label: 'Employee Advance', icon: Users },
                      { label: 'Hauling & Freight', icon: Truck },
                      { label: 'Utilities & Operations', icon: Zap },
                      { label: 'Other', icon: Tag }
                    ].map(cat => {
                      const isSelected = expenseCategory === cat.label;
                      const Icon = cat.icon;
                      return (
                        <button
                          key={cat.label}
                          type="button"
                          onClick={() => setExpenseCategory(cat.label)}
                          className={cn(
                            "flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-xs font-black uppercase tracking-wider transition-all text-left",
                            isSelected 
                              ? "bg-red-600 text-white border-red-600 shadow-md shadow-red-200" 
                              : "bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200"
                          )}
                        >
                          <Icon className={cn("w-3.5 h-3.5", isSelected ? "text-white" : "text-red-600")} />
                          <span className="truncate">{cat.label}</span>
                        </button>
                      );
                    })}
                  </div>

                  {expenseCategory === 'Other' && (
                    <div className="pt-2 animate-in fade-in-50 duration-200">
                      <input
                        type="text"
                        value={customCategory}
                        onChange={(e) => setCustomCategory(e.target.value)}
                        placeholder="Enter custom expense category..."
                        required
                        className="w-full px-4 py-3 bg-slate-50 border border-red-300 rounded-xl text-xs font-bold text-slate-900 outline-none focus:ring-2 focus:ring-red-500/20"
                      />
                    </div>
                  )}
                </div>

                {/* Amount Input with Shortcuts */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Expense Amount</label>
                    {expenseAmount && parseFloat(expenseAmount) > 0 && (
                      <span className="text-[10px] font-black text-red-600 uppercase tracking-widest">
                        -${(parseFloat(expenseAmount) || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </span>
                    )}
                  </div>
                  <div className="relative">
                    <DollarSign className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-400 w-6 h-6" />
                    <input 
                      type="number" 
                      step="0.01" 
                      min="0.01"
                      required 
                      autoFocus
                      value={expenseAmount}
                      onChange={(e) => setExpenseAmount(e.target.value)}
                      className="w-full pl-14 pr-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-2xl font-mono font-black focus:ring-4 focus:ring-red-500/10 focus:border-red-500 outline-none transition-all"
                      placeholder="0.00"
                    />
                  </div>

                  {/* Quick Preset Buttons */}
                  <div className="flex items-center gap-1.5 pt-1 overflow-x-auto pb-1">
                    {[20, 50, 100, 250, 500].map(val => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => {
                          const curr = parseFloat(expenseAmount) || 0;
                          setExpenseAmount((curr + val).toFixed(2));
                        }}
                        className="px-2.5 py-1 bg-slate-100 hover:bg-red-50 hover:text-red-700 border border-slate-200 rounded-lg text-[10px] font-mono font-bold text-slate-600 transition-all shrink-0"
                      >
                        +${val}
                      </button>
                    ))}
                    {expenseAmount && (
                      <button
                        type="button"
                        onClick={() => setExpenseAmount('')}
                        className="px-2 py-1 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all shrink-0"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </div>

                {/* Payee / Vendor Recipient */}
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Payee / Vendor / Recipient</label>
                  <input 
                    type="text"
                    value={expensePayee}
                    onChange={(e) => setExpensePayee(e.target.value)}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:ring-2 focus:ring-slate-200 outline-none" 
                    placeholder="e.g. Pilot Flying J #402, NAPA Auto Parts, Fastenal, John Doe" 
                  />
                </div>

                {/* Internal Memo / Notes */}
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Internal Notes / Memo / Receipt #</label>
                  <input 
                    type="text"
                    value={expenseNotes}
                    onChange={(e) => setExpenseNotes(e.target.value)}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:ring-2 focus:ring-slate-200 outline-none" 
                    placeholder="e.g. 50 Gal Off-road diesel for yard loader (Receipt #8392)" 
                  />
                </div>

                {/* Live Balance Projection */}
                {parseFloat(expenseAmount) > 0 && (
                  <div className="p-4 bg-red-50/70 border border-red-200 rounded-2xl space-y-2 text-xs animate-in fade-in-50 duration-200">
                    <span className="text-[10px] font-black text-red-800 uppercase tracking-widest block">Projected Balance Impact</span>
                    <div className="flex items-center justify-between font-mono">
                      <span className="text-slate-600 font-bold">Current: ${expectedCash.toFixed(2)}</span>
                      <span className="text-red-700 font-black">-${parseFloat(expenseAmount).toFixed(2)}</span>
                      <span className="text-slate-900 font-black">Result: ${Math.max(0, expectedCash - parseFloat(expenseAmount)).toFixed(2)}</span>
                    </div>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex gap-3 pt-2">
                  <button 
                    type="button" 
                    onClick={() => setShowExpenseModal(false)} 
                    className="flex-1 px-6 py-4 text-slate-500 font-bold uppercase text-xs tracking-widest hover:bg-slate-50 rounded-2xl transition-all"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit" 
                    className="flex-[2] bg-red-600 hover:bg-red-500 text-white px-6 py-4 rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl shadow-red-200 flex items-center justify-center gap-2 cursor-pointer transition-all active:scale-95"
                  >
                    <span>Review & Confirm</span>
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </form>
            )}

            {/* Step 2: Verification Confirmation */}
            {expenseStep === 'confirm' && (
              <div className="space-y-6">
                <div className="flex items-center gap-3 pb-4 border-b border-slate-100">
                  <div className="p-3 bg-red-50 rounded-2xl text-red-600">
                    <ShieldCheck className="w-7 h-7" />
                  </div>
                  <div>
                    <h3 className="text-xl font-black text-slate-900 uppercase tracking-tight">Confirm Expense Outlay</h3>
                    <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest">Verify details before writing to ledger</p>
                  </div>
                </div>

                {/* Big Verification Card */}
                <div className="p-6 bg-slate-900 text-white rounded-3xl space-y-5 shadow-xl">
                  <div className="text-center space-y-1">
                    <span className="text-[10px] font-black text-red-400 uppercase tracking-widest block">Payout Amount</span>
                    <p className="font-mono text-3xl sm:text-4xl font-black text-red-400">
                      -${(parseFloat(expenseAmount) || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </p>
                  </div>

                  <div className="p-4 bg-slate-800/80 rounded-2xl space-y-2.5 text-xs">
                    <div className="flex justify-between items-center pb-2 border-b border-slate-700">
                      <span className="text-slate-400 font-bold uppercase text-[10px]">Category</span>
                      <span className="font-black text-white uppercase">{expenseCategory === 'Other' && customCategory ? customCategory : expenseCategory}</span>
                    </div>
                    {expensePayee && (
                      <div className="flex justify-between items-center pb-2 border-b border-slate-700">
                        <span className="text-slate-400 font-bold uppercase text-[10px]">Payee / Vendor</span>
                        <span className="font-medium text-slate-200 truncate max-w-[200px]">{expensePayee}</span>
                      </div>
                    )}
                    {expenseNotes && (
                      <div className="flex justify-between items-center pb-2 border-b border-slate-700">
                        <span className="text-slate-400 font-bold uppercase text-[10px]">Notes / Memo</span>
                        <span className="font-medium text-slate-200 truncate max-w-[200px]">{expenseNotes}</span>
                      </div>
                    )}
                    <div className="flex justify-between items-center pb-2 border-b border-slate-700">
                      <span className="text-slate-400 font-bold uppercase text-[10px]">Session Date</span>
                      <span className="font-bold text-slate-200">{selectedSession?.date || activeSession?.date || todayStr}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-slate-400 font-bold uppercase text-[10px]">Recorded By</span>
                      <span className="font-bold text-slate-300 font-mono text-[11px]">{profile?.email}</span>
                    </div>
                  </div>

                  <div className="p-3.5 bg-red-950/40 border border-red-800/50 rounded-2xl flex items-center justify-between text-xs">
                    <span className="text-red-300 font-bold uppercase text-[10px]">Drawer Balance Impact</span>
                    <span className="font-mono font-bold text-red-400">
                      ${expectedCash.toFixed(2)} → ${Math.max(0, expectedCash - (parseFloat(expenseAmount) || 0)).toFixed(2)}
                    </span>
                  </div>
                </div>

                <div className="flex gap-3 pt-2">
                  <button 
                    type="button" 
                    onClick={() => setExpenseStep('form')}
                    className="flex-1 px-6 py-4 text-slate-600 font-bold uppercase text-xs tracking-widest hover:bg-slate-100 rounded-2xl transition-all"
                  >
                    ← Edit Details
                  </button>
                  <button 
                    type="button"
                    onClick={handleExecuteExpenseSubmit}
                    className="flex-[2] bg-red-600 hover:bg-red-500 text-white px-6 py-4 rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl shadow-red-200 flex items-center justify-center gap-2 cursor-pointer transition-all active:scale-95"
                  >
                    <Check className="w-4 h-4" />
                    <span>Confirm & Post Expense</span>
                  </button>
                </div>
              </div>
            )}

            {/* Step 3: Submitting State */}
            {expenseStep === 'submitting' && (
              <div className="py-12 px-4 text-center space-y-6 animate-in fade-in-50 duration-200">
                <div className="w-20 h-20 bg-red-50 rounded-full flex items-center justify-center mx-auto text-red-600">
                  <Loader2 className="w-10 h-10 animate-spin" />
                </div>
                <div className="space-y-2">
                  <h3 className="text-2xl font-black text-slate-900 uppercase tracking-tight">Writing to Ledger...</h3>
                  <p className="text-slate-500 text-xs font-medium">{expenseSubmittalMsg || 'Synchronizing cash transactions...'}</p>
                </div>
                <div className="w-48 h-1.5 bg-slate-100 rounded-full mx-auto overflow-hidden">
                  <div className="h-full bg-red-500 rounded-full animate-pulse w-full" />
                </div>
              </div>
            )}

            {/* Step 4: Success Receipt */}
            {expenseStep === 'success' && confirmedExpenseTx && (
              <div className="space-y-6 animate-in zoom-in-95 duration-200">
                <div className="text-center space-y-2">
                  <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-3 shadow-inner">
                    <CheckCircle2 className="w-10 h-10" />
                  </div>
                  <span className="px-3 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full text-[10px] font-black uppercase tracking-widest inline-block">
                    Expense Logged Successfully
                  </span>
                  <h3 className="text-2xl font-black text-slate-900 uppercase tracking-tight">Posted to Cash Ledger</h3>
                  <p className="text-slate-500 text-xs">Transaction ID: <strong className="font-mono text-slate-700">#TX-{confirmedExpenseTx.id.substring(0, 8).toUpperCase()}</strong></p>
                </div>

                {/* Receipt Breakdown */}
                <div className="p-5 bg-slate-50 rounded-2xl border border-slate-200 space-y-3 text-xs">
                  <div className="flex justify-between items-center pb-2 border-b border-slate-200">
                    <span className="text-slate-500 font-bold uppercase text-[10px]">Category</span>
                    <span className="font-black text-slate-900 uppercase">{confirmedExpenseTx.category}</span>
                  </div>
                  <div className="flex justify-between items-center pb-2 border-b border-slate-200">
                    <span className="text-slate-500 font-bold uppercase text-[10px]">Expense Amount</span>
                    <span className="font-mono font-black text-red-600 text-base">-${confirmedExpenseTx.amount.toFixed(2)}</span>
                  </div>
                  {confirmedExpenseTx.notes && (
                    <div className="flex justify-between items-center pb-2 border-b border-slate-200">
                      <span className="text-slate-500 font-bold uppercase text-[10px]">Payee & Notes</span>
                      <span className="font-medium text-slate-700 text-right truncate max-w-[200px]">{confirmedExpenseTx.notes}</span>
                    </div>
                  )}
                  <div className="flex justify-between items-center pt-1">
                    <span className="text-slate-500 font-bold uppercase text-[10px]">Updated Cash Drawer Balance</span>
                    <span className="font-mono font-black text-slate-900 text-sm">${confirmedExpenseTx.newBalance.toFixed(2)}</span>
                  </div>
                </div>

                {/* Finish / Record Another Actions */}
                <div className="space-y-2.5 pt-2">
                  <button
                    type="button"
                    onClick={() => handleFinishExpense(confirmedExpenseTx.id)}
                    className="w-full bg-slate-900 hover:bg-slate-800 text-white px-6 py-4 rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl flex items-center justify-center gap-2 cursor-pointer transition-all active:scale-95"
                  >
                    <Check className="w-4 h-4 text-emerald-400" />
                    <span>Done & View on Ledger</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleResetForAnotherExpense}
                    className="w-full bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 px-6 py-3 rounded-2xl font-bold text-xs uppercase tracking-widest transition-all"
                  >
                    + Record Another Expense
                  </button>
                </div>
              </div>
            )}

          </div>
        </div>
      )}

      
      {/* Edit Transaction Modal */}
      {editingTransaction && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-50 overflow-y-auto flex items-start justify-center p-4 sm:p-6 md:p-10">
          <div className="bg-white rounded-[2.5rem] p-10 max-w-md w-full shadow-2xl animate-in zoom-in-95 duration-200 border border-slate-200 my-8 sm:my-12">
            <div className="flex items-center gap-4 mb-8">
              <div className={editingTransaction.type === 'inflow' ? "p-4 bg-emerald-50 rounded-3xl text-emerald-600" : "p-4 bg-red-50 rounded-3xl text-red-600"}>
                {editingTransaction.type === 'inflow' ? <ArrowUpCircle className="w-8 h-8" /> : <ArrowDownCircle className="w-8 h-8" />}
              </div>
              <div className="space-y-1">
                <h3 className="text-2xl font-black text-slate-900 uppercase tracking-tight">Edit {editingTransaction.type === 'inflow' ? 'Inflow' : 'Expense'}</h3>
                <p className="text-slate-500 text-xs font-black uppercase tracking-widest">Update Transaction</p>
              </div>
            </div>

            <form onSubmit={handleEditTransaction} className="space-y-6">
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Category</label>
                  <select 
                    name="category" 
                    defaultValue={editingTransaction.category}
                    required 
                    className="w-full px-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl font-black text-xs uppercase tracking-widest outline-none focus:ring-2 focus:ring-slate-200"
                  >
                    {editingTransaction.type === 'inflow' ? (
                      <>
                        <option value="Bank Withdrawal">Bank Withdrawal</option>
                        <option value="Bank Run">Bank Run</option>
                        <option value="Cash In">Cash In</option>
                        <option value="Other Inflow">Other Inflow</option>
                      </>
                    ) : (
                      <>
                        <option value="Fuel">Fuel</option>
                        <option value="Vendor Payout">Vendor Payout</option>
                        <option value="Supplies">Supplies</option>
                        <option value="Employee Advance">Employee Advance</option>
                        <option value="Other">Other</option>
                      </>
                    )}
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Amount</label>
                  <div className="relative">
                    <DollarSign className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
                    <input 
                      name="amount" 
                      type="number" 
                      step="0.01" 
                      defaultValue={editingTransaction.amount}
                      required 
                      className="w-full pl-14 pr-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-lg font-mono font-black outline-none focus:ring-4 focus:ring-blue-500/10" 
                      placeholder="0.00" 
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Notes</label>
                  <input 
                    name="notes" 
                    defaultValue={editingTransaction.notes}
                    className="w-full px-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-slate-200" 
                    placeholder="Optional notes" 
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <button type="button" onClick={() => setEditingTransaction(null)} className="flex-1 px-8 py-4 text-slate-500 font-bold uppercase text-xs tracking-widest">Cancel</button>
                <button disabled={processing} type="submit" className="flex-[2] bg-blue-600 text-white px-8 py-4 rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl shadow-blue-200">Save Changes</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Finalize/Close Modal */}
      {showCloseModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-50 overflow-y-auto flex items-start justify-center p-4 sm:p-6 md:p-10">
          <div className="bg-white rounded-[2.5rem] p-6 md:p-10 max-w-4xl w-full shadow-2xl animate-in zoom-in-95 duration-200 border border-slate-200 my-8 sm:my-12">
            <div className="space-y-2 mb-8 text-center">
              <h3 className="text-3xl font-black text-slate-900 uppercase tracking-tight font-display">Daily Closing Audit</h3>
              <p className="text-slate-500 text-xs font-black uppercase tracking-widest">Final Step to Secure the Books</p>
            </div>

            {profile?.role === 'cashier' && (
              <div className="mb-8 p-5 bg-amber-50 border border-amber-200 rounded-[1.5rem] flex gap-3.5 items-start text-xs shadow-sm">
                <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="space-y-1 text-left">
                  <h4 className="font-black text-amber-900 uppercase tracking-tight text-[11px]">Cashier Account Disclaimer</h4>
                  <p className="text-amber-700 font-bold leading-relaxed">
                    You are entering closing manual cash counts as a Cashier. Once finalized, you will not have permission to edit, modify, or reopen this closed session. Please verify all physical coins and bills carefully. Any retroactive corrections will require manager approval and override PIN authentication.
                  </p>
                </div>
              </div>
            )}
            
            <div className="grid grid-cols-2 gap-6 mb-8">
              <div className="p-6 bg-slate-50 rounded-3xl border border-slate-100 text-center">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Calculated Balance</p>
                <p className="text-2xl font-black text-slate-900 font-mono">${expectedCash.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
              </div>
              <div className="p-6 bg-blue-50 rounded-3xl border border-blue-100 text-center">
                <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest mb-2">Payout Count</p>
                <p className="text-2xl font-black text-blue-600 font-mono">{buyTickets.length} Tickets</p>
              </div>
            </div>

            {/* Segmented Control */}
            <div className="flex bg-slate-100 p-1 rounded-2xl mb-8">
              <button
                type="button"
                onClick={() => setUseClosingDenoms(true)}
                className={cn(
                  "flex-1 py-3 text-xs font-black uppercase tracking-widest rounded-xl transition-all",
                  useClosingDenoms ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
                )}
              >
                Count Denominations
              </button>
              <button
                type="button"
                onClick={() => setUseClosingDenoms(false)}
                className={cn(
                  "flex-1 py-3 text-xs font-black uppercase tracking-widest rounded-xl transition-all",
                  !useClosingDenoms ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
                )}
              >
                Quick Cash Input
              </button>
            </div>

            <form onSubmit={handleCloseDay} className="space-y-8">
              {useClosingDenoms ? (
                <div className="space-y-6">
                  <DenominationEditor values={closingDenoms} onChange={setClosingDenoms} />
                  
                  {/* Live Reconcile Display */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-6 bg-blue-50 border border-blue-100 rounded-3xl text-center space-y-1">
                      <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest">Calculated Actual Count</p>
                      <p className="text-2xl font-black text-blue-600 font-mono">
                        ${calculateDenomTotal(closingDenoms).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </p>
                    </div>
                    {(() => {
                      const calculatedActual = calculateDenomTotal(closingDenoms);
                      const diff = calculatedActual - expectedCash;
                      const status = getShortageStatus(diff, buyTickets.length);
                      
                      let bgClass = "bg-slate-50 border-slate-100 text-slate-400";
                      if (diff > 0) bgClass = "bg-emerald-50 border-emerald-100 text-emerald-600";
                      else if (diff < 0) {
                        if (status.isTolerance) {
                          bgClass = "bg-amber-50 border-amber-200 text-amber-600";
                        } else {
                          bgClass = "bg-red-50 border-red-100 text-red-600";
                        }
                      }
                      
                      return (
                        <div className={cn("p-6 border rounded-3xl text-center space-y-1", bgClass)}>
                          <p className="text-[10px] font-black uppercase tracking-widest">
                            {status.isTolerance ? "Penny Rounding Tolerance" : "Live Over/Short"}
                          </p>
                          <p className="text-2xl font-black font-mono">
                            {diff >= 0 ? '+' : ''}{diff.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </p>
                          {status.isTolerance && (
                            <p className="text-[9px] font-bold text-amber-600 uppercase tracking-wide mt-1">
                              Normal shortage due to penny rounding ({buyTickets.length} tickets)
                            </p>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Actual Physical Count (Cash on Hand)</label>
                  <div className="relative">
                    <DollarSign className="absolute left-8 top-1/2 -translate-y-1/2 text-blue-600 w-6 h-6" />
                    <input 
                      name="actualCash" 
                      type="number" 
                      step="0.01" 
                      required 
                      autoFocus
                      className="w-full pl-16 pr-8 py-6 bg-blue-50 border-2 border-blue-100 rounded-[2rem] text-3xl font-mono font-black focus:ring-8 focus:ring-blue-500/10 focus:border-blue-500 outline-none transition-all text-blue-900" 
                      placeholder="0.00" 
                    />
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Final Reconciliation Notes</label>
                <textarea 
                  name="notes" 
                  rows={2}
                  className="w-full px-6 py-4 bg-slate-50 border border-slate-200 rounded-3xl text-sm font-medium outline-none focus:ring-2 focus:ring-slate-200 resize-none" 
                  placeholder="Any discrepancies to note for the audit?" 
                />
              </div>
              
              <div className="flex gap-4 pt-4 border-t border-slate-100">
                <button type="button" onClick={() => setShowCloseModal(false)} className="flex-1 py-5 text-slate-500 font-black text-xs uppercase tracking-widest hover:bg-slate-50 rounded-[1.5rem]">Keep Open</button>
                <button disabled={processing} type="submit" className="flex-[2] bg-slate-900 text-white py-5 rounded-[1.5rem] font-black text-xs uppercase tracking-widest shadow-2xl shadow-slate-900/40 hover:-translate-y-1 transition-all">Submit & Close Day</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Opening Cash Modal */}
      {showEditOpeningModal && selectedSession && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-50 overflow-y-auto flex items-start justify-center p-4 sm:p-6 md:p-10">
          <div className="bg-white rounded-[2.5rem] p-10 max-w-md w-full shadow-2xl animate-in zoom-in-95 duration-200 border border-slate-200 my-8 sm:my-12">
            <div className="space-y-2 mb-8">
              <h3 className="text-2xl font-black text-slate-900 uppercase tracking-tight">Edit Opening Balance</h3>
              <p className="text-slate-500 font-medium text-xs uppercase tracking-widest">
                Update initial cash for {selectedSession.id === activeSession?.id ? "today's session" : `session on ${selectedSession.date}`}
              </p>
            </div>
            <form onSubmit={handleUpdateOpeningCash} className="space-y-6">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Correct Opening Amount ($)</label>
                <div className="relative">
                  <DollarSign className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
                  <input 
                    name="openingCash" 
                    type="number" 
                    step="0.01" 
                    required 
                    defaultValue={selectedSession.openingCash}
                    autoFocus
                    className="w-full pl-14 pr-6 py-5 bg-slate-50 border border-slate-200 rounded-[1.5rem] text-xl font-mono font-black focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 outline-none transition-all"
                    placeholder="0.00"
                  />
                </div>
              </div>
              <div className="flex gap-3">
                <button type="button" onClick={() => setShowEditOpeningModal(false)} className="flex-1 px-8 py-5 text-slate-500 font-black text-xs uppercase tracking-widest hover:bg-slate-50 rounded-[1.5rem] transition-all">Cancel</button>
                <button disabled={processing} type="submit" className="flex-[2] px-8 py-5 bg-slate-900 text-white font-black text-xs uppercase tracking-widest rounded-[1.5rem] hover:bg-slate-800 transition-all shadow-xl flex items-center justify-center gap-2">
                  {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Update Balance
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Viewing Denominations Modal */}
      {viewingDenoms && (() => {
        const normalizedDenoms = ensureDenomTotals(viewingDenoms.denoms);
        return (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-50 overflow-y-auto flex items-start justify-center p-4 sm:p-6 md:p-10">
            <div className="bg-white rounded-[2.5rem] p-6 md:p-10 max-w-3xl w-full shadow-2xl animate-in zoom-in-95 duration-200 border border-slate-200 my-8 sm:my-12">
              <div className="space-y-2 mb-8">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <h3 className="text-2xl font-black text-slate-900 uppercase tracking-tight">{viewingDenoms.title}</h3>
                  {viewingDenoms.closedBy && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-slate-100 text-slate-700 rounded-full text-xs font-bold border border-slate-200 shrink-0">
                      <span className="text-slate-400 font-medium uppercase tracking-wider text-[10px]">Closed By:</span> {viewingDenoms.closedBy}
                    </span>
                  )}
                </div>
                <p className="text-slate-500 font-medium text-xs uppercase tracking-widest">Saved Denomination Totals</p>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-h-[60vh] overflow-y-auto pr-2">
                <div className="space-y-3">
                  <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 pb-2">Paper Bills</h4>
                  <div className="space-y-1">
                    {denominationsList.filter(d => !d.isCoin).map(denom => {
                      const totalVal = normalizedDenoms[denom.key] || 0;
                      return (
                        <div key={denom.key} className="flex justify-between py-2 border-b border-slate-50 text-xs">
                          <span className="text-slate-500 font-medium">{denom.label}</span>
                          <div className="font-mono text-right">
                            <span className="font-black text-slate-900">${Math.round(totalVal).toLocaleString()}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-3">
                  <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 pb-2">Coins / Change</h4>
                  <div className="space-y-1">
                    {denominationsList.filter(d => d.isCoin).map(denom => {
                      const totalVal = normalizedDenoms[denom.key] || 0;
                      return (
                        <div key={denom.key} className="flex justify-between py-2 border-b border-slate-50 text-xs">
                          <span className="text-slate-500 font-medium">{denom.label}</span>
                          <div className="font-mono text-right">
                            <span className="font-black text-slate-900">${totalVal.toFixed(2)}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="p-6 bg-slate-50 border border-slate-100 rounded-3xl text-center space-y-1 mt-8 mb-6">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total Value</p>
                <p className="text-3xl font-black text-slate-900 font-mono">
                  ${calculateDenomTotal(normalizedDenoms).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </p>
              </div>

              <div className="flex justify-end">
                <button 
                  type="button" 
                  onClick={() => setViewingDenoms(null)} 
                  className="px-8 py-4 bg-slate-900 text-white rounded-[1.5rem] font-black text-xs uppercase tracking-widest hover:bg-slate-800 transition-all shadow-xl"
                >
                  Close View
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Retroactive Session Resolution Modal */}
      {showRetroactiveModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-50 overflow-y-auto flex items-start justify-center p-4 sm:p-6 md:p-10">
          <div className="bg-white rounded-[2.5rem] p-6 md:p-10 max-w-4xl w-full shadow-2xl animate-in zoom-in-95 duration-200 border border-slate-200 my-8 sm:my-12">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-6">
              <div>
                <h3 className="text-2xl font-black text-slate-900 uppercase tracking-tight">Resolve Gap Day Retroactively</h3>
                <p className="text-slate-500 font-medium text-xs uppercase tracking-widest">Create retroactive open/close session for {retroactiveDate}</p>
              </div>
              <button 
                type="button" 
                onClick={() => setShowRetroactiveModal(false)}
                className="text-slate-400 hover:text-slate-600 font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateRetroactiveSession} className="space-y-6">
              {/* Date & Status selection */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-400 tracking-wider mb-2">Target Date</label>
                  <input
                    type="date"
                    required
                    disabled={!isManualRetro}
                    value={retroactiveDate}
                    onChange={(e) => setRetroactiveDate(e.target.value)}
                    className="w-full px-5 py-3.5 bg-slate-50 border border-slate-200 rounded-xl font-mono text-sm font-bold text-slate-800 outline-none focus:bg-white disabled:opacity-75 focus:ring-2 focus:ring-amber-500/20"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-400 tracking-wider mb-2">Desired Session Status</label>
                  <select
                    value={retroStatus}
                    onChange={(e) => setRetroStatus(e.target.value as 'open' | 'closed')}
                    className="w-full px-5 py-3.5 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500/20"
                  >
                    <option value="closed">Closed & Audited (Recommended for historical data)</option>
                    <option value="open">Opened (Leave open for active transactions)</option>
                  </select>
                </div>
              </div>

              {/* Opening Cash Input Container */}
              <div className="bg-slate-50 rounded-3xl p-6 border border-slate-200 space-y-4">
                <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3">
                  <div>
                    <h4 className="text-sm font-black text-slate-800 uppercase tracking-tight">Opening Cash Balance</h4>
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Beginning cash amount for this session</p>
                  </div>
                  <div className="flex bg-slate-200/60 p-1 rounded-xl text-[10px] font-bold">
                    <button
                      type="button"
                      onClick={() => setUseRetroOpeningDenoms(true)}
                      className={cn("px-3 py-1.5 rounded-lg transition-all", useRetroOpeningDenoms ? "bg-white text-slate-900 shadow-sm" : "text-slate-500")}
                    >
                      Denominations
                    </button>
                    <button
                      type="button"
                      onClick={() => setUseRetroOpeningDenoms(false)}
                      className={cn("px-3 py-1.5 rounded-lg transition-all", !useRetroOpeningDenoms ? "bg-white text-slate-900 shadow-sm" : "text-slate-500")}
                    >
                      Quick Cash
                    </button>
                  </div>
                </div>

                {useRetroOpeningDenoms ? (
                  <div className="space-y-6">
                    <DenominationEditor values={retroOpeningDenoms} onChange={setRetroOpeningDenoms} />
                    <div className="p-4 bg-slate-900 text-white rounded-3xl text-center space-y-1">
                      <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Calculated Opening Total</p>
                      <p className="text-2xl font-black text-amber-400 font-mono">
                        ${calculateDenomTotal(retroOpeningDenoms).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="relative max-w-sm">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-lg font-bold text-slate-400">$</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      required={!useRetroOpeningDenoms}
                      value={quickRetroOpeningCash}
                      onChange={(e) => setQuickRetroOpeningCash(e.target.value)} // Keep in sync
                      onBlur={(e) => setQuickRetroOpeningCash(parseFloat(e.target.value) ? (Math.round(parseFloat(e.target.value) * 100) / 100).toFixed(2) : '')}
                      className="w-full pl-8 pr-4 py-3 bg-white border border-slate-200 rounded-xl font-mono text-sm font-bold text-slate-800 outline-none"
                      placeholder="0.00"
                    />
                  </div>
                )}
              </div>

              {/* Bank Run / Cash Inflow Input Container */}
              <div className="bg-emerald-50/50 rounded-3xl p-6 border border-emerald-100 space-y-3">
                <div>
                  <h4 className="text-sm font-black text-emerald-900 uppercase tracking-tight flex items-center gap-2">
                    <ArrowUpCircle className="w-4 h-4 text-emerald-600" />
                    Bank Run / Cash Inflow Deposit (Optional)
                  </h4>
                  <p className="text-[10px] text-emerald-700 font-bold uppercase tracking-wider">Additional cash added to register drawer during this retroactive session</p>
                </div>
                <div className="relative max-w-sm">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-lg font-bold text-slate-400">$</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={retroBankRun}
                    onChange={(e) => setRetroBankRun(e.target.value)}
                    onBlur={(e) => setRetroBankRun(parseFloat(e.target.value) ? (Math.round(parseFloat(e.target.value) * 100) / 100).toFixed(2) : '')}
                    className="w-full pl-8 pr-4 py-3 bg-white border border-emerald-200 rounded-xl font-mono text-sm font-bold text-slate-800 outline-none focus:ring-2 focus:ring-emerald-500/20"
                    placeholder="0.00"
                  />
                </div>
              </div>

              {/* Closing Cash Input Container (Only shown for 'closed' status) */}
              {retroStatus === 'closed' && (
                <div className="bg-slate-50 rounded-3xl p-6 border border-slate-200 space-y-4">
                  <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-3">
                    <div>
                      <h4 className="text-sm font-black text-slate-800 uppercase tracking-tight">Closing Cash Balance</h4>
                      <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">End physical cash total counted for this day</p>
                    </div>
                    <div className="flex bg-slate-200/60 p-1 rounded-xl text-[10px] font-bold">
                      <button
                        type="button"
                        onClick={() => setUseRetroClosingDenoms(true)}
                        className={cn("px-3 py-1.5 rounded-lg transition-all", useRetroClosingDenoms ? "bg-white text-slate-900 shadow-sm" : "text-slate-500")}
                      >
                        Denominations
                      </button>
                      <button
                        type="button"
                        onClick={() => setUseRetroClosingDenoms(false)}
                        className={cn("px-3 py-1.5 rounded-lg transition-all", !useRetroClosingDenoms ? "bg-white text-slate-900 shadow-sm" : "text-slate-500")}
                      >
                        Quick Cash
                      </button>
                    </div>
                  </div>

                  {useRetroClosingDenoms ? (
                    <div className="space-y-6">
                      <DenominationEditor values={retroClosingDenoms} onChange={setRetroClosingDenoms} />
                      <div className="p-4 bg-slate-900 text-white rounded-3xl text-center space-y-1">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Calculated Closing Total</p>
                        <p className="text-2xl font-black text-amber-400 font-mono">
                          ${calculateDenomTotal(retroClosingDenoms).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="relative max-w-sm">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-lg font-bold text-slate-400">$</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        required={retroStatus === 'closed' && !useRetroClosingDenoms}
                        value={quickRetroClosingCash}
                        onChange={(e) => setQuickRetroClosingCash(e.target.value)}
                        onBlur={(e) => setQuickRetroClosingCash(parseFloat(e.target.value) ? (Math.round(parseFloat(e.target.value) * 100) / 100).toFixed(2) : '')}
                        className="w-full pl-8 pr-4 py-3 bg-white border border-slate-200 rounded-xl font-mono text-sm font-bold text-slate-800 outline-none"
                        placeholder="0.00"
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Audit Trail note input */}
              <div>
                <label className="block text-[10px] font-black uppercase text-slate-400 tracking-wider mb-2">Audit Correction Reason</label>
                <textarea
                  required
                  rows={2}
                  value={retroNotes}
                  onChange={(e) => setRetroNotes(e.target.value)}
                  placeholder="E.g. Corrective resolution of missed open/close session on a high volume day."
                  className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>

              {/* Actions */}
              <div className="flex gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowRetroactiveModal(false)}
                  className="flex-1 px-6 py-4 border border-slate-200 text-slate-500 hover:bg-slate-50 rounded-2xl font-black text-xs uppercase tracking-widest transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={processing}
                  className="flex-[2] px-6 py-4 bg-amber-600 hover:bg-amber-700 text-white rounded-2xl font-black text-xs uppercase tracking-widest transition-all shadow-xl shadow-amber-600/10 flex items-center justify-center gap-2"
                >
                  {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Resolve & Create Session
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
