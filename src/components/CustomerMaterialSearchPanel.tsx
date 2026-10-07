import { useMemo, useState } from 'react';
import { BuyTicket, Customer, Material } from '../types';
import {
  searchCustomersByMaterial,
  CustomerSearchCriteria,
  CustomerSearchResult,
  QuantityMode,
  VisitFilter,
  RecencyFilter,
  CustomerTypeFilter,
} from '../lib/customerMaterialSearch';
import { Search, Copy, Check, Phone, Users, Package, ArrowRight } from 'lucide-react';
import { cn } from '../lib/utils';

interface CustomerMaterialSearchPanelProps {
  buyTickets: BuyTicket[];
  customers: Customer[];
  materials: Material[];
  onViewCustomerTickets: (customerName: string) => void;
}

function daysAgoLabel(days: number): string {
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return `${days} days ago`;
}

export default function CustomerMaterialSearchPanel({
  buyTickets,
  customers,
  materials,
  onViewCustomerTickets,
}: CustomerMaterialSearchPanelProps) {
  const [matchBy, setMatchBy] = useState<'material' | 'category'>('material');
  const [selectedMaterialId, setSelectedMaterialId] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [minWeightLbs, setMinWeightLbs] = useState<number | ''>('');
  const [quantityMode, setQuantityMode] = useState<QuantityMode>('single');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [visitFilter, setVisitFilter] = useState<VisitFilter>('any');
  const [recencyFilter, setRecencyFilter] = useState<RecencyFilter>('any');
  const [customerTypeFilter, setCustomerTypeFilter] = useState<CustomerTypeFilter>('any');
  const [copiedAll, setCopiedAll] = useState(false);
  const [copiedPhoneId, setCopiedPhoneId] = useState<string | null>(null);

  const sortedMaterials = useMemo(
    () => [...materials].sort((a, b) => a.name.localeCompare(b.name)),
    [materials]
  );

  const categories = useMemo(
    () => Array.from(new Set(materials.map(m => m.category).filter(Boolean))).sort(),
    [materials]
  );

  const materialIds = useMemo(() => {
    if (matchBy === 'material') return selectedMaterialId ? [selectedMaterialId] : [];
    return selectedCategory ? materials.filter(m => m.category === selectedCategory).map(m => m.id) : [];
  }, [matchBy, selectedMaterialId, selectedCategory, materials]);

  // A blank weight means "any amount" -- picking a material alone is a valid search.
  const hasValidSearch = materialIds.length > 0 && (minWeightLbs === '' || (typeof minWeightLbs === 'number' && minWeightLbs >= 0));

  const results: CustomerSearchResult[] = useMemo(() => {
    if (!hasValidSearch) return [];
    const criteria: CustomerSearchCriteria = {
      materialIds,
      minWeightLbs: typeof minWeightLbs === 'number' ? minWeightLbs : 0,
      quantityMode,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      visitFilter,
      recencyFilter,
      customerTypeFilter,
    };
    return searchCustomersByMaterial(buyTickets, customers, criteria);
  }, [hasValidSearch, materialIds, minWeightLbs, quantityMode, dateFrom, dateTo, visitFilter, recencyFilter, customerTypeFilter, buyTickets, customers]);

  const copyAllPhones = () => {
    const phones = results.map(r => r.customer.phone).filter((p): p is string => !!p);
    if (phones.length === 0) return;
    navigator.clipboard.writeText(phones.join('\n'));
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
  };

  const copyPhone = (customerId: string, phone: string) => {
    navigator.clipboard.writeText(phone);
    setCopiedPhoneId(customerId);
    setTimeout(() => setCopiedPhoneId(null), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Filter controls */}
      <section className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 space-y-5" aria-label="Customer material search filters">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Match by</label>
            <div className="flex items-center gap-2 bg-slate-100 p-1.5 rounded-2xl">
              <button
                type="button"
                onClick={() => setMatchBy('material')}
                className={cn(
                  'flex-1 px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all',
                  matchBy === 'material' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'
                )}
              >
                Exact Material
              </button>
              <button
                type="button"
                onClick={() => setMatchBy('category')}
                className={cn(
                  'flex-1 px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all',
                  matchBy === 'category' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'
                )}
              >
                Category
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">
              {matchBy === 'material' ? 'Material' : 'Category'}
            </label>
            {matchBy === 'material' ? (
              <select
                value={selectedMaterialId}
                onChange={(e) => setSelectedMaterialId(e.target.value)}
                className="w-full px-4 py-3 bg-white border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 font-medium text-sm"
              >
                <option value="">Select a material&hellip;</option>
                {sortedMaterials.map(m => (
                  <option key={m.id} value={m.id}>{m.name} ({m.code})</option>
                ))}
              </select>
            ) : (
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="w-full px-4 py-3 bg-white border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 font-medium text-sm"
              >
                <option value="">Select a category&hellip;</option>
                {categories.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Minimum weight (lbs)</label>
            <input
              type="number"
              min="0"
              placeholder="e.g. 200"
              value={minWeightLbs}
              onChange={(e) => setMinWeightLbs(e.target.value === '' ? '' : Number(e.target.value))}
              className="w-full px-4 py-3 bg-white border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 font-mono font-bold text-sm"
            />
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Count as</label>
            <div className="flex items-center gap-2 bg-slate-100 p-1.5 rounded-2xl">
              <button
                type="button"
                onClick={() => setQuantityMode('single')}
                className={cn(
                  'flex-1 px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all',
                  quantityMode === 'single' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'
                )}
              >
                Single Ticket
              </button>
              <button
                type="button"
                onClick={() => setQuantityMode('cumulative')}
                className={cn(
                  'flex-1 px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all',
                  quantityMode === 'cumulative' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'
                )}
              >
                Cumulative Total
              </button>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">From date (optional)</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full px-4 py-3 bg-white border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 font-medium text-sm"
            />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">To date (optional)</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full px-4 py-3 bg-white border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 font-medium text-sm"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Visits</label>
            <select
              value={visitFilter}
              onChange={(e) => setVisitFilter(e.target.value as VisitFilter)}
              className="w-full px-4 py-3 bg-white border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 font-medium text-sm"
            >
              <option value="any">Any</option>
              <option value="first-time">First-time only (1 visit)</option>
              <option value="repeat">Repeat (2+ visits)</option>
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Hasn't been back in</label>
            <select
              value={recencyFilter}
              onChange={(e) => setRecencyFilter(e.target.value as RecencyFilter)}
              className="w-full px-4 py-3 bg-white border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 font-medium text-sm"
            >
              <option value="any">Any time</option>
              <option value="30">30+ days</option>
              <option value="60">60+ days</option>
              <option value="90">90+ days</option>
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Customer type</label>
            <select
              value={customerTypeFilter}
              onChange={(e) => setCustomerTypeFilter(e.target.value as CustomerTypeFilter)}
              className="w-full px-4 py-3 bg-white border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-blue-500 font-medium text-sm"
            >
              <option value="any">Any</option>
              <option value="individual">Individual</option>
              <option value="commercial">Commercial</option>
              <option value="industrial">Industrial</option>
            </select>
          </div>
        </div>
      </section>

      {/* Results */}
      {!hasValidSearch ? (
        <div className="text-center py-16 text-slate-400">
          <Search className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm font-bold uppercase tracking-wider">Pick a material to search (weight is optional)</p>
        </div>
      ) : (
        <section className="space-y-4" aria-label="Search results">
          <div className="flex items-center justify-between">
            <p className="text-xs font-black uppercase tracking-widest text-slate-500">
              {results.length} {results.length === 1 ? 'customer' : 'customers'} found
            </p>
            {results.length > 0 && (
              <button
                type="button"
                onClick={copyAllPhones}
                className="flex items-center gap-2 px-5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-black uppercase tracking-wider text-slate-700 hover:bg-slate-50 transition-all shadow-sm active:scale-95"
              >
                {copiedAll ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                {copiedAll ? 'Copied!' : 'Copy All Phone Numbers'}
              </button>
            )}
          </div>

          {results.length === 0 ? (
            <div className="text-center py-16 text-slate-400">
              <Users className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p className="text-sm font-bold uppercase tracking-wider">No customers match these filters</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {results.map(r => (
                <div key={r.customerId} className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-black text-slate-900 truncate">{r.customer.name}</p>
                      {r.customer.businessName && (
                        <p className="text-xs text-slate-500 font-medium truncate">{r.customer.businessName}</p>
                      )}
                    </div>
                    <span className="shrink-0 px-2.5 py-1 bg-slate-100 rounded-lg text-[9px] font-black uppercase tracking-widest text-slate-500">
                      {r.customer.customerType || 'individual'}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-slate-50 rounded-xl p-3 space-y-0.5">
                      <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 flex items-center gap-1">
                        <Package className="w-3 h-3" /> Matched
                      </p>
                      <p className="font-mono font-black text-slate-900 text-sm">
                        {r.matchedWeightLbs.toLocaleString(undefined, { maximumFractionDigits: 1 })} lbs
                      </p>
                      {quantityMode === 'cumulative' && (
                        <p className="text-[9px] text-slate-400 font-bold">across {r.matchedTickets.length} ticket{r.matchedTickets.length === 1 ? '' : 's'}</p>
                      )}
                    </div>
                    <div className="bg-slate-50 rounded-xl p-3 space-y-0.5">
                      <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">Last visit</p>
                      <p className="font-mono font-black text-slate-900 text-sm">{daysAgoLabel(r.daysSinceLastVisit)}</p>
                      <p className="text-[9px] text-slate-400 font-bold">{r.totalVisits} visit{r.totalVisits === 1 ? '' : 's'} all-time</p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                    {r.customer.phone ? (
                      <button
                        type="button"
                        onClick={() => copyPhone(r.customerId, r.customer.phone as string)}
                        className="flex items-center gap-2 text-xs font-bold text-slate-600 hover:text-slate-900 transition-colors"
                      >
                        {copiedPhoneId === r.customerId ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Phone className="w-3.5 h-3.5" />}
                        {copiedPhoneId === r.customerId ? 'Copied' : r.customer.phone}
                      </button>
                    ) : (
                      <span className="text-xs text-slate-300 font-bold uppercase tracking-wider">No phone on file</span>
                    )}
                    <button
                      type="button"
                      onClick={() => onViewCustomerTickets(r.customer.name)}
                      className="flex items-center gap-1 text-xs font-black text-blue-600 hover:underline"
                    >
                      View Tickets <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
