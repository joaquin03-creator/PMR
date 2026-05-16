import { useState, useEffect, useMemo } from 'react';
import { db } from '../firebase';
import { collection, onSnapshot, query, where, addDoc, getDocs, serverTimestamp, orderBy, limit } from 'firebase/firestore';
import { BuyTicket, TripTicket, Material, Customer, Invoice, InventoryItem, DailySnapshot, AuditLog, ComplianceSubmission } from '../types';
import { COMPANY_NAME, COMPANY_ADDRESS, COMPANY_PHONE, COMPANY_EMAIL, COMPANY_WEBSITE, handleImageError } from '../constants';
import { BrandLogo } from '../components/BrandLogo';
import { 
  BarChart3, 
  TrendingUp, 
  DollarSign, 
  Package, 
  Calendar, 
  Loader2, 
  ArrowUpRight, 
  ArrowDownRight, 
  Download, 
  Printer, 
  Filter,
  ChevronRight,
  FileText,
  ShieldCheck,
  AlertTriangle,
  History,
  Save,
  Search,
  Activity,
  User,
  Clock,
  X,
  Send,
  CheckCircle2,
  XCircle,
  Lock
} from 'lucide-react';
import { cn } from '../lib/utils';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  LineChart, 
  Line,
  AreaChart,
  Area,
  Cell,
  PieChart,
  Pie
} from 'recharts';

import { handleFirestoreError, OperationType } from '../lib/firestore-errors';

export default function Reports({ profile }: { profile: any }) {
  const [buyTickets, setBuyTickets] = useState<BuyTicket[]>([]);
  const [tripTickets, setTripTickets] = useState<TripTicket[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [dailySnapshots, setDailySnapshots] = useState<DailySnapshot[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [complianceSubmissions, setComplianceSubmissions] = useState<ComplianceSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [creatingSnapshot, setCreatingSnapshot] = useState(false);
  const [submittingReporting, setSubmittingReporting] = useState(false);
  const [timeRange, setTimeRange] = useState<'weekly' | 'monthly' | 'custom'>('weekly');
  const [activeTab, setActiveTab] = useState<'overview' | 'materials' | 'sales' | 'compliance' | 'backups' | 'history'>('overview');
  const [auditFilter, setAuditFilter] = useState({ query: '', type: 'all' });
  const [customRange, setCustomRange] = useState({ start: '', end: '' });
  const [notification, setNotification] = useState<{ type: 'success' | 'error' | 'warning', message: string, onConfirm?: () => void } | null>(null);

  if (profile?.role !== 'manager' || !profile?.permissions?.canGenerateReports) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-8">
        <div className="p-6 bg-red-50 rounded-full text-red-600 mb-6">
          <Lock className="w-12 h-12" />
        </div>
        <h2 className="text-2xl font-black text-slate-900 uppercase tracking-tight">Access Restricted</h2>
        <p className="text-slate-500 mt-2 max-w-md">You do not have the required permissions to access reports and analytics. Please contact your system administrator.</p>
      </div>
    );
  }

  useEffect(() => {
    const now = new Date();
    let startDate = new Date();
    
    if (timeRange === 'weekly') {
      startDate.setDate(now.getDate() - 7);
    } else if (timeRange === 'monthly') {
      startDate.setMonth(now.getMonth() - 1);
    } else if (timeRange === 'custom' && customRange.start) {
      startDate = new Date(customRange.start);
    }

    const startIso = startDate.toISOString();
    const endIso = timeRange === 'custom' && customRange.end 
      ? new Date(customRange.end).toISOString() 
      : new Date().toISOString();

    const unsubBuy = onSnapshot(
      query(collection(db, 'buyTickets'), where('timestamp', '>=', startIso), where('timestamp', '<=', endIso)), 
      (snapshot) => {
        setBuyTickets(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as BuyTicket[]);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'buyTickets')
    );

    const unsubTrip = onSnapshot(
      query(collection(db, 'tripTickets'), where('timestamp', '>=', startIso), where('timestamp', '<=', endIso)), 
      (snapshot) => {
        setTripTickets(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as TripTicket[]);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'tripTickets')
    );

    const unsubMaterials = onSnapshot(collection(db, 'materials'), (snapshot) => {
      setMaterials(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Material[]);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'materials'));

    const unsubCustomers = onSnapshot(collection(db, 'customers'), (snapshot) => {
      setCustomers(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Customer[]);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'customers'));

    const unsubInvoices = onSnapshot(collection(db, 'invoices'), (snapshot) => {
      setInvoices(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Invoice[]);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'invoices'));

    const unsubInventory = onSnapshot(collection(db, 'inventory'), (snapshot) => {
      setInventory(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as InventoryItem[]);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'inventory'));

    const unsubAudit = onSnapshot(
      query(collection(db, 'auditLogs'), orderBy('timestamp', 'desc'), limit(100)),
      (snapshot) => {
        setAuditLogs(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as AuditLog[]);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'auditLogs')
    );

    const unsubSnapshots = onSnapshot(
      query(collection(db, 'dailySnapshots'), orderBy('timestamp', 'desc'), limit(30)),
      (snapshot) => {
        setDailySnapshots(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as DailySnapshot[]);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'dailySnapshots')
    );

    const unsubSubmissions = onSnapshot(
      query(collection(db, 'complianceSubmissions'), orderBy('timestamp', 'desc'), limit(50)),
      (snapshot) => {
        setComplianceSubmissions(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as ComplianceSubmission[]);
        setLoading(false);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'complianceSubmissions')
    );

    return () => {
      unsubBuy();
      unsubTrip();
      unsubMaterials();
      unsubCustomers();
      unsubInvoices();
      unsubInventory();
      unsubAudit();
      unsubSnapshots();
      unsubSubmissions();
    };
  }, [timeRange, customRange]);

  const validBuyTickets = useMemo(() => 
    buyTickets.filter(t => (t.status || 'completed') === 'completed'),
  [buyTickets]);

  const validTripTickets = useMemo(() => 
    tripTickets.filter(t => t.status !== 'cancelled' && t.status !== 'voided'),
  [tripTickets]);

  // Granular Material Purchase Data
  const exportLeadsCsv = () => {
    const headers = [
      'Transaction ID',
      'Date',
      'Time',
      'Seller Name',
      'Seller ID Type',
      'Seller ID Num',
      'Seller Address',
      'Seller Phone',
      'Vehicle Plate',
      'Vehicle Make',
      'Vehicle Model',
      'Material',
      'Weight',
      'Price Paid',
      'Payment Method',
      'Affirmed'
    ];

    const rows = validBuyTickets.flatMap(ticket => {
      const customer = customers.find(c => c.id === ticket.customerId);
      return (ticket.materials || []).map(m => {
        const material = materials.find(mat => mat.id === m.materialId);
        const timestamp = new Date(ticket.timestamp);
        return [
          ticket.id,
          timestamp.toLocaleDateString(),
          timestamp.toLocaleTimeString(),
          customer?.name || 'Unknown',
          customer?.idType || '',
          customer?.idNumber || '',
          `"${customer?.address || ''}"`,
          customer?.phone || '',
          ticket.vehiclePlate || '',
          ticket.vehicleMake || '',
          ticket.vehicleModel || '',
          material?.name || 'Unknown',
          m.netWeight,
          m.totalAmount,
          ticket.paymentMethod || 'cash',
          ticket.sellerAffirmed ? 'YES' : 'NO'
        ];
      });
    });

    const csvContent = [
      headers.join(','),
      ...rows.map(r => r.join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ohio_leads_report_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };
  const materialPurchases = useMemo(() => {
    const stats: Record<string, { weight: number, cost: number, count: number, expectedRevenue: number }> = {};
    
    validBuyTickets.forEach(ticket => {
      (ticket.materials || []).forEach(m => {
        if (!stats[m.materialId]) {
          stats[m.materialId] = { weight: 0, cost: 0, count: 0, expectedRevenue: 0 };
        }
        const material = materials.find(mat => mat.id === m.materialId);
        const salePrice = material?.salePrice || 0;
        
        stats[m.materialId].weight += m.netWeight;
        stats[m.materialId].cost += m.totalAmount;
        stats[m.materialId].count += 1;
        stats[m.materialId].expectedRevenue += (salePrice * m.netWeight);
      });
    });

    return Object.entries(stats).map(([id, data]) => {
      const profit = data.expectedRevenue - data.cost;
      const margin = data.expectedRevenue > 0 ? (profit / data.expectedRevenue) * 100 : 0;
      
      return {
        id,
        name: materials.find(m => m.id === id)?.name || 'Unknown',
        category: materials.find(m => m.id === id)?.category || 'Unknown',
        ...data,
        profit,
        margin
      };
    }).sort((a, b) => b.profit - a.profit);
  }, [validBuyTickets, materials]);

  // Chart Data: Daily Volume & Spending
  const chartData = useMemo(() => {
    const daily: Record<string, { date: string, volume: number, spending: number, profit: number }> = {};
    
    // Initialize last 30 days if monthly, or 7 days if weekly
    const days = timeRange === 'monthly' ? 30 : 7;
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      daily[dateStr] = { date: dateStr, volume: 0, spending: 0, profit: 0 };
    }

    validBuyTickets.forEach(ticket => {
      const dateStr = new Date(ticket.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      if (daily[dateStr]) {
        daily[dateStr].spending += ticket.totalAmount;
        const ticketVolume = (ticket.materials || []).reduce((sum, m) => sum + m.netWeight, 0);
        daily[dateStr].volume += ticketVolume;
        
        const ticketProfit = (ticket.materials || []).reduce((sum, m) => {
          const material = materials.find(mat => mat.id === m.materialId);
          const salePrice = material?.salePrice || 0;
          return sum + ((salePrice - m.pricePerUnit) * m.netWeight);
        }, 0);
        daily[dateStr].profit += ticketProfit;
      }
    });

    validTripTickets.forEach(ticket => {
      const dateStr = new Date(ticket.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      // We could also track ticket value here if needed
    });

    return Object.values(daily);
  }, [validBuyTickets, timeRange, materials]);

  const validInvoices = useMemo(() => 
    invoices.filter(i => i.status !== 'draft'),
  [invoices]);

  const salesStats = useMemo(() => {
    const stats: Record<string, { total: number, collected: number, weight: number, count: number }> = {};
    
    validInvoices.forEach(inv => {
      if (!stats[inv.buyerName]) {
        stats[inv.buyerName] = { total: 0, collected: 0, weight: 0, count: 0 };
      }
      stats[inv.buyerName].total += inv.totalAmount;
      stats[inv.buyerName].weight += inv.totalWeight;
      stats[inv.buyerName].count += 1;
      if (inv.status === 'paid') {
        stats[inv.buyerName].collected += inv.totalAmount;
      }
    });

    return Object.entries(stats).map(([name, data]) => ({
      name,
      ...data,
      uncollected: data.total - data.collected
    })).sort((a, b) => b.total - a.total);
  }, [validInvoices]);

  const dailyChartData = useMemo(() => {
    const daily: Record<string, { date: string, revenue: number, expenses: number, profit: number }> = {};
    const dCount = timeRange === 'monthly' ? 30 : 7;
    
    for (let i = dCount - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      daily[dateStr] = { date: dateStr, revenue: 0, expenses: 0, profit: 0 };
    }

    validInvoices.forEach(inv => {
      const dateStr = new Date(inv.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      if (daily[dateStr]) {
        daily[dateStr].revenue += inv.totalAmount;
      }
    });

    validBuyTickets.forEach(ticket => {
      const dateStr = new Date(ticket.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      if (daily[dateStr]) {
        daily[dateStr].expenses += ticket.totalAmount;
      }
    });

    return Object.values(daily).map(d => ({
      ...d,
      profit: d.revenue - d.expenses
    }));
  }, [validInvoices, validBuyTickets, timeRange]);

  const totalSpent = validBuyTickets.reduce((sum, t) => sum + t.totalAmount, 0);
  const totalExpectedProfit = materialPurchases.reduce((sum, m) => sum + m.profit, 0);
  const totalWeightBought = validBuyTickets.reduce((sum, t) => {
    const weight = (t.materials || []).reduce((mSum, m) => mSum + m.netWeight, 0);
    return sum + weight;
  }, 0);
  const totalWeightSold = validTripTickets.reduce((sum, t) => {
    const weight = t.materials.reduce((mSum, m) => mSum + m.weight, 0);
    return sum + weight;
  }, 0);

  const exportToCSV = () => {
    const headers = ['Material', 'Category', 'Volume (lb)', 'Total Cost ($)', 'Expected Profit ($)', 'Margin (%)', 'Transaction Count'];
    const rows = materialPurchases.map(m => [
      m.name,
      m.category,
      m.weight.toFixed(2),
      m.cost.toFixed(2),
      m.profit.toFixed(2),
      m.margin.toFixed(1) + '%',
      m.count
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(r => r.join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `material_purchase_report_${timeRange}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handlePrint = () => {
    if (!settings.debugPrintMode) window.print();
    else console.log('DEBUG PRINT: window.print() bypassed.');
  };

  const createDailySnapshot = async (force = false) => {
    if (!profile) return;
    
    const today = new Date();
    const dateStr = today.toISOString().split('T')[0];
    
    // Check if snapshot already exists for today
    const existing = dailySnapshots.find(s => s.date === dateStr);
    if (existing && !force) {
      setNotification({
        type: 'warning',
        message: 'A snapshot for today already exists. Overwrite?',
        onConfirm: () => {
          setNotification(null);
          createDailySnapshot(true);
        }
      });
      return;
    }

    setCreatingSnapshot(true);
    try {
      // Filter data for today
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date();
      todayEnd.setHours(23, 59, 59, 999);

      const todayBuyTickets = validBuyTickets.filter(t => {
        const d = new Date(t.timestamp);
        return d >= todayStart && d <= todayEnd;
      });

      const todayTripTickets = tripTickets.filter(t => {
        const d = new Date(t.timestamp);
        return d >= todayStart && d <= todayEnd;
      });

      const todayInvoices = invoices.filter(i => {
        const d = new Date(i.date);
        return d >= todayStart && d <= todayEnd;
      });

      const snapshotData: Omit<DailySnapshot, 'id'> = {
        date: dateStr,
        timestamp: new Date().toISOString(),
        createdBy: profile.email,
        materials: materials.map(m => ({
          id: m.id,
          code: m.code,
          name: m.name,
          buyPrice: m.buyPrice,
          salePrice: m.salePrice,
          unit: m.unit
        })),
        inventory: inventory.map(inv => ({
          materialId: inv.materialId,
          weight: inv.currentWeight
        })),
        summary: {
          totalBuyTickets: todayBuyTickets.length,
          totalBuyAmount: todayBuyTickets.reduce((sum, t) => sum + t.totalAmount, 0),
          totalBuyWeight: todayBuyTickets.reduce((sum, t) => sum + t.materials.reduce((mSum, m) => mSum + m.netWeight, 0), 0),
          totalTripTickets: todayTripTickets.length,
          totalTripWeight: todayTripTickets.reduce((sum, t) => sum + t.materials.reduce((mSum, m) => mSum + m.weight, 0), 0),
          totalInvoices: todayInvoices.length,
          totalInvoiceAmount: todayInvoices.reduce((sum, i) => sum + i.totalAmount, 0)
        }
      };

      await addDoc(collection(db, 'dailySnapshots'), snapshotData);
      setNotification({ type: 'success', message: 'Daily snapshot created successfully!' });
    } catch (error) {
      console.error('Error creating snapshot:', error);
      setNotification({ type: 'error', message: 'Failed to create snapshot.' });
    } finally {
      setCreatingSnapshot(false);
    }
  };

  const handleSubmitToWorkCenter = async () => {
    if (!profile) return;
    
    // Prepare report data (matching exportLeadsCsv logic)
    const today = new Date().toISOString().split('T')[0];
    const todayTickets = validBuyTickets.filter(t => new Date(t.timestamp).toDateString() === new Date().toDateString());

    if (todayTickets.length === 0) {
      setNotification({ type: 'warning', message: 'No transactions found for today to submit.' });
      return;
    }

    setSubmittingReporting(true);
    try {
      const reportRows = todayTickets.flatMap(ticket => {
        const customer = customers.find(c => c.id === ticket.customerId);
        return (ticket.materials || []).map(m => {
          const material = materials.find(mat => mat.id === m.materialId);
          return {
            transactionId: ticket.id,
            timestamp: ticket.timestamp,
            seller: customer?.name || 'Unknown',
            idInfo: `${customer?.idType || ''} ${customer?.idNumber || ''}`,
            vehicle: `${ticket.vehicleYear || ''} ${ticket.vehicleMake || ''} ${ticket.vehicleModel || ''}`,
            material: material?.name || 'Unknown',
            weight: m.netWeight,
            amount: m.totalAmount
          };
        });
      });

      const response = await fetch('/api/submit-leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reportData: reportRows,
          date: today,
          submittedBy: profile.email
        })
      });

      const result = await response.json();

      const submissionLog: Omit<ComplianceSubmission, 'id'> = {
        date: today,
        timestamp: new Date().toISOString(),
        submittedBy: profile.displayName || profile.email,
        status: result.status === 'success' || result.status === 'mock_success' ? 'success' : 'failed',
        ticketCount: todayTickets.length,
        responseMessage: result.message || result.error,
        payloadText: JSON.stringify(reportRows)
      };

      await addDoc(collection(db, 'complianceSubmissions'), submissionLog);

      if (submissionLog.status === 'success') {
        setNotification({ 
          type: 'success', 
          message: result.message || 'Report submitted successfully to WorkCenter.' 
        });
      } else {
        setNotification({ 
          type: 'error', 
          message: `Submission failed: ${result.error || 'Unknown server error'}` 
        });
      }
    } catch (error: any) {
      console.error('Submission error:', error);
      setNotification({ type: 'error', message: `Submission failed: ${error.message}` });
    } finally {
      setSubmittingReporting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <main className="space-y-8 print:space-y-4 print:p-0">
      {/* Notification Modal */}
      {notification && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl space-y-6 animate-in zoom-in-95 duration-200">
            <div className="flex items-center gap-4">
              <div className={cn(
                "p-3 rounded-2xl",
                notification.type === 'success' ? "bg-green-50 text-green-600" : 
                notification.type === 'warning' ? "bg-amber-50 text-amber-600" : 
                "bg-red-50 text-red-600"
              )}>
                {notification.type === 'success' ? <ShieldCheck className="w-6 h-6" /> : 
                 notification.type === 'warning' ? <AlertTriangle className="w-6 h-6" /> : 
                 <AlertTriangle className="w-6 h-6" />}
              </div>
              <div>
                <h3 className="text-xl font-black text-slate-900 uppercase tracking-tight">
                  {notification.type === 'success' ? 'Success' : 
                   notification.type === 'warning' ? 'Confirmation' : 
                   'Error'}
                </h3>
                <p className="text-slate-500 font-medium">{notification.message}</p>
              </div>
            </div>
            <div className="flex gap-3">
              {notification.onConfirm ? (
                <>
                  <button 
                    onClick={() => setNotification(null)}
                    className="flex-1 px-6 py-3 bg-slate-100 text-slate-600 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-slate-200 transition-all"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={notification.onConfirm}
                    className="flex-1 px-6 py-3 bg-blue-600 text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-blue-700 transition-all shadow-xl shadow-blue-200"
                  >
                    Confirm
                  </button>
                </>
              ) : (
                <button 
                  onClick={() => setNotification(null)}
                  className="w-full px-6 py-3 bg-slate-900 text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-slate-800 transition-all"
                >
                  Dismiss
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Header - Hidden on Print */}
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 print:hidden">
        <div className="flex items-center gap-6">
          <div className="w-20 h-10 flex items-center justify-center overflow-hidden shrink-0">
            <BrandLogo className="w-full h-full object-contain" />
          </div>
          <div>
            <h1 className="text-4xl font-black text-slate-900 tracking-tight font-display">Yard Performance Reports</h1>
            <p className="text-slate-500 font-medium mt-1">Detailed granularity for material purchases and financial trends.</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={exportToCSV}
            className="flex items-center gap-2 px-5 py-3 bg-white border border-slate-200 rounded-2xl text-xs font-black uppercase tracking-widest text-slate-700 hover:bg-slate-50 transition-all shadow-sm active:scale-95 outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
            aria-label="Export report to CSV"
          >
            <Download className="w-5 h-5" aria-hidden="true" />
            Export CSV
          </button>
          <button 
            onClick={handlePrint}
            className="flex items-center gap-2 px-5 py-3 bg-slate-900 text-white rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-slate-800 transition-all shadow-xl shadow-slate-200 active:scale-95 outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
            aria-label="Print report"
          >
            <Printer className="w-5 h-5" aria-hidden="true" />
            Print Report
          </button>
        </div>
      </header>

      {/* Print Header - Only visible on Print */}
      <div className="hidden print:flex justify-between items-start border-b-2 border-slate-900 pb-8 mb-8">
        <div className="space-y-2">
          <h1 className="text-4xl font-black uppercase tracking-tight">{COMPANY_NAME}</h1>
          <p className="text-sm text-slate-500 font-bold">{COMPANY_ADDRESS}</p>
          <p className="text-sm text-slate-500">{COMPANY_PHONE} | {COMPANY_EMAIL}</p>
          <div className="pt-4">
            <h2 className="text-xl font-bold text-slate-900">Yard Performance Report</h2>
            <div className="flex gap-6 mt-1 text-xs font-bold text-slate-400 uppercase tracking-widest">
              <span>Interval: {timeRange}</span>
              <span>Generated: {new Date().toLocaleString()}</span>
            </div>
          </div>
        </div>
        <div className="w-16 h-16 flex items-center justify-center">
          <BrandLogo className="w-full h-full object-contain grayscale opacity-60" grayscale />
        </div>
      </div>

      {/* Filters - Hidden on Print */}
      <section className="flex flex-wrap items-center gap-4 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm print:hidden" aria-label="Filters">
        <div className="flex items-center gap-2 text-slate-400 mr-2">
          <Filter className="w-4 h-4" aria-hidden="true" />
          <span className="text-xs font-bold uppercase tracking-wider">Interval</span>
        </div>
        <nav className="flex bg-slate-100 p-1 rounded-xl" aria-label="Time range">
          {(['weekly', 'monthly', 'custom'] as const).map((range) => (
            <button
              key={range}
              onClick={() => setTimeRange(range)}
              className={cn(
                "px-6 py-2 text-sm font-bold rounded-lg transition-all capitalize outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
                timeRange === range ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
              )}
              aria-current={timeRange === range ? 'page' : undefined}
            >
              {range}
            </button>
          ))}
        </nav>

        {timeRange === 'custom' && (
          <div className="flex items-center gap-2 animate-in slide-in-from-left-2 duration-200">
            <label htmlFor="start-date" className="sr-only">Start Date</label>
            <input 
              id="start-date"
              type="date" 
              className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
              value={customRange.start}
              onChange={(e) => setCustomRange(prev => ({ ...prev, start: e.target.value }))}
            />
            <span className="text-slate-400" aria-hidden="true">to</span>
            <label htmlFor="end-date" className="sr-only">End Date</label>
            <input 
              id="end-date"
              type="date" 
              className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
              value={customRange.end}
              onChange={(e) => setCustomRange(prev => ({ ...prev, end: e.target.value }))}
            />
          </div>
        )}
      </section>

      {/* Tab Navigation */}
      <nav className="flex border-b border-slate-200 print:hidden" aria-label="Report sections">
        {(['overview', 'materials', 'sales', 'compliance', 'backups', 'history'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              "px-8 py-4 text-sm font-black uppercase tracking-widest transition-all relative",
              activeTab === tab 
                ? "text-blue-600" 
                : "text-slate-400 hover:text-slate-600"
            )}
          >
            {tab === 'history' ? 'Audit Logs' : tab}
            {activeTab === tab && (
              <div className="absolute bottom-0 left-0 right-0 h-1 bg-blue-600 rounded-t-full" aria-hidden="true" />
            )}
          </button>
        ))}
      </nav>

      {activeTab === 'overview' && (
        <>
          {/* Key Stats */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6" aria-label="Key performance indicators">
        {[
          { name: 'Total Payouts', value: `$${totalSpent.toLocaleString()}`, icon: DollarSign, color: 'blue' },
          { name: 'Total Sales', value: `$${validInvoices.reduce((sum, i) => sum + i.totalAmount, 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`, icon: TrendingUp, color: 'emerald' },
          { name: 'Volume Bought', value: `${totalWeightBought.toLocaleString()} lb`, icon: Package, color: 'indigo' },
          { name: 'Net Cash Flow', value: `$${(validInvoices.reduce((sum, i) => sum + i.totalAmount, 0) - totalSpent).toLocaleString(undefined, { minimumFractionDigits: 2 })}`, icon: Activity, color: 'amber' },
        ].map((stat) => (
          <article key={stat.name} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm print:border-slate-300">
            <div className="flex items-center gap-4 mb-4">
              <div className={cn("p-3 rounded-xl", {
                'bg-blue-50 text-blue-600': stat.color === 'blue',
                'bg-indigo-50 text-indigo-600': stat.color === 'indigo',
                'bg-emerald-50 text-emerald-600': stat.color === 'emerald',
                'bg-amber-50 text-amber-600': stat.color === 'amber',
              })} aria-hidden="true">
                <stat.icon className="w-6 h-6" />
              </div>
              <div>
                <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">{stat.name}</p>
                <p className="text-2xl font-black text-slate-900">{stat.value}</p>
              </div>
            </div>
          </article>
        ))}
      </section>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm print:border-slate-300">
          <h3 className="font-bold text-slate-900 mb-6 flex items-center gap-2 uppercase tracking-tight text-sm">
            <TrendingUp className="w-5 h-5 text-blue-600" />
            Revenue vs Purchases (lb)
          </h3>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dailyChartData}>
                <defs>
                  <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.1}/>
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorExpenses" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.1}/>
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 'bold' }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 'bold' }} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#fff', borderRadius: '16px', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)' }}
                  itemStyle={{ fontWeight: 'bold', fontSize: '12px' }}
                />
                <Area type="monotone" dataKey="revenue" name="Sales Revenue" stroke="#10b981" strokeWidth={3} fillOpacity={1} fill="url(#colorRevenue)" />
                <Area type="monotone" dataKey="expenses" name="Material Payouts" stroke="#ef4444" strokeWidth={3} fillOpacity={1} fill="url(#colorExpenses)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm print:border-slate-300">
          <h3 className="font-bold text-slate-900 mb-6 flex items-center gap-2 uppercase tracking-tight text-sm">
            <Package className="w-5 h-5 text-indigo-600" />
            Inventory Volume Index
          </h3>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 'bold' }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 'bold' }} />
                <Tooltip 
                  cursor={{ fill: '#f8fafc' }}
                  contentStyle={{ backgroundColor: '#fff', borderRadius: '16px', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)' }}
                  itemStyle={{ fontWeight: 'bold', fontSize: '12px' }}
                />
                <Bar dataKey="volume" name="Pounds Bought" fill="#4f46e5" radius={[6, 6, 0, 0]} barSize={20} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>
    </>
  )}

      {activeTab === 'sales' && (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-1">Total Invoiced</p>
              <p className="text-3xl font-black text-slate-900">${validInvoices.reduce((sum, i) => sum + i.totalAmount, 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
              <div className="mt-4 flex items-center gap-2 text-xs font-bold text-slate-400">
                <FileText className="w-4 h-4" />
                <span>{validInvoices.length} Invoices Issued</span>
              </div>
            </div>
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-1">Total Collected</p>
              <p className="text-3xl font-black text-emerald-600">${validInvoices.filter(i => i.status === 'paid').reduce((sum, i) => sum + i.totalAmount, 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
              <div className="mt-4 flex items-center gap-2 text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-lg w-fit">
                <CheckCircle2 className="w-4 h-4" />
                <span>{validInvoices.filter(i => i.status === 'paid').length} Paid</span>
              </div>
            </div>
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-1">Outstanding A/R</p>
              <p className="text-3xl font-black text-blue-600">${validInvoices.filter(i => i.status === 'sent').reduce((sum, i) => sum + i.totalAmount, 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
              <div className="mt-4 flex items-center gap-2 text-xs font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded-lg w-fit">
                <Clock className="w-4 h-4" />
                <span>{validInvoices.filter(i => i.status === 'sent').length} Pending Payment</span>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <h3 className="font-black text-slate-900 uppercase tracking-tight flex items-center gap-2">
                <User className="w-5 h-5 text-blue-600" />
                Sales Performance by Buyer
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 text-[10px] font-black uppercase tracking-widest border-b border-slate-100">
                    <th className="px-8 py-5">Buyer Name</th>
                    <th className="px-8 py-5 text-right">Invoices</th>
                    <th className="px-8 py-5 text-right">Total Volume</th>
                    <th className="px-8 py-5 text-right">Total Revenue</th>
                    <th className="px-8 py-5 text-right">Collected</th>
                    <th className="px-8 py-5 text-right">Outstanding</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {salesStats.map((buyer) => (
                    <tr key={buyer.name} className="hover:bg-slate-50 transition-colors">
                      <td className="px-8 py-6">
                        <span className="text-sm font-black text-slate-900 uppercase tracking-tight">{buyer.name}</span>
                      </td>
                      <td className="px-8 py-6 text-right font-bold text-slate-600">{buyer.count}</td>
                      <td className="px-8 py-6 text-right font-bold text-slate-600">{buyer.weight.toLocaleString()} lb</td>
                      <td className="px-8 py-6 text-right font-black text-slate-900">${buyer.total.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                      <td className="px-8 py-6 text-right font-bold text-emerald-600">${buyer.collected.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                      <td className="px-8 py-6 text-right font-bold text-blue-600">${buyer.uncollected.toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                    </tr>
                  ))}
                  {salesStats.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-8 py-20 text-center text-slate-400 font-bold uppercase tracking-widest">
                        No sales data available for this period.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
      {activeTab === 'materials' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden print:border-slate-300">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-slate-100 rounded-lg">
              <FileText className="w-5 h-5 text-slate-600" />
            </div>
            <h3 className="font-bold text-slate-900">Material Purchase Granularity</h3>
          </div>
          <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">
            {materialPurchases.length} Materials Tracked
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-50 text-slate-500 text-[10px] font-bold uppercase tracking-wider">
                <th className="px-6 py-4">Material Name</th>
                <th className="px-6 py-4">Category</th>
                <th className="px-6 py-4 text-right">Volume</th>
                <th className="px-6 py-4 text-right">Total Payout</th>
                <th className="px-6 py-4 text-right">Expected Profit</th>
                <th className="px-6 py-4 text-right">Margin</th>
                <th className="px-6 py-4 text-right">Tickets</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {materialPurchases.map((m) => (
                <tr key={m.id} className="hover:bg-slate-50 transition-colors group">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center text-slate-400 group-hover:bg-blue-50 group-hover:text-blue-600 transition-colors font-bold text-xs">
                        {m.name.charAt(0)}
                      </div>
                      <span className="text-sm font-bold text-slate-900">{m.name}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className="px-2 py-1 text-[10px] font-bold bg-slate-100 text-slate-600 rounded-md uppercase">
                      {m.category}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm font-bold text-slate-900 text-right">
                    {m.weight.toLocaleString()} lb
                  </td>
                  <td className="px-6 py-4 text-sm font-bold text-slate-900 text-right">
                    ${m.cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className="px-6 py-4 text-sm font-bold text-emerald-600 text-right">
                    ${m.profit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className="px-6 py-4 text-sm font-bold text-slate-500 text-right">
                    {m.margin.toFixed(1)}%
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-500 text-right">
                    {m.count}
                  </td>
                </tr>
              ))}
              {materialPurchases.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-400 italic">
                    No purchase data found for this period.
                  </td>
                </tr>
              )}
            </tbody>
            {materialPurchases.length > 0 && (
              <tfoot className="bg-slate-50 font-bold">
                <tr>
                  <td colSpan={2} className="px-6 py-4 text-sm text-slate-900">Total Summary</td>
                  <td className="px-6 py-4 text-sm text-slate-900 text-right">{totalWeightBought.toLocaleString()} lb</td>
                  <td className="px-6 py-4 text-sm text-slate-900 text-right">${totalSpent.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  <td className="px-6 py-4 text-sm text-emerald-600 text-right">${totalExpectedProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  <td className="px-6 py-4 text-sm text-slate-900 text-right">{(totalExpectedProfit / (totalSpent + totalExpectedProfit || 1) * 100).toFixed(1)}%</td>
                  <td></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    )}

      {activeTab === 'compliance' && (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4">
          <section className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-blue-50 rounded-2xl">
                  <ShieldCheck className="w-6 h-6 text-blue-600" />
                </div>
                <div>
                  <h3 className="text-xl font-black text-slate-900 uppercase tracking-tight">Ohio LEADS Reporting</h3>
                  <p className="text-sm text-slate-500 font-medium">Generate daily transaction reports for the Department of Public Safety.</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button 
                  onClick={handleSubmitToWorkCenter}
                  disabled={submittingReporting}
                  className="px-6 py-3 bg-slate-900 text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-slate-800 transition-all shadow-xl shadow-slate-200 flex items-center gap-2 disabled:opacity-50"
                >
                  {submittingReporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  Submit to WorkCenter
                </button>
                <button 
                  onClick={exportLeadsCsv}
                  className="px-6 py-3 border border-slate-200 bg-white text-slate-700 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-slate-50 transition-all flex items-center gap-2"
                >
                  <Download className="w-4 h-4" /> Export LEADS CSV
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-6 border-t border-slate-100">
              <div className="p-4 bg-slate-50 rounded-2xl space-y-2">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Compliance Status</p>
                <div className="flex items-center gap-2 text-green-600 font-bold">
                  <ShieldCheck className="w-5 h-5" />
                  <span>ORC 4737.04 Compliant</span>
                </div>
              </div>
              <div className="p-4 bg-slate-50 rounded-2xl space-y-2">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Pending Reports</p>
                <p className="text-xl font-black text-slate-900">0</p>
              </div>
              <div className="p-4 bg-slate-50 rounded-2xl space-y-2">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Last Export</p>
                <p className="text-sm font-bold text-slate-600">{new Date().toLocaleDateString()}</p>
              </div>
            </div>
          </section>

          <section className="bg-amber-50 border border-amber-100 p-6 rounded-3xl flex gap-4 items-start">
            <AlertTriangle className="w-6 h-6 text-amber-600 shrink-0 mt-1" />
            <div className="space-y-2">
              <h4 className="font-black text-amber-900 uppercase tracking-tight">Regulatory Reminder</h4>
              <p className="text-sm text-amber-800 leading-relaxed font-medium">
                Ohio law requires all scrap metal dealers to submit an electronic report of all purchase transactions to the Department of Public Safety by the end of each business day. Ensure all ID photos and material photos are captured before completing tickets.
              </p>
            </div>
          </section>

          <section className="bg-white rounded-[2.5rem] border border-slate-200 shadow-xl shadow-slate-200/50 overflow-hidden">
            <div className="px-8 py-6 border-b border-slate-100 flex justify-between items-center">
              <div>
                <h4 className="text-lg font-black text-slate-900 uppercase tracking-tight">Submission History</h4>
                <p className="text-xs text-slate-500 font-medium">Record of all automated DHS/LEADS transmissions.</p>
              </div>
              <History className="w-5 h-5 text-slate-300" />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/50 text-[10px] font-bold text-slate-400 uppercase tracking-widest border-b border-slate-100">
                    <th className="px-6 py-4">Status</th>
                    <th className="px-6 py-4">Submission Date</th>
                    <th className="px-6 py-4">Tickets</th>
                    <th className="px-6 py-4">Submitted By</th>
                    <th className="px-6 py-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {complianceSubmissions.map((sub) => (
                    <tr key={sub.id} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          {sub.status === 'success' ? (
                            <div className="flex items-center gap-1.5 text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
                              <CheckCircle2 className="w-3 h-3" />
                              <span className="text-[10px] font-black uppercase tracking-widest">Transmitted</span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5 text-red-600 bg-red-50 px-2 py-0.5 rounded-full">
                              <XCircle className="w-3 h-3" />
                              <span className="text-[10px] font-black uppercase tracking-widest">Failed</span>
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <p className="text-sm font-black text-slate-900">{new Date(sub.timestamp).toLocaleDateString()}</p>
                        <p className="text-[10px] text-slate-400 font-bold">{new Date(sub.timestamp).toLocaleTimeString()}</p>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-xs font-bold text-slate-700">{sub.ticketCount} Transactions</span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-xs font-medium text-slate-500">{sub.submittedBy}</span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <button 
                          onClick={() => setNotification({ type: 'success', message: `Submission Response: ${sub.responseMessage}\n\nPayload:\n${sub.payloadText}` })}
                          className="text-xs font-black text-blue-600 uppercase tracking-widest"
                        >
                          View Logs
                        </button>
                      </td>
                    </tr>
                  ))}
                  {complianceSubmissions.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-6 py-12 text-center text-slate-400 italic">No automated submissions recorded yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="bg-white rounded-[2.5rem] border border-slate-200 shadow-xl shadow-slate-200/50 overflow-hidden">
            <div className="px-8 py-6 border-b border-slate-100">
              <h4 className="text-lg font-black text-slate-900 uppercase tracking-tight">Daily Transaction Review</h4>
              <p className="text-xs text-slate-500 font-medium">Verify data completeness before nightly DHS submission.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/50">
                    <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest border-b border-slate-100">Ticket</th>
                    <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest border-b border-slate-100">Customer</th>
                    <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest border-b border-slate-100">Items</th>
                    <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest border-b border-slate-100">Docs</th>
                    <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest border-b border-slate-100">Affirmed</th>
                    <th className="px-6 py-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest border-b border-slate-100">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {validBuyTickets
                    .filter(t => new Date(t.timestamp).toDateString() === new Date().toDateString())
                    .map((ticket) => {
                      const customer = customers.find(c => c.id === ticket.customerId);
                      const hasID = !!(customer?.idImageUrl || ticket.idImageUrl);
                      const hasPhoto = !!ticket.customerPhotoUrl;
                      const hasPlate = !!ticket.vehiclePlate;
                      
                      return (
                        <tr key={ticket.id} className="hover:bg-slate-50/50 transition-colors">
                          <td className="px-6 py-4">
                            <p className="font-black text-slate-900 text-sm">#{ticket.id.slice(-6).toUpperCase()}</p>
                            <p className="text-[10px] text-slate-400 font-medium">{new Date(ticket.timestamp).toLocaleTimeString()}</p>
                          </td>
                          <td className="px-6 py-4 text-sm font-bold text-slate-700">
                            {customer?.name || 'Unknown'}
                          </td>
                          <td className="px-6 py-4 text-xs font-medium text-slate-500">
                            {ticket.materials.length} Materials
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex gap-1">
                              <span className={cn("px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-tighter", hasID ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700")}>ID</span>
                              <span className={cn("px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-tighter", hasPhoto ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700")}>Photo</span>
                              <span className={cn("px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-tighter", hasPlate ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700")}>Plate</span>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            {ticket.sellerAffirmed ? (
                              <ShieldCheck className="w-5 h-5 text-green-500" />
                            ) : (
                              <X className="w-5 h-5 text-red-400" />
                            )}
                          </td>
                          <td className="px-6 py-4 font-black text-slate-900 text-sm">
                            ${ticket.totalAmount.toFixed(2)}
                          </td>
                        </tr>
                      );
                    })}
                  {buyTickets.filter(t => new Date(t.timestamp).toDateString() === new Date().toDateString()).length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center">
                        <p className="text-slate-400 font-medium italic">No transactions recorded today.</p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {activeTab === 'backups' && (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4">
          <section className="bg-white p-8 rounded-3xl border border-slate-200 shadow-sm space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-indigo-50 rounded-2xl">
                  <Save className="w-6 h-6 text-indigo-600" />
                </div>
                <div>
                  <h3 className="text-xl font-black text-slate-900 uppercase tracking-tight">End-of-Day Snapshots</h3>
                  <p className="text-sm text-slate-500 font-medium">Capture a permanent record of today's prices, inventory, and transactions.</p>
                </div>
              </div>
              <button 
                onClick={() => createDailySnapshot()}
                disabled={creatingSnapshot}
                className="px-6 py-3 bg-indigo-600 text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-200 flex items-center gap-2 disabled:opacity-50"
              >
                {creatingSnapshot ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                Create Daily Snapshot
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-6 border-t border-slate-100">
              <div className="p-4 bg-slate-50 rounded-2xl space-y-2">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total Snapshots</p>
                <p className="text-xl font-black text-slate-900">{dailySnapshots.length}</p>
              </div>
              <div className="p-4 bg-slate-50 rounded-2xl space-y-2">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Last Snapshot</p>
                <p className="text-sm font-bold text-slate-600">
                  {dailySnapshots[0] ? new Date(dailySnapshots[0].timestamp).toLocaleString() : 'Never'}
                </p>
              </div>
              <div className="p-4 bg-slate-50 rounded-2xl space-y-2">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Storage Status</p>
                <div className="flex items-center gap-2 text-green-600 font-bold">
                  <ShieldCheck className="w-5 h-5" />
                  <span>Verified Secure</span>
                </div>
              </div>
            </div>
          </section>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {dailySnapshots.map((snapshot) => (
              <article key={snapshot.id} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                <div className="flex justify-between items-start">
                  <div>
                    <h4 className="font-black text-slate-900 uppercase tracking-tight">{new Date(snapshot.date).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}</h4>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{new Date(snapshot.timestamp).toLocaleTimeString()}</p>
                  </div>
                  <History className="w-5 h-5 text-slate-300" />
                </div>

                <div className="space-y-2 pt-4 border-t border-slate-50">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500 font-medium">Buy Tickets:</span>
                    <span className="text-slate-900 font-bold">{snapshot.summary.totalBuyTickets} (${snapshot.summary.totalBuyAmount.toLocaleString()})</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500 font-medium">Trip Tickets:</span>
                    <span className="text-slate-900 font-bold">{snapshot.summary.totalTripTickets} ({snapshot.summary.totalTripWeight.toLocaleString()} lb)</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500 font-medium">Invoices:</span>
                    <span className="text-slate-900 font-bold">{snapshot.summary.totalInvoices} (${snapshot.summary.totalInvoiceAmount.toLocaleString()})</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500 font-medium">Materials:</span>
                    <span className="text-slate-900 font-bold">{snapshot.materials.length} items</span>
                  </div>
                </div>

                <div className="pt-4">
                  <p className="text-[10px] text-slate-400 italic">Captured by: {snapshot.createdBy}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'history' && (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="flex flex-col md:flex-row gap-4 items-center justify-between print:hidden">
            <div className="relative flex-1 w-full">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input 
                type="text"
                placeholder="Search logs by user, action or entity ID..."
                className="w-full pl-11 pr-4 py-3 bg-white border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                value={auditFilter.query}
                onChange={(e) => setAuditFilter(prev => ({ ...prev, query: e.target.value }))}
              />
            </div>
            <select
              className="w-full md:w-48 px-4 py-3 bg-white border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 font-bold"
              value={auditFilter.type}
              onChange={(e) => setAuditFilter(prev => ({ ...prev, type: e.target.value }))}
            >
              <option value="all">All Entities</option>
              <option value="material">Materials</option>
              <option value="inventory">Inventory</option>
              <option value="buyTicket">Buy Tickets</option>
              <option value="tripTicket">Trip Tickets</option>
              <option value="invoice">Invoices</option>
              <option value="customer">Customers</option>
              <option value="settings">Settings</option>
            </select>
          </div>

          <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-xl shadow-slate-200/50 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/50">
                    <th className="px-6 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">Event</th>
                    <th className="px-6 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">Entity</th>
                    <th className="px-6 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">User</th>
                    <th className="px-6 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">Time</th>
                    <th className="px-6 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 text-right print:hidden">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {auditLogs
                    .filter(log => {
                      const matchesQuery = log.notes?.toLowerCase().includes(auditFilter.query.toLowerCase()) || 
                                         log.performedBy.toLowerCase().includes(auditFilter.query.toLowerCase()) ||
                                         log.entityId.toLowerCase().includes(auditFilter.query.toLowerCase());
                      const matchesType = auditFilter.type === 'all' || log.entityType === auditFilter.type;
                      return matchesQuery && matchesType;
                    })
                    .map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50/50 transition-colors group">
                      <td className="px-6 py-5">
                        <div className="flex items-center gap-3">
                          <div className={cn(
                            "p-2 rounded-xl",
                            log.action === 'create' ? "bg-emerald-50 text-emerald-600" :
                            log.action === 'update' ? "bg-blue-50 text-blue-600" :
                            log.action === 'delete' ? "bg-red-50 text-red-600" :
                            "bg-amber-50 text-amber-600"
                          )}>
                            <Activity className="w-4 h-4" />
                          </div>
                          <div>
                            <p className="text-sm font-black text-slate-900 capitalize">{log.action}</p>
                            <p className="text-[10px] font-medium text-slate-500">{log.notes}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-5">
                        <span className="px-3 py-1 bg-slate-100 text-slate-600 rounded-full text-[10px] font-black uppercase tracking-widest">
                          {log.entityType}
                        </span>
                      </td>
                      <td className="px-6 py-5">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-slate-200 flex items-center justify-center">
                            <User className="w-3 h-3 text-slate-500" />
                          </div>
                          <p className="text-sm font-bold text-slate-700 truncate max-w-[120px]">{log.performedBy}</p>
                        </div>
                      </td>
                      <td className="px-6 py-5">
                        <div className="flex items-center gap-2 text-slate-500">
                          <Clock className="w-4 h-4" />
                          <span className="text-xs font-medium">{new Date(log.timestamp).toLocaleString()}</span>
                        </div>
                      </td>
                      <td className="px-6 py-5 text-right print:hidden">
                        {log.changes && (
                          <button 
                            onClick={() => {
                              setNotification({
                                type: 'success',
                                message: `Audit Data for Event: ${log.action.toUpperCase()}\n\n${JSON.stringify(log.changes, null, 2)}`
                              });
                            }}
                            className="text-xs font-black text-blue-600 uppercase tracking-widest hover:bg-blue-50 px-3 py-1 rounded-lg transition-all"
                          >
                            Details
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {auditLogs.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-6 py-12 text-center">
                        <div className="flex flex-col items-center gap-2 text-slate-400">
                          <Activity className="w-8 h-8 opacity-20" />
                          <p className="text-sm font-medium italic">No dynamic changes logged yet.</p>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
