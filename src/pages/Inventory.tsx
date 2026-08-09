import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { auth, db } from '../firebase';
import { collection, onSnapshot, query, orderBy, addDoc, doc, updateDoc, deleteDoc, setDoc, increment, writeBatch } from 'firebase/firestore';
import { InventoryItem, Material, ExternalSale, ExternalSaleItem, UserProfile, LoadPlan, LoadPlanBox, MaterialConversion, InventoryAdjustment } from '../types';
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
  Info,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Repeat,
  ArrowRightLeft,
  Percent,
  RotateCcw,
  CheckCircle2,
  Ban,
  Layers,
  Zap,
  SlidersHorizontal,
  Scale,
  HelpCircle
} from 'lucide-react';
import { cn } from '../lib/utils';
import { COMPANY_NAME, handleImageError } from '../constants';
import { BrandLogo } from '../components/BrandLogo';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';
import { logAuditEvent } from '../lib/audit';

interface SaleFormItem {
  id: string;
  materialId: string;
  weight: string;
  salePrice: string;
  notes?: string;
}

export interface ConversionDestinationFormLine {
  id: string;
  destinationMaterialId: string;
  producedWeight: string;
}

export function getConversionDestinations(c: MaterialConversion) {
  if (c.destinations && Array.isArray(c.destinations) && c.destinations.length > 0) {
    return c.destinations;
  }
  if (c.destinationMaterialId && c.producedWeight !== undefined) {
    return [{
      destinationMaterialId: c.destinationMaterialId,
      producedWeight: c.producedWeight,
      yieldPercent: c.yieldPercent ?? (c.consumedWeight > 0 ? (c.producedWeight / c.consumedWeight) * 100 : 0)
    }];
  }
  return [];
}

export default function Inventory({ profile }: { profile: UserProfile | null }) {
  const [activeTab, setActiveTab] = useState<'inventory' | 'sales' | 'planner' | 'conversions' | 'adjustments'>('inventory');
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [sales, setSales] = useState<ExternalSale[]>([]);
  const [loadPlans, setLoadPlans] = useState<LoadPlan[]>([]);
  const [conversions, setConversions] = useState<MaterialConversion[]>([]);
  const [adjustments, setAdjustments] = useState<InventoryAdjustment[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);

  // Manual Inventory Adjustment State
  const [showAdjustmentModal, setShowAdjustmentModal] = useState(false);
  const [adjMaterialId, setAdjMaterialId] = useState('');
  const [adjType, setAdjType] = useState<'add' | 'remove'>('add');
  const [adjAmount, setAdjAmount] = useState('');
  const [adjReason, setAdjReason] = useState('');
  const [adjIsEstimate, setAdjIsEstimate] = useState(false);
  const [adjError, setAdjError] = useState<string | null>(null);
  const [adjSuccessMsg, setAdjSuccessMsg] = useState<string | null>(null);
  const [adjPageSuccessMsg, setAdjPageSuccessMsg] = useState<string | null>(null);
  const adjModalContentRef = useRef<HTMLDivElement>(null);

  // Manual Adjustments Filter State
  const [adjSearch, setAdjSearch] = useState('');
  const [adjMaterialFilter, setAdjMaterialFilter] = useState('all');
  const [adjEstimateFilter, setAdjEstimateFilter] = useState<'all' | 'estimate' | 'confirmed'>('all');
  const [adjTypeFilter, setAdjTypeFilter] = useState<'all' | 'add' | 'remove'>('all');

  // Material Conversions State
  const [showConversionModal, setShowConversionModal] = useState(false);
  const [conversionSourceMatId, setConversionSourceMatId] = useState('');
  const [conversionConsumedWeight, setConversionConsumedWeight] = useState('');
  const [conversionDestLines, setConversionDestLines] = useState<ConversionDestinationFormLine[]>([
    { id: '1', destinationMaterialId: '', producedWeight: '' }
  ]);
  const [conversionNotes, setConversionNotes] = useState('');
  const [conversionError, setConversionError] = useState<string | null>(null);
  const [conversionSuccessMsg, setConversionSuccessMsg] = useState<string | null>(null);
  const [conversionPageSuccessMsg, setConversionPageSuccessMsg] = useState<string | null>(null);
  const modalContentRef = useRef<HTMLDivElement>(null);

  // Conversions Filter State
  const [conversionSearch, setConversionSearch] = useState('');
  const [conversionSourceFilter, setConversionSourceFilter] = useState('all');
  const [conversionDestFilter, setConversionDestFilter] = useState('all');
  const [conversionStatusFilter, setConversionStatusFilter] = useState<'all' | 'completed' | 'voided'>('all');
  const [conversionVoidError, setConversionVoidError] = useState<string | null>(null);

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

  // External Sale Load Modal State
  const [showSaleModal, setShowSaleModal] = useState(false);
  const [editingSale, setEditingSale] = useState<ExternalSale | null>(null);

  // Multi-Material Form State
  const [saleItems, setSaleItems] = useState<SaleFormItem[]>([
    { id: '1', materialId: '', weight: '', salePrice: '' }
  ]);
  const [modalBuyerName, setModalBuyerName] = useState('');
  const [modalDate, setModalDate] = useState('');
  const [modalNotes, setModalNotes] = useState('');
  const [inventoryErrors, setInventoryErrors] = useState<string[]>([]);
  const [expandedSaleIds, setExpandedSaleIds] = useState<Record<string, boolean>>({});

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

    const unsubConversions = onSnapshot(
      query(collection(db, 'materialConversions'), orderBy('timestamp', 'desc')),
      (snapshot) => {
        setConversions(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as MaterialConversion[]);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'materialConversions')
    );

    const unsubAdjustments = onSnapshot(
      query(collection(db, 'inventoryAdjustments'), orderBy('timestamp', 'desc')),
      (snapshot) => {
        setAdjustments(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as InventoryAdjustment[]);
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'inventoryAdjustments')
    );

    return () => {
      unsubMaterials();
      unsubInventory();
      unsubSales();
      unsubLoadPlans();
      unsubConversions();
      unsubAdjustments();
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

  const handleAddSaleItem = () => {
    setSaleItems(prev => [
      ...prev,
      { id: Math.random().toString(36).substring(2, 9), materialId: '', weight: '', salePrice: '' }
    ]);
  };

  const handleRemoveSaleItem = (id: string) => {
    if (saleItems.length <= 1) return;
    setSaleItems(prev => prev.filter(item => item.id !== id));
  };

  const handleUpdateSaleItem = (id: string, field: keyof SaleFormItem, value: string) => {
    setSaleItems(prev => prev.map(item => {
      if (item.id === id) {
        const updated = { ...item, [field]: value };
        if (field === 'materialId' && value) {
          const mat = materials.find(m => m.id === value);
          if (mat) {
            updated.salePrice = mat.salePrice.toString();
          }
        }
        return updated;
      }
      return item;
    }));
    if (inventoryErrors.length > 0) setInventoryErrors([]);
  };

  const handleOpenRecordSale = (materialId?: string) => {
    setEditingSale(null);
    setInventoryErrors([]);
    if (materialId) {
      const mat = materials.find(m => m.id === materialId);
      setSaleItems([
        {
          id: Math.random().toString(36).substring(2, 9),
          materialId,
          weight: '',
          salePrice: mat?.salePrice ? mat.salePrice.toString() : ''
        }
      ]);
    } else {
      setSaleItems([
        { id: Math.random().toString(36).substring(2, 9), materialId: '', weight: '', salePrice: '' }
      ]);
    }
    setModalBuyerName('');
    setModalDate(new Date().toISOString().split('T')[0]);
    setModalNotes('');
    setShowSaleModal(true);
  };

  const handleOpenEditSale = (sale: ExternalSale) => {
    setEditingSale(sale);
    setInventoryErrors([]);
    if (sale.items && sale.items.length > 0) {
      setSaleItems(
        sale.items.map(it => ({
          id: Math.random().toString(36).substring(2, 9),
          materialId: it.materialId,
          weight: it.weight.toString(),
          salePrice: it.salePrice.toString(),
          notes: it.notes || ''
        }))
      );
    } else {
      setSaleItems([
        {
          id: Math.random().toString(36).substring(2, 9),
          materialId: sale.materialId || '',
          weight: sale.weight ? sale.weight.toString() : '',
          salePrice: sale.salePrice ? sale.salePrice.toString() : ''
        }
      ]);
    }
    setModalBuyerName(sale.buyerName || '');
    setModalDate(sale.date ? sale.date.split('T')[0] : new Date().toISOString().split('T')[0]);
    setModalNotes(sale.notes || '');
    setShowSaleModal(true);
  };

  const handleSubmitSale = async (e: React.FormEvent) => {
    e.preventDefault();
    if (processing || !modalDate) return;

    // Filter valid lines
    const validLines = saleItems.filter(item => item.materialId && Number(item.weight) > 0);
    if (validLines.length === 0) {
      setInventoryErrors(['Please select at least one material and enter a weight greater than 0.']);
      return;
    }

    setProcessing(true);
    setInventoryErrors([]);

    try {
      // 1. Group requested weights by material ID
      const requestedWeights: Record<string, number> = {};
      validLines.forEach(item => {
        const w = Number(item.weight) || 0;
        requestedWeights[item.materialId] = (requestedWeights[item.materialId] || 0) + w;
      });

      // Calculate old weights if editing an existing sale
      const oldWeights: Record<string, number> = {};
      if (editingSale) {
        if (editingSale.items && editingSale.items.length > 0) {
          editingSale.items.forEach(it => {
            oldWeights[it.materialId] = (oldWeights[it.materialId] || 0) + it.weight;
          });
        } else if (editingSale.materialId) {
          oldWeights[editingSale.materialId] = editingSale.weight;
        }
      }

      // Identify any line items exceeding available inventory
      const errors: string[] = [];
      Object.entries(requestedWeights).forEach(([matId, reqWeight]) => {
        const currentStock = inventory.find(inv => inv.materialId === matId)?.currentWeight || 0;
        const restoredStock = currentStock + (oldWeights[matId] || 0);

        if (reqWeight > restoredStock) {
          const mat = materials.find(m => m.id === matId);
          const matLabel = mat ? `${mat.code} - ${mat.name}` : 'Material';
          const unit = mat?.unit || 'lb';
          errors.push(
            `Insufficient inventory for "${matLabel}": Requested ${reqWeight.toLocaleString()} ${unit}, but only ${restoredStock.toLocaleString()} ${unit} available in stock.`
          );
        }
      });

      if (errors.length > 0) {
        setInventoryErrors(errors);
        setProcessing(false);
        return; // BLOCK submission completely — zero partial changes written
      }

      // 2. Perform Atomic Inventory Deduction and Load Save/Update via Firestore writeBatch
      const batch = writeBatch(db);

      const saleDate = new Date(modalDate + 'T12:00:00Z').toISOString();
      const finalItems: ExternalSaleItem[] = validLines.map(item => ({
        materialId: item.materialId,
        weight: Number(item.weight),
        salePrice: Number(item.salePrice) || 0,
        ...(item.notes ? { notes: item.notes } : {})
      }));

      const totalWeight = finalItems.reduce((sum, i) => sum + i.weight, 0);
      const totalRevenue = finalItems.reduce((sum, i) => sum + (i.weight * i.salePrice), 0);
      const avgPrice = totalWeight > 0 ? totalRevenue / totalWeight : 0;

      const saleData = {
        materialId: finalItems[0]?.materialId || 'multi',
        weight: totalWeight,
        salePrice: Number(avgPrice.toFixed(4)),
        date: saleDate,
        recordedAt: new Date().toISOString(),
        recordedBy: profile?.email || 'System',
        buyerName: modalBuyerName,
        notes: modalNotes,
        items: finalItems,
        totalWeight,
        totalRevenue
      };

      if (editingSale) {
        const allMatIds = Array.from(new Set([...Object.keys(oldWeights), ...Object.keys(requestedWeights)]));

        const saleRef = doc(db, 'externalSales', editingSale.id);
        batch.update(saleRef, saleData);

        allMatIds.forEach(matId => {
          const oldW = oldWeights[matId] || 0;
          const newW = requestedWeights[matId] || 0;
          const netDiff = newW - oldW;
          if (netDiff !== 0) {
            const invRef = doc(db, 'inventory', matId);
            batch.set(invRef, {
              materialId: matId,
              currentWeight: increment(-netDiff),
              lastUpdated: new Date().toISOString()
            }, { merge: true });
          }
        });

        await batch.commit();

        await logAuditEvent(
          'inventory',
          editingSale.id,
          'update',
          { before: editingSale, after: saleData },
          `Updated external sale load (ID: ${editingSale.id}) with ${finalItems.length} line items, total ${totalWeight} lbs`
        );

      } else {
        const saleRef = doc(collection(db, 'externalSales'));
        batch.set(saleRef, saleData);

        Object.entries(requestedWeights).forEach(([matId, reqWeight]) => {
          const invRef = doc(db, 'inventory', matId);
          batch.set(invRef, {
            materialId: matId,
            currentWeight: increment(-reqWeight),
            lastUpdated: new Date().toISOString()
          }, { merge: true });
        });

        await batch.commit();

        await logAuditEvent(
          'inventory',
          saleRef.id,
          'update',
          { after: saleData },
          `Recorded external sale load (ID: ${saleRef.id}) with ${finalItems.length} line items, total ${totalWeight} lbs`
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
    const items = (sale.items && sale.items.length > 0)
      ? sale.items
      : [{ materialId: sale.materialId, weight: sale.weight, salePrice: sale.salePrice }];

    const totalW = sale.totalWeight || sale.weight;

    if (!window.confirm(`Are you sure you want to delete this external sale load record (${items.length} material line(s), total ${totalW.toLocaleString()} lbs)? This will restore all material quantities back to live inventory.`)) return;
    setProcessing(true);

    try {
      const batch = writeBatch(db);

      const restoreMap: Record<string, number> = {};
      items.forEach(it => {
        restoreMap[it.materialId] = (restoreMap[it.materialId] || 0) + it.weight;
      });

      Object.entries(restoreMap).forEach(([matId, weight]) => {
        const invRef = doc(db, 'inventory', matId);
        batch.set(invRef, {
          materialId: matId,
          currentWeight: increment(weight),
          lastUpdated: new Date().toISOString()
        }, { merge: true });
      });

      const saleRef = doc(db, 'externalSales', sale.id);
      batch.delete(saleRef);

      await batch.commit();

      await logAuditEvent(
        'inventory',
        sale.id,
        'update',
        undefined,
        `Deleted external sale load record (ID: ${sale.id}) and returned ${totalW} lbs across ${items.length} material(s) to inventory`
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

  // Material Conversions Handlers
  const handleOpenConversionModal = (sourceMatId?: string) => {
    setConversionSourceMatId(sourceMatId || '');
    setConversionConsumedWeight('');
    setConversionDestLines([
      { id: '1', destinationMaterialId: '', producedWeight: '' }
    ]);
    setConversionNotes('');
    setConversionError(null);
    setConversionSuccessMsg(null);
    setShowConversionModal(true);
  };

  const handleAddConversionDestLine = () => {
    setConversionDestLines(prev => [
      ...prev,
      { id: Date.now().toString() + Math.random().toString(36).substring(2, 5), destinationMaterialId: '', producedWeight: '' }
    ]);
    setConversionError(null);
  };

  const handleRemoveConversionDestLine = (id: string) => {
    if (conversionDestLines.length <= 1) return;
    setConversionDestLines(prev => prev.filter(line => line.id !== id));
    setConversionError(null);
  };

  const handleUpdateConversionDestLine = (id: string, field: 'destinationMaterialId' | 'producedWeight', value: string) => {
    setConversionDestLines(prev => prev.map(line => {
      if (line.id !== id) return line;
      return { ...line, [field]: value };
    }));
    setConversionError(null);
  };

  const handleSubmitConversion = async (e: React.FormEvent, logAnother = false) => {
    e.preventDefault();
    setConversionError(null);
    setConversionSuccessMsg(null);

    if (!conversionSourceMatId || !conversionConsumedWeight) {
      setConversionError('Please select a source material and enter the quantity consumed.');
      modalContentRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    const consumedNum = Number(conversionConsumedWeight);
    if (isNaN(consumedNum) || consumedNum <= 0) {
      setConversionError('Consumed quantity must be a positive number greater than 0.');
      modalContentRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    // Validate destination lines
    if (!conversionDestLines || conversionDestLines.length === 0) {
      setConversionError('Please add at least one destination material line.');
      modalContentRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    for (let i = 0; i < conversionDestLines.length; i++) {
      const line = conversionDestLines[i];
      if (!line.destinationMaterialId) {
        setConversionError(`Please select a destination material for line #${i + 1}.`);
        modalContentRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }

      if (line.destinationMaterialId === conversionSourceMatId) {
        setConversionError(`Line #${i + 1}: Destination material cannot be the same as the source material.`);
        modalContentRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }

      const pNum = Number(line.producedWeight);
      if (isNaN(pNum) || pNum < 0 || line.producedWeight === '') {
        setConversionError(`Line #${i + 1}: Produced quantity must be a valid non-negative number.`);
        modalContentRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
    }

    // Check for duplicate destination materials
    const destMatIds = conversionDestLines.map(l => l.destinationMaterialId);
    const uniqueDestMatIds = new Set(destMatIds);
    if (uniqueDestMatIds.size < destMatIds.length) {
      setConversionError('Duplicate destination materials selected. Each destination line must be a unique material.');
      modalContentRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    // CHECK 1 (SOURCE INVENTORY BLOCK): Verify source material live inventory
    const sourceMat = materials.find(m => m.id === conversionSourceMatId);
    const sourceInv = inventory.find(i => i.materialId === conversionSourceMatId);
    const sourceLiveWeight = sourceInv?.currentWeight || 0;

    if (consumedNum > sourceLiveWeight) {
      const matLabel = sourceMat ? `${sourceMat.code} - ${sourceMat.name}` : 'Source Material';
      setConversionError(
        `Insufficient live inventory for "${matLabel}": Requested consumed weight ${consumedNum.toLocaleString()} lbs, but only ${sourceLiveWeight.toLocaleString()} lbs is available in stock. Submission blocked.`
      );
      modalContentRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
      return; // BLOCK SUBMISSION ENTIRELY
    }

    setProcessing(true);

    try {
      const timestamp = new Date().toISOString();

      const destinationsData = conversionDestLines.map(line => {
        const producedWeight = Number(line.producedWeight);
        const yieldPercent = Number(((producedWeight / consumedNum) * 100).toFixed(2));
        return {
          destinationMaterialId: line.destinationMaterialId,
          producedWeight,
          yieldPercent
        };
      });

      const totalProducedWeight = destinationsData.reduce((sum, d) => sum + d.producedWeight, 0);

      const batch = writeBatch(db);
      const convRef = doc(collection(db, 'materialConversions'));

      const primaryDest = destinationsData[0];

      const conversionData = {
        sourceMaterialId: conversionSourceMatId,
        consumedWeight: consumedNum,
        destinations: destinationsData,
        // Legacy single-destination fields for backward compatibility
        destinationMaterialId: primaryDest.destinationMaterialId,
        producedWeight: primaryDest.producedWeight,
        yieldPercent: primaryDest.yieldPercent,
        timestamp,
        status: 'completed' as const,
        ...(conversionNotes.trim() ? { notes: conversionNotes.trim() } : {})
      };

      batch.set(convRef, conversionData);

      // Decrement source material inventory
      const sourceInvRef = doc(db, 'inventory', conversionSourceMatId);
      batch.set(sourceInvRef, {
        materialId: conversionSourceMatId,
        currentWeight: increment(-consumedNum),
        lastUpdated: timestamp
      }, { merge: true });

      // Increment EVERY destination material inventory
      destinationsData.forEach(d => {
        const destInvRef = doc(db, 'inventory', d.destinationMaterialId);
        batch.set(destInvRef, {
          materialId: d.destinationMaterialId,
          currentWeight: increment(d.producedWeight),
          lastUpdated: timestamp
        }, { merge: true });
      });

      await batch.commit();

      const destSummary = destinationsData.map(d => {
        const m = materials.find(mat => mat.id === d.destinationMaterialId);
        return `${d.producedWeight.toLocaleString()} lbs of ${m?.name || d.destinationMaterialId} (${d.yieldPercent}% yield)`;
      }).join(', ');

      await logAuditEvent(
        'inventory',
        convRef.id,
        'update',
        { after: conversionData },
        `Converted ${consumedNum.toLocaleString()} lbs of ${sourceMat?.name || conversionSourceMatId} into ${destSummary}`
      );

      const successMsgText = `Successfully logged conversion of ${consumedNum.toLocaleString()} lbs of ${sourceMat?.name || 'source'} into ${destSummary}! Inventory updated.`;

      if (logAnother) {
        setConversionConsumedWeight('');
        setConversionDestLines([
          { id: '1', destinationMaterialId: '', producedWeight: '' }
        ]);
        setConversionNotes('');
        setConversionSuccessMsg(successMsgText);
        modalContentRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        setShowConversionModal(false);
        setConversionPageSuccessMsg(successMsgText);
        setActiveTab('conversions');
      }

    } catch (err: any) {
      console.error('Failed to record material conversion:', err);
      const errMsg = err?.message || String(err);
      setConversionError(`Failed to record material conversion: ${errMsg}`);
      try {
        handleFirestoreError(err, OperationType.CREATE, 'materialConversions');
      } catch (_) {
        // Ignore re-thrown error so state update succeeds
      }
      modalContentRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setProcessing(false);
    }
  };

  const handleVoidConversion = async (conversion: MaterialConversion) => {
    setConversionVoidError(null);
    const sourceMat = materials.find(m => m.id === conversion.sourceMaterialId);
    const sourceLabel = sourceMat ? `${sourceMat.code} - ${sourceMat.name}` : 'Source Material';

    const destLines = getConversionDestinations(conversion);

    // Group required deductions per destination material
    const requiredDeductions: Record<string, number> = {};
    destLines.forEach(d => {
      requiredDeductions[d.destinationMaterialId] = (requiredDeductions[d.destinationMaterialId] || 0) + d.producedWeight;
    });

    // CHECK 2 (DESTINATION INVENTORY BLOCK): Verify EVERY destination material live inventory before voiding
    const failingMaterials: string[] = [];

    Object.entries(requiredDeductions).forEach(([destId, reqDeduction]) => {
      const destInv = inventory.find(i => i.materialId === destId);
      const destLiveWeight = destInv?.currentWeight || 0;
      if (destLiveWeight < reqDeduction) {
        const dMat = materials.find(m => m.id === destId);
        const dLabel = dMat ? `${dMat.code} - ${dMat.name}` : destId;
        const deficit = reqDeduction - destLiveWeight;
        failingMaterials.push(`• "${dLabel}": Reversing requires removing ${reqDeduction.toLocaleString()} lbs, but only ${destLiveWeight.toLocaleString()} lbs is currently available in stock (Deficit: ${deficit.toLocaleString()} lbs).`);
      }
    });

    if (failingMaterials.length > 0) {
      const errorMsg = `Cannot void conversion: Reversing this conversion would cause ${failingMaterials.length} destination material(s) to drop below zero stock:\n\n${failingMaterials.join('\n')}\n\nVoid blocked until sufficient stock is available.`;
      setConversionVoidError(errorMsg);
      alert(errorMsg);
      return; // BLOCK VOID ENTIRELY
    }

    const destSummaryList = destLines.map(d => {
      const m = materials.find(mat => mat.id === d.destinationMaterialId);
      return `• Remove ${d.producedWeight.toLocaleString()} lbs from ${m?.code || ''} ${m?.name || d.destinationMaterialId}`;
    }).join('\n');

    if (!window.confirm(
      `Are you sure you want to VOID this material conversion?\n\nThis will ATOMICALLY:\n• Restore ${conversion.consumedWeight.toLocaleString()} lbs back to ${sourceLabel}\n${destSummaryList}\n\nVoided conversions remain permanently visible in history marked VOIDED.`
    )) {
      return;
    }

    setProcessing(true);

    try {
      const batch = writeBatch(db);
      const convRef = doc(db, 'materialConversions', conversion.id);
      const voidTime = new Date().toISOString();

      batch.update(convRef, {
        status: 'voided',
        voidedAt: voidTime
      });

      // Restore consumedWeight back to source material
      const sourceInvRef = doc(db, 'inventory', conversion.sourceMaterialId);
      batch.set(sourceInvRef, {
        materialId: conversion.sourceMaterialId,
        currentWeight: increment(conversion.consumedWeight),
        lastUpdated: voidTime
      }, { merge: true });

      // Deduct producedWeight from EVERY destination material
      Object.entries(requiredDeductions).forEach(([destId, reqDeduction]) => {
        const destInvRef = doc(db, 'inventory', destId);
        batch.set(destInvRef, {
          materialId: destId,
          currentWeight: increment(-reqDeduction),
          lastUpdated: voidTime
        }, { merge: true });
      });

      await batch.commit();

      await logAuditEvent(
        'inventory',
        conversion.id,
        'update',
        { before: conversion, after: { ...conversion, status: 'voided', voidedAt: voidTime } },
        `Voided material conversion (ID: ${conversion.id}): restored ${conversion.consumedWeight} lbs to ${sourceLabel} and reversed destination inventory increments.`
      );

    } catch (err: any) {
      console.error('Failed to void material conversion:', err);
      const errMsg = err?.message || String(err);
      setConversionVoidError(`Failed to void material conversion: ${errMsg}`);
      try {
        handleFirestoreError(err, OperationType.UPDATE, 'materialConversions');
      } catch (_) {
        // Ignore re-thrown error
      }
    } finally {
      setProcessing(false);
    }
  };

  const handleRelogConversion = (conversion: MaterialConversion) => {
    setConversionSourceMatId(conversion.sourceMaterialId);
    setConversionConsumedWeight(conversion.consumedWeight.toString());

    const dests = getConversionDestinations(conversion);
    if (dests.length > 0) {
      setConversionDestLines(dests.map((d, idx) => ({
        id: (idx + 1).toString(),
        destinationMaterialId: d.destinationMaterialId,
        producedWeight: d.producedWeight.toString()
      })));
    } else {
      setConversionDestLines([{ id: '1', destinationMaterialId: '', producedWeight: '' }]);
    }

    setConversionNotes(conversion.notes ? `Correction for voided entry (${conversion.id.slice(0, 6)}): ${conversion.notes}` : '');
    setConversionError(null);
    setConversionSuccessMsg(null);
    setShowConversionModal(true);
  };

  // Manual Inventory Adjustment Handlers
  const handleOpenAdjustmentModal = (materialId?: string) => {
    setAdjMaterialId(materialId || '');
    setAdjType('add');
    setAdjAmount('');
    setAdjReason('');
    setAdjIsEstimate(false);
    setAdjError(null);
    setAdjSuccessMsg(null);
    setShowAdjustmentModal(true);
  };

  const handleSubmitAdjustment = async (e: React.FormEvent, logAnother = false) => {
    e.preventDefault();
    setAdjError(null);
    setAdjSuccessMsg(null);

    if (!adjMaterialId) {
      setAdjError('Please select a material.');
      adjModalContentRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    const amountNum = Number(adjAmount);
    if (isNaN(amountNum) || amountNum <= 0) {
      setAdjError('Adjustment weight must be a positive number greater than 0.');
      adjModalContentRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    if (!adjReason.trim()) {
      setAdjError('Reason for adjustment is required before submitting.');
      adjModalContentRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    const selectedMat = materials.find(m => m.id === adjMaterialId);
    const matInv = inventory.find(i => i.materialId === adjMaterialId);
    const currentWeight = matInv?.currentWeight || 0;

    const delta = adjType === 'add' ? amountNum : -amountNum;
    const resultingWeight = currentWeight + delta;

    if (adjType === 'remove' && amountNum > currentWeight) {
      const matLabel = selectedMat ? `${selectedMat.code} - ${selectedMat.name}` : 'Material';
      setAdjError(
        `Cannot remove ${amountNum.toLocaleString()} lbs from "${matLabel}": requested deduction exceeds current available live stock (${currentWeight.toLocaleString()} lbs).`
      );
      adjModalContentRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    setProcessing(true);

    try {
      const timestamp = new Date().toISOString();
      const batch = writeBatch(db);
      const adjRef = doc(collection(db, 'inventoryAdjustments'));

      const adjustmentData = {
        materialId: adjMaterialId,
        materialName: selectedMat?.name || 'Unknown Material',
        materialCode: selectedMat?.code || '-',
        adjustmentAmount: delta,
        reason: adjReason.trim(),
        isEstimate: adjIsEstimate,
        previousWeight: currentWeight,
        resultingWeight: resultingWeight,
        timestamp,
        recordedBy: profile?.displayName || auth.currentUser?.email || 'Staff',
        recordedByUid: auth.currentUser?.uid || ''
      };

      batch.set(adjRef, adjustmentData);

      const invRef = doc(db, 'inventory', adjMaterialId);
      batch.set(invRef, {
        materialId: adjMaterialId,
        currentWeight: increment(delta),
        lastUpdated: timestamp
      }, { merge: true });

      await batch.commit();

      await logAuditEvent(
        'inventory',
        adjRef.id,
        'update',
        {
          before: { currentWeight },
          after: { currentWeight: resultingWeight, isEstimate: adjIsEstimate, reason: adjReason.trim() }
        },
        `Manual Adjustment: ${delta > 0 ? '+' : ''}${delta.toLocaleString()} lbs for ${selectedMat?.name || adjMaterialId} (${selectedMat?.code || ''}). Reason: ${adjReason.trim()}${adjIsEstimate ? ' [ESTIMATE]' : ''}`
      );

      const successText = `Successfully recorded Manual Adjustment (${delta > 0 ? '+' : ''}${delta.toLocaleString()} lbs) for ${selectedMat?.name || 'material'}. Live inventory updated from ${currentWeight.toLocaleString()} lbs to ${resultingWeight.toLocaleString()} lbs.`;

      if (logAnother) {
        setAdjAmount('');
        setAdjReason('');
        setAdjIsEstimate(false);
        setAdjSuccessMsg(successText);
        adjModalContentRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        setShowAdjustmentModal(false);
        setAdjPageSuccessMsg(successText);
        setActiveTab('adjustments');
      }

    } catch (err: any) {
      console.error('Failed to record manual adjustment:', err);
      const errMsg = err?.message || String(err);
      setAdjError(`Failed to record manual adjustment: ${errMsg}`);
      try {
        handleFirestoreError(err, OperationType.CREATE, 'inventoryAdjustments');
      } catch (_) {
        // Ignore
      }
      adjModalContentRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      setProcessing(false);
    }
  };

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
    const search = salesSearch.toLowerCase();
    if (!search) return true;

    const dateStr = new Date(s.date).toLocaleDateString().toLowerCase();
    const buyerStr = (s.buyerName || '').toLowerCase();
    const notesStr = (s.notes || '').toLowerCase();
    const recordedByStr = (s.recordedBy || '').toLowerCase();

    const items = s.items && s.items.length > 0
      ? s.items
      : [{ materialId: s.materialId, weight: s.weight, salePrice: s.salePrice }];

    const materialsMatch = items.some(it => {
      const matName = getMaterialName(it.materialId).toLowerCase();
      const matCode = getMaterialCode(it.materialId).toLowerCase();
      return matName.includes(search) || matCode.includes(search);
    });

    return dateStr.includes(search) ||
           buyerStr.includes(search) ||
           notesStr.includes(search) ||
           recordedByStr.includes(search) ||
           materialsMatch;
  });

  // Material Conversion Calculations (Yield % & trends exclude voided entries!)
  const completedConversions = useMemo(() => {
    return conversions.filter(c => c.status === 'completed');
  }, [conversions]);

  const totalConsumedWeight = useMemo(() => {
    return completedConversions.reduce((sum, c) => sum + c.consumedWeight, 0);
  }, [completedConversions]);

  const totalProducedWeight = useMemo(() => {
    return completedConversions.reduce((sum, c) => {
      const dests = getConversionDestinations(c);
      return sum + dests.reduce((pSum, d) => pSum + d.producedWeight, 0);
    }, 0);
  }, [completedConversions]);

  const overallAvgYield = useMemo(() => {
    if (totalConsumedWeight === 0) return 0;
    return (totalProducedWeight / totalConsumedWeight) * 100;
  }, [totalConsumedWeight, totalProducedWeight]);

  const topProcessingPairs = useMemo(() => {
    const map: Record<string, { sourceId: string; destId: string; consumed: number; produced: number; count: number }> = {};
    completedConversions.forEach(c => {
      const dests = getConversionDestinations(c);
      dests.forEach(d => {
        const key = `${c.sourceMaterialId}_${d.destinationMaterialId}`;
        if (!map[key]) {
          map[key] = { sourceId: c.sourceMaterialId, destId: d.destinationMaterialId, consumed: 0, produced: 0, count: 0 };
        }
        map[key].consumed += c.consumedWeight;
        map[key].produced += d.producedWeight;
        map[key].count += 1;
      });
    });

    return Object.values(map)
      .map(p => ({
        ...p,
        yieldPercent: p.consumed > 0 ? (p.produced / p.consumed) * 100 : 0
      }))
      .sort((a, b) => b.consumed - a.consumed);
  }, [completedConversions]);

  const filteredConversions = useMemo(() => {
    return conversions.filter(c => {
      const search = conversionSearch.toLowerCase();
      const sourceMat = materials.find(m => m.id === c.sourceMaterialId);
      const dests = getConversionDestinations(c);

      const sourceCode = (sourceMat?.code || '').toLowerCase();
      const sourceName = (sourceMat?.name || '').toLowerCase();
      const notesStr = (c.notes || '').toLowerCase();
      const statusStr = c.status.toLowerCase();

      const destsMatchSearch = dests.some(d => {
        const destMat = materials.find(m => m.id === d.destinationMaterialId);
        const destCode = (destMat?.code || '').toLowerCase();
        const destName = (destMat?.name || '').toLowerCase();
        return destCode.includes(search) || destName.includes(search);
      });

      const matchesSearch = !search ||
        sourceCode.includes(search) ||
        sourceName.includes(search) ||
        destsMatchSearch ||
        notesStr.includes(search) ||
        statusStr.includes(search);

      const matchesSource = conversionSourceFilter === 'all' || c.sourceMaterialId === conversionSourceFilter;
      const matchesDest = conversionDestFilter === 'all' || dests.some(d => d.destinationMaterialId === conversionDestFilter);
      const matchesStatus = conversionStatusFilter === 'all' || c.status === conversionStatusFilter;

      return matchesSearch && matchesSource && matchesDest && matchesStatus;
    });
  }, [conversions, conversionSearch, conversionSourceFilter, conversionDestFilter, conversionStatusFilter, materials]);

  // Manual Adjustments Calculations & Filtering
  const totalNetAdjustmentWeight = useMemo(() => {
    return adjustments.reduce((sum, a) => sum + a.adjustmentAmount, 0);
  }, [adjustments]);

  const totalEstimateAdjustmentsCount = useMemo(() => {
    return adjustments.filter(a => a.isEstimate).length;
  }, [adjustments]);

  const filteredAdjustments = useMemo(() => {
    return adjustments.filter(adj => {
      const search = adjSearch.toLowerCase();
      const matName = (adj.materialName || getMaterialName(adj.materialId)).toLowerCase();
      const matCode = (adj.materialCode || getMaterialCode(adj.materialId)).toLowerCase();
      const reason = (adj.reason || '').toLowerCase();
      const recordedBy = (adj.recordedBy || '').toLowerCase();

      const matchesSearch = !search ||
        matName.includes(search) ||
        matCode.includes(search) ||
        reason.includes(search) ||
        recordedBy.includes(search);

      const matchesMaterial = adjMaterialFilter === 'all' || adj.materialId === adjMaterialFilter;
      const matchesEstimate = adjEstimateFilter === 'all' || (adjEstimateFilter === 'estimate' ? adj.isEstimate : !adj.isEstimate);
      const matchesType = adjTypeFilter === 'all' || (adjTypeFilter === 'add' ? adj.adjustmentAmount > 0 : adj.adjustmentAmount < 0);

      return matchesSearch && matchesMaterial && matchesEstimate && matchesType;
    });
  }, [adjustments, adjSearch, adjMaterialFilter, adjEstimateFilter, adjTypeFilter, materials]);

  // Ensure early returns are only evaluated AFTER all hooks have been declared to avoid hook order violations
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (profile && !profile.permissions?.canManageInventory && profile.role !== 'manager') {
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
              onClick={() => setActiveTab('adjustments')}
              className={cn(
                "px-5 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all flex items-center gap-2",
                activeTab === 'adjustments' ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
              )}
            >
              <SlidersHorizontal className="w-4 h-4" />
              Manual Adjustments
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
            <button
              onClick={() => setActiveTab('conversions')}
              className={cn(
                "px-5 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all flex items-center gap-2",
                activeTab === 'conversions' ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
              )}
            >
              <Repeat className="w-4 h-4" />
              Material Conversions
            </button>
          </nav>
          
          {activeTab === 'planner' ? (
            <button
              onClick={handleOpenCreateLoad}
              className="px-6 py-4.5 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white rounded-2xl text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all shadow-lg shadow-blue-100 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              New Load Plan
            </button>
          ) : activeTab === 'conversions' ? (
            <button
              onClick={() => handleOpenConversionModal()}
              className="px-6 py-4.5 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white rounded-2xl text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all shadow-lg shadow-blue-100 cursor-pointer"
            >
              <Repeat className="w-4 h-4" />
              New Conversion
            </button>
          ) : activeTab === 'adjustments' ? (
            <button
              onClick={() => handleOpenAdjustmentModal()}
              className="px-6 py-4.5 bg-amber-600 hover:bg-amber-700 active:scale-95 text-white rounded-2xl text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all shadow-lg shadow-amber-100 cursor-pointer"
            >
              <SlidersHorizontal className="w-4 h-4" />
              Adjust Stock
            </button>
          ) : (
            <div className="flex items-center gap-3">
              <button
                onClick={() => handleOpenAdjustmentModal()}
                className="px-5 py-4.5 bg-amber-600 hover:bg-amber-700 active:scale-95 text-white rounded-2xl text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all shadow-md shadow-amber-100 cursor-pointer"
              >
                <SlidersHorizontal className="w-4 h-4" />
                Adjust Stock
              </button>
              <button
                onClick={() => handleOpenConversionModal()}
                className="px-5 py-4.5 bg-slate-900 hover:bg-slate-800 active:scale-95 text-white rounded-2xl text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all shadow-md cursor-pointer"
              >
                <Repeat className="w-4 h-4" />
                Convert Material
              </button>
              <button
                onClick={() => handleOpenRecordSale()}
                className="px-5 py-4.5 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white rounded-2xl text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all shadow-lg shadow-blue-100 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                Mark Sold Outside App
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Page-level success feedback banner */}
      {conversionPageSuccessMsg && (
        <div className="p-5 bg-emerald-50 border border-emerald-200 rounded-3xl flex items-center justify-between gap-4 text-xs text-emerald-900 shadow-sm animate-in fade-in slide-in-from-top-2 duration-300 mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-100 rounded-2xl text-emerald-700 shrink-0">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <div>
              <h5 className="font-black uppercase tracking-wider text-emerald-950">Conversion Recorded</h5>
              <p className="font-medium text-emerald-800 mt-0.5">{conversionPageSuccessMsg}</p>
            </div>
          </div>
          <button
            onClick={() => setConversionPageSuccessMsg(null)}
            className="p-2 text-emerald-600 hover:text-emerald-900 hover:bg-emerald-100 rounded-xl transition-all cursor-pointer"
            aria-label="Dismiss message"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {adjPageSuccessMsg && (
        <div className="p-5 bg-amber-50 border border-amber-200 rounded-3xl flex items-center justify-between gap-4 text-xs text-amber-950 shadow-sm animate-in fade-in slide-in-from-top-2 duration-300 mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-100 rounded-2xl text-amber-800 shrink-0">
              <SlidersHorizontal className="w-5 h-5" />
            </div>
            <div>
              <h5 className="font-black uppercase tracking-wider text-amber-950">Manual Adjustment Recorded</h5>
              <p className="font-medium text-amber-900 mt-0.5">{adjPageSuccessMsg}</p>
            </div>
          </div>
          <button
            onClick={() => setAdjPageSuccessMsg(null)}
            className="p-2 text-amber-700 hover:text-amber-950 hover:bg-amber-100 rounded-xl transition-all cursor-pointer"
            aria-label="Dismiss message"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

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
                      <div className="flex items-center gap-2">
                        <button 
                          onClick={() => handleOpenAdjustmentModal(material.id)}
                          className="flex items-center gap-1.5 text-slate-700 font-black hover:text-amber-600 transition-colors bg-slate-100 hover:bg-amber-50 rounded-xl px-3 py-2 active:scale-95 cursor-pointer"
                          aria-label={`Adjust stock for ${material.name}`}
                          title="Manual inventory adjustment (addition or loss deduction)"
                        >
                          <SlidersHorizontal className="w-3.5 h-3.5 text-amber-600" />
                          Adjust
                        </button>
                        <button 
                          onClick={() => handleOpenConversionModal(material.id)}
                          className="flex items-center gap-1.5 text-slate-700 font-black hover:text-blue-600 transition-colors bg-slate-100 hover:bg-blue-50 rounded-xl px-3 py-2 active:scale-95 cursor-pointer"
                          aria-label={`Convert ${material.name}`}
                          title="Process or convert material"
                        >
                          <Repeat className="w-3.5 h-3.5 text-blue-600" />
                          Convert
                        </button>
                        <button 
                          onClick={() => handleOpenRecordSale(material.id)}
                          className="flex items-center gap-2 text-blue-600 font-black hover:text-blue-700 transition-colors bg-blue-50/50 hover:bg-blue-50 rounded-xl px-3.5 py-2 active:scale-95 cursor-pointer"
                          aria-label={`Record external sale for ${material.name}`}
                        >
                          Record Sale
                          <ArrowUpRight className="w-4 h-4" />
                        </button>
                      </div>
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
                placeholder="Search external sales by buyer, material, date or notes..."
                value={salesSearch}
                onChange={(e) => setSalesSearch(e.target.value)}
              />
            </div>
            <button
              onClick={() => handleOpenRecordSale()}
              className="px-6 py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl text-xs font-black uppercase tracking-widest flex items-center gap-2 transition-all shadow-lg shadow-blue-100 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              Mark Sold Outside App
            </button>
          </div>

          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/50 text-slate-500 text-[10px] font-black uppercase tracking-widest border-b border-slate-100">
                    <th className="px-6 py-5">Date / Buyer</th>
                    <th className="px-6 py-5">Manifest / Items</th>
                    <th className="px-6 py-5 text-right">Total Weight</th>
                    <th className="px-6 py-5 text-right">Avg Rate</th>
                    <th className="px-6 py-5 text-right">Total Revenue</th>
                    <th className="px-6 py-5">Notes / Ref</th>
                    <th className="px-6 py-5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredSales.map((sale) => {
                    const items = (sale.items && sale.items.length > 0)
                      ? sale.items
                      : [{ materialId: sale.materialId, weight: sale.weight, salePrice: sale.salePrice }];
                    const isExpanded = !!expandedSaleIds[sale.id];
                    const totWeight = sale.totalWeight || sale.weight;
                    const totRevenue = sale.totalRevenue || (sale.weight * sale.salePrice);
                    const avgRate = totWeight > 0 ? totRevenue / totWeight : sale.salePrice;

                    return (
                      <tr key={sale.id} className="hover:bg-blue-50/20 transition-all group border-b border-slate-100 last:border-0">
                        <td colSpan={7} className="p-0">
                          <table className="w-full text-left border-collapse">
                            <tbody>
                              <tr>
                                <td className="px-6 py-5 w-[20%]">
                                  <div className="flex items-center gap-3">
                                    <div className="p-2.5 bg-slate-100 rounded-xl text-slate-500 group-hover:bg-blue-100 group-hover:text-blue-600 transition-all shrink-0">
                                      <Calendar className="w-4 h-4" />
                                    </div>
                                    <div>
                                      <p className="text-sm font-black text-slate-900 uppercase tracking-tight">
                                        {new Date(sale.date).toLocaleDateString()}
                                      </p>
                                      {sale.buyerName && (
                                        <p className="text-xs font-bold text-blue-700 mt-0.5">
                                          {sale.buyerName}
                                        </p>
                                      )}
                                      <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest mt-0.5">
                                        Logged by {sale.recordedBy || 'System'}
                                      </p>
                                    </div>
                                  </div>
                                </td>
                                <td className="px-6 py-5 w-[25%]">
                                  <div className="flex flex-col gap-1.5">
                                    <div className="flex items-center gap-2">
                                      <span className="px-2.5 py-1 bg-slate-100 rounded-md text-[10px] font-black uppercase tracking-wider text-slate-700">
                                        {items.length} {items.length === 1 ? 'Material' : 'Materials'}
                                      </span>
                                      {items.length > 1 && (
                                        <button
                                          type="button"
                                          onClick={() => setExpandedSaleIds(prev => ({ ...prev, [sale.id]: !prev[sale.id] }))}
                                          className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-blue-600 hover:text-blue-800 transition-colors cursor-pointer"
                                        >
                                          {isExpanded ? 'Hide Manifest' : 'View Manifest'}
                                          {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                                        </button>
                                      )}
                                    </div>
                                    <div className="text-xs text-slate-700 font-medium">
                                      {items.slice(0, 2).map((it, idx) => (
                                        <span key={idx} className="mr-2">
                                          <span className="font-mono font-bold text-slate-500">[{getMaterialCode(it.materialId)}]</span> {getMaterialName(it.materialId)} ({it.weight.toLocaleString()} {getMaterialUnit(it.materialId)})
                                          {idx < Math.min(items.length, 2) - 1 ? ',' : ''}
                                        </span>
                                      ))}
                                      {items.length > 2 && (
                                        <span className="text-slate-400 font-bold text-[10px]">+ {items.length - 2} more</span>
                                      )}
                                    </div>
                                  </div>
                                </td>
                                <td className="px-6 py-5 text-right font-mono w-[12%]">
                                  <span className="text-sm font-black text-slate-900">
                                    {totWeight.toLocaleString()} {getMaterialUnit(items[0]?.materialId || '')}
                                  </span>
                                </td>
                                <td className="px-6 py-5 text-right font-mono w-[12%]">
                                  <span className="text-xs font-bold text-slate-600">
                                    ${avgRate.toFixed(2)} / {getMaterialUnit(items[0]?.materialId || '')}
                                  </span>
                                </td>
                                <td className="px-6 py-5 text-right font-mono w-[13%]">
                                  <span className="text-sm font-black text-blue-600">
                                    ${totRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </span>
                                </td>
                                <td className="px-6 py-5 max-w-xs truncate w-[10%]">
                                  <p className="text-xs text-slate-500 font-medium" title={sale.notes}>{sale.notes || '-'}</p>
                                </td>
                                <td className="px-6 py-5 text-right w-[8%]">
                                  <div className="flex items-center gap-2 justify-end">
                                    <button
                                      onClick={() => handleOpenEditSale(sale)}
                                      className="p-2.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all active:scale-95 cursor-pointer"
                                      title="Edit Load Record"
                                    >
                                      <Edit2 className="w-4 h-4" />
                                    </button>
                                    <button
                                      onClick={() => handleDeleteSale(sale)}
                                      className="p-2.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all active:scale-95 cursor-pointer"
                                      title="Delete Load Record"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  </div>
                                </td>
                              </tr>

                              {/* Collapsible Manifest Detail Row */}
                              {(isExpanded || (items.length === 1)) && (
                                <tr className="bg-slate-50/80">
                                  <td colSpan={7} className="px-6 py-4">
                                    <div className="bg-white border border-slate-200/80 rounded-2xl p-4 shadow-xs space-y-3">
                                      <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                                          Load Item Manifest ({items.length} {items.length === 1 ? 'Line' : 'Lines'})
                                        </span>
                                        <span className="text-xs font-mono font-bold text-slate-700">
                                          Total Weight: {totWeight.toLocaleString()} lbs | Total Revenue: ${totRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                        </span>
                                      </div>
                                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                                        {items.map((it, idx) => {
                                          const lineTotal = it.weight * it.salePrice;
                                          return (
                                            <div key={idx} className="p-3 bg-slate-50 border border-slate-200/60 rounded-xl flex justify-between items-center text-xs">
                                              <div>
                                                <div className="flex items-center gap-2">
                                                  <span className="font-mono font-black text-slate-600 px-1.5 py-0.5 bg-slate-200/60 rounded text-[10px]">
                                                    {getMaterialCode(it.materialId)}
                                                  </span>
                                                  <span className="font-bold text-slate-900">{getMaterialName(it.materialId)}</span>
                                                </div>
                                                <p className="text-[11px] text-slate-500 mt-1 font-mono">
                                                  {it.weight.toLocaleString()} {getMaterialUnit(it.materialId)} @ ${it.salePrice.toFixed(2)}/{getMaterialUnit(it.materialId)}
                                                </p>
                                                {it.notes && <p className="text-[10px] text-slate-400 italic mt-0.5">{it.notes}</p>}
                                              </div>
                                              <span className="font-black font-mono text-blue-700 text-sm">
                                                ${lineTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                              </span>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    );
                  })}
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

      {activeTab === 'conversions' && (
        <section className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-300">
          {/* Conversion Performance Overview Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Total Completed</span>
                <Repeat className="w-4 h-4 text-blue-600" />
              </div>
              <p className="text-3xl font-black text-slate-900 font-mono">
                {completedConversions.length} <span className="text-xs font-normal text-slate-400">({conversions.filter(c => c.status === 'voided').length} voided)</span>
              </p>
            </div>

            <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Consumed Weight</span>
                <ArrowDownLeft className="w-4 h-4 text-amber-600" />
              </div>
              <p className="text-3xl font-black text-slate-900 font-mono">
                {totalConsumedWeight.toLocaleString()} <span className="text-xs font-medium text-slate-400">lbs</span>
              </p>
            </div>

            <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Produced Weight</span>
                <ArrowUpRight className="w-4 h-4 text-emerald-600" />
              </div>
              <p className="text-3xl font-black text-slate-900 font-mono">
                {totalProducedWeight.toLocaleString()} <span className="text-xs font-medium text-slate-400">lbs</span>
              </p>
            </div>

            <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Avg Processing Yield</span>
                <Percent className="w-4 h-4 text-indigo-600" />
              </div>
              <p className={cn(
                "text-3xl font-black font-mono",
                overallAvgYield >= 75 ? "text-emerald-600" : overallAvgYield >= 50 ? "text-amber-600" : "text-slate-900"
              )}>
                {overallAvgYield.toFixed(1)}%
              </p>
            </div>
          </div>

          {/* Pair Yield Trends Summary */}
          {topProcessingPairs.length > 0 && (
            <div className="bg-slate-50 border border-slate-200 rounded-[2rem] p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-blue-600" />
                  <h3 className="text-base font-black text-slate-900 uppercase tracking-tight">Material Pair Yield Trends</h3>
                </div>
                <span className="text-xs text-slate-400 font-bold uppercase tracking-wider">Active Conversions Summary</span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {topProcessingPairs.map((pair, idx) => {
                  const srcMat = materials.find(m => m.id === pair.sourceId);
                  const dstMat = materials.find(m => m.id === pair.destId);

                  return (
                    <div key={idx} className="bg-white p-4 rounded-2xl border border-slate-200/60 shadow-xs space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-900">
                          <span className="px-1.5 py-0.5 bg-slate-100 font-mono text-[10px] rounded text-slate-600">{srcMat?.code || '-'}</span>
                          <ArrowRightLeft className="w-3 h-3 text-slate-400 shrink-0" />
                          <span className="px-1.5 py-0.5 bg-slate-100 font-mono text-[10px] rounded text-slate-600">{dstMat?.code || '-'}</span>
                        </div>
                        <span className={cn(
                          "px-2.5 py-1 rounded-full text-xs font-black font-mono",
                          pair.yieldPercent >= 75 ? "bg-emerald-50 text-emerald-700" : pair.yieldPercent >= 50 ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-700"
                        )}>
                          {pair.yieldPercent.toFixed(1)}% Yield
                        </span>
                      </div>

                      <div className="text-[11px] text-slate-500 flex justify-between items-center font-medium pt-2 border-t border-slate-100">
                        <span>{srcMat?.name || pair.sourceId} &rarr; {dstMat?.name || pair.destId}</span>
                        <span className="font-mono font-bold text-slate-700">{pair.consumed.toLocaleString()} lbs processed ({pair.count} log{pair.count === 1 ? '' : 's'})</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Void Error Banner Alert */}
          {conversionVoidError && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-2xl flex items-start justify-between gap-3 animate-in fade-in duration-200">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                <div>
                  <h5 className="text-xs font-black text-red-900 uppercase tracking-tight">Void Action Blocked</h5>
                  <p className="text-xs text-red-700 mt-1">{conversionVoidError}</p>
                </div>
              </div>
              <button 
                onClick={() => setConversionVoidError(null)}
                className="text-red-400 hover:text-red-600 p-1 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Filter Toolbar */}
          <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
            <div className="flex flex-col sm:flex-row items-center gap-3 flex-1">
              <div className="relative group w-full sm:max-w-xs">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-blue-600 transition-colors" />
                <input
                  type="text"
                  className="w-full pl-10 pr-4 py-3 bg-white border border-slate-200 rounded-2xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-all shadow-sm"
                  placeholder="Search by code, material name, notes..."
                  value={conversionSearch}
                  onChange={(e) => setConversionSearch(e.target.value)}
                />
              </div>

              <select
                value={conversionSourceFilter}
                onChange={(e) => setConversionSourceFilter(e.target.value)}
                className="w-full sm:w-auto px-4 py-3 bg-white border border-slate-200 rounded-2xl text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500 shadow-sm cursor-pointer"
              >
                <option value="all">All Source Materials</option>
                {materials.map(m => (
                  <option key={m.id} value={m.id}>Source: {m.code} - {m.name}</option>
                ))}
              </select>

              <select
                value={conversionDestFilter}
                onChange={(e) => setConversionDestFilter(e.target.value)}
                className="w-full sm:w-auto px-4 py-3 bg-white border border-slate-200 rounded-2xl text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500 shadow-sm cursor-pointer"
              >
                <option value="all">All Destination Materials</option>
                {materials.map(m => (
                  <option key={m.id} value={m.id}>Dest: {m.code} - {m.name}</option>
                ))}
              </select>

              <select
                value={conversionStatusFilter}
                onChange={(e) => setConversionStatusFilter(e.target.value as any)}
                className="w-full sm:w-auto px-4 py-3 bg-white border border-slate-200 rounded-2xl text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500 shadow-sm cursor-pointer"
              >
                <option value="all">All Statuses</option>
                <option value="completed">Active Only</option>
                <option value="voided">Voided Only</option>
              </select>
            </div>

            <button
              onClick={() => handleOpenConversionModal()}
              className="px-6 py-3.5 bg-blue-600 hover:bg-blue-700 active:scale-95 text-white rounded-2xl text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all shadow-lg shadow-blue-100 cursor-pointer shrink-0"
            >
              <Plus className="w-4 h-4" />
              New Material Conversion
            </button>
          </div>

          {/* Conversions Log Table */}
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/50 text-slate-500 text-[10px] font-black uppercase tracking-widest border-b border-slate-100">
                    <th className="px-6 py-5">Date & Time</th>
                    <th className="px-6 py-5">Source Material</th>
                    <th className="px-6 py-5 text-right">Qty Consumed</th>
                    <th className="px-6 py-5">Destination Material(s) & Yields</th>
                    <th className="px-6 py-5">Status</th>
                    <th className="px-6 py-5">Notes</th>
                    <th className="px-6 py-5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredConversions.map((conv) => {
                    const srcMat = materials.find(m => m.id === conv.sourceMaterialId);
                    const isVoided = conv.status === 'voided';
                    const srcStock = inventory.find(i => i.materialId === conv.sourceMaterialId)?.currentWeight || 0;
                    const dests = getConversionDestinations(conv);

                    return (
                      <tr key={conv.id} className={cn("transition-colors group", isVoided ? "bg-slate-50/60 text-slate-400" : "hover:bg-blue-50/20 text-slate-900")}>
                        <td className="px-6 py-5 font-mono text-xs">
                          <div className="font-bold">{new Date(conv.timestamp).toLocaleDateString()}</div>
                          <div className="text-[10px] text-slate-400">{new Date(conv.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                        </td>

                        <td className="px-6 py-5">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-black text-slate-600 px-2 py-0.5 bg-slate-100 rounded text-[10px]">
                              {srcMat?.code || '-'}
                            </span>
                            <span className={cn("font-bold text-xs", isVoided && "line-through text-slate-400")}>
                              {srcMat?.name || conv.sourceMaterialId}
                            </span>
                          </div>
                          <p className="text-[10px] text-slate-400 mt-0.5">Live Stock: {srcStock.toLocaleString()} lbs</p>
                        </td>

                        <td className="px-6 py-5 text-right font-mono text-xs font-bold text-amber-700">
                          -{conv.consumedWeight.toLocaleString()} lbs
                        </td>

                        <td className="px-6 py-5 min-w-[320px]">
                          <div className="space-y-1.5">
                            {dests.map((d, dIdx) => {
                              const dstMat = materials.find(m => m.id === d.destinationMaterialId);
                              const dstStock = inventory.find(i => i.materialId === d.destinationMaterialId)?.currentWeight || 0;

                              return (
                                <div key={dIdx} className="flex items-center justify-between gap-3 bg-slate-50 p-2 rounded-xl border border-slate-100 text-xs">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <span className="font-mono font-black text-slate-600 px-1.5 py-0.5 bg-white border border-slate-200 rounded text-[10px] shrink-0">
                                      {dstMat?.code || '-'}
                                    </span>
                                    <span className={cn("font-bold text-xs text-slate-800 truncate", isVoided && "line-through text-slate-400")}>
                                      {dstMat?.name || d.destinationMaterialId}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2 font-mono text-xs shrink-0">
                                    <span className={cn("font-bold text-emerald-700", isVoided && "line-through text-slate-400")}>
                                      +{d.producedWeight.toLocaleString()} lbs
                                    </span>
                                    <span className={cn(
                                      "px-2 py-0.5 rounded-full text-[10px] font-black",
                                      isVoided ? "bg-slate-200 text-slate-500 line-through" :
                                      d.yieldPercent >= 75 ? "bg-emerald-100 text-emerald-800" :
                                      d.yieldPercent >= 50 ? "bg-amber-100 text-amber-800" :
                                      "bg-slate-200 text-slate-700"
                                    )}>
                                      {d.yieldPercent.toFixed(1)}%
                                    </span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </td>

                        <td className="px-6 py-5">
                          {isVoided ? (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-red-100 text-red-800 border border-red-200">
                              <Ban className="w-3 h-3 text-red-600" />
                              Voided
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-200">
                              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                              Active
                            </span>
                          )}
                        </td>

                        <td className="px-6 py-5 text-xs text-slate-500 max-w-xs truncate">
                          {conv.notes || '-'}
                        </td>

                        <td className="px-6 py-5 text-right">
                          {!isVoided ? (
                            <button
                              onClick={() => handleVoidConversion(conv)}
                              disabled={processing}
                              className="px-3.5 py-2 bg-red-50 hover:bg-red-100 text-red-700 rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-1.5 ml-auto transition-colors active:scale-95 cursor-pointer"
                              title="Void this conversion and reverse inventory changes"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              Void
                            </button>
                          ) : (
                            <button
                              onClick={() => handleRelogConversion(conv)}
                              disabled={processing}
                              className="px-3.5 py-2 bg-slate-100 hover:bg-blue-50 text-slate-700 hover:text-blue-700 rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-1.5 ml-auto transition-colors active:scale-95 cursor-pointer"
                              title="Log a new corrected conversion using these materials"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              Log Corrected
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}

                  {filteredConversions.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-6 py-12 text-center text-slate-400">
                        <Repeat className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                        <p className="text-slate-700 font-bold text-sm">No material conversions logged yet</p>
                        <p className="text-xs text-slate-400 mt-1">Use the "New Material Conversion" button to log internal processing.</p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {/* Manual Inventory Adjustments Tab */}
      {activeTab === 'adjustments' && (
        <section className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-300">
          {/* Header Stats Bar */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white border border-slate-200 rounded-[2rem] p-6 shadow-xs flex items-center justify-between">
              <div>
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-1">
                  Total Adjustments Recorded
                </span>
                <span className="text-3xl font-black font-mono text-slate-900">
                  {adjustments.length}
                </span>
              </div>
              <div className="p-3 bg-indigo-50 text-indigo-600 rounded-2xl">
                <SlidersHorizontal className="w-6 h-6" />
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-[2rem] p-6 shadow-xs flex items-center justify-between">
              <div>
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-1">
                  Net Physical Stock Shift
                </span>
                <span className={cn(
                  "text-3xl font-black font-mono",
                  totalNetAdjustmentWeight > 0 ? "text-emerald-600" : totalNetAdjustmentWeight < 0 ? "text-red-600" : "text-slate-900"
                )}>
                  {totalNetAdjustmentWeight > 0 ? '+' : ''}{totalNetAdjustmentWeight.toLocaleString()} lbs
                </span>
              </div>
              <div className="p-3 bg-blue-50 text-blue-600 rounded-2xl">
                <Scale className="w-6 h-6" />
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-[2rem] p-6 shadow-xs flex items-center justify-between">
              <div>
                <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-1">
                  Pending Physical Verification
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-3xl font-black font-mono text-amber-600">
                    {totalEstimateAdjustmentsCount}
                  </span>
                  <span className="text-xs font-bold text-amber-700 bg-amber-50 px-2.5 py-1 rounded-full border border-amber-200 uppercase tracking-wider">
                    Estimates
                  </span>
                </div>
              </div>
              <div className="p-3 bg-amber-50 text-amber-600 rounded-2xl">
                <HelpCircle className="w-6 h-6" />
              </div>
            </div>
          </div>

          {/* Filter Toolbar */}
          <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
            <div className="flex flex-col sm:flex-row items-center gap-3 flex-1 flex-wrap">
              <div className="relative group w-full sm:max-w-xs">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-blue-600 transition-colors" />
                <input
                  type="text"
                  className="w-full pl-10 pr-4 py-3 bg-white border border-slate-200 rounded-2xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-all shadow-sm"
                  placeholder="Search by code, material, reason, staff..."
                  value={adjSearch}
                  onChange={(e) => setAdjSearch(e.target.value)}
                />
              </div>

              <select
                value={adjMaterialFilter}
                onChange={(e) => setAdjMaterialFilter(e.target.value)}
                className="w-full sm:w-auto px-4 py-3 bg-white border border-slate-200 rounded-2xl text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500 shadow-sm cursor-pointer"
              >
                <option value="all">All Materials</option>
                {materials.map(m => (
                  <option key={m.id} value={m.id}>{m.code} - {m.name}</option>
                ))}
              </select>

              <select
                value={adjTypeFilter}
                onChange={(e) => setAdjTypeFilter(e.target.value as any)}
                className="w-full sm:w-auto px-4 py-3 bg-white border border-slate-200 rounded-2xl text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500 shadow-sm cursor-pointer"
              >
                <option value="all">All Adjustment Types</option>
                <option value="add">Additions (+)</option>
                <option value="remove">Deductions (-)</option>
              </select>

              <select
                value={adjEstimateFilter}
                onChange={(e) => setAdjEstimateFilter(e.target.value as any)}
                className="w-full sm:w-auto px-4 py-3 bg-white border border-slate-200 rounded-2xl text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500 shadow-sm cursor-pointer"
              >
                <option value="all">Estimate & Confirmed</option>
                <option value="estimate">Estimates Only</option>
                <option value="confirmed">Confirmed Only</option>
              </select>
            </div>

            <button
              onClick={() => handleOpenAdjustmentModal()}
              className="px-6 py-3.5 bg-amber-600 hover:bg-amber-700 active:scale-95 text-white rounded-2xl text-xs font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all shadow-lg shadow-amber-100 cursor-pointer shrink-0"
            >
              <Plus className="w-4 h-4" />
              Adjust Stock
            </button>
          </div>

          {/* Adjustments Log Table */}
          <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/50 text-slate-500 text-[10px] font-black uppercase tracking-widest border-b border-slate-100">
                    <th className="px-6 py-5">Date & Time</th>
                    <th className="px-6 py-5">Action Type</th>
                    <th className="px-6 py-5">Verification</th>
                    <th className="px-6 py-5">Material</th>
                    <th className="px-6 py-5 text-right">Adjustment Delta</th>
                    <th className="px-6 py-5 text-center">Stock Shift</th>
                    <th className="px-6 py-5">Reason</th>
                    <th className="px-6 py-5">Recorded By</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredAdjustments.map((adj) => {
                    const mat = materials.find(m => m.id === adj.materialId);
                    const isPositive = adj.adjustmentAmount > 0;

                    return (
                      <tr key={adj.id} className="hover:bg-amber-50/20 text-slate-900 transition-colors">
                        <td className="px-6 py-5 font-mono text-xs">
                          <div className="font-bold">{new Date(adj.timestamp).toLocaleDateString()}</div>
                          <div className="text-[10px] text-slate-400">{new Date(adj.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                        </td>

                        <td className="px-6 py-5">
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-indigo-100 text-indigo-900 border border-indigo-200">
                            <SlidersHorizontal className="w-3 h-3 text-indigo-600" />
                            MANUAL ADJUSTMENT
                          </span>
                        </td>

                        <td className="px-6 py-5">
                          {adj.isEstimate ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-100 text-amber-900 border border-amber-300">
                              <AlertCircle className="w-3 h-3 text-amber-600" />
                              ESTIMATE
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-900 border border-emerald-300">
                              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                              CONFIRMED
                            </span>
                          )}
                        </td>

                        <td className="px-6 py-5">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-black text-slate-600 px-2 py-0.5 bg-slate-100 rounded text-[10px]">
                              {adj.materialCode || mat?.code || '-'}
                            </span>
                            <span className="font-bold text-xs">
                              {adj.materialName || mat?.name || adj.materialId}
                            </span>
                          </div>
                        </td>

                        <td className={cn(
                          "px-6 py-5 text-right font-mono text-sm font-black",
                          isPositive ? "text-emerald-600" : "text-red-600"
                        )}>
                          {isPositive ? '+' : ''}{adj.adjustmentAmount.toLocaleString()} lbs
                        </td>

                        <td className="px-6 py-5 text-center font-mono text-xs text-slate-500">
                          <span className="bg-slate-50 px-2.5 py-1 rounded-lg border border-slate-200/60 inline-flex items-center gap-1.5">
                            <span>{adj.previousWeight.toLocaleString()} lbs</span>
                            <span className="text-slate-300">&rarr;</span>
                            <span className="font-bold text-slate-900">{adj.resultingWeight.toLocaleString()} lbs</span>
                          </span>
                        </td>

                        <td className="px-6 py-5 text-xs text-slate-700 max-w-md">
                          <p className="bg-slate-50/80 p-2.5 rounded-xl border border-slate-100 font-medium leading-relaxed">
                            {adj.reason}
                          </p>
                        </td>

                        <td className="px-6 py-5 text-xs text-slate-500 font-medium">
                          {adj.recordedBy}
                        </td>
                      </tr>
                    );
                  })}

                  {filteredAdjustments.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-6 py-12 text-center text-slate-400">
                        <SlidersHorizontal className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                        <p className="text-slate-700 font-bold text-sm">No manual adjustments logged yet</p>
                        <p className="text-xs text-slate-400 mt-1">Use the "Adjust Stock" button to record physical counts, carryovers, or inventory losses.</p>
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

      {/* Record / Edit Multi-Material External Sale Modal */}
      {showSaleModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6 z-50 animate-in fade-in duration-200 overflow-y-auto" role="dialog" aria-modal="true">
          <div className="bg-white rounded-[2.5rem] w-full max-w-3xl p-6 sm:p-10 border border-slate-100 shadow-2xl relative space-y-8 animate-in zoom-in-95 duration-200 my-8">
            <button
              onClick={() => setShowSaleModal(false)}
              className="absolute top-6 right-6 sm:top-8 sm:right-8 w-11 h-11 flex items-center justify-center text-slate-300 hover:text-slate-500 hover:bg-slate-50 rounded-xl transition-all active:scale-95 cursor-pointer"
              aria-label="Close modal"
            >
              <X className="w-5 h-5" />
            </button>

            <div>
              <h2 className="text-2xl font-black text-slate-900 uppercase tracking-tight">
                {editingSale ? 'Edit Outbound Sale Load' : 'Record Outbound Sale Load'}
              </h2>
              <p className="text-xs text-slate-400 font-black uppercase tracking-widest mt-1">
                Log a multi-material shipment sold outside the app
              </p>
            </div>

            <form onSubmit={handleSubmitSale} className="space-y-6">
              {/* Shared Load Info Card */}
              <div className="p-6 bg-slate-50 rounded-2xl border border-slate-200/80 space-y-4">
                <span className="text-xs font-black text-slate-900 uppercase tracking-wide block">
                  Shared Load Metadata
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
                      Sale Date (Retroactive)
                    </label>
                    <div className="relative group">
                      <Calendar className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-blue-600 transition-colors pointer-events-none" />
                      <input
                        required
                        type="date"
                        className="w-full pl-10 pr-4 py-3 bg-white border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                        value={modalDate}
                        onChange={(e) => setModalDate(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
                      Buyer / Destination Company
                    </label>
                    <input
                      type="text"
                      className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                      placeholder="e.g. Midwest Metals / Melt Shop #2"
                      value={modalBuyerName}
                      onChange={(e) => setModalBuyerName(e.target.value)}
                    />
                  </div>

                  <div className="sm:col-span-2 space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
                      Load Notes / Reference
                    </label>
                    <textarea
                      className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-blue-500 min-h-[60px] resize-none"
                      placeholder="PO number, check/EFT details, carrier info, or load notes..."
                      value={modalNotes}
                      onChange={(e) => setModalNotes(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              {/* Material Lines Builder */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-black text-slate-900 uppercase tracking-wide block">
                      Material Lines ({saleItems.length})
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">
                      Add all materials contained in this outbound shipment
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleAddSaleItem}
                    className="px-4 py-2 bg-blue-50 hover:bg-blue-100 text-blue-600 rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-1.5 transition-all cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    Add Material Line
                  </button>
                </div>

                <div className="space-y-3 max-h-[320px] overflow-y-auto pr-1">
                  {saleItems.map((item, idx) => {
                    const lineSubtotal = (Number(item.weight) || 0) * (Number(item.salePrice) || 0);
                    const selectedMat = materials.find(m => m.id === item.materialId);

                    return (
                      <div key={item.id} className="p-4 bg-slate-50/60 border border-slate-200 rounded-2xl space-y-3 relative">
                        <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                          <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-1.5">
                            <span className="w-5 h-5 flex items-center justify-center bg-slate-200 text-slate-700 text-[10px] font-mono rounded-md">
                              {idx + 1}
                            </span>
                            Line #{idx + 1}
                          </span>
                          <div className="flex items-center gap-3">
                            <span className="text-xs font-mono font-black text-blue-600">
                              Subtotal: ${lineSubtotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                            {saleItems.length > 1 && (
                              <button
                                type="button"
                                onClick={() => handleRemoveSaleItem(item.id)}
                                className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all cursor-pointer"
                                title="Remove Material Line"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                          <div className="sm:col-span-5 space-y-1">
                            <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">
                              Material
                            </label>
                            <select
                              required
                              className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500"
                              value={item.materialId}
                              onChange={(e) => handleUpdateSaleItem(item.id, 'materialId', e.target.value)}
                            >
                              <option value="">-- Choose Material --</option>
                              {materials.map(m => (
                                <option key={m.id} value={m.id}>
                                  {m.code} - {m.name} (${m.salePrice.toFixed(2)} / {m.unit})
                                </option>
                              ))}
                            </select>
                          </div>

                          <div className="sm:col-span-3 space-y-1">
                            <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">
                              Weight Sold
                            </label>
                            <div className="relative">
                              <input
                                required
                                type="number"
                                step="any"
                                min="0.01"
                                className="w-full pl-3 pr-10 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="0.00"
                                value={item.weight}
                                onChange={(e) => handleUpdateSaleItem(item.id, 'weight', e.target.value)}
                              />
                              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-black text-slate-400 uppercase">
                                {selectedMat ? selectedMat.unit : 'lb'}
                              </span>
                            </div>
                          </div>

                          <div className="sm:col-span-4 space-y-1">
                            <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">
                              Price / Unit
                            </label>
                            <div className="relative">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">$</span>
                              <input
                                required
                                type="number"
                                step="0.01"
                                min="0"
                                className="w-full pl-7 pr-3 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="0.00"
                                value={item.salePrice}
                                onChange={(e) => handleUpdateSaleItem(item.id, 'salePrice', e.target.value)}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Insufficient Inventory Error Banner */}
              {inventoryErrors.length > 0 && (
                <div className="p-4 bg-red-50 border border-red-200 rounded-2xl space-y-2 animate-in fade-in duration-150">
                  <div className="flex items-center gap-2 text-red-700 text-xs font-black uppercase tracking-wide">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>Submission Blocked — Insufficient Live Inventory</span>
                  </div>
                  <ul className="list-disc list-inside space-y-1 text-xs text-red-600 font-medium">
                    {inventoryErrors.map((err, idx) => (
                      <li key={idx}>{err}</li>
                    ))}
                  </ul>
                  <p className="text-[10px] text-red-500 font-bold uppercase tracking-wider mt-1">
                    Please lower the requested weight or adjust your stock balances before submitting. No inventory was deducted.
                  </p>
                </div>
              )}

              {/* Running Load Total Bar */}
              <div className="p-6 bg-slate-900 text-white rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-4 shadow-xl">
                <div>
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">
                    Outbound Load Summary
                  </span>
                  <div className="flex items-center gap-4 mt-1">
                    <span className="text-xs font-bold text-slate-300">
                      {saleItems.filter(i => i.materialId && Number(i.weight) > 0).length} Line Items
                    </span>
                    <span className="text-slate-600">•</span>
                    <span className="text-xs font-bold text-slate-300">
                      Total Weight:{' '}
                      <span className="text-white font-mono font-black text-sm">
                        {saleItems.reduce((sum, i) => sum + (Number(i.weight) || 0), 0).toLocaleString()} lbs
                      </span>
                    </span>
                  </div>
                </div>

                <div className="text-right w-full sm:w-auto border-t sm:border-t-0 border-slate-800 pt-3 sm:pt-0">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">
                    Total Revenue
                  </span>
                  <span className="text-2xl font-black font-mono text-blue-400">
                    ${saleItems.reduce((sum, i) => sum + ((Number(i.weight) || 0) * (Number(i.salePrice) || 0)), 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowSaleModal(false)}
                  className="flex-1 py-4 border border-slate-200 text-slate-500 rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-slate-50 transition-all cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={processing}
                  className="flex-[2] py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl font-black text-xs uppercase tracking-widest transition-all disabled:opacity-50 flex items-center justify-center gap-3 shadow-xl shadow-blue-100 cursor-pointer"
                >
                  {processing ? <Loader2 className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
                  {editingSale ? 'Save Load Changes' : 'Confirm Outbound Load'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Material Conversion Modal */}
      {showConversionModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6 z-50 animate-in fade-in duration-200 overflow-y-auto" role="dialog" aria-modal="true">
          <div ref={modalContentRef} className="bg-white rounded-[2.5rem] w-full max-w-2xl p-6 sm:p-10 border border-slate-100 shadow-2xl relative space-y-8 animate-in zoom-in-95 duration-200 my-8 max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => setShowConversionModal(false)}
              className="absolute top-6 right-6 sm:top-8 sm:right-8 w-11 h-11 flex items-center justify-center text-slate-300 hover:text-slate-500 hover:bg-slate-50 rounded-xl transition-all active:scale-95 cursor-pointer"
              aria-label="Close modal"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-blue-50 text-blue-600 rounded-2xl">
                  <Repeat className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-2xl font-black text-slate-900 uppercase tracking-tight">Material Conversion</h3>
                  <p className="text-xs text-slate-500 font-medium">Log internal processing (e.g. stripping wire from Romex to Bare Bright Copper).</p>
                </div>
              </div>
            </div>

            {conversionError && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-2xl flex items-start gap-3 text-xs text-red-800">
                <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                <div>
                  <h5 className="font-black uppercase tracking-wider text-red-900">Validation Error</h5>
                  <p className="mt-0.5">{conversionError}</p>
                </div>
              </div>
            )}

            {conversionSuccessMsg && (
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-start gap-3 text-xs text-emerald-800">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                <div>
                  <h5 className="font-black uppercase tracking-wider text-emerald-900">Success</h5>
                  <p className="mt-0.5">{conversionSuccessMsg}</p>
                </div>
              </div>
            )}

            <form onSubmit={(e) => handleSubmitConversion(e, false)} className="space-y-6">
              {/* Source Material & Quantity Consumed */}
              <div className="p-6 bg-slate-50 rounded-3xl border border-slate-200/80 space-y-4">
                <div className="flex items-center gap-2">
                  <ArrowDownLeft className="w-4 h-4 text-amber-600" />
                  <h4 className="text-xs font-black uppercase tracking-widest text-slate-900">1. Source Material (Consumed)</h4>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                      Source Material <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={conversionSourceMatId}
                      onChange={(e) => {
                        setConversionSourceMatId(e.target.value);
                        setConversionError(null);
                      }}
                      className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-all cursor-pointer"
                      required
                    >
                      <option value="">-- Select Source Material --</option>
                      {materials.map(m => {
                        const invWeight = inventory.find(i => i.materialId === m.id)?.currentWeight || 0;
                        return (
                          <option key={m.id} value={m.id}>
                            {m.code} - {m.name} ({invWeight.toLocaleString()} {m.unit} in stock)
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                      Quantity Consumed (Weight) <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <input
                        type="number"
                        step="any"
                        min="0.01"
                        placeholder="e.g. 100"
                        value={conversionConsumedWeight}
                        onChange={(e) => {
                          setConversionConsumedWeight(e.target.value);
                          setConversionError(null);
                        }}
                        className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-xs font-mono font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                        required
                      />
                      <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">lbs</span>
                    </div>
                  </div>
                </div>

                {conversionSourceMatId && (
                  <div className="text-[11px] text-slate-500 font-medium pt-1 flex justify-between">
                    <span>Available Live Inventory:</span>
                    <span className="font-mono font-bold text-slate-900">
                      {(inventory.find(i => i.materialId === conversionSourceMatId)?.currentWeight || 0).toLocaleString()} lbs
                    </span>
                  </div>
                )}
              </div>

              {/* Destination Materials & Quantities Produced */}
              <div className="p-6 bg-slate-50 rounded-3xl border border-slate-200/80 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ArrowUpRight className="w-4 h-4 text-emerald-600" />
                    <h4 className="text-xs font-black uppercase tracking-widest text-slate-900">
                      2. Destination Material(s) Produced
                    </h4>
                  </div>
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                    {conversionDestLines.length} Destination {conversionDestLines.length === 1 ? 'Line' : 'Lines'}
                  </span>
                </div>

                <div className="space-y-3">
                  {conversionDestLines.map((line, idx) => {
                    const lineProducedNum = Number(line.producedWeight) || 0;
                    const consumedNum = Number(conversionConsumedWeight) || 0;
                    const lineYieldPercent = consumedNum > 0 ? (lineProducedNum / consumedNum) * 100 : 0;

                    return (
                      <div key={line.id} className="p-4 bg-white rounded-2xl border border-slate-200 shadow-sm space-y-3">
                        <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
                          <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                            Destination Line #{idx + 1}
                          </span>
                          {conversionDestLines.length > 1 && (
                            <button
                              type="button"
                              onClick={() => handleRemoveConversionDestLine(line.id)}
                              className="text-slate-400 hover:text-red-600 p-1 rounded-lg hover:bg-red-50 transition-colors cursor-pointer"
                              title="Remove destination line"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                              Destination Material <span className="text-red-500">*</span>
                            </label>
                            <select
                              value={line.destinationMaterialId}
                              onChange={(e) => handleUpdateConversionDestLine(line.id, 'destinationMaterialId', e.target.value)}
                              className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-all cursor-pointer"
                              required
                            >
                              <option value="">-- Select Material --</option>
                              {materials.map(m => {
                                const invWeight = inventory.find(i => i.materialId === m.id)?.currentWeight || 0;
                                return (
                                  <option key={m.id} value={m.id} disabled={m.id === conversionSourceMatId}>
                                    {m.code} - {m.name} ({invWeight.toLocaleString()} {m.unit} in stock)
                                  </option>
                                );
                              })}
                            </select>
                          </div>

                          <div>
                            <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                              Produced Weight (lbs) <span className="text-red-500">*</span>
                            </label>
                            <div className="relative">
                              <input
                                type="number"
                                step="any"
                                min="0"
                                placeholder="e.g. 85"
                                value={line.producedWeight}
                                onChange={(e) => handleUpdateConversionDestLine(line.id, 'producedWeight', e.target.value)}
                                className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono font-bold outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                                required
                              />
                              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">lbs</span>
                            </div>
                          </div>
                        </div>

                        {/* Individual Line Yield Calculation */}
                        {consumedNum > 0 && line.destinationMaterialId && (
                          <div className="flex items-center justify-between text-[11px] font-medium pt-1 text-slate-500">
                            <span>Individual Line Yield:</span>
                            <span className={cn(
                              "font-mono font-black px-2 py-0.5 rounded-full text-[10px]",
                              lineYieldPercent >= 75 ? "bg-emerald-100 text-emerald-800" :
                              lineYieldPercent >= 50 ? "bg-amber-100 text-amber-800" :
                              "bg-slate-100 text-slate-700"
                            )}>
                              {lineYieldPercent.toFixed(1)}% yield ({lineProducedNum.toLocaleString()} lbs)
                            </span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <button
                  type="button"
                  onClick={handleAddConversionDestLine}
                  className="w-full py-3 bg-white hover:bg-slate-100 border border-dashed border-slate-300 text-slate-700 rounded-2xl text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer shadow-sm"
                >
                  <Plus className="w-4 h-4 text-blue-600" />
                  + Add Another Destination Material Line
                </button>

                {/* Total Combined Yield & Weight Summary Card */}
                {Number(conversionConsumedWeight) > 0 && conversionDestLines.some(l => Number(l.producedWeight) > 0) && (() => {
                  const consumedNum = Number(conversionConsumedWeight);
                  const totalProd = conversionDestLines.reduce((sum, l) => sum + (Number(l.producedWeight) || 0), 0);
                  const totalYield = (totalProd / consumedNum) * 100;
                  const diff = totalProd - consumedNum;

                  return (
                    <div className="p-4 bg-slate-900 text-white rounded-2xl space-y-2 shadow-lg">
                      <div className="flex items-center justify-between text-xs font-bold border-b border-slate-800 pb-2">
                        <span className="text-slate-400 uppercase tracking-wider text-[10px]">Total Production Summary</span>
                        <span className={cn(
                          "px-2.5 py-0.5 rounded-full text-xs font-black font-mono",
                          totalYield >= 75 ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40" : "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                        )}>
                          {totalYield.toFixed(1)}% Combined Yield
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-xs font-mono">
                        <span className="text-slate-300">Total Produced: <span className="text-white font-bold">{totalProd.toLocaleString()} lbs</span></span>
                        <span className={diff >= 0 ? "text-emerald-400" : "text-amber-400"}>
                          {diff >= 0 ? `+${diff.toLocaleString()} lbs gain` : `${diff.toLocaleString()} lbs loss/scrap`}
                        </span>
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* Notes */}
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-500 mb-1">
                  Processing / Conversion Notes (Optional)
                </label>
                <textarea
                  rows={2}
                  placeholder="e.g. Stripped 100 lbs Romex wire using wire stripper machine..."
                  value={conversionNotes}
                  onChange={(e) => setConversionNotes(e.target.value)}
                  className="w-full p-3 bg-white border border-slate-200 rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                />
              </div>

              {/* Buttons */}
              <div className="flex flex-col sm:flex-row items-center justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowConversionModal(false)}
                  className="w-full sm:w-auto px-6 py-3.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-2xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer"
                >
                  Cancel
                </button>

                <button
                  type="button"
                  onClick={(e) => handleSubmitConversion(e, true)}
                  disabled={processing}
                  className="w-full sm:w-auto px-6 py-3.5 bg-slate-900 hover:bg-slate-800 text-white rounded-2xl text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50"
                >
                  {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  Save & Log Another
                </button>

                <button
                  type="submit"
                  disabled={processing}
                  className="w-full sm:w-auto px-6 py-3.5 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 transition-all shadow-lg shadow-blue-100 cursor-pointer disabled:opacity-50"
                >
                  {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  Confirm Conversion
                </button>
              </div>
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

      {/* Manual Inventory Adjustment Modal */}
      {showAdjustmentModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6 z-50 animate-in fade-in duration-200 overflow-y-auto" role="dialog" aria-modal="true">
          <div ref={adjModalContentRef} className="bg-white rounded-[2.5rem] w-full max-w-2xl p-6 sm:p-10 border border-slate-100 shadow-2xl relative space-y-6 animate-in zoom-in-95 duration-200 my-8 max-h-[90vh] overflow-y-auto">
            <button
              onClick={() => setShowAdjustmentModal(false)}
              className="absolute top-6 right-6 sm:top-8 sm:right-8 w-11 h-11 flex items-center justify-center text-slate-300 hover:text-slate-500 hover:bg-slate-50 rounded-xl transition-all active:scale-95 cursor-pointer"
              aria-label="Close modal"
            >
              <X className="w-5 h-5" />
            </button>

            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-800 text-[10px] font-black uppercase tracking-widest mb-2">
                <SlidersHorizontal className="w-3.5 h-3.5 text-amber-600" />
                Manual Adjustment
              </div>
              <h2 className="text-2xl font-black text-slate-900 uppercase tracking-tight">
                Manual Inventory Adjustment
              </h2>
              <p className="text-xs text-slate-500 font-medium mt-1">
                Record a physical count correction, location carryover, or stock loss. Adjustments permanently update live inventory and create a permanent history entry.
              </p>
            </div>

            {adjError && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-2xl flex items-start gap-3 animate-in fade-in duration-200">
                <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                <div className="text-xs">
                  <h5 className="font-black text-red-900 uppercase tracking-tight">Adjustment Error</h5>
                  <p className="text-red-700 mt-1">{adjError}</p>
                </div>
              </div>
            )}

            {adjSuccessMsg && (
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-start gap-3 animate-in fade-in duration-200">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                <div className="text-xs">
                  <h5 className="font-black text-emerald-900 uppercase tracking-tight">Adjustment Saved</h5>
                  <p className="text-emerald-800 mt-1">{adjSuccessMsg}</p>
                </div>
              </div>
            )}

            <form onSubmit={(e) => handleSubmitAdjustment(e, false)} className="space-y-6">
              {/* Material Selector */}
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
                  Select Material <span className="text-red-500">*</span>
                </label>
                <select
                  required
                  value={adjMaterialId}
                  onChange={(e) => {
                    setAdjMaterialId(e.target.value);
                    setAdjError(null);
                  }}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-amber-500 transition-all cursor-pointer"
                >
                  <option value="">-- Choose Material to Adjust --</option>
                  {materials.map((m) => {
                    const inv = inventory.find(i => i.materialId === m.id);
                    const stock = inv?.currentWeight || 0;
                    return (
                      <option key={m.id} value={m.id}>
                        {m.code} - {m.name} (Current Live Stock: {stock.toLocaleString()} lbs)
                      </option>
                    );
                  })}
                </select>
              </div>

              {/* Adjustment Direction Toggle */}
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
                  Adjustment Type <span className="text-red-500">*</span>
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setAdjType('add');
                      setAdjError(null);
                    }}
                    className={cn(
                      "p-4 rounded-2xl border text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer",
                      adjType === 'add'
                        ? "bg-emerald-50 border-emerald-500 text-emerald-800 shadow-xs ring-2 ring-emerald-500/20"
                        : "bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100"
                    )}
                  >
                    <Plus className="w-4 h-4 text-emerald-600" />
                    Add Stock (+)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAdjType('remove');
                      setAdjError(null);
                    }}
                    className={cn(
                      "p-4 rounded-2xl border text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 transition-all cursor-pointer",
                      adjType === 'remove'
                        ? "bg-red-50 border-red-500 text-red-800 shadow-xs ring-2 ring-red-500/20"
                        : "bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100"
                    )}
                  >
                    <Trash2 className="w-4 h-4 text-red-600" />
                    Remove Stock (-)
                  </button>
                </div>
                <p className="text-[11px] text-slate-400 italic px-1">
                  {adjType === 'add' 
                    ? "Adds inventory (e.g. found material during physical audit, carryover from previous site)." 
                    : "Removes inventory (e.g. damage, shrinkage, loss, count deficit)."}
                </p>
              </div>

              {/* Weight Amount Input */}
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
                  Adjustment Weight (lbs) <span className="text-red-500">*</span>
                </label>
                <input
                  required
                  type="number"
                  min="1"
                  step="any"
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-900 outline-none focus:ring-2 focus:ring-amber-500 transition-all font-mono"
                  placeholder="e.g. 500"
                  value={adjAmount}
                  onChange={(e) => {
                    setAdjAmount(e.target.value);
                    setAdjError(null);
                  }}
                />

                {/* Stock Live Preview */}
                {adjMaterialId && adjAmount && !isNaN(Number(adjAmount)) && Number(adjAmount) > 0 && (
                  <div className="p-3 bg-slate-100/80 rounded-xl border border-slate-200/80 text-xs flex items-center justify-between font-mono">
                    <span className="text-slate-500 font-sans text-[11px]">Calculated Impact:</span>
                    <div className="flex items-center gap-2">
                      <span className="text-slate-600">
                        {(inventory.find(i => i.materialId === adjMaterialId)?.currentWeight || 0).toLocaleString()} lbs
                      </span>
                      <span className="text-slate-400">&rarr;</span>
                      <span className={cn(
                        "font-black",
                        adjType === 'add' ? "text-emerald-700" : "text-red-700"
                      )}>
                        {((inventory.find(i => i.materialId === adjMaterialId)?.currentWeight || 0) + (adjType === 'add' ? Number(adjAmount) : -Number(adjAmount))).toLocaleString()} lbs
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Estimate Checkbox / Toggle */}
              <div className="p-4 bg-amber-50/60 border border-amber-200/80 rounded-2xl space-y-2">
                <label className="flex items-center gap-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={adjIsEstimate}
                    onChange={(e) => setAdjIsEstimate(e.target.checked)}
                    className="w-5 h-5 text-amber-600 rounded border-slate-300 focus:ring-amber-500 cursor-pointer"
                  />
                  <div>
                    <span className="text-xs font-black text-amber-950 uppercase tracking-tight block">
                      Mark as ESTIMATE (Pending Physical Verification)
                    </span>
                    <span className="text-[11px] text-amber-800 block">
                      Check if this figure is estimated (e.g. quick visual eyeball count). It will be tagged with a visible ESTIMATE badge in history.
                    </span>
                  </div>
                </label>
              </div>

              {/* Reason Input (REQUIRED) */}
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">
                  Reason for Adjustment <span className="text-red-500">* (Required)</span>
                </label>
                <textarea
                  required
                  rows={3}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-amber-500 transition-all resize-none font-medium"
                  placeholder="Provide a clear explanation (e.g. Found 2 extra Gaylords during Q3 physical audit; Water/evaporation weight loss...)"
                  value={adjReason}
                  onChange={(e) => {
                    setAdjReason(e.target.value);
                    setAdjError(null);
                  }}
                />
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAdjustmentModal(false)}
                  disabled={processing}
                  className="px-5 py-3.5 text-slate-600 hover:text-slate-800 rounded-xl text-xs font-bold transition-all cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={(e) => handleSubmitAdjustment(e, true)}
                  disabled={processing}
                  className="px-5 py-3.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-black uppercase tracking-wider transition-all disabled:opacity-50 cursor-pointer"
                >
                  Save & Log Another
                </button>
                <button
                  type="submit"
                  disabled={processing}
                  className="px-6 py-3.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-2 transition-all shadow-md shadow-amber-100 disabled:opacity-50 cursor-pointer"
                >
                  {processing ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <SlidersHorizontal className="w-4 h-4" />
                      Confirm Adjustment
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
