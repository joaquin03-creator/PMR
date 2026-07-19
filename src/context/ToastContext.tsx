import React, { createContext, useContext, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CheckCircle2, XCircle, AlertCircle, Info, Database, Save, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warning' | 'info' | 'firestore' | 'local';

export interface Toast {
  id: string;
  title: string;
  message: string;
  type: ToastType;
  duration?: number;
}

interface ToastContextType {
  toast: (title: string, message: string, type: ToastType, duration?: number) => void;
  success: (title: string, message: string, duration?: number) => void;
  error: (title: string, message: string, duration?: number) => void;
  warning: (title: string, message: string, duration?: number) => void;
  info: (title: string, message: string, duration?: number) => void;
  firestore: (title: string, message: string, duration?: number) => void;
  local: (title: string, message: string, duration?: number) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}

interface ToastProviderProps {
  children: React.ReactNode;
}

export function ToastProvider({ children }: ToastProviderProps) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback((title: string, message: string, type: ToastType, duration = 4000) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, title, message, type, duration }]);

    setTimeout(() => {
      removeToast(id);
    }, duration);
  }, [removeToast]);

  const success = useCallback((title: string, message: string, duration?: number) => {
    toast(title, message, 'success', duration);
  }, [toast]);

  const error = useCallback((title: string, message: string, duration?: number) => {
    toast(title, message, 'error', duration);
  }, [toast]);

  const warning = useCallback((title: string, message: string, duration?: number) => {
    toast(title, message, 'warning', duration);
  }, [toast]);

  const info = useCallback((title: string, message: string, duration?: number) => {
    toast(title, message, 'info', duration);
  }, [toast]);

  const firestore = useCallback((title: string, message: string, duration?: number) => {
    toast(title, message, 'firestore', duration);
  }, [toast]);

  const local = useCallback((title: string, message: string, duration?: number) => {
    toast(title, message, 'local', duration);
  }, [toast]);

  return (
    <ToastContext.Provider value={{ toast, success, error, warning, info, firestore, local }}>
      {children}
      {/* Toast Render Area */}
      <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-3 w-full max-w-sm pointer-events-none">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: -20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.15 } }}
              className="pointer-events-auto bg-slate-900 border border-slate-800 text-white rounded-2xl shadow-xl overflow-hidden relative"
            >
              <div className="p-4 flex gap-3">
                <div className="mt-0.5 flex-shrink-0">
                  {t.type === 'success' && <CheckCircle2 className="w-5 h-5 text-emerald-400" />}
                  {t.type === 'error' && <XCircle className="w-5 h-5 text-rose-500" />}
                  {t.type === 'warning' && <AlertCircle className="w-5 h-5 text-amber-500" />}
                  {t.type === 'info' && <Info className="w-5 h-5 text-sky-400" />}
                  {t.type === 'firestore' && (
                    <div className="relative">
                      <Database className="w-5 h-5 text-indigo-400" />
                      <span className="absolute -top-1 -right-1 w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                    </div>
                  )}
                  {t.type === 'local' && <Save className="w-5 h-5 text-amber-400" />}
                </div>

                <div className="flex-1 min-w-0 pr-4">
                  <h4 className="text-xs font-black uppercase tracking-wider text-slate-100 flex items-center gap-1.5">
                    {t.title}
                    {t.type === 'firestore' && (
                      <span className="text-[8px] px-1.5 py-0.5 bg-indigo-950 text-indigo-300 border border-indigo-900 rounded-full font-black uppercase tracking-widest scale-90">
                        CLOUD
                      </span>
                    )}
                    {t.type === 'local' && (
                      <span className="text-[8px] px-1.5 py-0.5 bg-amber-950 text-amber-300 border border-amber-900 rounded-full font-black uppercase tracking-widest scale-90">
                        LOCAL
                      </span>
                    )}
                  </h4>
                  <p className="text-slate-400 text-xs mt-1 font-semibold leading-relaxed">
                    {t.message}
                  </p>
                </div>

                <button
                  onClick={() => removeToast(t.id)}
                  className="absolute top-3 right-3 text-slate-500 hover:text-slate-300 transition-colors p-1 rounded-lg hover:bg-slate-800"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* Progress timer bar */}
              <motion.div
                initial={{ width: '100%' }}
                animate={{ width: '0%' }}
                transition={{ duration: (t.duration || 4000) / 1000, ease: 'linear' }}
                className={`h-1 ${
                  t.type === 'success' ? 'bg-emerald-500' :
                  t.type === 'error' ? 'bg-rose-500' :
                  t.type === 'warning' ? 'bg-amber-500' :
                  t.type === 'info' ? 'bg-sky-500' :
                  t.type === 'firestore' ? 'bg-indigo-500' : 'bg-amber-500'
                }`}
              />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
