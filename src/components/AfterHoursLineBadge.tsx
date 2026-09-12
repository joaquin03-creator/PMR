import React, { useState } from 'react';
import { AlertTriangle, Check, Loader2, Save, X, Edit2 } from 'lucide-react';
import { AfterHoursDay } from '../types';
import { saveAfterHoursNote } from '../lib/afterHoursDetection';

interface AfterHoursLineBadgeProps {
  day: AfterHoursDay;
  isManager: boolean;
  currentUserEmail?: string;
  className?: string;
}

export const AfterHoursLineBadge: React.FC<AfterHoursLineBadgeProps> = ({
  day,
  isManager,
  currentUserEmail,
  className = ''
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [noteInput, setNoteInput] = useState(day.note || '');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleStartEdit = () => {
    setNoteInput(day.note || '');
    setSaveError(null);
    setIsEditing(true);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setNoteInput(day.note || '');
    setSaveError(null);
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setSaveError(null);
      await saveAfterHoursNote(day.date, noteInput, currentUserEmail || 'manager');
      setIsEditing(false);
    } catch (err: any) {
      console.error('Failed to save after-hours note:', err);
      setSaveError(err.message || 'Failed to save note');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={`flex flex-col gap-1.5 py-1 ${className}`}>
      {/* Badge and Count/Total Row */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 text-[10px] font-bold border border-amber-300 shadow-xs">
          <AlertTriangle className="w-3 h-3 text-amber-600 shrink-0" />
          After-hours — no drawer opened
        </span>
        <span className="text-[11px] font-mono font-bold text-slate-700">
          {day.ticketCount} ticket{day.ticketCount === 1 ? '' : 's'}, ${day.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
        </span>

        {/* Note Status: Green check if noted, muted dot if unnoted */}
        {day.hasNote && day.note ? (
          <span className="inline-flex items-center gap-1 text-[10px] text-emerald-700 font-semibold bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
            <Check className="w-3 h-3 text-emerald-600 shrink-0" />
            Acknowledged
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[10px] text-slate-500 font-medium bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
            <span className="w-1.5 h-1.5 rounded-full bg-slate-400 shrink-0" />
            needs review
          </span>
        )}
      </div>

      {/* Inline Note Display or Compact Editor */}
      {isEditing ? (
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-1.5 mt-0.5 max-w-lg bg-amber-50/90 p-2 rounded-xl border border-amber-300">
          <input
            type="text"
            value={noteInput}
            onChange={(e) => setNoteInput(e.target.value)}
            placeholder="Add context (e.g. favor for friend, ran 2 tickets after close)"
            className="flex-1 px-2.5 py-1 text-xs border border-amber-300 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500 font-sans shadow-inner"
            autoFocus
            disabled={saving}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave();
              if (e.key === 'Escape') handleCancel();
            }}
          />
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              disabled={saving}
              onClick={handleSave}
              className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white text-[10px] font-black uppercase tracking-wider rounded-lg transition-all flex items-center gap-1 cursor-pointer disabled:opacity-50 shadow-xs"
            >
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
              Save
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={handleCancel}
              className="px-2 py-1 bg-white hover:bg-slate-100 text-slate-600 text-[10px] font-bold uppercase tracking-wider rounded-lg border border-slate-200 transition-all flex items-center gap-1 cursor-pointer"
            >
              <X className="w-3 h-3" />
              Cancel
            </button>
          </div>
          {saveError && (
            <span className="text-[10px] text-red-600 font-bold block sm:inline">{saveError}</span>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2 text-xs">
          {day.hasNote && day.note ? (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="italic text-slate-600 font-medium">"{day.note}"</span>
              {day.authorEmail && (
                <span className="text-[10px] text-slate-400 font-normal">
                  — by {day.authorEmail}
                </span>
              )}
              {isManager && (
                <button
                  type="button"
                  onClick={handleStartEdit}
                  className="text-[10px] text-amber-700 hover:text-amber-800 underline font-semibold flex items-center gap-0.5 cursor-pointer ml-1"
                >
                  <Edit2 className="w-2.5 h-2.5" />
                  Edit
                </button>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              {isManager && (
                <button
                  type="button"
                  onClick={handleStartEdit}
                  className="text-[10px] text-amber-700 hover:text-amber-800 underline font-semibold cursor-pointer"
                >
                  Add note
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
