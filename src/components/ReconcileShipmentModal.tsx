import { useMemo, useRef, useState } from 'react';
import { collection, doc, writeBatch, increment } from 'firebase/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../firebase';
import { Invoice, Material, ProcessingShrinkMaterialDelta, UserProfile } from '../types';
import { logAuditEvent } from '../lib/audit';
import { handleFirestoreError, OperationType } from '../lib/firestore-errors';
import { X, Scale, Camera, Loader2, Check } from 'lucide-react';

interface ReconcileShipmentModalProps {
  invoice: Invoice;
  materials: Material[];
  /** Current book weight per materialId, e.g. Invoices.tsx's inventoryMap. */
  inventoryMap: Record<string, number>;
  profile: UserProfile | null;
  onClose: () => void;
  onReconciled: () => void;
}

// Books the gap between book (ticket-derived estimate) and physical
// (load-out weigh-up) on-hand, per material on this invoice, as ONE
// append-only ProcessingShrinkAdjustment -- not a per-conversion entry.
// Scoped to only the materials on this invoice, since those are what's
// actually being weighed at load-out; other materials' potential drift is
// backstopped by a full Count Mode pass if a month passes with no load.
export function ReconcileShipmentModal({ invoice, materials, inventoryMap, profile, onClose, onReconciled }: ReconcileShipmentModalProps) {
  const materialIds = useMemo(
    () => Array.from(new Set((invoice.materials || []).filter(m => m.materialId).map(m => m.materialId))),
    [invoice]
  );

  const [physicalWeights, setPhysicalWeights] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    materialIds.forEach(id => {
      const bookWeight = inventoryMap[id] ?? 0;
      initial[id] = String(bookWeight);
    });
    return initial;
  });
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slipPhotoUrl, setSlipPhotoUrl] = useState<string | null>(null);
  const [uploadingSlip, setUploadingSlip] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isManager = profile?.role === 'manager';

  const handleSlipUpload = async (file: File) => {
    setUploadingSlip(true);
    setError(null);
    try {
      const fileName = `${invoice.id}-${Date.now()}_${file.name}`;
      const fileRef = storageRef(storage, `reconciliation-slips/${fileName}`);
      await uploadBytes(fileRef, file);
      const url = await getDownloadURL(fileRef);
      setSlipPhotoUrl(url);
    } catch (err) {
      console.error('Error uploading receiving slip:', err);
      setError('Failed to upload the slip photo. You can still save the reconciliation without it.');
    } finally {
      setUploadingSlip(false);
    }
  };

  const rows = materialIds.map(id => {
    const mat = materials.find(m => m.id === id);
    const bookWeight = inventoryMap[id] ?? 0;
    // A blank field is NOT zero: Number('') is 0, which would write off the material's
    // whole book weight. Blank / non-numeric / negative entries are invalid and block the save.
    const raw = (physicalWeights[id] ?? '').trim();
    const parsed = Number(raw);
    const valid = raw !== '' && Number.isFinite(parsed) && parsed >= 0;
    const physicalWeight = valid ? parsed : bookWeight;
    return { materialId: id, materialName: mat?.name || id, bookWeight, physicalWeight, delta: physicalWeight - bookWeight, valid };
  });
  const invalidRows = rows.filter(r => !r.valid);

  const handleSubmit = async () => {
    if (!isManager) {
      setError('Manager access required to reconcile a shipment.');
      return;
    }
    if (invalidRows.length > 0) {
      setError(`Enter the weighed amount for: ${invalidRows.map(r => r.materialName).join(', ')}. A blank is not counted as zero.`);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const timestamp = new Date().toISOString();
      const batch = writeBatch(db);

      const materialDeltas: ProcessingShrinkMaterialDelta[] = rows.map(r => ({
        materialId: r.materialId,
        bookWeight: r.bookWeight,
        physicalWeight: r.physicalWeight,
        delta: r.delta
      }));

      rows.forEach(r => {
        if (r.delta === 0) return;
        const invRef = doc(db, 'inventory', r.materialId);
        batch.set(invRef, {
          materialId: r.materialId,
          currentWeight: increment(r.delta),
          lastUpdated: timestamp
        }, { merge: true });
      });

      const adjRef = doc(collection(db, 'processingShrinkAdjustments'));
      const adjustmentData = {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        materialDeltas,
        // Optional fields are left out when empty: Firestore rejects `undefined`, which made
        // the whole reconciliation fail unless both a note and a slip photo were supplied.
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        ...(slipPhotoUrl ? { slipPhotoUrl } : {}),
        timestamp,
        recordedBy: profile?.displayName || profile?.email || 'Manager'
      };
      batch.set(adjRef, adjustmentData);

      batch.update(doc(db, 'invoices', invoice.id), { reconciledAt: timestamp });

      await batch.commit();

      const summary = rows.filter(r => r.delta !== 0).map(r => `${r.materialName}: ${r.delta > 0 ? '+' : ''}${r.delta.toLocaleString()} lbs`).join(', ');
      await logAuditEvent(
        'inventory',
        adjRef.id,
        'adjustment',
        { after: adjustmentData },
        `Processing & Shrink reconciled for invoice ${invoice.invoiceNumber}: ${summary || 'no change'}`
      );

      onReconciled();
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'processingShrinkAdjustments');
      setError('Failed to save reconciliation. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-[200] flex items-start justify-center p-4 overflow-y-auto">
      <div className="bg-white rounded-[2.5rem] p-8 max-w-2xl w-full shadow-2xl my-8 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-50 text-blue-600 rounded-xl"><Scale className="w-5 h-5" /></div>
            <div>
              <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight">Reconcile Invoice {invoice.invoiceNumber}</h3>
              <p className="text-xs text-slate-400 font-medium">Enter the load-out weigh-up per material. This is the physical truth.</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-xl text-slate-400"><X className="w-5 h-5" /></button>
        </div>

        {error && <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-sm font-bold rounded-xl">{error}</div>}

        <div className="space-y-3">
          {rows.map(r => (
            <div key={r.materialId} className="grid grid-cols-3 gap-4 items-center p-4 bg-slate-50 rounded-2xl border border-slate-200">
              <div>
                <p className="text-sm font-bold text-slate-900">{r.materialName}</p>
                <p className="text-[10px] text-slate-400 uppercase tracking-wider">Book: {r.bookWeight.toLocaleString()} lbs</p>
              </div>
              <div>
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Physical (weighed)</label>
                <input
                  type="number"
                  value={physicalWeights[r.materialId] ?? ''}
                  onChange={(e) => setPhysicalWeights(prev => ({ ...prev, [r.materialId]: e.target.value }))}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm font-mono font-bold outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="text-right">
                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Delta</p>
                {!r.valid ? (
                  <p className="text-amber-600 font-black text-xs uppercase tracking-wider">Enter a weight</p>
                ) : (
                <p className={r.delta === 0 ? 'text-slate-400 font-mono font-black' : r.delta > 0 ? 'text-emerald-600 font-mono font-black' : 'text-red-600 font-mono font-black'}>
                  {r.delta > 0 ? '+' : ''}{r.delta.toLocaleString()} lbs
                </p>
                )}
              </div>
            </div>
          ))}
        </div>

        <div>
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Buyer's Receiving Slip (optional)</label>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleSlipUpload(file);
            }}
          />
          {slipPhotoUrl ? (
            <div className="flex items-center gap-3 p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
              <img src={slipPhotoUrl} alt="Receiving slip" className="w-14 h-14 object-cover rounded-lg border border-emerald-200" />
              <div className="flex-1">
                <p className="text-xs font-bold text-emerald-800 flex items-center gap-1"><Check className="w-3.5 h-3.5" /> Slip attached</p>
                <button type="button" onClick={() => fileInputRef.current?.click()} className="text-[10px] font-black text-emerald-700 hover:underline uppercase tracking-wider">Replace</button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingSlip}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-slate-50 border border-dashed border-slate-300 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-100 hover:border-slate-400 transition-all disabled:opacity-50"
            >
              {uploadingSlip ? <Loader2 className="w-4 h-4 animate-spin" /> : <Camera className="w-4 h-4" />}
              {uploadingSlip ? 'Uploading...' : 'Attach a photo of the slip'}
            </button>
          )}
        </div>

        <div>
          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">Notes (optional)</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="How the material was received -- weight deductions, contamination, downgrades, etc."
          />
        </div>

        <div className="flex gap-3 pt-2">
          <button onClick={onClose} className="flex-1 px-6 py-3.5 text-slate-500 font-black text-xs uppercase tracking-widest hover:bg-slate-50 rounded-2xl transition-all">Cancel</button>
          <button
            onClick={handleSubmit}
            disabled={saving || uploadingSlip || !isManager}
            className="flex-[2] px-6 py-3.5 bg-blue-600 text-white font-black text-xs uppercase tracking-widest rounded-2xl hover:bg-blue-700 disabled:opacity-50 transition-all"
          >
            {saving ? 'Saving...' : uploadingSlip ? 'Uploading slip...' : 'Book Processing & Shrink Adjustment'}
          </button>
        </div>
      </div>
    </div>
  );
}
