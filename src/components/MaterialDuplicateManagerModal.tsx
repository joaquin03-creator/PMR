import { useState, useEffect, useMemo } from 'react';
import { db } from '../firebase';
import {
  collection,
  getDocs,
  doc,
  writeBatch,
  increment,
  updateDoc,
  deleteDoc,
  getDoc,
  setDoc,
  DocumentReference
} from 'firebase/firestore';
import { Material, BuyTicket, BuyTicketMaterial, ConversionLog, UserProfile } from '../types';
import {
  DuplicateGroup,
  MaterialWithStats,
  detectDuplicateMaterials,
  normalizeMaterialName
} from '../utils/materialDuplicates';
import { logAuditEvent } from '../lib/audit';
import { useToast } from '../context/ToastContext';
import {
  Copy,
  Layers,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  RefreshCw,
  Loader2,
  X,
  Trash2,
  Edit3,
  ShieldCheck,
  Scale,
  FileText,
  Merge,
  AlertCircle,
  HelpCircle,
  Tag,
  ArrowRightLeft
} from 'lucide-react';
import { cn } from '../lib/utils';

interface MaterialDuplicateManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  materials: Material[];
  profile: UserProfile | null;
  onMaterialChanged?: () => void;
}

export default function MaterialDuplicateManagerModal({
  isOpen,
  onClose,
  materials,
  profile,
  onMaterialChanged
}: MaterialDuplicateManagerModalProps) {
  const { success, error: toastError, info } = useToast();

  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [activeTab, setActiveTab] = useState<'all' | 'same_code' | 'similar_name'>('all');
  const [searchFilter, setSearchFilter] = useState('');

  // Stats cached from live collections
  const [inventoryMap, setInventoryMap] = useState<Record<string, number>>({});
  const [completedTicketsMap, setCompletedTicketsMap] = useState<Record<string, number>>({});
  const [allTicketsMap, setAllTicketsMap] = useState<Record<string, number>>({});

  // Action states: Merge
  const [mergeGroup, setMergeGroup] = useState<DuplicateGroup | null>(null);
  const [survivorId, setSurvivorId] = useState<string>('');
  const [sourceId, setSourceId] = useState<string>('');
  const [showMergeConfirm, setShowMergeConfirm] = useState(false);
  const [isMerging, setIsMerging] = useState(false);
  const [mergeProgress, setMergeProgress] = useState<{ current: number; total: number; stage: string } | null>(null);

  // Action states: Change Code
  const [editingCodeMaterial, setEditingCodeMaterial] = useState<MaterialWithStats | null>(null);
  const [newCodeInput, setNewCodeInput] = useState('');
  const [sharedCodeConfirmNeeded, setSharedCodeConfirmNeeded] = useState<string | null>(null);
  const [isSavingCode, setIsSavingCode] = useState(false);

  // Action states: Delete
  const [deleteCandidate, setDeleteCandidate] = useState<MaterialWithStats | null>(null);
  const [isDeletingMaterial, setIsDeletingMaterial] = useState(false);

  // Load ticket and inventory data for accurate stats
  const scanData = async () => {
    setScanning(true);
    try {
      // 1. Fetch live inventory
      const invSnap = await getDocs(collection(db, 'inventory'));
      const newInvMap: Record<string, number> = {};
      invSnap.docs.forEach((d) => {
        const data = d.data();
        const weight = Number(data.currentWeight) || 0;
        newInvMap[d.id] = weight;
        if (data.materialId && data.materialId !== d.id) {
          newInvMap[data.materialId] = weight;
        }
      });
      setInventoryMap(newInvMap);

      // 2. Fetch live buyTickets
      const ticketsSnap = await getDocs(collection(db, 'buyTickets'));
      const completedCounts: Record<string, number> = {};
      const allCounts: Record<string, number> = {};

      ticketsSnap.docs.forEach((d) => {
        const ticket = d.data() as BuyTicket;
        const isCompleted = ticket.status === 'completed';
        const referencedMatIds = new Set<string>();

        if (Array.isArray(ticket.materials)) {
          ticket.materials.forEach((m) => {
            if (m.materialId) referencedMatIds.add(m.materialId);
          });
        }

        referencedMatIds.forEach((matId) => {
          allCounts[matId] = (allCounts[matId] || 0) + 1;
          if (isCompleted) {
            completedCounts[matId] = (completedCounts[matId] || 0) + 1;
          }
        });
      });

      setCompletedTicketsMap(completedCounts);
      setAllTicketsMap(allCounts);
    } catch (err) {
      console.error('Error scanning duplicate stats:', err);
      toastError('Scan Error', 'Failed to load transaction data for duplicate analysis');
    } finally {
      setScanning(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      scanData();
    }
  }, [isOpen]);

  // Compute duplicate groups
  const detectionResult = useMemo(() => {
    return detectDuplicateMaterials(materials, inventoryMap, {
      completed: completedTicketsMap,
      all: allTicketsMap
    });
  }, [materials, inventoryMap, completedTicketsMap, allTicketsMap]);

  // Filter groups
  const displayedGroups = useMemo(() => {
    let groups: DuplicateGroup[] = [];
    if (activeTab === 'all') {
      groups = [...detectionResult.sameCodeGroups, ...detectionResult.similarNameGroups];
    } else if (activeTab === 'same_code') {
      groups = detectionResult.sameCodeGroups;
    } else {
      groups = detectionResult.similarNameGroups;
    }

    if (!searchFilter.trim()) return groups;

    const term = searchFilter.toLowerCase();
    return groups.filter((g) => {
      const matchKey = g.displayName.toLowerCase().includes(term);
      const matchMat = g.materials.some(
        (m) =>
          m.name.toLowerCase().includes(term) ||
          m.code.toLowerCase().includes(term) ||
          m.category.toLowerCase().includes(term)
      );
      return matchKey || matchMat;
    });
  }, [detectionResult, activeTab, searchFilter]);

  // Only managers can access
  if (!isOpen) return null;
  if (profile?.role !== 'manager') {
    return (
      <div
        className="fixed inset-0 bg-slate-900/60 z-[110] flex items-center justify-center p-4 backdrop-blur-md"
        role="dialog"
        aria-modal="true"
      >
        <div className="bg-white rounded-3xl p-8 max-w-md w-full text-center space-y-4 shadow-2xl">
          <div className="w-16 h-16 bg-red-50 text-red-600 rounded-full flex items-center justify-center mx-auto">
            <ShieldCheck className="w-8 h-8" />
          </div>
          <h2 className="text-xl font-black text-slate-900">Access Restricted</h2>
          <p className="text-slate-500 text-sm">
            The Material Duplicate Manager is restricted to manager accounts.
          </p>
          <button
            onClick={onClose}
            className="w-full py-3 bg-slate-900 text-white font-bold rounded-xl text-sm"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  // Handle open Merge modal for a group
  const handleInitiateMerge = (group: DuplicateGroup) => {
    setMergeGroup(group);
    if (group.materials.length >= 2) {
      // Pick the material with the most tickets or inventory as default survivor
      const sorted = [...group.materials].sort((a, b) => {
        if (b.completedTicketCount !== a.completedTicketCount) {
          return b.completedTicketCount - a.completedTicketCount;
        }
        return b.inventoryWeight - a.inventoryWeight;
      });
      setSurvivorId(sorted[0].id);
      setSourceId(sorted[1].id);
    } else {
      setSurvivorId('');
      setSourceId('');
    }
    setShowMergeConfirm(false);
  };

  // Perform Merge Action (Atomic chunked batches)
  const handleExecuteMerge = async () => {
    if (!mergeGroup || !survivorId || !sourceId || survivorId === sourceId) return;

    const survivor = mergeGroup.materials.find((m) => m.id === survivorId);
    const source = mergeGroup.materials.find((m) => m.id === sourceId);

    if (!survivor || !source) {
      toastError('Invalid Selection', 'Invalid survivor or source material selected.');
      return;
    }

    setIsMerging(true);
    setMergeProgress({ current: 0, total: 0, stage: 'Scanning buy tickets...' });

    try {
      // Step 1: Scan all buyTickets referencing source.id
      const ticketsSnap = await getDocs(collection(db, 'buyTickets'));
      const ticketsToRemap: { docRef: DocumentReference; updatedMaterials: BuyTicketMaterial[] }[] = [];

      ticketsSnap.docs.forEach((d) => {
        const ticket = d.data() as BuyTicket;
        let containsSource = false;
        const newMaterials = (ticket.materials || []).map((item) => {
          if (item.materialId === source.id) {
            containsSource = true;
            return {
              ...item,
              materialId: survivor.id
            };
          }
          return item;
        });

        if (containsSource) {
          ticketsToRemap.push({
            docRef: d.ref,
            updatedMaterials: newMaterials
          });
        }
      });

      setMergeProgress({
        current: 0,
        total: ticketsToRemap.length,
        stage: `Remapping ${ticketsToRemap.length} buy tickets...`
      });

      // Step 1 Execution: Remap tickets in batches of 450
      const BATCH_CHUNK = 450;
      let remappedCount = 0;

      for (let i = 0; i < ticketsToRemap.length; i += BATCH_CHUNK) {
        const chunk = ticketsToRemap.slice(i, i + BATCH_CHUNK);
        const batch = writeBatch(db);

        chunk.forEach((t) => {
          batch.update(t.docRef, { materials: t.updatedMaterials });
        });

        await batch.commit();
        remappedCount += chunk.length;

        setMergeProgress({
          current: remappedCount,
          total: ticketsToRemap.length,
          stage: `Remapped ${remappedCount} of ${ticketsToRemap.length} tickets...`
        });
      }

      // Step 2: Reassign conversions collection docs
      setMergeProgress((prev) => ({
        current: prev?.current ?? 0,
        total: prev?.total ?? 0,
        stage: 'Remapping conversion logs...'
      }));

      // Check `conversions` collection
      const convSnap = await getDocs(collection(db, 'conversions'));
      const convUpdates: { docRef: DocumentReference; data: Record<string, any> }[] = [];

      convSnap.docs.forEach((d) => {
        const data = d.data() as ConversionLog;
        const updates: Record<string, any> = {};
        if (data.sourceMatId === source.id) {
          updates.sourceMatId = survivor.id;
          updates.sourceName = survivor.name;
        }
        if (data.outputMatId === source.id) {
          updates.outputMatId = survivor.id;
          updates.outputName = survivor.name;
        }
        if (Object.keys(updates).length > 0) {
          convUpdates.push({ docRef: d.ref, data: updates });
        }
      });

      // Check `materialConversions` collection as well
      const matConvSnap = await getDocs(collection(db, 'materialConversions'));
      matConvSnap.docs.forEach((d) => {
        const data = d.data() as any;
        const updates: Record<string, any> = {};
        if (data.sourceMaterialId === source.id) {
          updates.sourceMaterialId = survivor.id;
        }
        if (data.destinationMaterialId === source.id) {
          updates.destinationMaterialId = survivor.id;
        }
        if (Array.isArray(data.destinations)) {
          let hasChange = false;
          const newDests = data.destinations.map((dest: any) => {
            if (dest.destinationMaterialId === source.id) {
              hasChange = true;
              return { ...dest, destinationMaterialId: survivor.id };
            }
            return dest;
          });
          if (hasChange) {
            updates.destinations = newDests;
          }
        }
        if (Object.keys(updates).length > 0) {
          convUpdates.push({ docRef: d.ref, data: updates });
        }
      });

      if (convUpdates.length > 0) {
        for (let i = 0; i < convUpdates.length; i += BATCH_CHUNK) {
          const chunk = convUpdates.slice(i, i + BATCH_CHUNK);
          const batch = writeBatch(db);
          chunk.forEach((c) => batch.update(c.docRef, c.data));
          await batch.commit();
        }
      }

      // Step 3: Transfer inventory & Delete source inventory
      setMergeProgress((prev) => ({
        current: prev?.current ?? 0,
        total: prev?.total ?? 0,
        stage: 'Transferring inventory weight...'
      }));

      const sourceInvSnap = await getDoc(doc(db, 'inventory', source.id));
      const sourceWeight = sourceInvSnap.exists() ? Number(sourceInvSnap.data().currentWeight) || 0 : 0;

      const finalBatch = writeBatch(db);
      const survivorInvRef = doc(db, 'inventory', survivor.id);
      const sourceInvRef = doc(db, 'inventory', source.id);

      if (sourceWeight !== 0) {
        finalBatch.set(
          survivorInvRef,
          {
            materialId: survivor.id,
            currentWeight: increment(sourceWeight),
            lastUpdated: new Date().toISOString()
          },
          { merge: true }
        );
      }
      if (sourceInvSnap.exists()) {
        finalBatch.delete(sourceInvRef);
      }

      // Step 4: Delete source material document
      // (CRITICAL RULE: only delete after all ticket remaps and operations succeeded)
      setMergeProgress((prev) => ({
        current: prev?.current ?? 0,
        total: prev?.total ?? 0,
        stage: 'Deleting source material...'
      }));

      const sourceMatRef = doc(db, 'materials', source.id);
      finalBatch.delete(sourceMatRef);

      await finalBatch.commit();

      // Step 5: Write Audit Event
      const userIdent = profile?.displayName || profile?.email || 'manager';
      await logAuditEvent(
        'material',
        survivor.id,
        'update',
        {
          before: {
            mergedSourceId: source.id,
            sourceCode: source.code,
            sourceName: source.name,
            sourceWeight
          },
          after: {
            survivorId: survivor.id,
            survivorCode: survivor.code,
            survivorName: survivor.name,
            remappedTickets: remappedCount,
            inventoryMoved: sourceWeight
          }
        },
        `Material merged: ${source.code} (${source.name}) → ${survivor.code} (${survivor.name}) by ${userIdent}. ${remappedCount} tickets remapped, ${sourceWeight} lb inventory moved.`
      );

      success(
        'Materials Merged',
        `Successfully merged "${source.code} (${source.name})" into "${survivor.code} (${survivor.name})". ${remappedCount} tickets remapped.`
      );

      // Close merge modal and refresh data
      setMergeGroup(null);
      setShowMergeConfirm(false);
      onMaterialChanged?.();
      await scanData();
    } catch (err: any) {
      console.error('Merge error:', err);
      toastError('Merge Failed', `Merge failed: ${err.message || 'Unknown error'}`);
    } finally {
      setIsMerging(false);
      setMergeProgress(null);
    }
  };

  // Action B: Save Code
  const handleSaveCode = async () => {
    if (!editingCodeMaterial) return;
    const trimmedNewCode = newCodeInput.trim().toUpperCase();

    if (!trimmedNewCode) {
      toastError('Invalid Code', 'Material code cannot be empty.');
      return;
    }

    if (trimmedNewCode === editingCodeMaterial.code.trim().toUpperCase()) {
      setEditingCodeMaterial(null);
      return;
    }

    // Uniqueness validation
    const duplicateMaterial = materials.find(
      (m) => m.id !== editingCodeMaterial.id && m.code.trim().toUpperCase() === trimmedNewCode
    );

    if (duplicateMaterial && !sharedCodeConfirmNeeded) {
      setSharedCodeConfirmNeeded(duplicateMaterial.name);
      return;
    }

    setIsSavingCode(true);
    try {
      const userIdent = profile?.displayName || profile?.email || 'manager';
      const oldCode = editingCodeMaterial.code;

      await updateDoc(doc(db, 'materials', editingCodeMaterial.id), {
        code: trimmedNewCode,
        updatedAt: new Date().toISOString(),
        updatedBy: userIdent
      });

      await logAuditEvent(
        'material',
        editingCodeMaterial.id,
        'update',
        {
          before: { code: oldCode },
          after: { code: trimmedNewCode }
        },
        `Material code changed from ${oldCode} to ${trimmedNewCode} (${editingCodeMaterial.name}) by ${userIdent}`
      );

      success('Code Updated', `Code for "${editingCodeMaterial.name}" updated to "${trimmedNewCode}".`);
      setEditingCodeMaterial(null);
      setSharedCodeConfirmNeeded(null);
      onMaterialChanged?.();
      await scanData();
    } catch (err: any) {
      console.error('Error updating material code:', err);
      toastError('Update Failed', `Failed to update code: ${err.message || 'Unknown error'}`);
    } finally {
      setIsSavingCode(false);
    }
  };

  // Action C: Delete material
  const handleDeleteMaterial = async (mat: MaterialWithStats) => {
    // Safety check: ZERO completed buyTickets AND ZERO inventory
    const hasTickets = mat.completedTicketCount > 0 || mat.allTicketCount > 0;
    const hasInventory = mat.inventoryWeight > 0;

    if (hasTickets || hasInventory) {
      setDeleteCandidate(mat); // Will trigger the blocked warning dialog
      return;
    }

    setDeleteCandidate(mat); // Allowed, will show confirmation dialog
  };

  const handleConfirmDelete = async () => {
    if (!deleteCandidate) return;

    setIsDeletingMaterial(true);
    try {
      const userIdent = profile?.displayName || profile?.email || 'manager';

      // Delete material doc
      await deleteDoc(doc(db, 'materials', deleteCandidate.id));

      // Also clean up empty inventory doc if exists
      try {
        await deleteDoc(doc(db, 'inventory', deleteCandidate.id));
      } catch {
        // Ignored if not present
      }

      await logAuditEvent(
        'material',
        deleteCandidate.id,
        'delete',
        {
          before: {
            id: deleteCandidate.id,
            code: deleteCandidate.code,
            name: deleteCandidate.name,
            category: deleteCandidate.category
          },
          after: null
        },
        `Deleted unused material: ${deleteCandidate.code} (${deleteCandidate.name}) by ${userIdent}`
      );

      success('Material Deleted', `Unused material "${deleteCandidate.code} - ${deleteCandidate.name}" deleted.`);
      setDeleteCandidate(null);
      onMaterialChanged?.();
      await scanData();
    } catch (err: any) {
      console.error('Error deleting material:', err);
      toastError('Deletion Failed', `Failed to delete material: ${err.message || 'Unknown error'}`);
    } finally {
      setIsDeletingMaterial(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-slate-900/60 z-[100] flex items-center justify-center p-4 backdrop-blur-md overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="duplicate-manager-title"
    >
      <div className="bg-white rounded-[2.5rem] w-full max-w-6xl h-[92vh] flex flex-col p-6 sm:p-8 shadow-2xl animate-in zoom-in-95 duration-200 relative overflow-hidden border border-slate-200">
        {/* Top Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 border-b border-slate-100 gap-4 shrink-0">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-amber-500/10 text-amber-600 rounded-2xl">
                <Copy className="w-6 h-6" />
              </div>
              <div>
                <h2 id="duplicate-manager-title" className="text-2xl font-black text-slate-900 tracking-tight font-display">
                  Material Duplicate Manager
                </h2>
                <p className="text-slate-500 font-medium text-xs sm:text-sm">
                  Detect overlapping material codes and similar names. Safely merge, re-code, or clean up unused materials.
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 self-end sm:self-auto">
            <button
              onClick={scanData}
              disabled={scanning}
              className="px-4 py-2.5 bg-slate-100 text-slate-700 hover:bg-slate-200 rounded-xl font-bold text-xs flex items-center gap-2 transition-all active:scale-95 disabled:opacity-50"
              title="Rescan database"
            >
              <RefreshCw className={cn('w-4 h-4', scanning && 'animate-spin')} />
              {scanning ? 'Scanning...' : 'Rescan'}
            </button>
            <button
              onClick={onClose}
              className="p-2.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-all"
              aria-label="Close dialog"
            >
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>

        {/* Stats & Filter Bar */}
        <div className="py-4 flex flex-col md:flex-row md:items-center justify-between gap-4 shrink-0 border-b border-slate-100">
          {/* Tabs */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0">
            <button
              onClick={() => setActiveTab('all')}
              className={cn(
                'px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all whitespace-nowrap',
                activeTab === 'all'
                  ? 'bg-slate-900 text-white shadow-md'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              )}
            >
              All Groups ({detectionResult.totalDuplicates})
            </button>
            <button
              onClick={() => setActiveTab('same_code')}
              className={cn(
                'px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all whitespace-nowrap flex items-center gap-1.5',
                activeTab === 'same_code'
                  ? 'bg-amber-500 text-slate-950 shadow-md'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              )}
            >
              <Tag className="w-3.5 h-3.5" />
              Same Code ({detectionResult.sameCodeGroups.length})
            </button>
            <button
              onClick={() => setActiveTab('similar_name')}
              className={cn(
                'px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all whitespace-nowrap flex items-center gap-1.5',
                activeTab === 'similar_name'
                  ? 'bg-blue-600 text-white shadow-md'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              )}
            >
              <Copy className="w-3.5 h-3.5" />
              Similar Name ({detectionResult.similarNameGroups.length})
            </button>
          </div>

          {/* Search Box */}
          <div className="relative w-full md:w-72">
            <input
              type="text"
              placeholder="Filter duplicates..."
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              className="w-full pl-3 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {searchFilter && (
              <button
                onClick={() => setSearchFilter('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Informational Guidance Banner */}
        <div className="mt-3 mb-2 p-3.5 bg-amber-50 border border-amber-200 rounded-2xl flex items-start gap-3 shrink-0">
          <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-xs text-amber-900 leading-relaxed font-medium">
            <strong className="font-bold">Historical Integrity Safeguard:</strong> Historical tickets, inventory records, and conversions reference materials by internal database ID. Merging remaps all past tickets to the survivor before deleting the duplicate. Unused materials can only be deleted if they have 0 ticket references and 0 lb inventory.
          </div>
        </div>

        {/* Content List */}
        <div className="flex-1 overflow-y-auto space-y-5 pr-1 py-2">
          {scanning ? (
            <div className="flex flex-col items-center justify-center h-64 space-y-3">
              <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
              <p className="text-slate-500 text-sm font-bold">Scanning materials and ticket history...</p>
            </div>
          ) : displayedGroups.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-center p-8 bg-slate-50 rounded-3xl border border-dashed border-slate-200">
              <div className="p-4 bg-emerald-50 text-emerald-600 rounded-full mb-3">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h3 className="text-lg font-black text-slate-900">No Duplicate Materials Found</h3>
              <p className="text-slate-500 text-xs sm:text-sm max-w-md mt-1">
                {searchFilter
                  ? 'No duplicate groups match your search query.'
                  : 'Your material registry is clean! No overlapping codes or confusing duplicate names were detected.'}
              </p>
            </div>
          ) : (
            displayedGroups.map((group) => (
              <div
                key={group.id}
                className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden transition-all hover:border-slate-300"
              >
                {/* Group Header */}
                <div className="p-4 bg-slate-50/80 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span
                      className={cn(
                        'px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider',
                        group.type === 'same_code'
                          ? 'bg-amber-100 text-amber-800 border border-amber-200'
                          : 'bg-blue-100 text-blue-800 border border-blue-200'
                      )}
                    >
                      {group.type === 'same_code' ? 'Duplicate Code' : 'Similar Names'}
                    </span>
                    <h3 className="text-sm sm:text-base font-black text-slate-900">
                      {group.displayName}
                    </h3>
                  </div>

                  <button
                    onClick={() => handleInitiateMerge(group)}
                    className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-2 shadow-sm active:scale-95 transition-all self-start sm:self-auto"
                  >
                    <Merge className="w-3.5 h-3.5 text-amber-400" />
                    Merge Materials
                  </button>
                </div>

                {/* Table of materials in this duplicate group */}
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-slate-100/50 text-slate-500 font-bold uppercase tracking-wider text-[10px] border-b border-slate-200">
                      <tr>
                        <th className="p-3">Code</th>
                        <th className="p-3">Material Name</th>
                        <th className="p-3">Category</th>
                        <th className="p-3 text-right">Inventory (Stock)</th>
                        <th className="p-3 text-right">Completed Tickets</th>
                        <th className="p-3 text-center">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-medium">
                      {group.materials.map((mat) => {
                        const isBlockedFromDelete = mat.completedTicketCount > 0 || mat.inventoryWeight > 0;

                        return (
                          <tr key={mat.id} className="hover:bg-slate-50/60 transition-colors">
                            <td className="p-3">
                              <span className="inline-block px-2.5 py-1 bg-slate-900 text-white font-mono font-black text-xs rounded-lg shadow-sm">
                                {mat.code}
                              </span>
                            </td>
                            <td className="p-3">
                              <div className="font-bold text-slate-900 text-sm">{mat.name}</div>
                              <div className="text-[10px] text-slate-400 font-mono">ID: {mat.id}</div>
                            </td>
                            <td className="p-3">
                              <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded-md text-[11px] font-semibold">
                                {mat.category}
                              </span>
                            </td>
                            <td className="p-3 text-right">
                              <span
                                className={cn(
                                  'font-black font-mono text-xs',
                                  mat.inventoryWeight > 0 ? 'text-blue-600' : 'text-slate-400'
                                )}
                              >
                                {mat.inventoryWeight.toLocaleString()} lbs
                              </span>
                            </td>
                            <td className="p-3 text-right">
                              <span
                                className={cn(
                                  'font-black font-mono text-xs',
                                  mat.completedTicketCount > 0 ? 'text-amber-600' : 'text-slate-400'
                                )}
                              >
                                {mat.completedTicketCount} tickets
                              </span>
                              {mat.allTicketCount > mat.completedTicketCount && (
                                <span className="text-[10px] text-slate-400 block">
                                  ({mat.allTicketCount} total)
                                </span>
                              )}
                            </td>
                            <td className="p-3 text-center">
                              <div className="flex items-center justify-center gap-1.5">
                                <button
                                  onClick={() => {
                                    setEditingCodeMaterial(mat);
                                    setNewCodeInput(mat.code);
                                    setSharedCodeConfirmNeeded(null);
                                  }}
                                  className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-[11px] rounded-lg transition-all flex items-center gap-1"
                                  title="Change material code"
                                >
                                  <Edit3 className="w-3 h-3 text-slate-500" />
                                  Change Code
                                </button>
                                <button
                                  onClick={() => handleDeleteMaterial(mat)}
                                  className={cn(
                                    'px-2.5 py-1.5 rounded-lg font-bold text-[11px] transition-all flex items-center gap-1',
                                    isBlockedFromDelete
                                      ? 'bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200'
                                      : 'bg-red-50 text-red-700 hover:bg-red-100 border border-red-200'
                                  )}
                                  title={isBlockedFromDelete ? 'Cannot delete - tickets or inventory exist' : 'Delete unused material'}
                                >
                                  <Trash2 className="w-3 h-3" />
                                  Delete
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ========================================================= */}
      {/* ACTION A: MERGE MODAL & CONFIRMATION */}
      {/* ========================================================= */}
      {mergeGroup && (
        <div
          className="fixed inset-0 bg-slate-900/70 z-[120] flex items-center justify-center p-4 backdrop-blur-md overflow-y-auto"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white rounded-[2.5rem] w-full max-w-2xl p-6 sm:p-8 shadow-2xl space-y-6 animate-in zoom-in-95 duration-200 border border-slate-200 relative">
            <button
              onClick={() => {
                if (!isMerging) {
                  setMergeGroup(null);
                  setShowMergeConfirm(false);
                }
              }}
              disabled={isMerging}
              className="absolute top-6 right-6 p-2 text-slate-400 hover:text-slate-600 rounded-xl transition-all"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3">
              <div className="p-3 bg-amber-500/10 text-amber-600 rounded-2xl">
                <Merge className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-xl font-black text-slate-900 tracking-tight font-display">
                  Merge Duplicate Materials
                </h3>
                <p className="text-slate-500 text-xs font-medium">
                  Select which material to keep (Survivor) and which to merge away (Source).
                </p>
              </div>
            </div>

            {/* Selection Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Survivor Selection */}
              <div className="p-4 bg-emerald-50/50 border-2 border-emerald-500/30 rounded-2xl space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-black text-emerald-800 uppercase tracking-wider flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    Keep (Survivor)
                  </span>
                  <span className="text-[10px] text-emerald-600 font-bold bg-emerald-100 px-2 py-0.5 rounded-full">
                    Will Remain Active
                  </span>
                </div>

                <select
                  value={survivorId}
                  onChange={(e) => {
                    const val = e.target.value;
                    setSurvivorId(val);
                    if (sourceId === val) {
                      const other = mergeGroup.materials.find((m) => m.id !== val);
                      if (other) setSourceId(other.id);
                    }
                  }}
                  disabled={isMerging}
                  className="w-full p-3 bg-white border border-emerald-300 rounded-xl font-bold text-slate-900 text-xs focus:ring-2 focus:ring-emerald-500 outline-none"
                >
                  {mergeGroup.materials.map((m) => (
                    <option key={m.id} value={m.id}>
                      [{m.code}] {m.name} ({m.completedTicketCount} tickets, {m.inventoryWeight} lbs)
                    </option>
                  ))}
                </select>

                {(() => {
                  const survMat = mergeGroup.materials.find((m) => m.id === survivorId);
                  if (!survMat) return null;
                  return (
                    <div className="text-[11px] text-slate-600 space-y-1 pt-1">
                      <div>
                        <strong>Current Stock:</strong> {survMat.inventoryWeight.toLocaleString()} lbs
                      </div>
                      <div>
                        <strong>Completed Tickets:</strong> {survMat.completedTicketCount}
                      </div>
                      <div className="font-mono text-[10px] text-slate-400">ID: {survMat.id}</div>
                    </div>
                  );
                })()}
              </div>

              {/* Source Selection */}
              <div className="p-4 bg-red-50/50 border-2 border-red-500/30 rounded-2xl space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-black text-red-800 uppercase tracking-wider flex items-center gap-1.5">
                    <ArrowRightLeft className="w-4 h-4 text-red-600" />
                    Merge Away (Source)
                  </span>
                  <span className="text-[10px] text-red-600 font-bold bg-red-100 px-2 py-0.5 rounded-full">
                    Will Be Deleted
                  </span>
                </div>

                <select
                  value={sourceId}
                  onChange={(e) => {
                    const val = e.target.value;
                    setSourceId(val);
                    if (survivorId === val) {
                      const other = mergeGroup.materials.find((m) => m.id !== val);
                      if (other) setSurvivorId(other.id);
                    }
                  }}
                  disabled={isMerging}
                  className="w-full p-3 bg-white border border-red-300 rounded-xl font-bold text-slate-900 text-xs focus:ring-2 focus:ring-red-500 outline-none"
                >
                  {mergeGroup.materials
                    .filter((m) => m.id !== survivorId)
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        [{m.code}] {m.name} ({m.completedTicketCount} tickets, {m.inventoryWeight} lbs)
                      </option>
                    ))}
                </select>

                {(() => {
                  const srcMat = mergeGroup.materials.find((m) => m.id === sourceId);
                  if (!srcMat) return null;
                  return (
                    <div className="text-[11px] text-slate-600 space-y-1 pt-1">
                      <div>
                        <strong>Weight to Move:</strong> +{srcMat.inventoryWeight.toLocaleString()} lbs
                      </div>
                      <div>
                        <strong>Tickets to Remap:</strong> {srcMat.completedTicketCount} completed ({srcMat.allTicketCount} total)
                      </div>
                      <div className="font-mono text-[10px] text-slate-400">ID: {srcMat.id}</div>
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* Merge Summary Checklist */}
            {(() => {
              const survivor = mergeGroup.materials.find((m) => m.id === survivorId);
              const source = mergeGroup.materials.find((m) => m.id === sourceId);
              if (!survivor || !source) return null;

              return (
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-2.5 text-xs text-slate-700">
                  <h4 className="font-black text-slate-900 uppercase tracking-wider text-[11px]">
                    What will happen upon confirmation:
                  </h4>
                  <ul className="space-y-1.5 list-disc list-inside font-medium text-slate-600">
                    <li>
                      <strong>Buy Tickets Remapped:</strong> All buy tickets referencing <code>{source.name}</code> ({source.allTicketCount} total tickets) will have their line items re-pointed to <code>{survivor.name}</code>. Weights, prices, deductions, and totals remain completely unchanged.
                    </li>
                    <li>
                      <strong>Inventory Moved:</strong> {source.inventoryWeight.toLocaleString()} lbs from <code>{source.name}</code> will be added into <code>{survivor.name}</code> stock, and the source inventory record will be removed.
                    </li>
                    <li>
                      <strong>Conversions Updated:</strong> Any conversion logs referencing <code>{source.name}</code> will be updated to point to <code>{survivor.name}</code>.
                    </li>
                    <li>
                      <strong>Source Deleted:</strong> Material document <code>{source.name}</code> will be permanently removed. (Never deleted until all ticket remappings succeed).
                    </li>
                    <li>
                      <strong>Audit Log:</strong> An official system audit log will be created recording the merge.
                    </li>
                  </ul>
                </div>
              );
            })()}

            {/* Progress Indicator */}
            {mergeProgress && (
              <div className="p-4 bg-blue-50 border border-blue-200 rounded-2xl space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-blue-900">
                  <span className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
                    {mergeProgress.stage}
                  </span>
                  {mergeProgress.total > 0 && (
                    <span>
                      {Math.round((mergeProgress.current / mergeProgress.total) * 100)}%
                    </span>
                  )}
                </div>
                {mergeProgress.total > 0 && (
                  <div className="w-full bg-blue-200 h-2 rounded-full overflow-hidden">
                    <div
                      className="bg-blue-600 h-full transition-all duration-300"
                      style={{
                        width: `${Math.min(100, Math.round((mergeProgress.current / mergeProgress.total) * 100))}%`
                      }}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Buttons */}
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  setMergeGroup(null);
                  setShowMergeConfirm(false);
                }}
                disabled={isMerging}
                className="px-5 py-3 border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-xl font-black text-xs uppercase tracking-wider transition-all disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleExecuteMerge}
                disabled={isMerging || !survivorId || !sourceId || survivorId === sourceId}
                className="px-6 py-3 bg-amber-500 hover:bg-amber-600 text-slate-950 rounded-xl font-black text-xs uppercase tracking-wider transition-all flex items-center gap-2 shadow-lg shadow-amber-500/20 active:scale-95 disabled:opacity-50"
              >
                {isMerging ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Merging Materials...
                  </>
                ) : (
                  <>
                    <Merge className="w-4 h-4" />
                    Confirm & Execute Merge
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* ACTION B: CHANGE CODE MODAL */}
      {/* ========================================================= */}
      {editingCodeMaterial && (
        <div
          className="fixed inset-0 bg-slate-900/70 z-[120] flex items-center justify-center p-4 backdrop-blur-md"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white rounded-[2rem] w-full max-w-md p-6 shadow-2xl space-y-5 animate-in zoom-in-95 duration-200 border border-slate-200">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-black text-slate-900 tracking-tight font-display flex items-center gap-2">
                <Edit3 className="w-5 h-5 text-blue-600" />
                Change Material Code
              </h3>
              <button
                onClick={() => {
                  setEditingCodeMaterial(null);
                  setSharedCodeConfirmNeeded(null);
                }}
                disabled={isSavingCode}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="text-xs text-slate-600 space-y-1">
              <div>
                <strong>Material:</strong> {editingCodeMaterial.name}
              </div>
              <div>
                <strong>Current Code:</strong>{' '}
                <span className="font-mono font-bold bg-slate-100 px-1.5 py-0.5 rounded">
                  {editingCodeMaterial.code}
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="change-mat-code" className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">
                New Material Code
              </label>
              <input
                id="change-mat-code"
                type="text"
                value={newCodeInput}
                onChange={(e) => {
                  setNewCodeInput(e.target.value.toUpperCase());
                  setSharedCodeConfirmNeeded(null);
                }}
                disabled={isSavingCode}
                placeholder="e.g. CU-1"
                className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-mono font-bold text-slate-900 uppercase focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Warning if code is already used */}
            {sharedCodeConfirmNeeded && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 space-y-2">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <p>
                    Code <strong>"{newCodeInput}"</strong> is already in use by{' '}
                    <strong>"{sharedCodeConfirmNeeded}"</strong>.
                  </p>
                </div>
                <p className="text-[11px] text-amber-800">
                  Do you explicitly confirm you want these materials to share the same code?
                </p>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setEditingCodeMaterial(null);
                  setSharedCodeConfirmNeeded(null);
                }}
                disabled={isSavingCode}
                className="px-4 py-2.5 border border-slate-200 text-slate-600 hover:bg-slate-50 rounded-xl font-black text-xs uppercase tracking-wider"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveCode}
                disabled={isSavingCode || !newCodeInput.trim()}
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-black text-xs uppercase tracking-wider flex items-center gap-2 shadow-md shadow-blue-500/20 disabled:opacity-50"
              >
                {isSavingCode ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Saving...
                  </>
                ) : sharedCodeConfirmNeeded ? (
                  'Yes, Allow Shared Code'
                ) : (
                  'Save New Code'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* ACTION C: DELETE MODAL (BLOCKED OR CONFIRM) */}
      {/* ========================================================= */}
      {deleteCandidate && (
        <div
          className="fixed inset-0 bg-slate-900/70 z-[120] flex items-center justify-center p-4 backdrop-blur-md"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white rounded-[2.5rem] w-full max-w-md p-6 sm:p-8 shadow-2xl space-y-5 animate-in zoom-in-95 duration-200 border border-slate-200 text-center">
            {deleteCandidate.completedTicketCount > 0 || deleteCandidate.inventoryWeight > 0 ? (
              // BLOCKED DELETE CASE
              <div className="space-y-4">
                <div className="w-16 h-16 bg-amber-50 text-amber-600 rounded-full flex items-center justify-center mx-auto border border-amber-200">
                  <AlertTriangle className="w-8 h-8" />
                </div>

                <div className="space-y-1">
                  <h3 className="text-xl font-black text-slate-900 tracking-tight font-display">
                    Deletion Blocked
                  </h3>
                  <p className="text-amber-800 bg-amber-50 p-3 rounded-xl border border-amber-200 font-semibold text-xs leading-relaxed">
                    This material has {deleteCandidate.completedTicketCount} tickets and{' '}
                    {deleteCandidate.inventoryWeight.toLocaleString()} lb inventory — merge it into another material instead of deleting, to preserve records.
                  </p>
                </div>

                <p className="text-slate-500 text-xs font-medium">
                  Deleting materials with historical transactions orphans financial audit records. Use the <strong>Merge</strong> feature to safely reassign historical tickets to another material.
                </p>

                <div className="flex flex-col gap-2 pt-2">
                  {/* Find group that contains this material */}
                  {(() => {
                    const parentGroup = displayedGroups.find((g) =>
                      g.materials.some((m) => m.id === deleteCandidate.id)
                    );
                    return (
                      <button
                        type="button"
                        onClick={() => {
                          const candidate = deleteCandidate;
                          setDeleteCandidate(null);
                          if (parentGroup) {
                            handleInitiateMerge(parentGroup);
                            setSourceId(candidate.id);
                          }
                        }}
                        className="w-full py-3 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black rounded-xl text-xs uppercase tracking-wider shadow-md shadow-amber-500/20"
                      >
                        Merge this Material Instead
                      </button>
                    );
                  })()}
                  <button
                    type="button"
                    onClick={() => setDeleteCandidate(null)}
                    className="w-full py-3 border border-slate-200 text-slate-600 hover:bg-slate-50 font-bold rounded-xl text-xs uppercase tracking-wider"
                  >
                    Close
                  </button>
                </div>
              </div>
            ) : (
              // ALLOWED UNUSED DELETE CASE
              <div className="space-y-4">
                <div className="w-16 h-16 bg-red-50 text-red-600 rounded-full flex items-center justify-center mx-auto border border-red-200">
                  <Trash2 className="w-8 h-8" />
                </div>

                <div className="space-y-1">
                  <h3 className="text-xl font-black text-slate-900 tracking-tight font-display">
                    Delete Unused Material?
                  </h3>
                  <p className="text-slate-500 text-xs font-medium">
                    This material has <strong className="text-slate-900 font-bold">0 tickets</strong> and{' '}
                    <strong className="text-slate-900 font-bold">0 lbs inventory</strong>. It can be safely deleted without impacting historical records.
                  </p>
                </div>

                <div className="p-3 bg-slate-50 rounded-xl text-xs text-slate-700 font-medium">
                  <span className="font-bold text-slate-900">
                    [{deleteCandidate.code}] {deleteCandidate.name}
                  </span>
                </div>

                <div className="flex items-center gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setDeleteCandidate(null)}
                    disabled={isDeletingMaterial}
                    className="flex-1 py-3 border border-slate-200 text-slate-600 hover:bg-slate-50 font-bold rounded-xl text-xs uppercase tracking-wider"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmDelete}
                    disabled={isDeletingMaterial}
                    className="flex-1 py-3 bg-red-600 hover:bg-red-700 text-white font-black rounded-xl text-xs uppercase tracking-wider shadow-md shadow-red-500/20 flex items-center justify-center gap-1.5"
                  >
                    {isDeletingMaterial ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Deleting...
                      </>
                    ) : (
                      'Yes, Delete'
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
