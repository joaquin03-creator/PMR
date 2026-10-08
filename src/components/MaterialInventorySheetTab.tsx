import { useEffect, useMemo, useRef, useState } from 'react';
import { collection, onSnapshot, query, orderBy, addDoc, updateDoc, doc } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { Material, MaterialInventorySheet, MaterialInventorySheetRow, UserProfile } from '../types';
import { MaterialAutocompleteInput } from './MaterialAutocompleteInput';
import { logAuditEvent } from '../lib/audit';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';
import { cn } from '../lib/utils';
import {
  computeNetTotalsByMaterial,
  computeSheetNetTotal,
  computeIntakeVelocityLbsPerWeek,
  projectDateToTarget,
  computeFulfillmentCountdown,
  FULL_LOAD_TARGET_LBS,
  BUYER_LOCK_THRESHOLD_LBS,
} from '../lib/loadReadiness';
import { Plus, Trash2, Save, FilePlus2, Lock, Scale, TrendingUp, Calendar, CloudCheck, CloudUpload } from 'lucide-react';
import { useLocalDraftBackup, readDraft, clearDraft } from '../hooks/useLocalDraftBackup';

interface MaterialInventorySheetTabProps {
  materials: Material[];
  profile: UserProfile | null;
}

const todayStr = () => new Date().toLocaleDateString('en-CA');

const AUTOSAVE_DEBOUNCE_MS = 2500;

function draftKey(sheetId: string) {
  return `pm_draft_invsheet_${sheetId}`;
}

function emptyRow(date: string): MaterialInventorySheetRow {
  return {
    id: `row-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    boxNumber: '',
    materialId: '',
    gross: 0,
    tare: 0,
    net: 0,
    date,
    remarks: ''
  };
}

export default function MaterialInventorySheetTab({ materials, profile }: MaterialInventorySheetTabProps) {
  const [sheets, setSheets] = useState<MaterialInventorySheet[]>([]);
  const [loading, setLoading] = useState(true);
  const [draftRows, setDraftRows] = useState<MaterialInventorySheetRow[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [autosaveStatus, setAutosaveStatus] = useState<'idle' | 'pending' | 'saving' | 'saved' | 'error'>('idle');
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [dropdownOpenRowId, setDropdownOpenRowId] = useState<string | null>(null);
  const [materialSearchByRow, setMaterialSearchByRow] = useState<Record<string, string>>({});
  const isWritingRef = useRef(false);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'materialInventorySheets'), orderBy('date', 'asc')),
      (snapshot) => {
        const rows = snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as MaterialInventorySheet[];
        setSheets(rows);
        setLoading(false);
      },
      (error) => { handleFirestoreError(error, OperationType.LIST, 'materialInventorySheets'); setLoading(false); }
    );
    return () => unsub();
  }, []);

  const currentSheet = sheets.length > 0 ? sheets[sheets.length - 1] : null;

  // On loading a sheet, prefer a newer local backup over the server copy --
  // it means this device has edits that never made it to Firestore (e.g. the
  // tab was killed before the debounced autosave below could fire).
  useEffect(() => {
    if (!currentSheet) {
      setDraftRows([]);
      setDirty(false);
      return;
    }
    const localDraft = readDraft<MaterialInventorySheetRow[]>(draftKey(currentSheet.id));
    const serverUpdatedAt = currentSheet.updatedAt || currentSheet.createdAt;
    if (localDraft && (!serverUpdatedAt || localDraft.savedAt > serverUpdatedAt)) {
      setDraftRows(localDraft.value.map(r => ({ ...r })));
      setDirty(true);
      setAutosaveStatus('pending');
      setNotification({ type: 'success', message: 'Restored unsaved changes from your last session on this device.' });
    } else {
      setDraftRows(currentSheet.rows.map(r => ({ ...r })));
      setDirty(false);
      setAutosaveStatus('idle');
      clearDraft(draftKey(currentSheet.id));
    }
  }, [currentSheet?.id]);

  useEffect(() => {
    if (notification) {
      const t = setTimeout(() => setNotification(null), 4000);
      return () => clearTimeout(t);
    }
  }, [notification]);

  // Instant local backup -- survives a crashed/killed tab even if the
  // debounced Firestore autosave below hasn't had time to fire yet. Also
  // warns on an accidental tab close/refresh while changes haven't synced.
  useLocalDraftBackup(currentSheet ? draftKey(currentSheet.id) : 'pm_draft_invsheet_none', draftRows, dirty);

  // Debounced autosave to Firestore -- fires a couple seconds after the last
  // edit so normal saving no longer depends on remembering to click Save.
  useEffect(() => {
    if (!currentSheet || !dirty) return;
    setAutosaveStatus('pending');
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      persistRows(currentSheet, draftRows, { silent: true });
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => { if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftRows, dirty, currentSheet?.id]);

  const isManager = profile?.role === 'manager';

  const draftNetTotal = useMemo(() => draftRows.reduce((sum, r) => sum + (r.net || 0), 0), [draftRows]);

  const readinessLines = useMemo(() => computeNetTotalsByMaterial(
    currentSheet ? { ...currentSheet, rows: draftRows } : null
  ), [currentSheet, draftRows]);

  const velocity = useMemo(() => computeIntakeVelocityLbsPerWeek(sheets), [sheets]);
  const percentToFull = FULL_LOAD_TARGET_LBS > 0 ? Math.min(100, (draftNetTotal / FULL_LOAD_TARGET_LBS) * 100) : 0;
  const projectionTo75 = useMemo(() => projectDateToTarget(draftNetTotal, BUYER_LOCK_THRESHOLD_LBS, velocity), [draftNetTotal, velocity]);
  const fulfillmentCountdown = useMemo(() => computeFulfillmentCountdown(currentSheet?.orderLockedAt), [currentSheet?.orderLockedAt]);
  const canLockOrder = draftNetTotal >= BUYER_LOCK_THRESHOLD_LBS && !currentSheet?.orderLockedAt;

  const updateRow = (id: string, patch: Partial<MaterialInventorySheetRow>) => {
    setDraftRows(prev => prev.map(r => {
      if (r.id !== id) return r;
      const next = { ...r, ...patch };
      next.net = (Number(next.gross) || 0) - (Number(next.tare) || 0);
      return next;
    }));
    setDirty(true);
  };

  const addRow = () => {
    setDraftRows(prev => [...prev, emptyRow(todayStr())]);
    setDirty(true);
  };

  const removeRow = (id: string) => {
    setDraftRows(prev => prev.filter(r => r.id !== id));
    setDirty(true);
  };

  const persistRows = async (
    sheet: MaterialInventorySheet,
    rows: MaterialInventorySheetRow[],
    opts: { silent?: boolean } = {}
  ) => {
    if (isWritingRef.current) return;
    isWritingRef.current = true;
    if (opts.silent) setAutosaveStatus('saving'); else setSaving(true);
    try {
      const netTotal = rows.reduce((sum, r) => sum + (r.net || 0), 0);
      await updateDoc(doc(db, 'materialInventorySheets', sheet.id), {
        rows,
        netTotal,
        updatedAt: new Date().toISOString(),
        updatedBy: profile?.displayName || profile?.email || 'Staff'
      });
      await logAuditEvent(
        'inventory',
        sheet.id,
        'update',
        { after: { netTotal, rowCount: rows.length } },
        `Material Inventory Sheet (${sheet.date}) updated -- ${rows.length} boxes, ${netTotal.toLocaleString()} lbs net total${opts.silent ? ' (autosave)' : ''}`
      );
      clearDraft(draftKey(sheet.id));
      setDirty(false);
      if (opts.silent) {
        setAutosaveStatus('saved');
      } else {
        setNotification({ type: 'success', message: 'Sheet saved.' });
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'materialInventorySheets');
      if (opts.silent) {
        setAutosaveStatus('error');
      } else {
        setNotification({ type: 'error', message: 'Failed to save sheet.' });
      }
    } finally {
      isWritingRef.current = false;
      if (opts.silent) {
        // local backup stays intact on failure so nothing is lost
      } else {
        setSaving(false);
      }
    }
  };

  const handleSave = async () => {
    if (!currentSheet) return;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    await persistRows(currentSheet, draftRows);
  };

  const handleStartNewSheet = async () => {
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    setSaving(true);
    try {
      const date = todayStr();
      const carriedRows = draftRows.map(r => ({ ...r, id: `row-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }));
      const netTotal = carriedRows.reduce((sum, r) => sum + (r.net || 0), 0);
      const newSheet: Omit<MaterialInventorySheet, 'id'> = {
        date,
        rows: carriedRows,
        netTotal,
        createdAt: new Date().toISOString(),
        createdBy: profile?.displayName || profile?.email || 'Staff'
      };
      const docRef = await addDoc(collection(db, 'materialInventorySheets'), newSheet);
      await logAuditEvent(
        'inventory',
        docRef.id,
        'create',
        { after: newSheet },
        `Started new Material Inventory Sheet for ${date}, carried forward ${carriedRows.length} boxes`
      );
      if (currentSheet) clearDraft(draftKey(currentSheet.id));
      setNotification({ type: 'success', message: 'New sheet started -- previous sheet kept in history.' });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'materialInventorySheets');
      setNotification({ type: 'error', message: 'Failed to start new sheet.' });
    } finally {
      setSaving(false);
    }
  };

  const handleLockOrder = async () => {
    if (!currentSheet || !isManager) return;
    setSaving(true);
    try {
      const lockedAt = new Date().toISOString();
      await updateDoc(doc(db, 'materialInventorySheets', currentSheet.id), { orderLockedAt: lockedAt });
      await logAuditEvent(
        'inventory',
        currentSheet.id,
        'update',
        { after: { orderLockedAt: lockedAt } },
        `Order locked with buyer at ${draftNetTotal.toLocaleString()} lbs -- 30-day fulfillment window started`
      );
      setNotification({ type: 'success', message: 'Order locked. 30-day fulfillment window started.' });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'materialInventorySheets');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="py-16 text-center text-slate-400 text-sm font-bold uppercase tracking-wider">Loading sheet&hellip;</div>;
  }

  return (
    <section className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-300">
      {notification && (
        <div className={cn(
          'p-4 rounded-2xl border text-sm font-bold',
          notification.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-800'
        )}>
          {notification.message}
        </div>
      )}

      {/* Load readiness stat cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white border border-slate-200 rounded-[2rem] p-6 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-1">Net Boxed</span>
            <span className="text-3xl font-black font-mono text-slate-900">{draftNetTotal.toLocaleString()}</span>
            <span className="text-xs font-bold text-slate-400 block">of {FULL_LOAD_TARGET_LBS.toLocaleString()} lbs ({percentToFull.toFixed(0)}%)</span>
          </div>
          <div className="p-3 bg-blue-50 text-blue-600 rounded-2xl"><Scale className="w-6 h-6" /></div>
        </div>

        <div className="bg-white border border-slate-200 rounded-[2rem] p-6 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-1">Intake Velocity</span>
            <span className="text-3xl font-black font-mono text-slate-900">
              {velocity === null ? '--' : `${Math.round(velocity).toLocaleString()}`}
            </span>
            <span className="text-xs font-bold text-slate-400 block">{velocity === null ? 'need 2+ sheets' : 'lbs / week'}</span>
          </div>
          <div className="p-3 bg-indigo-50 text-indigo-600 rounded-2xl"><TrendingUp className="w-6 h-6" /></div>
        </div>

        <div className="bg-white border border-slate-200 rounded-[2rem] p-6 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-1">75% Buyer-Lock ETA</span>
            <span className="text-lg font-black font-mono text-slate-900">
              {projectionTo75.reached ? 'Reached' : projectionTo75.projectedDate || 'No trend yet'}
            </span>
            <span className="text-xs font-bold text-slate-400 block">target {BUYER_LOCK_THRESHOLD_LBS.toLocaleString()} lbs</span>
          </div>
          <div className="p-3 bg-amber-50 text-amber-600 rounded-2xl"><Calendar className="w-6 h-6" /></div>
        </div>

        <div className="bg-white border border-slate-200 rounded-[2rem] p-6 shadow-xs flex items-center justify-between">
          <div>
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 block mb-1">Fulfillment Window</span>
            {fulfillmentCountdown ? (
              <>
                <span className={cn('text-3xl font-black font-mono', fulfillmentCountdown.overdue ? 'text-red-600' : 'text-slate-900')}>
                  {fulfillmentCountdown.overdue ? 'Overdue' : `${fulfillmentCountdown.daysRemaining}d`}
                </span>
                <span className="text-xs font-bold text-slate-400 block">due {fulfillmentCountdown.deadline}</span>
              </>
            ) : (
              <>
                <span className="text-lg font-black font-mono text-slate-300">Not locked</span>
                {canLockOrder && isManager && (
                  <button
                    type="button"
                    onClick={handleLockOrder}
                    disabled={saving}
                    className="mt-1 flex items-center gap-1 text-xs font-black text-blue-600 hover:underline"
                  >
                    <Lock className="w-3 h-3" /> Lock Order Now
                  </button>
                )}
              </>
            )}
          </div>
          <div className="p-3 bg-slate-100 text-slate-600 rounded-2xl"><Lock className="w-6 h-6" /></div>
        </div>
      </div>

      {/* Per-material readiness breakdown */}
      {readinessLines.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-[2rem] p-6 shadow-xs">
          <h3 className="text-xs font-black uppercase tracking-widest text-slate-400 mb-4">Boxed by Material</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {readinessLines.map(line => {
              const mat = materials.find(m => m.id === line.materialId);
              return (
                <div key={line.materialId} className="bg-slate-50 rounded-xl p-3">
                  <p className="text-[10px] font-black text-slate-400 uppercase truncate">{mat?.name || 'Unknown'}</p>
                  <p className="font-mono font-black text-slate-900 text-sm">{line.netLbs.toLocaleString()} lbs</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* The sheet itself */}
      <div className="bg-white border border-slate-200 rounded-[2rem] shadow-xs overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest">
              Material Inventory Sheet {currentSheet ? `-- ${currentSheet.date}` : ''}
            </h3>
            <p className="text-xs text-slate-400 font-medium mt-0.5">
              {currentSheet ? 'Editable -- boxes can be topped off after entry. Autosaves as you go.' : 'No sheet yet -- start one to begin tracking.'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {currentSheet && (
              <span className={cn(
                'flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest',
                autosaveStatus === 'error' ? 'text-red-500' : autosaveStatus === 'saved' || !dirty ? 'text-emerald-500' : 'text-slate-400'
              )}>
                {autosaveStatus === 'saving' || autosaveStatus === 'pending' ? (
                  <><CloudUpload className="w-3.5 h-3.5 animate-pulse" /> {autosaveStatus === 'saving' ? 'Autosaving...' : 'Unsaved changes'}</>
                ) : autosaveStatus === 'error' ? (
                  <><CloudUpload className="w-3.5 h-3.5" /> Autosave failed -- click Save</>
                ) : (
                  <><CloudCheck className="w-3.5 h-3.5" /> All changes saved</>
                )}
              </span>
            )}
            {currentSheet && (
              <button
                type="button"
                onClick={handleSave}
                disabled={!dirty || saving}
                className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-xl text-xs font-black uppercase tracking-wider hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                <Save className="w-4 h-4" /> {saving ? 'Saving...' : 'Save Sheet'}
              </button>
            )}
            <button
              type="button"
              onClick={handleStartNewSheet}
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-black uppercase tracking-wider text-slate-700 hover:bg-slate-50 transition-all"
            >
              <FilePlus2 className="w-4 h-4" /> Start New Sheet
            </button>
          </div>
        </div>

        {!currentSheet ? (
          <div className="py-16 text-center text-slate-400 text-sm font-bold uppercase tracking-wider">
            No sheet started yet
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 text-slate-500 text-[10px] font-bold uppercase tracking-widest border-b border-slate-100">
                  <th className="px-4 py-3 w-20">Box #</th>
                  <th className="px-4 py-3 min-w-[200px]">Material</th>
                  <th className="px-4 py-3 w-28 text-right">Gross</th>
                  <th className="px-4 py-3 w-28 text-right">Tare</th>
                  <th className="px-4 py-3 w-28 text-right">Net</th>
                  <th className="px-4 py-3 w-36">Date</th>
                  <th className="px-4 py-3 min-w-[160px]">Remarks</th>
                  <th className="px-2 py-3 w-12"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {draftRows.map(row => {
                  const material = materials.find(m => m.id === row.materialId) || null;
                  return (
                    <tr key={row.id}>
                      <td className="px-4 py-2">
                        <input
                          type="text"
                          value={row.boxNumber}
                          onChange={(e) => updateRow(row.id, { boxNumber: e.target.value })}
                          className="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="#"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <MaterialAutocompleteInput
                          id={row.id}
                          materials={materials}
                          value={material}
                          isOpen={dropdownOpenRowId === row.id}
                          searchValue={materialSearchByRow[row.id] || ''}
                          onOpenChange={(open) => setDropdownOpenRowId(open ? row.id : null)}
                          onSearchChange={(val) => setMaterialSearchByRow(prev => ({ ...prev, [row.id]: val }))}
                          onSelect={(m) => updateRow(row.id, { materialId: m.id })}
                        />
                      </td>
                      <td className="px-4 py-2">
                        <input
                          type="number"
                          value={row.gross || ''}
                          onChange={(e) => updateRow(row.id, { gross: Number(e.target.value) || 0 })}
                          className="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono font-bold text-right outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="0"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <input
                          type="number"
                          value={row.tare || ''}
                          onChange={(e) => updateRow(row.id, { tare: Number(e.target.value) || 0 })}
                          className="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono font-bold text-right outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="0"
                        />
                      </td>
                      <td className="px-4 py-2 text-right font-mono font-black text-sm text-slate-900">
                        {row.net.toLocaleString()}
                      </td>
                      <td className="px-4 py-2">
                        <input
                          type="date"
                          value={row.date}
                          onChange={(e) => updateRow(row.id, { date: e.target.value })}
                          className="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <input
                          type="text"
                          value={row.remarks || ''}
                          onChange={(e) => updateRow(row.id, { remarks: e.target.value })}
                          className="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium outline-none focus:ring-2 focus:ring-blue-500"
                          placeholder="--"
                        />
                      </td>
                      <td className="px-2 py-2 text-center">
                        <button type="button" onClick={() => removeRow(row.id)} className="p-1.5 text-slate-300 hover:text-red-500 rounded-lg transition-colors">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-slate-50">
                  <td colSpan={4} className="px-4 py-3 text-right text-xs font-black uppercase tracking-widest text-slate-500">Net Total</td>
                  <td className="px-4 py-3 text-right font-mono font-black text-lg text-slate-900">{draftNetTotal.toLocaleString()}</td>
                  <td colSpan={3}></td>
                </tr>
              </tfoot>
            </table>
            <div className="p-4 border-t border-slate-100">
              <button
                type="button"
                onClick={addRow}
                className="flex items-center gap-2 px-4 py-2.5 text-xs font-black uppercase tracking-wider text-blue-600 hover:bg-blue-50 rounded-xl transition-all"
              >
                <Plus className="w-4 h-4" /> Add Box
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
