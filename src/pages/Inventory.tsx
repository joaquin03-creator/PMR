import { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { InventoryItem, Material } from '../types';
import { Package, ArrowUpRight, ArrowDownLeft, AlertCircle, Loader2, Lock } from 'lucide-react';
import { cn } from '../lib/utils';
import { COMPANY_NAME, handleImageError } from '../constants';
import { BrandLogo } from '../components/BrandLogo';


import { handleFirestoreError, OperationType } from '../lib/firestore-errors';

import { UserProfile } from '../types';

export default function Inventory({ profile }: { profile: UserProfile | null }) {
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);

  if (profile?.role !== 'manager' || !profile?.permissions?.canManageInventory) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-8">
        <div className="p-6 bg-red-50 rounded-full text-red-600 mb-6">
          <Lock className="w-12 h-12" />
        </div>
        <h2 className="text-2xl font-black text-slate-900 uppercase tracking-tight">Access Restricted</h2>
        <p className="text-slate-500 mt-2 max-w-md">You do not have the required permissions to manage inventory. Please contact your system administrator.</p>
      </div>
    );
  }

  useEffect(() => {
    const unsubMaterials = onSnapshot(collection(db, 'materials'), (snapshot) => {
      setMaterials(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Material[]);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'materials'));

    const unsubInventory = onSnapshot(collection(db, 'inventory'), (snapshot) => {
      setInventory(snapshot.docs.map(doc => doc.data() as InventoryItem));
      setLoading(false);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'inventory'));

    return () => {
      unsubMaterials();
      unsubInventory();
    };
  }, []);

  const getMaterialName = (id: string) => materials.find(m => m.id === id)?.name || 'Unknown';
  const getMaterialUnit = (id: string) => materials.find(m => m.id === id)?.unit || 'lb';

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <main className="space-y-6">
      <header className="flex items-center gap-6">
        <div className="w-20 h-10 flex items-center justify-center overflow-hidden shrink-0">
          <BrandLogo className="w-full h-full object-contain" />
        </div>
        <div>
          <h1 className="text-4xl font-black text-slate-900 tracking-tight font-display">Inventory Tracking</h1>
          <p className="text-slate-500 font-medium mt-1">Real-time stock levels based on buy and trip tickets.</p>
        </div>
      </header>

      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6" aria-label="Material Inventory">
        {materials.map((material) => {
          const invItem = inventory.find(i => i.materialId === material.id);
          const weight = invItem?.currentWeight || 0;
          const isLow = weight < 100; // Example threshold

          return (
            <article 
              key={material.id} 
              className="bg-white rounded-[2rem] border border-slate-200 p-8 shadow-sm hover:shadow-xl hover:shadow-slate-200/50 transition-all group"
              aria-labelledby={`material-title-${material.id}`}
            >
              <div className="flex items-start justify-between mb-6">
                <div className="p-3 bg-blue-50 rounded-2xl group-hover:scale-110 transition-transform">
                  <Package className="w-6 h-6 text-blue-600" aria-hidden="true" />
                </div>
                {isLow && (
                  <span className="flex items-center gap-1 text-[10px] font-black text-amber-600 bg-amber-50 px-3 py-1.5 rounded-full uppercase tracking-widest border border-amber-100" role="status">
                    <AlertCircle className="w-3.5 h-3.5" aria-hidden="true" />
                    Low Stock
                  </span>
                )}
              </div>
              
              <h3 id={`material-title-${material.id}`} className="font-black text-slate-900 text-xl font-display uppercase tracking-tight">{material.name}</h3>
              <p className="text-xs text-slate-400 uppercase font-black tracking-widest mt-1.5">{material.category}</p>
              
              <div className="mt-8">
                <p className="text-4xl font-black text-slate-900 font-display">
                  {weight.toLocaleString()} <span className="text-sm font-medium text-slate-400 uppercase tracking-widest ml-1">{material.unit}</span>
                </p>
                <div className="flex items-center gap-2 mt-4">
                  <div className="flex-1 h-3 bg-slate-100 rounded-full overflow-hidden shadow-inner" role="progressbar" aria-valuenow={weight} aria-valuemin={0} aria-valuemax={2000} aria-label={`${material.name} stock level`}>
                    <div 
                      className={cn(
                        "h-full rounded-full transition-all duration-1000 ease-out",
                        isLow ? "bg-amber-500" : "bg-blue-600"
                      )}
                      style={{ width: `${Math.min((weight / 2000) * 100, 100)}%` }}
                    />
                  </div>
                </div>
              </div>

              <div className="mt-8 pt-8 border-t border-slate-50 flex items-center justify-between">
                <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  Updated: {invItem ? new Date(invItem.lastUpdated).toLocaleDateString() : 'Never'}
                </div>
                <button 
                  className="flex items-center gap-2 text-blue-600 font-black text-xs uppercase tracking-widest hover:text-blue-700 transition-colors group/btn outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 rounded-xl px-4 py-3 bg-blue-50/50 active:scale-95"
                  aria-label={`View history for ${material.name}`}
                >
                  History
                  <ArrowUpRight className="w-4 h-4 group-hover/btn:translate-x-0.5 group-hover/btn:-translate-y-0.5 transition-transform" aria-hidden="true" />
                </button>
              </div>
            </article>
          );
        })}
      </section>

      {materials.length === 0 && (
        <div className="text-center py-12 bg-white rounded-xl border border-dashed border-slate-300">
          <Package className="w-12 h-12 text-slate-300 mx-auto mb-4" aria-hidden="true" />
          <h3 className="text-lg font-medium text-slate-900">No materials defined</h3>
          <p className="text-slate-500">Go to Manage Prices to add materials to your yard.</p>
        </div>
      )}
    </main>
  );
}
