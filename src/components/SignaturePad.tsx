import { useRef, useState, useEffect } from 'react';
import SignatureCanvas from 'react-signature-canvas';
import { RotateCcw, Check, PenTool, Radio, Loader2, AlertCircle } from 'lucide-react';

interface SignaturePadProps {
  onCapture: (url: string) => void;
  onClear?: () => void;
  label?: string;
  className?: string;
}

export default function SignaturePad({ onCapture, onClear, label = "Customer Signature", className = "" }: SignaturePadProps) {
  const sigCanvas = useRef<SignatureCanvas>(null);
  const [isEmpty, setIsEmpty] = useState(true);
  
  // Hardware State
  const [hardwareStatus, setHardwareStatus] = useState<'idling' | 'connecting' | 'connected' | 'capturing' | 'error'>('idling');
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const clear = () => {
    sigCanvas.current?.clear();
    setIsEmpty(true);
    if (onClear) onClear();
    if (hardwareStatus === 'connected' || hardwareStatus === 'capturing') {
      // If we cleared the UI, we might want to tell the hardware to restart too
      startHardwareCapture();
    }
  };

  const save = () => {
    if (sigCanvas.current) {
      if (sigCanvas.current.isEmpty() && hardwareStatus === 'idling') {
        setIsEmpty(true);
        return;
      }
      const dataUrl = sigCanvas.current.getCanvas().toDataURL('image/png');
      onCapture(dataUrl);
    }
  };

  // ePadLink (Interlink) WebSocket Integration
  const connectHardware = () => {
    setHardwareStatus('connecting');
    setError(null);

    // ePadLink Universal SDK typically listens on 11001 or 11002
    // We try 11001 first (Standard for Universal SDK)
    const wsUrl = "ws://localhost:11001/";
    
    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setHardwareStatus('connected');
        // Initialize the device
        ws.send(JSON.stringify({ command: "open" }));
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        
        switch (data.command) {
          case "getimage":
            if (data.status === "success" && data.image) {
              const dataUrl = `data:image/png;base64,${data.image}`;
              onCapture(dataUrl);
              setIsEmpty(false);
              setHardwareStatus('connected');
              
              // We can also draw it to our canvas if we want to show it there
              const img = new Image();
              img.onload = () => {
                const ctx = sigCanvas.current?.getCanvas().getContext('2d');
                if (ctx) {
                  ctx.clearRect(0,0, ctx.canvas.width, ctx.canvas.height);
                  ctx.drawImage(img, 0, 0, ctx.canvas.width, ctx.canvas.height);
                }
              };
              img.src = dataUrl;
            }
            break;
          case "error":
            setError(data.message || "Hardware Error");
            setHardwareStatus('error');
            break;
          default:
            console.log("Hardware Msg:", data);
        }
      };

      ws.onerror = () => {
        setHardwareStatus('error');
        setError("Could not connect to ePadLink service. Ensure 'Universal SDK' or 'IntegriSign Desktop' is running locally.");
      };

      ws.onclose = () => {
        if (hardwareStatus !== 'error') {
          setHardwareStatus('idling');
        }
      };
    } catch (err) {
      setHardwareStatus('error');
      setError("Local connection blocked.");
    }
  };

  const startHardwareCapture = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      setHardwareStatus('capturing');
      // Command to start real-time capture
      wsRef.current.send(JSON.stringify({ 
        command: "start",
        params: {
          width: 400,
          height: 150
        }
      }));

      // In some versions, you might need to poll for the image or wait for a stop command
      // Here we assume the device sends an image when the user hits 'OK' or 'Done' on the pad
    }
  };

  const stopHardwareCapture = () => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ command: "getimage", params: { format: "png" } }));
      wsRef.current.send(JSON.stringify({ command: "stop" }));
    }
  };

  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  return (
    <div className={`space-y-3 ${className}`}>
      <div className="flex items-center justify-between">
        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
          <PenTool className="w-3 h-3" />
          {label}
        </label>
        
        <div className="flex items-center gap-4">
          {hardwareStatus === 'idling' ? (
            <button
              type="button"
              onClick={connectHardware}
              className="text-[10px] font-black text-blue-600 uppercase tracking-widest hover:text-blue-700 transition-colors flex items-center gap-1.5"
              title="Connect to ePadlink Hardware"
            >
              <Radio className="w-3 h-3" />
              Connect ePad
            </button>
          ) : hardwareStatus === 'connecting' ? (
            <div className="flex items-center gap-2 text-[10px] font-black text-slate-400 uppercase tracking-widest">
              <Loader2 className="w-3 h-3 animate-spin" />
              Syncing...
            </div>
          ) : hardwareStatus === 'capturing' ? (
            <button
              onClick={stopHardwareCapture}
              className="text-[10px] font-black text-green-600 uppercase tracking-widest animate-pulse flex items-center gap-1.5"
            >
              Finish on Pad
            </button>
          ) : (
            <button
              type="button"
              onClick={startHardwareCapture}
              className="text-[10px] font-black text-blue-600 uppercase tracking-widest flex items-center gap-1.5"
            >
              <Radio className="w-3 h-3 fill-blue-600 animate-ping" />
              ePad Active
            </button>
          )}

          <button
            type="button"
            onClick={clear}
            className="text-[10px] font-black text-red-500 uppercase tracking-widest hover:text-red-600 transition-colors flex items-center gap-1"
          >
            <RotateCcw className="w-3 h-3" />
            Clear
          </button>
        </div>
      </div>

      <div className="relative bg-white border-2 border-slate-200 rounded-3xl overflow-hidden shadow-inner group">
        <SignatureCanvas
          ref={sigCanvas}
          penColor="black"
          onBegin={() => setIsEmpty(false)}
          onEnd={save}
          canvasProps={{
            className: "w-full h-48 cursor-crosshair",
          }}
        />
        {isEmpty && hardwareStatus !== 'capturing' && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-40">
            <p className="text-slate-400 text-sm font-medium italic">Sign on screen or ePad...</p>
          </div>
        )}
        {hardwareStatus === 'capturing' && (
          <div className="absolute inset-0 bg-blue-50/50 flex flex-col items-center justify-center animate-in fade-in">
            <div className="bg-white p-6 rounded-2xl shadow-xl flex flex-col items-center gap-4 text-center">
              <div className="w-12 h-12 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center">
                <Radio className="w-6 h-6 animate-pulse" />
              </div>
              <div>
                <p className="font-bold text-slate-900">Pad Active</p>
                <p className="text-xs text-slate-500">Please sign on your ePad-ink device</p>
              </div>
              <button 
                onClick={stopHardwareCapture}
                className="mt-2 px-6 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold hover:bg-blue-700 transition-all"
              >
                Capture Signature
              </button>
            </div>
          </div>
        )}
      </div>
      
      {error && (
        <div className="flex items-start gap-2 text-red-500 p-3 bg-red-50 rounded-2xl border border-red-100 animate-in slide-in-from-top-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <p className="text-[10px] font-medium leading-relaxed">{error}</p>
        </div>
      )}

      {!isEmpty && (
        <div className="flex items-center gap-2 text-green-600 animate-in fade-in slide-in-from-top-1">
          <Check className="w-4 h-4" />
          <span className="text-[10px] font-bold uppercase tracking-wider">Signature Captured</span>
        </div>
      )}
    </div>
  );
}
