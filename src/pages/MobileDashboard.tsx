import { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, query, where, orderBy } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { BuyTicket, UserProfile } from '../types';
import { LogOut, DollarSign, Users } from 'lucide-react';
import { cn } from '../lib/utils';
import { COMPANY_NAME } from '../constants';

interface MobileDashboardProps {
  profile: UserProfile | null;
}

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  delta: number | null;
  compareLabel: string;
  compareValue: string;
}

function StatCard({ icon, label, value, delta, compareLabel, compareValue }: StatCardProps) {
  return (
    <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm space-y-3">
      <div className="flex items-center gap-2 text-slate-400">
        {icon}
        <span className="text-[10px] font-black uppercase tracking-widest">{label}</span>
      </div>
      <p className="text-4xl font-black text-slate-900 font-mono">{value}</p>
      <div className="flex items-center justify-between text-xs pt-2 border-t border-slate-100">
        <span className="text-slate-400 font-bold uppercase tracking-wide">vs last {compareLabel}</span>
        <span className="font-mono font-bold text-slate-600">{compareValue}</span>
      </div>
      {delta !== null && (
        <p className={cn('text-xs font-black', delta >= 0 ? 'text-emerald-600' : 'text-red-600')}>
          {delta >= 0 ? '+' : ''}{delta.toFixed(0)}% vs last week
        </p>
      )}
    </div>
  );
}

// Read-only, phone-first snapshot for the owner. Deliberately separate from
// Dashboard.tsx/Layout.tsx -- no sidebar, no editing, minimal data pull --
// so it can never affect the desktop dashboard's UI or behavior.
export default function MobileDashboard({ profile }: MobileDashboardProps) {
  const [buyTickets, setBuyTickets] = useState<BuyTicket[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const eightDaysAgo = new Date();
    eightDaysAgo.setDate(eightDaysAgo.getDate() - 8);
    const q = query(
      collection(db, 'buyTickets'),
      where('timestamp', '>=', eightDaysAgo.toISOString()),
      orderBy('timestamp', 'desc')
    );
    const unsub = onSnapshot(q, (snapshot) => {
      setBuyTickets(snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as BuyTicket[]);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const todayLocalDateString = new Date().toLocaleDateString('en-CA');
  const todayTickets = useMemo(() => buyTickets.filter(t => {
    if (!t.timestamp) return false;
    return new Date(t.timestamp).toLocaleDateString('en-CA') === todayLocalDateString
      && t.status !== 'voided' && t.status !== 'cancelled';
  }), [buyTickets, todayLocalDateString]);

  const lastWeekDateInfo = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return { ymd: d.toLocaleDateString('en-CA'), dayName: d.toLocaleDateString('en-US', { weekday: 'long' }) };
  }, []);

  const lastWeekSameDayTickets = useMemo(() => buyTickets.filter(t => {
    if (!t.timestamp) return false;
    return new Date(t.timestamp).toLocaleDateString('en-CA') === lastWeekDateInfo.ymd
      && t.status !== 'voided' && t.status !== 'cancelled';
  }), [buyTickets, lastWeekDateInfo.ymd]);

  const todaySpend = useMemo(() => todayTickets.reduce((sum, t) => sum + t.totalAmount, 0), [todayTickets]);
  const todayCustomers = useMemo(() => {
    const ids = new Set<string>();
    todayTickets.forEach(t => { if (t.customerId) ids.add(t.customerId); });
    return ids.size;
  }, [todayTickets]);

  const lastWeekSpend = useMemo(() => lastWeekSameDayTickets.reduce((sum, t) => sum + t.totalAmount, 0), [lastWeekSameDayTickets]);
  const lastWeekCustomers = useMemo(() => {
    const ids = new Set<string>();
    lastWeekSameDayTickets.forEach(t => { if (t.customerId) ids.add(t.customerId); });
    return ids.size;
  }, [lastWeekSameDayTickets]);

  const spendDelta = lastWeekSpend > 0 ? ((todaySpend - lastWeekSpend) / lastWeekSpend) * 100 : null;
  const customerDelta = lastWeekCustomers > 0 ? ((todayCustomers - lastWeekCustomers) / lastWeekCustomers) * 100 : null;

  if (!profile) return null;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center px-5 py-8">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{COMPANY_NAME}</p>
            <h1 className="text-lg font-black text-slate-900">Today's Snapshot</h1>
          </div>
          <button
            onClick={() => auth.signOut()}
            className="p-2 text-slate-400 hover:text-slate-600 rounded-lg"
            aria-label="Sign out"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>

        {loading ? (
          <div className="text-center py-20 text-slate-400 text-sm font-bold uppercase tracking-wider">
            Loading&hellip;
          </div>
        ) : (
          <>
            <StatCard
              icon={<DollarSign className="w-5 h-5" />}
              label="Material Spend"
              value={`$${todaySpend.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
              delta={spendDelta}
              compareLabel={lastWeekDateInfo.dayName}
              compareValue={`$${lastWeekSpend.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
            />
            <StatCard
              icon={<Users className="w-5 h-5" />}
              label="Customers Today"
              value={String(todayCustomers)}
              delta={customerDelta}
              compareLabel={lastWeekDateInfo.dayName}
              compareValue={String(lastWeekCustomers)}
            />
          </>
        )}

        <p className="text-center text-[10px] text-slate-400 font-bold uppercase tracking-wider pt-4">
          Read-only &middot; Updates live
        </p>
      </div>
    </div>
  );
}
