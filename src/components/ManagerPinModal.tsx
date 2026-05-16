import { useState, useEffect } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { X, ShieldCheck, Loader2 } from 'lucide-react';

interface ManagerPinModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  title?: string;
  message?: string;
}

export default function ManagerPinModal({ isOpen, onClose, onSuccess, title = "Manager Approval Required", message = "Please enter a manager PIN to approve this price override." }: ManagerPinModalProps) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setPin('');
      setError('');
    }
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pin.length < 4) return;

    setVerifying(true);
    setError('');

    try {
      // Check if any manager has this PIN
      const managersQuery = query(
        collection(db, 'users'),
        where('role', '==', 'manager'),
        where('managerPin', '==', pin)
      );
      
      const snapshot = await getDocs(managersQuery);
      
      if (!snapshot.empty) {
        onSuccess();
        onClose();
      } else {
        setError('Invalid Manager PIN. Please try again.');
        setPin('');
      }
    } catch (err) {
      console.error('Error verifying PIN:', err);
      setError('An error occurred. Please try again.');
    } finally {
      setVerifying(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/60 z-[300] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl w-full max-w-sm p-6 shadow-2xl animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-50 rounded-full flex items-center justify-center">
              <ShieldCheck className="w-6 h-6 text-blue-600" />
            </div>
            <h2 className="text-xl font-bold text-slate-900">{title}</h2>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
            <X className="w-5 h-5 text-slate-400" />
          </button>
        </div>

        <p className="text-slate-600 text-sm mb-6 leading-relaxed">
          {message}
        </p>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="flex justify-center gap-3">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className={`w-12 h-16 rounded-xl border-2 flex items-center justify-center text-2xl font-black transition-all ${
                  pin.length > i 
                    ? 'border-blue-600 bg-blue-50 text-blue-600' 
                    : 'border-slate-200 bg-slate-50 text-slate-300'
                }`}
              >
                {pin.length > i ? '●' : ''}
              </div>
            ))}
          </div>

          <input
            type="password"
            autoFocus
            maxLength={4}
            className="sr-only"
            value={pin}
            onChange={(e) => {
              const val = e.target.value.replace(/\D/g, '');
              if (val.length <= 4) setPin(val);
            }}
          />

          {/* Virtual Keypad */}
          <div className="grid grid-cols-3 gap-3">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 'Clear', 0, 'OK'].map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  if (key === 'Clear') setPin('');
                  else if (key === 'OK') handleSubmit(new Event('submit') as any);
                  else if (typeof key === 'number' && pin.length < 4) setPin(prev => prev + key);
                }}
                className={`py-4 rounded-xl font-bold text-lg transition-all ${
                  typeof key === 'number'
                    ? 'bg-slate-50 text-slate-700 hover:bg-slate-100'
                    : key === 'OK'
                    ? 'bg-blue-600 text-white hover:bg-blue-700 col-span-1'
                    : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                }`}
              >
                {key}
              </button>
            ))}
          </div>

          {error && (
            <p className="text-center text-sm font-bold text-red-600 animate-bounce">
              {error}
            </p>
          )}

          {verifying && (
            <div className="flex items-center justify-center gap-2 text-blue-600 font-bold">
              <Loader2 className="w-4 h-4 animate-spin" />
              Verifying PIN...
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
