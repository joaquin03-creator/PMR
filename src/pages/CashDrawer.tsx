import { useState, useEffect, useMemo } from 'react';
import { db } from '../firebase';
import { collection, onSnapshot, query, where, addDoc, doc, updateDoc, deleteDoc, getDocs, orderBy, limit } from 'firebase/firestore';
import { CashSession, CashTransaction, BuyTicket, UserProfile } from '../types';
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
  ShieldCheck
} from 'lucide-react';
import { cn } from '../lib/utils';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';

interface CashDrawerProps {
  profile: UserProfile | null;
}

export default function CashDrawer({ profile }: CashDrawerProps) {
  const [activeSession, setActiveSession] = useState<CashSession | null>(null);
  const [transactions, setTransactions] = useState<CashTransaction[]>([]);
  const [buyTickets, setBuyTickets] = useState<BuyTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  
  const [showInflowModal, setShowInflowModal] = useState(false);
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [showStartModal, setShowStartModal] = useState(false);
  const [showEditOpeningModal, setShowEditOpeningModal] = useState(false);
  
  const [history, setHistory] = useState<CashSession[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  const todayStr = new Date().toISOString().split('T')[0];

  useEffect(() => {
    // 1. Subscribe to today's session
    const unsubSession = onSnapshot(
      query(collection(db, 'cashSessions'), where('date', '==', todayStr), limit(1)),
      (snapshot) => {
        if (!snapshot.empty) {
          setActiveSession({ id: snapshot.docs[0].id, ...snapshot.docs[0].data() } as CashSession);
        } else {
          setActiveSession(null);
        }
        setLoading(false);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'cashSessions')
    );

    // 2. Subscribe to today's Buy Tickets for automatic payout calculation
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const unsubTickets = onSnapshot(
      query(collection(db, 'buyTickets'), where('timestamp', '>=', startOfToday.toISOString())),
      (snapshot) => {
        const tickets = snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as BuyTicket[];
        setBuyTickets(tickets.filter(t => t.status !== 'voided' && t.status !== 'cancelled'));
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'buyTickets')
    );

    // 3. Historical sessions
    const unsubHistory = onSnapshot(
      query(collection(db, 'cashSessions'), orderBy('date', 'desc'), limit(30)),
      (snapshot) => {
        setHistory(snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as CashSession[]);
      }
    );

    return () => {
      unsubSession();
      unsubTickets();
      unsubHistory();
    };
  }, [todayStr]);

  // If there's an active session, subscribe to its transactions
  useEffect(() => {
    if (activeSession) {
      const unsubTx = onSnapshot(
        query(collection(db, 'cashTransactions'), where('sessionId', '==', activeSession.id), orderBy('timestamp', 'desc')),
        (snapshot) => {
          setTransactions(snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as CashTransaction[]);
        }
      );
      return () => unsubTx();
    } else {
      setTransactions([]);
    }
  }, [activeSession?.id]);

  const totalPayouts = useMemo(() => {
    return buyTickets.reduce((sum, t) => sum + t.totalAmount, 0);
  }, [buyTickets]);

  const totalReplenishments = useMemo(() => {
    return transactions.filter(t => t.type === 'inflow').reduce((sum, t) => sum + t.amount, 0);
  }, [transactions]);

  const totalExpenses = useMemo(() => {
    return transactions.filter(t => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0);
  }, [transactions]);

  const expectedCash = useMemo(() => {
    if (!activeSession) return 0;
    return activeSession.openingCash + totalReplenishments - totalPayouts - totalExpenses;
  }, [activeSession, totalReplenishments, totalPayouts, totalExpenses]);

  // Update expected cash in session document (if it changed and we're the manager)
  useEffect(() => {
    if (activeSession?.id && activeSession.status === 'open' && Math.abs(activeSession.expectedCash - expectedCash) > 0.01) {
      updateDoc(doc(db, 'cashSessions', activeSession.id), { expectedCash });
    }
  }, [expectedCash, activeSession?.id, activeSession?.status, activeSession?.expectedCash]);

  const handleStartDay = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!profile) return;
    setProcessing(true);
    
    const formData = new FormData(e.currentTarget);
    const openingCash = parseFloat(formData.get('openingCash') as string);
    
    try {
      await addDoc(collection(db, 'cashSessions'), {
        date: todayStr,
        status: 'open',
        openingCash,
        expectedCash: openingCash,
        openedAt: new Date().toISOString(),
        openedBy: profile.email,
      } as Omit<CashSession, 'id'>);
      setShowStartModal(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'cashSessions');
    } finally {
      setProcessing(false);
    }
  };

  const handleAddTransaction = async (e: React.FormEvent<HTMLFormElement>, type: 'inflow' | 'expense') => {
    e.preventDefault();
    if (!activeSession || !profile) return;
    setProcessing(true);
    
    const formData = new FormData(e.currentTarget);
    const amount = parseFloat(formData.get('amount') as string);
    const category = formData.get('category') as string;
    const notes = formData.get('notes') as string;
    
    try {
      await addDoc(collection(db, 'cashTransactions'), {
        sessionId: activeSession.id,
        type,
        category,
        amount,
        notes,
        timestamp: new Date().toISOString(),
        performedBy: profile.email
      } as Omit<CashTransaction, 'id'>);
      
      if (type === 'inflow') setShowInflowModal(false);
      else setShowExpenseModal(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'cashTransactions');
    } finally {
      setProcessing(false);
    }
  };

  const handleCloseDay = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!activeSession || !profile) return;
    setProcessing(true);
    
    const formData = new FormData(e.currentTarget);
    const actualCash = parseFloat(formData.get('actualCash') as string);
    const notes = formData.get('notes') as string;
    const overShort = actualCash - expectedCash;
    
    try {
      await updateDoc(doc(db, 'cashSessions', activeSession.id), {
        status: 'closed',
        actualCash,
        overShort,
        closedAt: new Date().toISOString(),
        closedBy: profile.email,
        notes: notes || activeSession.notes || ''
      });
      setShowCloseModal(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'cashSessions');
    } finally {
      setProcessing(false);
    }
  };

  const handleReOpenSession = async () => {
    if (!activeSession || !profile) return;
    setProcessing(true);
    try {
      await updateDoc(doc(db, 'cashSessions', activeSession.id), {
        status: 'open',
        actualCash: null,
        overShort: null,
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'cashSessions');
    } finally {
      setProcessing(false);
    }
  };

  const handleUpdateOpeningCash = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!activeSession || !profile) return;
    setProcessing(true);
    const formData = new FormData(e.currentTarget);
    const openingCash = parseFloat(formData.get('openingCash') as string);
    try {
      await updateDoc(doc(db, 'cashSessions', activeSession.id), {
        openingCash
      });
      setShowEditOpeningModal(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'cashSessions');
    } finally {
      setProcessing(false);
    }
  };

  const handleDeleteTransaction = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this transaction? This will affect your expected balance.')) return;
    try {
      await deleteDoc(doc(db, 'cashTransactions', id));
    } catch (error) {
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

  if (profile?.role !== 'manager' || !profile?.permissions?.canManageCash) {
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
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
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
          <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-sm">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Date</th>
                  <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Status</th>
                  <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Expected</th>
                  <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Actual</th>
                  <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-right">Diff</th>
                  <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Closed By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {history.map(session => (
                  <tr key={session.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-slate-100 rounded-xl">
                          <Calendar className="w-4 h-4 text-slate-500" />
                        </div>
                        <span className="font-bold text-slate-900">{session.date}</span>
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
                    <td className={cn(
                      "px-6 py-4 text-right font-mono font-bold",
                      (session.overShort || 0) < 0 ? "text-red-600" : (session.overShort || 0) > 0 ? "text-emerald-600" : "text-slate-400"
                    )}>
                      {session.overShort !== undefined ? (
                        `${session.overShort > 0 ? '+' : ''}${session.overShort.toLocaleString(undefined, { minimumFractionDigits: 2 })}`
                      ) : '-'}
                    </td>
                    <td className="px-6 py-4 text-slate-500 text-sm font-medium">
                      {session.closedBy || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <>
          {!activeSession ? (
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
              <button 
                onClick={() => setShowStartModal(true)}
                className="px-10 py-5 bg-blue-600 text-white rounded-3xl font-black text-sm uppercase tracking-widest hover:bg-blue-700 transition-all shadow-2xl shadow-blue-200 flex items-center gap-3 hover:-translate-y-1 active:scale-95"
              >
                <Plus className="w-5 h-5" />
                Initialize Opening Cash
              </button>
            </div>
          ) : (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4">
              {/* Stat Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <div className="bg-white rounded-[2rem] p-8 border border-slate-200 shadow-sm relative overflow-hidden group">
                  <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:scale-110 transition-transform">
                    <History className="w-20 h-20" />
                  </div>
                  <div className="flex items-center justify-between mb-4">
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Opening Cash</p>
                    {activeSession.status === 'open' && (
                      <button 
                        onClick={() => setShowEditOpeningModal(true)}
                        className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-blue-600 transition-all"
                      >
                        <Edit2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                  <h3 className="text-3xl font-black text-slate-900 font-mono">
                    ${activeSession.openingCash.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </h3>
                  <div className="mt-4 flex items-center gap-2 text-slate-400">
                    <Clock className="w-4 h-4" />
                    <span className="text-[10px] font-bold uppercase tracking-widest">{new Date(activeSession.openedAt).toLocaleTimeString()}</span>
                  </div>
                </div>

                <div className="bg-white rounded-[2rem] p-8 border border-slate-200 shadow-sm relative overflow-hidden group border-l-4 border-l-emerald-500">
                  <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:scale-110 transition-transform">
                    <ArrowUpCircle className="w-20 h-20 text-emerald-500" />
                  </div>
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Replenishments</p>
                  <h3 className="text-3xl font-black text-emerald-600 font-mono">
                    +${totalReplenishments.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </h3>
                  <p className="mt-4 text-[10px] font-bold text-slate-500 uppercase tracking-widest">{transactions.filter(t => t.type === 'inflow').length} Bank Runs logged</p>
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
                    activeSession.status === 'open' ? "bg-blue-500/20 text-blue-400" : "bg-emerald-500/20 text-emerald-400"
                  )}>
                    <div className={cn("w-1.5 h-1.5 rounded-full", activeSession.status === 'open' ? "bg-blue-400 animate-pulse" : "bg-emerald-400")} />
                    Session {activeSession.status}
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
                      <h3 className="text-xl font-black text-slate-900 uppercase tracking-tight">Today's Transactions</h3>
                    </div>
                    {activeSession.status === 'open' && (
                      <div className="flex gap-2">
                        <button 
                          onClick={() => setShowInflowModal(true)}
                          className="px-4 py-2 bg-emerald-50 text-emerald-700 rounded-xl font-black text-[10px] uppercase tracking-widest border border-emerald-100 hover:bg-emerald-100 transition-all flex items-center gap-2"
                        >
                          <ArrowUpCircle className="w-4 h-4" />
                          Bank Run
                        </button>
                        <button 
                          onClick={() => setShowExpenseModal(true)}
                          className="px-4 py-2 bg-red-50 text-red-700 rounded-xl font-black text-[10px] uppercase tracking-widest border border-red-100 hover:bg-red-100 transition-all flex items-center gap-2"
                        >
                          <ArrowDownCircle className="w-4 h-4" />
                          Expense
                        </button>
                      </div>
                    )}
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
                        {transactions.map(tx => (
                          <div key={tx.id} className="p-6 flex items-center justify-between hover:bg-slate-50/50 transition-all">
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
                              {activeSession.status === 'open' && (
                                <button 
                                  onClick={() => handleDeleteTransaction(tx.id)}
                                  className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                                  title="Delete Transaction"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          </div>
                        ))}
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
                      
                      {activeSession.status === 'open' ? (
                        <div className="space-y-4 pt-4">
                          <p className="text-slate-400 text-[10px] font-black uppercase tracking-widest leading-relaxed">
                            Ready to count your physical cash and verify the balance? This will finalize the session.
                          </p>
                          <button 
                            onClick={() => setShowCloseModal(true)}
                            className="w-full py-5 bg-white text-slate-900 rounded-3xl font-black text-xs uppercase tracking-widest hover:bg-slate-100 transition-all shadow-xl flex items-center justify-center gap-2 group/btn"
                          >
                            <CheckCircle2 className="w-4 h-4 text-emerald-600 group-hover/btn:scale-110 transition-transform" />
                            Finalize Reconciliation
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-6 pt-4">
                          <div className="p-6 bg-white/5 rounded-3xl border border-white/10 space-y-4">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold text-slate-400 uppercase">Physical Count</span>
                              <span className="font-mono font-black">${activeSession.actualCash?.toLocaleString()}</span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold text-slate-400 uppercase">Over/Short</span>
                              <span className={cn(
                                "p-2 rounded-xl font-mono font-black",
                                (activeSession.overShort || 0) < 0 ? "bg-red-500/20 text-red-400" : "bg-emerald-500/20 text-emerald-400"
                              )}>
                                {activeSession.overShort !== undefined && activeSession.overShort > 0 ? '+' : ''}{activeSession.overShort?.toFixed(2)}
                              </span>
                            </div>
                          </div>
                          <div className="flex flex-col gap-3 pt-4">
                            <div className="flex items-center gap-3 p-4 bg-emerald-500/10 rounded-2xl border border-emerald-500/20">
                              <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0" />
                              <p className="text-[10px] font-black text-emerald-400 uppercase tracking-widest">
                                This session is finalized. Reconciliation record is archived.
                              </p>
                            </div>
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
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="bg-white rounded-[2rem] p-8 border border-slate-200 shadow-sm">
                    <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest mb-6">Security & Notes</h3>
                    <div className="space-y-4">
                      {activeSession.notes && (
                        <div className="p-4 bg-slate-50 rounded-2xl italic text-slate-600 text-sm border border-slate-100">
                          "{activeSession.notes}"
                        </div>
                      )}
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-relaxed">
                        Session audits include all bank run replenishments and non-buying expenses. These records are tied to the manager who closed the day.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* MODALS */}
      {/* Start Session Modal */}
      {showStartModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-[2.5rem] p-10 max-w-md w-full shadow-2xl animate-in zoom-in-95 duration-200 border border-slate-200">
            <div className="space-y-2 mb-8">
              <h3 className="text-2xl font-black text-slate-900 uppercase tracking-tight">Open Ledger</h3>
              <p className="text-slate-500 font-medium text-xs uppercase tracking-widest">Combined Safe + Register Total</p>
            </div>
            <form onSubmit={handleStartDay} className="space-y-6">
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
                    className="w-full pl-14 pr-6 py-5 bg-slate-50 border border-slate-200 rounded-[1.5rem] text-xl font-mono font-black focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 outline-none transition-all"
                    placeholder="0.00"
                  />
                </div>
              </div>
              <div className="flex gap-3">
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

      {/* Replenish (Inflow) Modal */}
      {showInflowModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-[2.5rem] p-10 max-w-md w-full shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center gap-4 mb-8">
              <div className="p-4 bg-emerald-50 rounded-3xl text-emerald-600">
                <ArrowUpCircle className="w-8 h-8" />
              </div>
              <div className="space-y-1">
                <h3 className="text-2xl font-black text-slate-900 uppercase tracking-tight">Bank Run</h3>
                <p className="text-slate-500 text-xs font-black uppercase tracking-widest">Added to Total Cash on Hand</p>
              </div>
            </div>
            <form onSubmit={(e) => handleAddTransaction(e, 'inflow')} className="space-y-6">
              <input type="hidden" name="category" value="Bank Run" />
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Replenishment Amount</label>
                  <div className="relative">
                    <DollarSign className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
                    <input 
                      name="amount" 
                      type="number" 
                      step="0.01" 
                      required 
                      className="w-full pl-14 pr-6 py-5 bg-slate-50 border border-slate-200 rounded-3xl text-xl font-mono font-black focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500 outline-none transition-all"
                      placeholder="0.00"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Notes</label>
                  <input 
                    name="notes" 
                    className="w-full px-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl font-medium focus:ring-2 focus:ring-slate-200 outline-none" 
                    placeholder="e.g. Returned from Fifth Third Bank" 
                  />
                </div>
              </div>
              <div className="flex gap-3 pt-4">
                <button type="button" onClick={() => setShowInflowModal(false)} className="flex-1 px-8 py-4 text-slate-500 font-bold uppercase text-xs tracking-widest">Back</button>
                <button disabled={processing} type="submit" className="flex-[2] bg-emerald-600 text-white px-8 py-4 rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl shadow-emerald-200">Record Deposit</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Expense Modal */}
      {showExpenseModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-[2.5rem] p-10 max-w-md w-full shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center gap-4 mb-8">
              <div className="p-4 bg-red-50 rounded-3xl text-red-600">
                <ArrowDownCircle className="w-8 h-8" />
              </div>
              <div className="space-y-1">
                <h3 className="text-2xl font-black text-slate-900 uppercase tracking-tight">One-Off Expense</h3>
                <p className="text-slate-500 text-xs font-black uppercase tracking-widest">Non-Material Outflow</p>
              </div>
            </div>
            <form onSubmit={(e) => handleAddTransaction(e, 'expense')} className="space-y-6">
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Category</label>
                  <select name="category" required className="w-full px-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl font-black text-xs uppercase tracking-widest outline-none focus:ring-2 focus:ring-slate-200">
                    <option value="Fuel">Fuel</option>
                    <option value="Vendor Payout">Vendor Payout</option>
                    <option value="Supplies">Supplies</option>
                    <option value="Employee Advance">Employee Advance</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Amount</label>
                  <div className="relative">
                    <DollarSign className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
                    <input name="amount" type="number" step="0.01" required className="w-full pl-14 pr-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-lg font-mono font-black outline-none focus:ring-4 focus:ring-red-500/10" placeholder="0.00" />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Internal Notes</label>
                  <input name="notes" className="w-full px-6 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-slate-200" placeholder="e.g. Diesel for Yard Truck" />
                </div>
              </div>
              <div className="flex gap-3 pt-4">
                <button type="button" onClick={() => setShowExpenseModal(false)} className="flex-1 px-8 py-4 text-slate-500 font-bold uppercase text-xs tracking-widest">Back</button>
                <button disabled={processing} type="submit" className="flex-[2] bg-red-600 text-white px-8 py-4 rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl shadow-red-200">Record Expense</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Finalize/Close Modal */}
      {showCloseModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-[2.5rem] p-12 max-w-xl w-full shadow-2xl animate-in zoom-in-95 duration-200 border border-slate-200">
            <div className="space-y-2 mb-8 text-center">
              <h3 className="text-3xl font-black text-slate-900 uppercase tracking-tight font-display">Daily Closing Audit</h3>
              <p className="text-slate-500 text-xs font-black uppercase tracking-widest">Final Step to Secure the Books</p>
            </div>
            
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

            <form onSubmit={handleCloseDay} className="space-y-8">
              <div className="space-y-4">
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
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Final Reconciliation Notes</label>
                  <textarea 
                    name="notes" 
                    rows={2}
                    className="w-full px-6 py-4 bg-slate-50 border border-slate-200 rounded-3xl text-sm font-medium outline-none focus:ring-2 focus:ring-slate-200 resize-none" 
                    placeholder="Any discrepancies to note for the audit?" 
                  />
                </div>
              </div>
              
              <div className="flex gap-4">
                <button type="button" onClick={() => setShowCloseModal(false)} className="flex-1 py-5 text-slate-500 font-black text-xs uppercase tracking-widest hover:bg-slate-50 rounded-[1.5rem]">Keep Open</button>
                <button disabled={processing} type="submit" className="flex-[2] bg-slate-900 text-white py-5 rounded-[1.5rem] font-black text-xs uppercase tracking-widest shadow-2xl shadow-slate-900/40 hover:-translate-y-1 transition-all">Submit & Close Day</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Opening Cash Modal */}
      {showEditOpeningModal && activeSession && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-[2.5rem] p-10 max-w-md w-full shadow-2xl animate-in zoom-in-95 duration-200 border border-slate-200">
            <div className="space-y-2 mb-8">
              <h3 className="text-2xl font-black text-slate-900 uppercase tracking-tight">Edit Opening Balance</h3>
              <p className="text-slate-500 font-medium text-xs uppercase tracking-widest">Update initial cash for the session</p>
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
                    defaultValue={activeSession.openingCash}
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
    </main>
  );
}
