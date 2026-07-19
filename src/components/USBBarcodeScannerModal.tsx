import React, { useState, useEffect, useRef } from 'react';
import { X, QrCode, AlertCircle, Sparkles, CheckCircle2 } from 'lucide-react';
import { parseAAMVABarcode } from '../hooks/useIDScanner';
import { cn } from '../lib/utils';

interface USBBarcodeScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScanSuccess: (data: {
    name: string;
    idNumber: string;
    address: string;
    idType: string;
    idExpiration: string;
  }) => void;
}

export default function USBBarcodeScannerModal({
  isOpen,
  onClose,
  onScanSuccess,
}: USBBarcodeScannerModalProps) {
  const [inputValue, setInputValue] = useState('');
  const [error, setError] = useState('');
  const [hasFocus, setHasFocus] = useState(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scanTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const inputValueRef = useRef(inputValue);

  // Keep ref up to date
  useEffect(() => {
    inputValueRef.current = inputValue;
  }, [inputValue]);

  // Auto-focus input when open or clicked
  useEffect(() => {
    if (isOpen) {
      setInputValue('');
      setError('');
      setHasFocus(true);
      setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
    }
  }, [isOpen]);

  // Periodically force focus back to the textarea to make sure focus is never lost
  useEffect(() => {
    if (!isOpen) return;

    const interval = setInterval(() => {
      if (document.activeElement !== inputRef.current) {
        inputRef.current?.focus();
      }
    }, 150);

    return () => clearInterval(interval);
  }, [isOpen]);

  // Clean up timeout on unmount
  useEffect(() => {
    return () => {
      if (scanTimeoutRef.current) {
        clearTimeout(scanTimeoutRef.current);
      }
    };
  }, []);

  // Global event listener to capture keyboard wedge scans even if focus is temporarily lost
  useEffect(() => {
    if (!isOpen) return;

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // Ignore control/system keys or shortcuts
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Escape' || e.key === 'Tab') return;

      // If our input is not active, refocus and programmatically capture the character so nothing is lost!
      if (document.activeElement !== inputRef.current) {
        inputRef.current?.focus();
        
        if (e.key.length === 1) {
          e.preventDefault();
          const nextVal = inputValueRef.current + e.key;
          setInputValue(nextVal);
          setError('');

          // Reset parser timeout for the newly appended character
          if (scanTimeoutRef.current) {
            clearTimeout(scanTimeoutRef.current);
          }

          if (nextVal.length > 2) {
            scanTimeoutRef.current = setTimeout(() => {
              const parsed = parseAAMVABarcode(nextVal);
              if (parsed) {
                onScanSuccess(parsed);
                onClose();
              } else if (nextVal.length > 15) {
                setError("Could not decode driver's license barcode. Please verify you scanned the large, dense PDF417 barcode on the back of the card.");
              }
            }, 400);
          }
        }
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown, { capture: true });
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleFocusClick = () => {
    inputRef.current?.focus();
    setHasFocus(true);
  };

  const handleModalClick = (e: React.MouseEvent) => {
    // Prevent focus loss when clicking anywhere inside the modal (except on actionable buttons)
    const target = e.target as HTMLElement;
    if (target.closest('button')) return;
    inputRef.current?.focus();
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInputValue(val);
    setError('');

    // Clear previous parsing timeout
    if (scanTimeoutRef.current) {
      clearTimeout(scanTimeoutRef.current);
    }

    // Since USB scanners type extremely fast (every 1-5ms), wait for a 400ms gap of silence.
    // This ensures we parse the complete payload and completely avoids race conditions on partially typed text.
    if (val.length > 2) {
      scanTimeoutRef.current = setTimeout(() => {
        const parsed = parseAAMVABarcode(val);
        if (parsed) {
          onScanSuccess(parsed);
          onClose();
        } else if (val.length > 15) {
          setError("Could not decode driver's license barcode. Please verify you scanned the large, dense PDF417 barcode on the back of the card.");
        }
      }, 400);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      
      // Clear timeout since we received the terminating 'Enter' delimiter key
      if (scanTimeoutRef.current) {
        clearTimeout(scanTimeoutRef.current);
      }

      const val = inputValue.trim();
      if (!val) return;

      const parsed = parseAAMVABarcode(val);
      if (parsed) {
        onScanSuccess(parsed);
        onClose();
      } else {
        setError('Could not decode driver\'s license barcode. Please verify you scanned the large, dense PDF417 barcode on the back of the card.');
        setInputValue('');
      }
    }
  };

  return (
    <div 
      className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-[200] flex items-center justify-center p-4 animate-in fade-in duration-200"
      onClick={() => onClose()}
    >
      <div 
        onClick={(e) => {
          e.stopPropagation();
          handleModalClick(e);
        }}
        className="bg-white rounded-[2rem] border border-slate-100 shadow-2xl max-w-lg w-full overflow-hidden flex flex-col p-8 space-y-6 relative animate-in zoom-in-95 duration-200"
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-50 text-blue-600 rounded-2xl">
              <QrCode className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg font-black text-slate-900 font-display uppercase tracking-tight">USB License Scanner</h3>
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">AAMVA PDF417 Barcode Decoder</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-slate-50 text-slate-400 hover:text-slate-600 rounded-xl transition-all"
            aria-label="Close scanner modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Visual Target Area */}
        <div 
          onClick={handleFocusClick}
          className={cn(
            "relative w-full h-36 bg-slate-50 border-2 border-dashed rounded-2xl flex flex-col items-center justify-center overflow-hidden cursor-pointer transition-all",
            hasFocus ? "border-blue-200 bg-slate-50/50" : "border-amber-300 bg-amber-50/20"
          )}
        >
          {/* Laser beam */}
          {hasFocus && (
            <div 
              className="absolute inset-x-0 h-1 bg-gradient-to-r from-transparent via-red-500 to-transparent shadow-[0_0_12px_#ef4444] animate-bounce" 
              style={{ top: '35%', animationDuration: '2.5s' }} 
            />
          )}

          <QrCode className={cn("w-10 h-10 mb-2 transition-all", hasFocus ? "text-blue-500 animate-pulse" : "text-amber-500")} />

          {hasFocus ? (
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider animate-pulse text-center px-4">
              Scanner Ready. Aim and trigger your USB scanner now.
            </p>
          ) : (
            <div className="text-center px-4 space-y-1">
              <p className="text-xs font-black text-amber-600 uppercase tracking-wider flex items-center justify-center gap-1">
                <AlertCircle className="w-4 h-4" /> Scanner Disconnected (Click here to fix)
              </p>
              <p className="text-[10px] text-slate-400 font-medium">
                The scanner behaves as a keyboard. Focus must be active to scan.
              </p>
            </div>
          )}
        </div>

        {/* Textarea Box (Preserves newlines for correct parsing) */}
        <div className="space-y-2">
          <label htmlFor="barcode-raw-input" className="text-xs font-black text-slate-400 uppercase tracking-widest block ml-1">
            Scanner Input Field
          </label>
          <textarea
            id="barcode-raw-input"
            ref={inputRef}
            className={cn(
              "w-full h-24 px-5 py-4 bg-slate-50 border rounded-2xl outline-none text-xs font-mono transition-all resize-none overflow-hidden",
              hasFocus ? "border-slate-200 focus:ring-2 focus:ring-blue-500" : "border-amber-300 bg-amber-50/30"
            )}
            placeholder="Awaiting hardware scan data..."
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onFocus={() => setHasFocus(true)}
            onBlur={() => setHasFocus(false)}
            autoComplete="off"
            autoFocus
          />
        </div>

        {/* Error State */}
        {error && (
          <div className="p-4 bg-red-50 border border-red-100 rounded-2xl flex gap-3 text-red-600 text-xs font-medium animate-in fade-in slide-in-from-top-2 duration-200">
            <AlertCircle className="w-5 h-5 shrink-0 text-red-500" />
            <p>{error}</p>
          </div>
        )}

        {/* Prompt tips */}
        <div className="p-4 bg-blue-50/50 border border-blue-100/50 rounded-2xl space-y-1">
          <p className="text-xs font-black text-blue-800 uppercase tracking-wider flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5" /> Employee Scanner Tip
          </p>
          <p className="text-[10px] text-slate-500 leading-relaxed">
            The scanner mimics typing extremely fast. Standard USB scanners automatically submit once the barcode is fully read. If scanning doesn't trigger, click inside this modal and try again!
          </p>
        </div>
      </div>
    </div>
  );
}
