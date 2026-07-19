import { useState, useEffect, useMemo, useCallback } from 'react';
import { auth, db } from '../firebase';
import { collection, onSnapshot, query, orderBy, addDoc, doc, updateDoc, deleteDoc, setDoc, increment } from 'firebase/firestore';
import { InventoryItem, Material, ExternalSale, UserProfile, LoadPlan, LoadPlanBox } from '../types';
import { 
  Package, 
  ArrowUpRight, 
  ArrowDownLeft, 
  AlertCircle, 
  Loader2, 
  Lock,
  Plus,
  Search,
  Calendar,
  DollarSign,
  X,
  History,
  Trash2,
  Edit2,
  FileText,
  TrendingUp,
  BarChart3,
  ArrowUpDown,
  Truck,
  Info
} from 'lucide-react';
import { cn } from '../lib/utils';
import { COMPANY_NAME, handleImageError } from '../constants';
import { BrandLogo } from '../components/BrandLogo';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';
import { logAuditEvent } from '../lib/audit';

export default function Inventory({ profile }: { profile: UserProfile | null }) {
  const [activeTab, setActiveTab] = useState<'inventory' | 'sales' | 'planner'>('inventory');
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [sales, setSales] = useState<ExternalSale[]>([]);
  const [loadPlans, setLoadPlans] = useState<LoadPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);

  // Sales Search
  const [salesSearch, setSalesSearch] = useState('');

  // Stock Search, Sort, and Category Filter
  const [stockSearch, setStockSearch] = useState('');
  const [stockSort, setStockSort] = useState<'weight-desc' | 'weight-asc' | 'code' | 'name'>('weight-desc');
  const [selectedCategory, setSelectedCategory] = useState('all');

  // Load Planner State
  const [showLoadModal, setShowLoadModal] = useState(false);
  const [editingLoad, setEditingLoad] = useState<LoadPlan | null>(null);
  const [selectedLoadId, setSelectedLoadId] = useState<string | null>(null);
  const [loadSearch, setLoadSearch] = useState('');
  const [deductFromStock, setDeductFromStock] = useState(true);

  // Current load draft builder state (8 slots)
  const [draftBoxes, setDraftBoxes] = useState<LoadPlanBox[]>(
    Array.from({ length: 8 }, (_, idx) => ({ slotIndex: idx }))
  );
  const [loadDate, setLoadDate] = useState('');
  const [loadNotes, setLoadNotes] = useState('');
  const [loadCarrier, setLoadCarrier] = useState('');

  // Modal State
  const [showSaleModal, setShowSaleModal] = useState(false);
  const [editingSale, setEditingSale] = useState<ExternalSale | null>(null);

  // Form State
  const [modalMaterialId, setModalMaterialId] = useState('');
  const [modalWeight, setModalWeight] = useState('');
  const [modalPrice, setModalPrice] = useState('');
  const [modalDate, setModalDate] = useState('');
  const [modalNotes, setModalNotes] = useState('');

  // Hooks will run unconditionally. Permission check will happen after loading.

  useEffect(() => {
    if (!auth.currentUser) return;

    const unsubMaterials = onSnapshot(collection(db, 'materials'), (snapshot) => {
      setMaterials(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Material[]);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'materials'));

    const unsubInventory = onSnapshot(collection(db, 'inventory'), (snapshot) => {
      setInventory(snapshot.docs.map(doc => doc.data() as InventoryItem));
      setLoading(false);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'inventory'));

    const unsubSales = onSnapshot(
      query(collection(db, 'externalSales'), orderBy('date', 'desc')),
      (snapshot) => {
        setSales(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as ExternalSale[]);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'externalSales')
    );

    const unsubLoadPlans = onSnapshot(
      query(collection(db, 'loadPlans'), orderBy('date', 'desc')),
      (snapshot) => {
        setLoadPlans(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as LoadPlan[]);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'loadPlans')
    );

    return () => {
      unsubMaterials();
      unsubInventory();
      unsubSales();
      unsubLoadPlans();
    };
  }, [profile]);

  const [loadDraftLoaded, setLoadDraftLoaded] = useState(false);

  // Load draft load plan on mount
  useEffect(() => {
    const saved = localStorage.getItem('pm_draft_loadplan');
    if (saved) {
      try {
        const draft = JSON.parse(saved);
        if (draft.showLoadModal) {
          setEditingLoad(draft.editingLoad || null);
          setDraftBoxes(draft.draftBoxes || Array.from({ length: 8 }, (_, idx) => ({ slotIndex: idx, materialId: '', weight: 0, notes: '' })));
          setLoadDate(draft.loadDate || '');
          setLoadNotes(draft.loadNotes || '');
          setLoadCarrier(draft.loadCarrier || '');
          setDeductFromStock(draft.deductFromStock !== undefined ? draft.deductFromStock : true);
          setShowLoadModal(true);
        }
      } catch (err) {
        console.error('Error loading load plan draft:', err);
      }
    }
    setLoadDraftLoaded(true);
  }, []);

  // Save draft load plan on change (Autosave after any box or form edit)
  useEffect(() => {
    if (!loadDraftLoaded) return;

    if (showLoadModal) {
      const draft = {
        showLoadModal,
        editingLoad,
        draftBoxes,
        loadDate,
        loadNotes,
        loadCarrier,
        deductFromStock
      };
      localStorage.setItem('pm_draft_loadplan', JSON.stringify(draft));
    } else {
      localStorage.removeItem('pm_draft_loadplan');
    }
  }, [showLoadModal, editingLoad, draftBoxes, loadDate, loadNotes, loadCarrier, deductFromStock, loadDraftLoaded]);

  const getMaterialName = (id: string) => materials.find(m => m.id === id)?.name || 'Unknown';
  const getMaterialCode = (id: string) => materials.find(m => m.id === id)?.code || '-';
  const getMaterialUnit = (id: string) => materials.find(m => m.id === id)?.unit || 'lb';

  const handleOpenRecordSale = (materialId?: string) => {
    setEditingSale(null);
    if (materialId) {
      setModalMaterialId(materialId);
      const material = materials.find(m => m.id === materialId);
      setModalPrice(material?.salePrice.toString() || '');
    } else {
      setModalMaterialId('');
      setModalPrice('');
    }
    setModalWeight('');
    setModalDate(new Date().toISOString().split('T')[0]);
    setModalNotes('');
    setShowSaleModal(true);
  };

  const handleOpenEditSale = (sale: ExternalSale) => {
    setEditingSale(sale);
    setModalMaterialId(sale.materialId);
    setModalWeight(sale.weight.toString());
    setModalPrice(sale.salePrice.toString());
    setModalDate(sale.date.split('T')[0]);
    setModalNotes(sale.notes || '');
    setShowSaleModal(true);
  };

  const handleSubmitSale = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modalMaterialId || !modalWeight || !modalPrice || !modalDate || processing) return;
    setProcessing(true);

    try {
      const weightNum = Number(modalWeight);
      const priceNum = Number(modalPrice);
      const material = materials.find(m => m.id === modalMaterialId);
      const materialName = material?.name || 'Unknown';
      const materialUnit = material?.unit || 'lb';
      const saleDate = new Date(modalDate + 'T12:00:00Z').toISOString();

      if (editingSale) {
        // Edit existing sale
        const oldWeight = editingSale.weight;
        const weightDiff = weightNum - oldWeight;

        const updatedData = {
          materialId: modalMaterialId,
          weight: weightNum,
          salePrice: priceNum,
          date: saleDate,
          notes: modalNotes,
          recordedAt: new Date().toISOString(),
          recordedBy: profile?.email || 'System'
        };

        // 1. Update the sale document
        await updateDoc(doc(db, 'externalSales', editingSale.id), updatedData);

        // 2. Adjust inventory: subtract the new weight, add back the old weight (net change is -weightDiff)
        await setDoc(doc(db, 'inventory', modalMaterialId), {
          materialId: modalMaterialId,
          currentWeight: increment(-weightDiff),
          lastUpdated: new Date().toISOString()
        }, { merge: true });

        // 3. Log Audit Event
        await logAuditEvent(
          'inventory',
          modalMaterialId,
          'update',
          { before: editingSale, after: updatedData },
          `Edited external sale (ID: ${editingSale.id}) of ${materialName}: adjusted weight from ${oldWeight} to ${weightNum} ${materialUnit}`
        );

      } else {
        // Create new sale
        const saleData = {
          materialId: modalMaterialId,
          weight: weightNum,
          salePrice: priceNum,
          date: saleDate,
          notes: modalNotes,
          recordedAt: new Date().toISOString(),
          recordedBy: profile?.email || 'System'
        };

        // 1. Add external sale record
        const docRef = await addDoc(collection(db, 'externalSales'), saleData);

        // 2. Decrement inventory
        await setDoc(doc(db, 'inventory', modalMaterialId), {
          materialId: modalMaterialId,
          currentWeight: increment(-weightNum),
          lastUpdated: new Date().toISOString()
        }, { merge: true });

        // 3. Log Audit Event
        await logAuditEvent(
          'inventory',
          modalMaterialId,
          'update',
          { after: saleData },
          `Recorded external sale (ID: ${docRef.id}) of ${weightNum} ${materialUnit} of ${materialName}`
        );
      }

      setShowSaleModal(false);
      setEditingSale(null);
    } catch (err) {
      handleFirestoreError(err, editingSale ? OperationType.UPDATE : OperationType.CREATE, 'externalSales');
    } finally {
      setProcessing(false);
    }
  };

  const handleDeleteSale = async (sale: ExternalSale) => {
    const material = materials.find(m => m.id === sale.materialId);
    const materialName = material?.name || 'Unknown';
    const materialUnit = material?.unit || 'lb';

    if (!window.confirm(`Are you sure you want to delete this external sale record? This will restore ${sale.weight.toLocaleString()} ${materialUnit} back to inventory.`)) return;
    setProcessing(true);

    try {
      // 1. Restore inventory
      await setDoc(doc(db, 'inventory', sale.materialId), {
        materialId: sale.materialId,
        currentWeight: increment(sale.weight),
        lastUpdated: new Date().toISOString()
      }, { merge: true });

      // 2. Delete the record
      await deleteDoc(doc(db, 'externalSales', sale.id));

      // 3. Log Audit Event
      await logAuditEvent(
        'inventory',
        sale.materialId,
        'update',
        undefined,
        `Deleted external sale record (ID: ${sale.id}) and returned ${sale.weight} ${materialUnit} of ${materialName} to inventory`
      );

    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'externalSales');
    } finally {
      setProcessing(false);
    }
  };

  const handleOpenCreateLoad = () => {
    setEditingLoad(null);
    setDraftBoxes(Array.from({ length: 8 }, (_, idx) => ({ slotIndex: idx, materialId: '', weight: 0, notes: '' })));
    setLoadDate(new Date().toISOString().split('T')[0]);
    setLoadNotes('');
    setLoadCarrier('');
    setDeductFromStock(true);
    setShowLoadModal(true);
  };

  const handleOpenEditLoad = (load: LoadPlan) => {
    setEditingLoad(load);
    
    const boxesMap = Array.from({ length: 8 }, (_, idx) => {
      const existing = load.boxes.find(b => b.slotIndex === idx);
      return existing || { slotIndex: idx, materialId: '', weight: 0, notes: '' };
    });
    
    setDraftBoxes(boxesMap);
    setLoadDate(load.date.split('T')[0]);
    setLoadNotes(load.notes || '');
    setLoadCarrier(load.carrier || '');
    setDeductFromStock(true);
    setShowLoadModal(true);
  };

  const handleUpdateBoxSlot = (slotIdx: number, field: keyof LoadPlanBox, value: any) => {
    setDraftBoxes(prev => prev.map(box => {
      if (box.slotIndex === slotIdx) {
        return { ...box, [field]: value };
      }
      return box;
    }));
  };

  const handleCloseLoadModal = (forceDiscard = false) => {
    if (forceDiscard || window.confirm('Discard draft load plan? This will clear all current assignments.')) {
      setShowLoadModal(false);
      setEditingLoad(null);
      localStorage.removeItem('pm_draft_loadplan');
    }
  };

  const handleSubmitLoadPlan = async (e: React.SyntheticEvent | React.FormEvent, status: 'draft' | 'shipped') => {
    if (e) e.preventDefault();
    if (!loadDate || processing) return;
    setProcessing(true);

    try {
      const assignedBoxes = draftBoxes.map(box => ({
        slotIndex: box.slotIndex,
        materialId: box.materialId || '',
        weight: box.materialId ? Number(box.weight || 0) : 0,
        notes: box.notes || ''
      }));

      const totalWeightNum = assignedBoxes.reduce((sum, b) => sum + b.weight, 0);
      const isoDate = new Date(loadDate + 'T12:00:00Z').toISOString();

      if (editingLoad) {
        const isNowShipping = status === 'shipped' && editingLoad.status === 'draft';

        const updatedData = {
          loadNumber: editingLoad.loadNumber,
          date: isoDate,
          status,
          carrier: loadCarrier,
          notes: loadNotes,
          boxes: assignedBoxes,
          totalWeight: totalWeightNum,
          recordedAt: new Date().toISOString(),
          recordedBy: profile?.email || 'System'
        };

        await updateDoc(doc(db, 'loadPlans', editingLoad.id), updatedData);
        setSelectedLoadId(editingLoad.id);

        if (isNowShipping && deductFromStock) {
          for (const box of assignedBoxes) {
            if (box.materialId && box.weight > 0) {
              await setDoc(doc(db, 'inventory', box.materialId), {
                materialId: box.materialId,
                currentWeight: increment(-box.weight),
                lastUpdated: new Date().toISOString()
              }, { merge: true });
            }
          }
        }

        await logAuditEvent(
          'loadPlan',
          editingLoad.id,
          'update',
          { before: editingLoad, after: updatedData },
          `Updated load plan ${editingLoad.loadNumber} (Status: ${status}, Total Weight: ${totalWeightNum.toLocaleString()} lbs)`
        );

      } else {
        const nextLoadNum = `LOAD-${(loadPlans.length + 1001).toString()}`;
        
        const newLoadData = {
          loadNumber: nextLoadNum,
          date: isoDate,
          status,
          carrier: loadCarrier,
          notes: loadNotes,
          boxes: assignedBoxes,
          totalWeight: totalWeightNum,
          recordedAt: new Date().toISOString(),
          recordedBy: profile?.email || 'System'
        };

        const docRef = await addDoc(collection(db, 'loadPlans'), newLoadData);
        setSelectedLoadId(docRef.id);

        if (status === 'shipped' && deductFromStock) {
          for (const box of assignedBoxes) {
            if (box.materialId && box.weight > 0) {
              await setDoc(doc(db, 'inventory', box.materialId), {
                materialId: box.materialId,
                currentWeight: increment(-box.weight),
                lastUpdated: new Date().toISOString()
              }, { merge: true });
            }
          }
        }

        await logAuditEvent(
          'loadPlan',
          docRef.id,
          'create',
          { after: newLoadData },
          `Created load plan ${nextLoadNum} (Status: ${status}, Total Weight: ${totalWeightNum.toLocaleString()} lbs)`
        );
      }

      setShowLoadModal(false);
      setEditingLoad(null);
      localStorage.removeItem('pm_draft_loadplan');
    } catch (err) {
      handleFirestoreError(err, editingLoad ? OperationType.UPDATE : OperationType.CREATE, 'loadPlans');
    } finally {
      setProcessing(false);
    }
  };

  const handleDeleteLoadPlan = async (load: LoadPlan) => {
    let restoreStock = false;
    
    if (load.status === 'shipped') {
      restoreStock = window.confirm(
        `This load is marked SHIPPED. Would you like to RESTORE the box weights (${load.totalWeight.toLocaleString()} lbs) back into real-time yard inventory stock?`
      );
    } else {
      if (!window.confirm(`Are you sure you want to delete load plan ${load.loadNumber}?`)) return;
    }
    
    setProcessing(true);
    try {
      if (restoreStock) {
        for (const box of load.boxes) {
          if (box.materialId && (box.weight || 0) > 0) {
            await setDoc(doc(db, 'inventory', box.materialId), {
              materialId: box.materialId,
              currentWeight: increment(box.weight || 0),
              lastUpdated: new Date().toISOString()
            }, { merge: true });
          }
        }
      }

      await deleteDoc(doc(db, 'loadPlans', load.id));
      if (selectedLoadId === load.id) {
        setSelectedLoadId(null);
      }

      await logAuditEvent(
        'loadPlan',
        load.id,
        'delete',
        undefined,
        `Deleted load plan ${load.loadNumber} (Restored stock: ${restoreStock ? 'Yes' : 'No'})`
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'loadPlans');
    } finally {
      setProcessing(false);
    }
  };

  const handleShipDraftLoad = async (load: LoadPlan) => {
    const shouldDeduct = window.confirm(
      `Are you sure you want to transition ${load.loadNumber} to SHIPPED status? This will deduct ${load.totalWeight.toLocaleString()} lbs from your active yard inventory.`
    );
    if (!shouldDeduct) return;

    setProcessing(true);
    try {
      await updateDoc(doc(db, 'loadPlans', load.id), {
        status: 'shipped',
        recordedAt: new Date().toISOString(),
        recordedBy: profile?.email || 'System'
      });

      for (const box of load.boxes) {
        if (box.materialId && (box.weight || 0) > 0) {
          await setDoc(doc(db, 'inventory', box.materialId), {
            materialId: box.materialId,
            currentWeight: increment(-(box.weight || 0)),
            lastUpdated: new Date().toISOString()
          }, { merge: true });
        }
      }

      await logAuditEvent(
        'loadPlan',
        load.id,
        'update',
        { before: load, after: { ...load, status: 'shipped' } },
        `Shipped draft load ${load.loadNumber} and deducted weights from active yard inventory.`
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'loadPlans');
    } finally {
      setProcessing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

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

  const categoryCasingMap = useMemo(() => {
    const map: Record<string, string> = {};
    materials.forEach(m => {
      const cat = (m.category || '').trim();
      if (!cat) return;
      const lower = cat.toLowerCase();
      if (!map[lower]) {
        map[lower] = cat;
      } else {
        const currentUpperCount = (map[lower].match(/[A-Z]/g) || []).length;
        const newUpperCount = (cat.match(/[A-Z]/g) || []).length;
        if (newUpperCount > currentUpperCount) {
          map[lower] = cat;
        }
      }
    });
    return map;
  }, [materials]);

  const getCanonicalCategory = useCallback((cat: string) => {
    if (!cat) return 'General';
    const lower = cat.trim().toLowerCase();
    return categoryCasingMap[lower] || cat.trim();
  }, [categoryCasingMap]);

  const materialsWithWeight = useMemo(() => {
    return materials.map(m => {
      const inv = inventory.find(i => i.materialId === m.id);
      return {
        ...m,
        category: getCanonicalCategory(m.category),
        weight: inv?.currentWeight || 0,
        lastUpdated: inv?.lastUpdated || null
      };
    });
  }, [materials, inventory, getCanonicalCategory]);

  const categories = useMemo(() => {
    return ['all', ...Array.from(new Set(materials.map(m => getCanonicalCategory(m.category)).filter(Boolean)))];
  }, [materials, getCanonicalCategory]);

  const filteredAndSortedStock = useMemo(() => {
    return materialsWithWeight
      .filter(item => {
        const matchesSearch = item.name.toLowerCase().includes(stockSearch.toLowerCase()) || 
                              item.code.toLowerCase().includes(stockSearch.toLowerCase());
        const matchesCategory = selectedCategory === 'all' || getCanonicalCategory(item.category) === selectedCategory;
        return matchesSearch && matchesCategory;
      })
      .sort((a, b) => {
        if (stockSort === 'weight-desc') {
          return b.weight - a.weight;
        }
        if (stockSort === 'weight-asc') {
          return a.weight - b.weight;
        }
        if (stockSort === 'code') {
          return a.code.localeCompare(b.code);
        }
        if (stockSort === 'name') {
          return a.name.localeCompare(b.name);
        }
        return 0;
      });
  }, [materialsWithWeight, stockSearch, selectedCategory, stockSort, getCanonicalCategory]);

  const totalYardWeight = useMemo(() => {
    return materialsWithWeight.reduce((sum, m) => sum + m.weight, 0);
  }, [materialsWithWeight]);

  // Top 5 heaviest materials in stock for load planning
  const heaviestMaterials = [...materialsWithWeight]
    .sort((a, b) => b.weight - a.weight)
    .filter(m => m.weight > 0)
    .slice(0, 5);

  const filteredSales = sales.filter(s => {
    const name = getMaterialName(s.materialId).toLowerCase();
    const code = getMaterialCode(s.materialId).toLowerCase();
    const search = salesSearch.toLowerCase();
    return name.includes(search) || code.includes(search) || (s.notes || '').toLowerCase().includes(search);
  });

  return (
    <main className="max-w-7xl mx-auto space-y-8">
      {/* Header section with branding and actions */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="text-4xl font-black text-slate-900 tracking-tight font-display uppercase">Inventory</h1>
          <p className="text-slate-500 font-medium mt-1">Real-time stock tracking and truck capacity load planner.</p>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 shrink-0">
          <nav className="flex bg-slate-100 p-1.5 rounded-2xl animate-fade-in" aria-label="Inventory Tabs">
            <button
              onClick={() => setActiveTab('inventory')}
              className={cn(
                "px-5 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all flex items-center gap-2",
                activeTab === 'inventory' ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
              )}
            >
              <Package className="w-4 h-4" />
              Real-time Stock
            </button>
            <button
              onClick={() => setActiveTab('planner')}
              className={cn(
                "px-5 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all flex items-center gap-2",
                activeTab === 'planner' ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
              )}
            >
              <Truck className="w-4 h-4" />
              Flatbed Planner
            </button>
            <button
              onClick={() => setActiveTab('sales')}
              className={cn(
                "px-5 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all flex items-center gap-2",
                activeTab === 'sales' ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
              )}
            >
              <History className="w-4 h-4" />
              External Sales
            </button>
          </nav>
          
          {activeTab === 'planner' ? (
            <button
              onClick={handleOpenCreateLoad}
              className="px-6 py-4.5 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white rounded-2xl text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all shadow-lg shadow-blue-100"
            >
              <Plus className="w-4 h-4" />
              New Load Plan
            </button>
          ) : (
            <button
              onClick={() => handleOpenRecordSale()}
              className="px-6 py-4.5 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white rounded-2xl text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all shadow-lg shadow-blue-100"
            >
              <Plus className="w-4 h-4" />
              Mark Sold Outside App
            </button>
          )}
        </div>
      </header>

      {activeTab === 'inventory' && (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-300">
          {/* Load Dispatch & Ready-to-Ship Leaderboard */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 bg-slate-50 border border-slate-200/60 rounded-[2.5rem] p-8">
            {/* Column 1 & 2: Leaderboard progress */}
            <div className="lg:col-span-2 space-y-4">
              <div className="flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-blue-600" />
                <h2 className="text-lg font-black text-slate-900 uppercase tracking-tight">Load Ready Leaderboard</h2>
              </div>
              <p className="text-xs text-slate-400 font-bold uppercase tracking-widest leading-none">Your materials ranked from heaviest to lightest weight</p>
              
              <div className="space-y-4 mt-6">
                {heaviestMaterials.length > 0 ? (
                  heaviestMaterials.map((item) => {
                    const maxWeight = heaviestMaterials[0]?.weight || 1;
                    const percent = Math.min((item.weight / maxWeight) * 100, 100);
                    return (
                      <div key={item.id} className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-bold text-slate-700 uppercase tracking-tight">
                            <span className="font-mono bg-white px-1.5 py-0.5 rounded border border-slate-200 mr-2 text-[10px] font-black text-slate-500">{item.code}</span>
                            {item.name}
                          </span>
                          <span className="font-black text-slate-900">{item.weight.toLocaleString()} {item.unit}</span>
                        </div>
                        <div className="h-3 bg-white border border-slate-200/60 rounded-full overflow-hidden p-[2px]">
                          <div 
                            className="h-full bg-blue-600 rounded-full transition-all duration-1000"
                            style={{ width: `${percent}%` }}
                          />
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <p className="text-sm text-slate-400 font-bold py-6 uppercase tracking-wider">No stock recorded in yard yet. Buy tickets will automatically increase real-time stock levels.</p>
                )}
              </div>
            </div>

            {/* Column 3: Quick Insights */}
            <div className="bg-white border border-slate-200/85 rounded-3xl p-6 flex flex-col justify-between shadow-sm">
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-slate-400">
                  <TrendingUp className="w-4 h-4 text-emerald-600" />
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Dispatch Insights</span>
                </div>
                
                <div className="space-y-1">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Total Yard Weight</p>
                  <p className="text-4xl font-black text-slate-900 tracking-tight">
                    {totalYardWeight.toLocaleString()} <span className="text-sm font-medium text-slate-400 uppercase tracking-widest">lbs</span>
                  </p>
                </div>

                <div className="pt-4 border-t border-slate-100 space-y-1">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Heaviest Material</p>
                  {heaviestMaterials.length > 0 ? (
                    <div>
                      <p className="text-sm font-black text-slate-800 uppercase tracking-tight">{heaviestMaterials[0].name}</p>
                      <p className="text-xs text-slate-500 font-bold uppercase tracking-wider">{heaviestMaterials[0].weight.toLocaleString()} {heaviestMaterials[0].unit} in stock</p>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400 font-bold uppercase tracking-wider">N/A</p>
                  )}
                </div>
              </div>

              <div className="mt-6 pt-4 border-t border-slate-100">
                <p className="text-[10px] text-slate-400 leading-relaxed font-bold uppercase tracking-wider">
                  💡 Tip: Prioritize your first outbound load using these heaviest stock weights to optimize truck capacity.
                </p>
              </div>
            </div>
          </div>

          {/* Grid Controls (Search, Sort, Category Filters) */}
          <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4 pt-4 border-t border-slate-100">
            <div className="relative group w-full md:max-w-md">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-blue-600 transition-colors" />
              <input
                type="text"
                className="w-full pl-10 pr-4 py-4 bg-white border border-slate-200 rounded-2xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-all shadow-sm"
                placeholder="Search materials in stock..."
                value={stockSearch}
                onChange={(e) => setStockSearch(e.target.value)}
              />
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Category:</span>
                <select
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                  className="bg-white border border-slate-200 px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {categories.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat === 'all' ? 'All Categories' : cat.toUpperCase()}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Sort:</span>
                <select
                  value={stockSort}
                  onChange={(e) => setStockSort(e.target.value as any)}
                  className="bg-white border border-slate-200 px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="weight-desc">Weight (High to Low)</option>
                  <option value="weight-asc">Weight (Low to High)</option>
                  <option value="code">Material Code</option>
                  <option value="name">Material Name</option>
                </select>
              </div>
            </div>
          </div>

          <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8" aria-label="Material Inventory">
            {filteredAndSortedStock.map((material) => {
              const weight = material.weight;
              const isLow = weight < 100;

              return (
                <article 
                  key={material.id} 
                  className="bg-white rounded-[2.5rem] border border-slate-200 p-8 shadow-sm hover:shadow-xl hover:shadow-slate-200/40 transition-all group relative flex flex-col justify-between min-h-[300px]"
                  aria-labelledby={`material-title-${material.id}`}
                >
                  <div>
                    <div className="flex items-start justify-between mb-6">
                      <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 group-hover:bg-blue-50 group-hover:border-blue-100 transition-colors">
                        <span className="font-mono text-sm font-black text-slate-500 group-hover:text-blue-600">{material.code}</span>
                      </div>
                      {isLow && (
                        <span className="flex items-center gap-1.5 text-[10px] font-black text-amber-600 bg-amber-50 px-3.5 py-2 rounded-full uppercase tracking-widest border border-amber-100 animate-pulse" role="status">
                          <AlertCircle className="w-3.5 h-3.5" aria-hidden="true" />
                          Low Stock
                        </span>
                      )}
                    </div>
                    
                    <h3 id={`material-title-${material.id}`} className="font-black text-slate-900 text-2xl uppercase tracking-tight leading-none">{material.name}</h3>
                    <p className="text-[10px] text-slate-400 uppercase font-black tracking-widest mt-2">{material.category}</p>
                  </div>
                  
                  <div className="mt-8 space-y-4">
                    <div>
                      <p className="text-5xl font-black text-slate-900 tracking-tight">
                        {weight.toLocaleString()} <span className="text-sm font-medium text-slate-400 uppercase tracking-widest ml-1">{material.unit}</span>
                      </p>
                      <div className="flex items-center gap-2 mt-4">
                        <div className="flex-1 h-3.5 bg-slate-100 rounded-full overflow-hidden shadow-inner" role="progressbar" aria-valuenow={weight} aria-valuemin={0} aria-valuemax={2000} aria-label={`${material.name} stock level`}>
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

                    <div className="pt-6 border-t border-slate-50 flex items-center justify-between text-slate-400 text-[10px] font-black uppercase tracking-widest">
                      <span>
                        Updated: {material.lastUpdated ? new Date(material.lastUpdated).toLocaleDateString() : 'Never'}
                      </span>
                      <button 
                        onClick={() => handleOpenRecordSale(material.id)}
                        className="flex items-center gap-2 text-blue-600 font-black hover:text-blue-700 transition-colors bg-blue-50/50 hover:bg-blue-50 rounded-xl px-4 py-2.5 active:scale-95"
                        aria-label={`Record external sale for ${material.name}`}
                      >
                        Record Sale
                        <ArrowUpRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
            {filteredAndSortedStock.length === 0 && (
              <div className="col-span-full py-16 text-center">
                <div className="max-w-xs mx-auto space-y-3">
                  <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto">
                    <Package className="w-8 h-8 text-slate-300" />
                  </div>
                  <p className="text-slate-900 font-bold">No stock matches found</p>
                  <p className="text-sm text-slate-500">No materials matched your filters or search query.</p>
                </div>
              </div>
            )}
          </section>
        </div>
      )}

      {activeTab === 'planner' && (
        (() => {
          const activePlan = loadPlans.find(lp => lp.id === selectedLoadId) || loadPlans[0];
          const activeDrafts = loadPlans.filter(lp => lp.status === 'draft');

          return (
            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-300">
              {/* Draft Recovery / Resume Panel */}
              {activeDrafts.length > 0 && (
                <div className="bg-amber-50/80 border border-amber-200 rounded-[2rem] p-6 space-y-4 animate-in fade-in duration-300">
                  <div className="flex items-center justify-between flex-wrap gap-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 bg-amber-100 text-amber-800 rounded-2xl">
                        <Truck className="w-5 h-5 animate-bounce" />
                      </div>
                      <div>
                        <h4 className="text-sm font-black text-slate-900 uppercase tracking-tight">Active Load Plan Drafts ({activeDrafts.length})</h4>
                        <p className="text-[10px] font-bold text-amber-800 uppercase tracking-wider">Incomplete flatbed load drafts detected. Click to resume editing or ship out immediately.</p>
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                    {activeDrafts.map((draft) => {
                      const boxCount = draft.boxes.filter(b => b.materialId).length;
                      return (
                        <div key={draft.id} className="bg-white p-4 rounded-2xl border border-amber-200/60 shadow-sm flex flex-col justify-between space-y-3">
                          <div>
                            <div className="flex justify-between items-center">
                              <span className="font-mono text-xs font-black text-slate-800">{draft.loadNumber}</span>
                              <span className="text-[9px] font-black uppercase tracking-wider text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                                Draft
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-500 font-bold uppercase mt-1 truncate">Carrier: {draft.carrier || 'Unassigned'}</p>
                            <p className="text-[10px] text-slate-400 font-mono mt-1">{boxCount} / 8 slots filled • {draft.totalWeight.toLocaleString()} lbs</p>
                          </div>
                          <div className="flex items-center gap-2 pt-2 border-t border-slate-50">
                            <button
                              onClick={() => handleOpenEditLoad(draft)}
                              className="flex-1 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-[10px] font-black uppercase tracking-wider transition-all flex items-center justify-center gap-1 active:scale-95"
                            >
                              <Edit2 className="w-3 h-3" /> Resume Draft
                            </button>
                            <button
                              onClick={() => handleShipDraftLoad(draft)}
                              className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-[10px] font-black uppercase tracking-wider transition-all active:scale-95"
                              title="Ship Out"
                            >
                              <Truck className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Active / Selection Details or Quick Help */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 bg-slate-50 border border-slate-200/60 rounded-[2.5rem] p-8 space-y-6">
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-100 pb-6">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Truck className="w-5 h-5 text-blue-600" />
                        <h2 className="text-lg font-black text-slate-900 uppercase tracking-tight">Active Load Layout</h2>
                      </div>
                      <p className="text-xs text-slate-400 font-bold uppercase tracking-widest leading-none">
                        Assign Gaylord boxes to the 8 flatbed slots to maximize capacity and weight efficiency
                      </p>
                    </div>
                    <div className="flex items-center gap-3 w-full sm:w-auto">
                      {loadPlans.length > 0 && (
                        <div className="flex items-center gap-2 bg-white px-3 py-2 border border-slate-200 rounded-xl shadow-sm">
                          <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">View:</span>
                          <select
                            className="bg-transparent border-none outline-none text-xs font-bold text-slate-700 cursor-pointer pr-4"
                            value={selectedLoadId || activePlan?.id || ''}
                            onChange={(e) => setSelectedLoadId(e.target.value)}
                          >
                            {loadPlans.map(lp => (
                              <option key={lp.id} value={lp.id}>
                                {lp.loadNumber} - {lp.carrier || 'No Carrier'} ({lp.status.toUpperCase()})
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                      <button
                        onClick={handleOpenCreateLoad}
                        className="px-5 py-3 bg-blue-600 hover:bg-blue-700 text-white text-xs font-black uppercase tracking-widest rounded-xl transition-all active:scale-95 shrink-0 shadow-md shadow-blue-100"
                      >
                        Create New Load
                      </button>
                    </div>
                  </div>

                  {/* Truck Bed Visualizer */}
                  <div className="bg-slate-900 rounded-[2rem] p-8 border border-slate-800 shadow-inner relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-4">
                      <span className="text-[10px] font-mono font-black text-slate-500 uppercase tracking-widest bg-slate-950 px-3 py-1.5 rounded-full border border-slate-800">
                        Flatbed Bed (8 slots capacity)
                      </span>
                    </div>

                    {/* Truck Front Cabin Indicator */}
                    <div className="flex justify-center mb-6">
                      <div className="w-48 bg-slate-800 h-8 rounded-t-xl border-x border-t border-slate-700 flex items-center justify-center shadow-md">
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">▲ Front of Truck ▲</span>
                      </div>
                    </div>

                    {/* The 8 Pallet/Box Slots Grid */}
                    <div className="grid grid-cols-2 gap-4 max-w-2xl mx-auto">
                      {Array.from({ length: 8 }).map((_, idx) => {
                        const selectedLoad = editingLoad || activePlan;
                        const box = selectedLoad?.boxes.find(b => b.slotIndex === idx);
                        const material = box?.materialId ? materials.find(m => m.id === box.materialId) : null;
                        const hasBox = !!material;

                        return (
                          <div 
                            key={idx} 
                            className={cn(
                              "relative aspect-video rounded-2xl border-2 transition-all p-4 flex flex-col justify-between overflow-hidden shadow-sm",
                              hasBox 
                                ? "bg-amber-50/90 border-amber-500/50 hover:bg-amber-50" 
                                : "bg-slate-950/40 border-dashed border-slate-800 text-slate-600"
                            )}
                          >
                            {/* Pallet Slats Graphic in Background */}
                            <div className="absolute inset-x-0 bottom-0 h-2 bg-yellow-900/10 border-t border-yellow-900/5 flex justify-around px-2">
                              <span className="w-1 bg-yellow-900/20 h-full" />
                              <span className="w-1 bg-yellow-900/20 h-full" />
                              <span className="w-1 bg-yellow-900/20 h-full" />
                              <span className="w-1 bg-yellow-900/20 h-full" />
                            </div>

                            <div className="flex justify-between items-start">
                              <span className="text-[10px] font-mono font-black px-2 py-0.5 rounded bg-slate-950/10 text-slate-500 border border-slate-200">
                                Slot {idx + 1}
                              </span>
                              {hasBox && (
                                <span className="text-[9px] font-black uppercase tracking-widest text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full border border-amber-200">
                                  4ft Gaylord
                                </span>
                              )}
                            </div>

                            {hasBox ? (
                              <div className="space-y-1.5 my-2">
                                <p className="font-mono text-xs font-black text-amber-900 tracking-tight flex items-center gap-1.5">
                                  <span className="bg-amber-100 px-1.5 py-0.5 rounded border border-amber-200">{material.code}</span>
                                  <span className="truncate max-w-[120px]">{material.name}</span>
                                </p>
                                <p className="text-xl font-black text-slate-900 tracking-tight leading-none">
                                  {box.weight?.toLocaleString()} <span className="text-[10px] font-medium text-slate-400 uppercase">lbs</span>
                                </p>
                              </div>
                            ) : (
                              <div className="my-auto text-center py-2">
                                <Package className="w-5 h-5 mx-auto text-slate-800 mb-1" />
                                <p className="text-[10px] font-black uppercase tracking-widest text-slate-700">Empty Slot</p>
                              </div>
                            )}

                            <div className="text-[9px] font-medium text-slate-400 truncate">
                              {box?.notes ? `📝 ${box.notes}` : (hasBox ? 'Pallet: Standard Wood' : 'Available for loading')}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Truck Rear Indicator */}
                    <div className="flex justify-center mt-6">
                      <div className="w-48 bg-slate-800 h-6 rounded-b-xl border-x border-b border-slate-700 flex items-center justify-center shadow-md">
                        <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">▼ Rear Tailgate ▼</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Load Capacity Sidebar */}
                <div className="bg-white border border-slate-200 rounded-[2.5rem] p-8 flex flex-col justify-between shadow-sm">
                  <div className="space-y-6">
                    <div className="space-y-1">
                      <span className="text-[10px] font-black uppercase tracking-widest text-blue-600">Active Load Summary</span>
                      {loadPlans.length > 0 ? (
                        <div>
                          <h3 className="text-2xl font-black text-slate-900 uppercase tracking-tight">
                            {editingLoad ? `Editing: ${editingLoad.loadNumber}` : `Latest: ${activePlan.loadNumber}`}
                          </h3>
                          <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">
                            Driver/Carrier: {editingLoad?.carrier || activePlan.carrier || 'Unassigned'}
                          </p>
                        </div>
                      ) : (
                        <h3 className="text-2xl font-black text-slate-900 uppercase tracking-tight">No Load Plans</h3>
                      )}
                    </div>

                    {/* Flatbed Stats */}
                    {loadPlans.length > 0 ? (
                      (() => {
                        const filledBoxesCount = activePlan.boxes.filter(b => b.materialId).length;
                        const percentFilled = (filledBoxesCount / 8) * 100;

                        return (
                          <div className="space-y-6 pt-4 border-t border-slate-100">
                            <div className="space-y-2">
                              <div className="flex justify-between items-end text-xs">
                                <span className="font-bold text-slate-400 uppercase tracking-wider">Flatbed Capacity</span>
                                <span className="font-black text-slate-950">{filledBoxesCount} / 8 Boxes</span>
                              </div>
                              <div className="h-4 bg-slate-100 border border-slate-200/60 rounded-full overflow-hidden p-[2px]">
                                <div 
                                  className={cn(
                                    "h-full rounded-full transition-all duration-500",
                                    percentFilled === 100 ? "bg-emerald-500" : "bg-amber-500"
                                  )}
                                  style={{ width: `${percentFilled}%` }}
                                />
                              </div>
                            </div>

                            <div className="space-y-1">
                              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total Planned Weight</span>
                              <p className="text-4xl font-black text-slate-900 tracking-tight">
                                {activePlan.totalWeight.toLocaleString()} <span className="text-xs text-slate-400 tracking-widest font-bold">lbs</span>
                              </p>
                            </div>

                            <div className="space-y-2 pt-4 border-t border-slate-100">
                              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Load Status</span>
                              <div className="flex items-center gap-3">
                                <span className={cn(
                                  "px-3.5 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest border",
                                  activePlan.status === 'shipped' 
                                    ? "bg-emerald-50 border-emerald-200 text-emerald-700" 
                                    : "bg-amber-50 border-amber-200 text-amber-700"
                                )}>
                                  {activePlan.status}
                                </span>
                                {activePlan.status === 'draft' && (
                                  <button
                                    onClick={() => handleShipDraftLoad(activePlan)}
                                    className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-blue-600 bg-blue-50 px-3 py-1.5 rounded-xl hover:bg-blue-100 border border-blue-200/50 active:scale-95 transition-all"
                                  >
                                    Ship Out
                                    <ArrowUpRight className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            </div>

                            <div className="text-xs font-medium text-slate-400 leading-relaxed bg-slate-50 p-4 rounded-2xl border border-slate-200/40">
                              💡 Each Gaylord box pallet measures approx. 4x4 feet. Assigning 8 boxes fully fills the physical layout of your flatbed trailer for maximum safety and transport efficiency.
                            </div>
                          </div>
                        );
                      })()
                    ) : (
                      <p className="text-sm text-slate-400 font-bold py-6 uppercase tracking-wider">No active load plans configured yet. Click "Create New Load" to begin.</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Historical Load Plans Table */}
              <div className="space-y-6 pt-8 border-t border-slate-100">
                <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                  <div className="space-y-1">
                    <h3 className="text-xl font-black text-slate-900 uppercase tracking-tight">Historical Load Plans</h3>
                    <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">Track capacity utilization and correction logs</p>
                  </div>

                  <div className="relative group w-full sm:max-w-md">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-blue-600 transition-colors" />
                    <input
                      type="text"
                      className="w-full pl-10 pr-4 py-3 bg-white border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-all shadow-sm"
                      placeholder="Search loads by number, carrier, notes..."
                      value={loadSearch}
                      onChange={(e) => setLoadSearch(e.target.value)}
                    />
                  </div>
                </div>

                <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50/50 text-slate-500 text-[10px] font-black uppercase tracking-widest border-b border-slate-100">
                          <th className="px-8 py-5">Load ID</th>
                          <th className="px-8 py-5">Shipment Date</th>
                          <th className="px-8 py-5">Carrier/Driver</th>
                          <th className="px-8 py-5">Boxes Loaded</th>
                          <th className="px-8 py-5">Total Weight</th>
                          <th className="px-8 py-5">Status</th>
                          <th className="px-8 py-5">Notes</th>
                          <th className="px-8 py-5 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {loadPlans
                          .filter(load => {
                            const searchLower = loadSearch.toLowerCase();
                            return load.loadNumber.toLowerCase().includes(searchLower) ||
                                   (load.carrier || '').toLowerCase().includes(searchLower) ||
                                   (load.notes || '').toLowerCase().includes(searchLower);
                          })
                          .map((load) => {
                            const boxCount = load.boxes.filter(b => b.materialId).length;
                            return (
                              <tr key={load.id} className="hover:bg-blue-50/20 transition-all group">
                                <td className="px-8 py-6">
                                  <span className="font-mono text-sm font-black text-slate-800">{load.loadNumber}</span>
                                </td>
                                <td className="px-8 py-6">
                                  <span className="text-sm font-bold text-slate-700">
                                    {new Date(load.date).toLocaleDateString()}
                                  </span>
                                </td>
                                <td className="px-8 py-6">
                                  <span className="text-sm font-medium text-slate-600">{load.carrier || '-'}</span>
                                </td>
                                <td className="px-8 py-6">
                                  <span className="text-sm font-black text-slate-900">
                                    {boxCount} / 8 <span className="text-xs text-slate-400 font-normal">boxes</span>
                                  </span>
                                </td>
                                <td className="px-8 py-6">
                                  <span className="text-sm font-black text-slate-900">
                                    {load.totalWeight.toLocaleString()} lbs
                                  </span>
                                </td>
                                <td className="px-8 py-6">
                                  <span className={cn(
                                    "px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border",
                                    load.status === 'shipped' 
                                      ? "bg-emerald-50 border-emerald-200 text-emerald-700" 
                                      : "bg-amber-50 border-amber-200 text-amber-700"
                                  )}>
                                    {load.status}
                                  </span>
                                </td>
                                <td className="px-8 py-6 max-w-xs truncate">
                                  <p className="text-xs text-slate-500 font-medium" title={load.notes}>{load.notes || '-'}</p>
                                </td>
                                <td className="px-8 py-6 text-right">
                                  <div className="flex items-center justify-end gap-2">
                                    {load.status === 'draft' && (
                                      <button
                                        onClick={() => handleShipDraftLoad(load)}
                                        className="p-2 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors"
                                        title="Dispatch Load"
                                      >
                                        <Truck className="w-4 h-4" />
                                      </button>
                                    )}
                                    <button
                                      onClick={() => handleOpenEditLoad(load)}
                                      className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                      title="Edit Plan"
                                    >
                                      <Edit2 className="w-4 h-4" />
                                    </button>
                                    <button
                                      onClick={() => handleDeleteLoadPlan(load)}
                                      className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                      title="Delete Record"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        {loadPlans.length === 0 && (
                          <tr>
                            <td colSpan={8} className="px-8 py-12 text-center text-slate-400">
                              <div className="max-w-xs mx-auto space-y-2">
                                <Truck className="w-12 h-12 text-slate-200 mx-auto" />
                                <p className="font-bold text-slate-800">No load plans recorded</p>
                                <p className="text-xs text-slate-400">Maximize flatbed efficiency by drafting your wood-pallet boxes loads.</p>
                              </div>
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          );
        })()
      )}

      {activeTab === 'sales' && (
        <section className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="relative group w-full sm:max-w-md">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-blue-600 transition-colors" />
              <input
                type="text"
                className="w-full pl-10 pr-4 py-4 bg-white border border-slate-200 rounded-2xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-all shadow-sm"
                placeholder="Search external sales by material or notes..."
                value={salesSearch}
                onChange={(e) => setSalesSearch(e.target.value)}
              />
            </div>
          </div>

          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/50 text-slate-500 text-[10px] font-black uppercase tracking-widest border-b border-slate-100">
                    <th className="px-8 py-5">Date / Time</th>
                    <th className="px-8 py-5">Material</th>
                    <th className="px-8 py-5">Weight Sold</th>
                    <th className="px-8 py-5">Price</th>
                    <th className="px-8 py-5">Total Revenue</th>
                    <th className="px-8 py-5">Notes</th>
                    <th className="px-8 py-5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {filteredSales.map((sale) => (
                    <tr key={sale.id} className="hover:bg-blue-50/20 transition-all group">
                      <td className="px-8 py-6">
                        <div className="flex items-center gap-4">
                          <div className="p-3 bg-slate-100 rounded-2xl text-slate-500 group-hover:bg-blue-100 group-hover:text-blue-600 transition-all">
                            <Calendar className="w-5 h-5" />
                          </div>
                          <div>
                            <p className="text-sm font-black text-slate-900 uppercase tracking-tight">
                              {new Date(sale.date).toLocaleDateString()}
                            </p>
                            <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest">
                              Logged by {sale.recordedBy || 'System'}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-8 py-6">
                        <div className="flex items-center gap-3">
                          <span className="px-2.5 py-1.5 bg-slate-100 rounded-lg text-xs font-mono font-black text-slate-600">
                            {getMaterialCode(sale.materialId)}
                          </span>
                          <span className="text-sm font-bold text-slate-800 uppercase tracking-tight">
                            {getMaterialName(sale.materialId)}
                          </span>
                        </div>
                      </td>
                      <td className="px-8 py-6">
                        <span className="text-sm font-black text-slate-900">
                          {sale.weight.toLocaleString()} {getMaterialUnit(sale.materialId)}
                        </span>
                      </td>
                      <td className="px-8 py-6">
                        <span className="text-sm font-bold text-slate-600">
                          ${sale.salePrice.toFixed(2)} / {getMaterialUnit(sale.materialId)}
                        </span>
                      </td>
                      <td className="px-8 py-6">
                        <span className="text-sm font-black text-blue-600">
                          ${(sale.weight * sale.salePrice).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </span>
                      </td>
                      <td className="px-8 py-6 max-w-xs truncate">
                        <p className="text-xs text-slate-500 font-medium" title={sale.notes}>{sale.notes || '-'}</p>
                      </td>
                      <td className="px-8 py-6 text-right">
                        <div className="flex items-center gap-2 justify-end">
                          <button
                            onClick={() => handleOpenEditSale(sale)}
                            className="p-2.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all active:scale-95"
                            title="Edit Record"
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDeleteSale(sale)}
                            className="p-2.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all active:scale-95"
                            title="Delete Record"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {filteredSales.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-8 py-20 text-center">
                        <div className="max-w-xs mx-auto space-y-3">
                          <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto">
                            <History className="w-8 h-8 text-slate-200" />
                          </div>
                          <p className="text-slate-900 font-bold">No sales records</p>
                          <p className="text-sm text-slate-500">No external sales match your filter or search query.</p>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {materials.length === 0 && (
        <div className="text-center py-12 bg-white rounded-xl border border-dashed border-slate-300">
          <Package className="w-12 h-12 text-slate-300 mx-auto mb-4" aria-hidden="true" />
          <h3 className="text-lg font-medium text-slate-900">No materials defined</h3>
          <p className="text-slate-500">Go to Manage Prices to add materials to your yard.</p>
        </div>
      )}

      {/* Record / Edit External Sale Modal */}
      {showSaleModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-6 z-50 animate-in fade-in duration-200" role="dialog" aria-modal="true">
          <div className="bg-white rounded-[2.5rem] w-full max-w-lg p-10 border border-slate-100 shadow-2xl relative space-y-8 animate-in zoom-in-95 duration-200">
            <button
              onClick={() => setShowSaleModal(false)}
              className="absolute top-8 right-8 w-11 h-11 flex items-center justify-center text-slate-300 hover:text-slate-500 hover:bg-slate-50 rounded-xl transition-all active:scale-95"
              aria-label="Close modal"
            >
              <X className="w-5 h-5" />
            </button>

            <div>
              <h2 className="text-2xl font-black text-slate-900 uppercase tracking-tight">
                {editingSale ? 'Edit External Sale' : 'Record External Sale'}
              </h2>
              <p className="text-xs text-slate-400 font-black uppercase tracking-widest mt-1">Retroactive inventory sale entries</p>
            </div>

            <form onSubmit={handleSubmitSale} className="space-y-6">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Select Material</label>
                <select
                  required
                  disabled={!!editingSale}
                  className="w-full px-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-all appearance-none"
                  value={modalMaterialId}
                  onChange={(e) => {
                    setModalMaterialId(e.target.value);
                    const material = materials.find(m => m.id === e.target.value);
                    setModalPrice(material?.salePrice.toString() || '');
                  }}
                >
                  <option value="">-- Choose Material --</option>
                  {materials.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.code} - {m.name} (${m.salePrice.toFixed(2)} / {m.unit})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Weight Sold</label>
                  <div className="relative">
                    <input
                      required
                      type="number"
                      step="any"
                      min="0.01"
                      className="w-full pl-4 pr-12 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                      placeholder="0.00"
                      value={modalWeight}
                      onChange={(e) => setModalWeight(e.target.value)}
                    />
                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-black text-slate-400 uppercase">
                      {modalMaterialId ? getMaterialUnit(modalMaterialId) : 'unit'}
                    </span>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Sale Price Per Unit</label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400">$</span>
                    <input
                      required
                      type="number"
                      step="0.01"
                      min="0"
                      className="w-full pl-8 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                      placeholder="0.00"
                      value={modalPrice}
                      onChange={(e) => setModalPrice(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Date of Sale (Retroactive)</label>
                <div className="relative group">
                  <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 group-focus-within:text-blue-600 transition-colors pointer-events-none" />
                  <input
                    required
                    type="date"
                    className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                    value={modalDate}
                    onChange={(e) => setModalDate(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Sale Notes / Reference</label>
                <textarea
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm outline-none focus:ring-2 focus:ring-blue-500 min-h-[80px] resize-none"
                  placeholder="Buyer info, check numbers, etc..."
                  value={modalNotes}
                  onChange={(e) => setModalNotes(e.target.value)}
                />
              </div>

              <button
                type="submit"
                disabled={processing}
                className="w-full py-5 bg-slate-900 text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-slate-800 transition-all disabled:opacity-50 flex items-center justify-center gap-3 shadow-xl"
              >
                {processing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
                {editingSale ? 'Save Changes' : 'Confirm Sale'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Create / Edit Load Plan Modal */}
      {showLoadModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-6 z-50 animate-in fade-in duration-200 overflow-y-auto" role="dialog" aria-modal="true">
          <div className="bg-white rounded-[2.5rem] w-full max-w-4xl p-10 border border-slate-100 shadow-2xl relative space-y-8 animate-in zoom-in-95 duration-200 my-8">
            <button
              onClick={() => handleCloseLoadModal(false)}
              className="absolute top-8 right-8 w-11 h-11 flex items-center justify-center text-slate-300 hover:text-slate-500 hover:bg-slate-50 rounded-xl transition-all active:scale-95"
              aria-label="Close modal"
            >
              <X className="w-5 h-5" />
            </button>

            <div>
              <h2 className="text-2xl font-black text-slate-900 uppercase tracking-tight">
                {editingLoad ? 'Edit Flatbed Load Plan' : 'Create Flatbed Load Plan'}
              </h2>
              <p className="text-xs text-slate-400 font-black uppercase tracking-widest mt-1">
                Configure Carrier details and assign Gaylord boxes to the 8 physical flatbed slots
              </p>
            </div>

            <form onSubmit={(e) => handleSubmitLoadPlan(e, editingLoad?.status === 'shipped' ? 'shipped' : 'draft')} className="space-y-8">
              {/* Basic Carrier & Shipment Info */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 bg-slate-50 p-6 rounded-2xl border border-slate-200/50">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Driver / Carrier Name</label>
                  <input
                    required
                    type="text"
                    className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                    placeholder="e.g. Acme Transport Truck #4"
                    value={loadCarrier}
                    onChange={(e) => setLoadCarrier(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Shipment Target Date</label>
                  <div className="relative group">
                    <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-blue-600 transition-colors pointer-events-none" />
                    <input
                      required
                      type="date"
                      className="w-full pl-10 pr-4 py-3 bg-white border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                      value={loadDate}
                      onChange={(e) => setLoadDate(e.target.value)}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Inventory Action</label>
                  <label className="flex items-center gap-3 px-4 py-3 bg-white border border-slate-200 rounded-xl cursor-pointer hover:bg-slate-50/50 transition-all">
                    <input
                      type="checkbox"
                      className="w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500"
                      checked={deductFromStock}
                      onChange={(e) => setDeductFromStock(e.target.checked)}
                    />
                    <span className="text-[11px] font-black text-slate-700 uppercase tracking-wide">Deduct on Ship Out</span>
                  </label>
                </div>

                <div className="md:col-span-3 space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Load Notes / Instructions</label>
                  <textarea
                    className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-blue-500 min-h-[60px] resize-none"
                    placeholder="Provide shipping instructions, Melt Shop details, or destination logs..."
                    value={loadNotes}
                    onChange={(e) => setLoadNotes(e.target.value)}
                  />
                </div>
              </div>

              {/* The 8 Boxes Slot Configuration */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black text-slate-900 uppercase tracking-tight">Gaylord Box Assignments (8 Slots)</span>
                  <span className="text-[10px] font-mono text-slate-400 uppercase tracking-widest">
                    Pallet capacity is locked to flatbed truck specs
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-h-[350px] overflow-y-auto pr-2 scrollbar-thin">
                  {draftBoxes.map((box, idx) => {
                    return (
                      <div key={idx} className="p-5 border border-slate-200/80 bg-slate-50/40 rounded-2xl flex flex-col gap-3 relative">
                        <div className="flex justify-between items-center border-b border-slate-100 pb-2">
                          <span className="text-xs font-black text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                            <span className="w-5 h-5 flex items-center justify-center bg-slate-200 text-slate-700 text-[10px] font-mono rounded-md">
                              {idx + 1}
                            </span>
                            Slot {idx + 1} Pallet
                          </span>
                          {box.materialId ? (
                            <span className="text-[9px] font-black text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-100 uppercase tracking-wider">
                              Assigned
                            </span>
                          ) : (
                            <span className="text-[9px] font-black text-slate-400 bg-slate-100 px-2 py-0.5 rounded border border-slate-200 uppercase tracking-wider">
                              Unassigned
                            </span>
                          )}
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div className="space-y-1.5">
                            <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Material</label>
                            <select
                              className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold outline-none focus:ring-1 focus:ring-blue-500"
                              value={box.materialId}
                              onChange={(e) => handleUpdateBoxSlot(idx, 'materialId', e.target.value)}
                            >
                              <option value="">-- Empty Slot --</option>
                              {materials.map(m => (
                                <option key={m.id} value={m.id}>
                                  {m.code} - {m.name}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="space-y-1.5">
                            <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Box Weight (lbs)</label>
                            <input
                              type="number"
                              disabled={!box.materialId}
                              className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-40"
                              placeholder="Weight in lbs"
                              value={box.weight || ''}
                              onChange={(e) => handleUpdateBoxSlot(idx, 'weight', Number(e.target.value))}
                            />
                          </div>
                        </div>

                        <div className="space-y-1">
                          <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Box Note / Correction Log</label>
                          <input
                            type="text"
                            disabled={!box.materialId}
                            className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-[11px] outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-40"
                            placeholder="e.g. Mixed copper scrap box #A"
                            value={box.notes || ''}
                            onChange={(e) => handleUpdateBoxSlot(idx, 'notes', e.target.value)}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-6 border-t border-slate-100">
                <span className="text-xs font-black text-slate-500 uppercase tracking-widest">
                  Total Planned Weight:{' '}
                  <span className="text-slate-900 font-mono text-base">
                    {draftBoxes.reduce((sum, b) => sum + (b.materialId ? Number(b.weight || 0) : 0), 0).toLocaleString()} lbs
                  </span>
                </span>

                <div className="flex items-center gap-3 w-full sm:w-auto">
                  <button
                    type="button"
                    onClick={() => handleCloseLoadModal(false)}
                    className="flex-1 sm:flex-none px-6 py-3.5 border border-slate-200 text-slate-500 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-slate-50 transition-all"
                  >
                    Cancel
                  </button>
                  
                  <button
                    type="button"
                    disabled={processing}
                    onClick={(e) => handleSubmitLoadPlan(e, 'draft')}
                    className="flex-1 sm:flex-none px-6 py-3.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-black uppercase tracking-widest transition-all disabled:opacity-50"
                  >
                    Save Draft
                  </button>

                  <button
                    type="submit"
                    disabled={processing}
                    onClick={(e) => handleSubmitLoadPlan(e, 'shipped')}
                    className="flex-1 sm:flex-none px-6 py-3.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-black uppercase tracking-widest transition-all disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg"
                  >
                    {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Truck className="w-4 h-4" />}
                    Ship Out Now
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
