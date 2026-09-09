import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { Bug, X, Send, Loader2, CheckCircle2, AlertTriangle, Clock, Shield, Monitor } from 'lucide-react';
import { db } from '../firebase';
import { collection, addDoc, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import { UserProfile, ProblemReport } from '../types';
import { APP_VERSION } from '../constants';
import { cn } from '../lib/utils';

interface ReportProblemModalProps {
  isOpen: boolean;
  onClose: () => void;
  profile: UserProfile | null;
  stationName: string;
  isOnline: boolean;
}

export const ReportProblemModal: React.FC<ReportProblemModalProps> = ({
  isOpen,
  onClose,
  profile,
  stationName,
  isOnline,
}) => {
  const location = useLocation();
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [auditEvents, setAuditEvents] = useState<{ title: string; time: string }[]>([]);
  const [loadingAudit, setLoadingAudit] = useState(false);

  // Fetch last 5 audit events for this user
  useEffect(() => {
    if (!isOpen) return;

    setIsSuccess(false);
    setError(null);
    setDescription('');
    setLoadingAudit(true);

    const fetchAudit = async () => {
      try {
        const userEmail = profile?.email;
        let q;
        if (userEmail) {
          q = query(
            collection(db, 'auditLogs'),
            where('performedBy', '==', userEmail),
            orderBy('timestamp', 'desc'),
            limit(5)
          );
        } else {
          q = query(
            collection(db, 'auditLogs'),
            orderBy('timestamp', 'desc'),
            limit(5)
          );
        }
        const snap = await getDocs(q);
        const events = snap.docs.map((d) => {
          const data = d.data() as Record<string, any>;
          const title = `${data.action || 'action'} ${data.entityType || 'entity'}${data.notes ? ` — ${data.notes}` : ''}`;
          return {
            title,
            time: data.timestamp ? new Date(data.timestamp).toLocaleTimeString() : 'Recent',
          };
        });
        setAuditEvents(events);
      } catch (err) {
        console.warn('Could not fetch audit events for problem report:', err);
        // Fallback: empty array or local event
        setAuditEvents([]);
      } finally {
        setLoadingAudit(false);
      }
    };

    fetchAudit();
  }, [isOpen, profile]);

  if (!isOpen) return null;

  const currentRoute = location.pathname;
  const userName = profile?.displayName || profile?.email || 'Anonymous';
  const userRole = profile?.role || 'cashier';
  const timestamp = new Date().toISOString();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim()) {
      setError('Please describe what happened.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const report: Omit<ProblemReport, 'id'> = {
        description: description.trim(),
        route: currentRoute,
        userName,
        userRole,
        stationName: stationName || 'Main Station',
        timestamp,
        isOnline,
        appVersion: APP_VERSION,
        auditEvents,
        status: 'open',
      };

      await addDoc(collection(db, 'problemReports'), report);
      setIsSuccess(true);
    } catch (err: any) {
      console.error('Failed to submit problem report:', err);
      // If offline, persistent cache will still queue it; if error:
      setError(err?.message || 'Failed to submit report. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="report-problem-title"
    >
      <div
        className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-5 animate-in zoom-in-95 duration-200 my-8"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center shrink-0">
              <Bug className="w-4 h-4" />
            </div>
            <div>
              <h3 id="report-problem-title" className="text-base font-black text-slate-900">
                Report a Problem
              </h3>
              <p className="text-[11px] text-slate-500">
                Quick diagnostic report sent directly to management.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {isSuccess ? (
          <div className="py-6 space-y-4 text-center">
            <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-2xl mx-auto flex items-center justify-center">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h4 className="text-sm font-black text-slate-900">Report Sent</h4>
              <p className="text-xs text-slate-600 font-medium px-4 leading-relaxed">
                Sent. Joaquin will see this — keep the customer moving and use the paper ticket if you're stuck.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Description Textarea */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label
                  htmlFor="problem-description"
                  className="text-xs font-bold text-slate-700"
                >
                  What were you trying to do, and what happened? *
                </label>
                <span className="text-[10px] text-slate-400 font-mono">
                  {description.length}/500
                </span>
              </div>
              <textarea
                id="problem-description"
                required
                maxLength={500}
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. Tried to save ticket #1042 for bare bright, scale weight wouldn't pull..."
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 outline-none transition-all resize-none"
              />
            </div>

            {/* Auto-Captured Diagnostic Metadata */}
            <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200/80 space-y-2.5 text-[11px]">
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">
                Auto-Captured Diagnostic Context
              </span>
              <div className="grid grid-cols-2 gap-2 text-slate-600">
                <div>
                  <span className="text-slate-400 font-medium">Page / Route:</span>{' '}
                  <span className="font-mono font-bold text-slate-800">{currentRoute}</span>
                </div>
                <div>
                  <span className="text-slate-400 font-medium">User &amp; Role:</span>{' '}
                  <span className="font-bold text-slate-800">{userName} ({userRole})</span>
                </div>
                <div>
                  <span className="text-slate-400 font-medium">Station:</span>{' '}
                  <span className="font-bold text-slate-800">{stationName || 'Default'}</span>
                </div>
                <div>
                  <span className="text-slate-400 font-medium">Status:</span>{' '}
                  <span
                    className={cn(
                      'font-bold',
                      isOnline ? 'text-emerald-700' : 'text-amber-700'
                    )}
                  >
                    {isOnline ? 'Online' : 'Offline'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 font-medium">App Version:</span>{' '}
                  <span className="font-mono font-bold text-slate-800">v{APP_VERSION}</span>
                </div>
                <div>
                  <span className="text-slate-400 font-medium">Timestamp:</span>{' '}
                  <span className="font-mono text-slate-700">
                    {new Date().toLocaleTimeString()}
                  </span>
                </div>
              </div>

              {/* Recent Audit Events */}
              <div className="pt-2 border-t border-slate-200/60">
                <span className="text-[10px] font-bold text-slate-400 block mb-1">
                  Last 5 user audit events:
                </span>
                {loadingAudit ? (
                  <div className="flex items-center gap-1.5 text-slate-400 text-[10px]">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>Loading audit log...</span>
                  </div>
                ) : auditEvents.length === 0 ? (
                  <span className="text-slate-400 italic text-[10px]">
                    No recent audit events found for this session.
                  </span>
                ) : (
                  <ul className="space-y-1">
                    {auditEvents.map((evt, idx) => (
                      <li
                        key={idx}
                        className="flex items-center justify-between text-slate-600 text-[10px] gap-2"
                      >
                        <span className="truncate">• {evt.title}</span>
                        <span className="shrink-0 text-slate-400 font-mono text-[9px]">
                          {evt.time}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || !description.trim()}
                className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Submitting...</span>
                  </>
                ) : (
                  <>
                    <Send className="w-3.5 h-3.5" />
                    <span>Send Report</span>
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
