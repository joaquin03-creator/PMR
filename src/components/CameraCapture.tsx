import React, { useState, useRef } from 'react';
import { Camera, RefreshCw, X, Video, Loader2 } from 'lucide-react';
import { PHOTO_PLACEHOLDER_URL } from '../constants';
import { useSettings } from '../context/SettingsContext';

const stampImage = (base64OrDataUrl: string): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(base64OrDataUrl); return; }
      ctx.drawImage(img, 0, 0);

      // Format: mm/dd/yyyy hh:mm AM/PM
      const now = new Date();
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');
      const yyyy = now.getFullYear();
      let hours = now.getHours();
      const ampm = hours >= 12 ? 'PM' : 'AM';
      hours = hours % 12 || 12;
      const mins = String(now.getMinutes()).padStart(2, '0');
      const stamp = `${mm}/${dd}/${yyyy} ${hours}:${mins} ${ampm}`;

      // Scale font to image size, minimum 16px
      const fontSize = Math.max(16, Math.floor(img.width / 40));
      ctx.font = `bold ${fontSize}px Arial`;

      // Draw semi-opaque black background box in bottom-right corner
      const textWidth = ctx.measureText(stamp).width;
      const pad = fontSize * 0.4;
      const boxX = img.width - textWidth - pad * 3;
      const boxY = img.height - fontSize - pad * 3;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
      ctx.fillRect(boxX, boxY, textWidth + pad * 2, fontSize + pad * 2);

      // Draw white timestamp text
      ctx.fillStyle = '#FFFFFF';
      ctx.textBaseline = 'top';
      ctx.fillText(stamp, boxX + pad, boxY + pad);

      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => {
      resolve(base64OrDataUrl);
    };
    img.src = base64OrDataUrl;
  });
};

interface CameraCaptureProps {
  onCapture: (photoUrl: string) => void;
  label?: string;
  className?: string;
  networkUrl?: string; // Swann Snapshot URL
  photoUrl?: string; // Existing photo URL
}

export const CameraCapture: React.FC<CameraCaptureProps> = ({ 
  onCapture, 
  label = "Take Photo", 
  className = "",
  networkUrl,
  photoUrl
}) => {
  const { settings } = useSettings();
  const [isStreaming, setIsStreaming] = useState(false);
  const [isPulling, setIsPulling] = useState(false);
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(photoUrl || null);

  React.useEffect(() => {
    setCapturedPhoto(photoUrl || null);
  }, [photoUrl]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Get list of available cameras based on brand
  const getAvailableNetworkCams = () => {
    if (settings.cameraBrand === 'reolink') {
      const channels = settings.reolinkChannels || [];
      const user = settings.reolinkUsername || 'admin';
      const pass = settings.reolinkPassword || '';
      let base = (settings.reolinkNvrIp || '').trim();
      if (base && !base.startsWith('http://') && !base.startsWith('https://')) {
        base = `http://${base}`;
      }

      return channels
        .filter(ch => ch.isEnabled)
        .map(ch => {
          const url = base ? `${base}/cgi-bin/api.cgi?cmd=Snap&channel=${ch.channel}&user=${user}&password=${pass}` : '';
          return {
            id: ch.id,
            name: ch.name,
            url: url
          };
        });
    } else {
      const list = [];
      if (settings.swannCams.material) list.push({ id: 'material', name: 'Material Station Cam', url: settings.swannCams.material });
      if (settings.swannCams.customer) list.push({ id: 'customer', name: 'Customer Face Cam', url: settings.swannCams.customer });
      if (settings.swannCams.entrance) list.push({ id: 'entrance', name: 'Entrance/Vehicle Cam', url: settings.swannCams.entrance });
      return list;
    }
  };

  const availableCams = getAvailableNetworkCams();

  const getInitialCamIndex = () => {
    const lbl = label.toLowerCase();
    if (lbl.includes('entrance') || lbl.includes('vehicle')) {
      const idx = availableCams.findIndex(c => c.id === 'entrance' || c.name.toLowerCase().includes('entrance') || c.name.toLowerCase().includes('vehicle'));
      if (idx !== -1) return idx;
    }
    if (lbl.includes('customer') || lbl.includes('face') || lbl.includes('id ') || lbl.includes('document')) {
      const idx = availableCams.findIndex(c => c.id === 'customer' || c.name.toLowerCase().includes('customer') || c.name.toLowerCase().includes('face') || c.name.toLowerCase().includes('id'));
      if (idx !== -1) return idx;
    }
    if (lbl.includes('material') || lbl.includes('scale')) {
      const idx = availableCams.findIndex(c => c.id === 'material' || c.name.toLowerCase().includes('scale') || c.name.toLowerCase().includes('material'));
      if (idx !== -1) return idx;
    }
    if (networkUrl) {
      const idx = availableCams.findIndex(c => c.url === networkUrl);
      if (idx !== -1) return idx;
    }
    return 0;
  };

  const [selectedCamIdx, setSelectedCamIdx] = useState(() => getInitialCamIndex());

  const pullFromNetworkUrl = async (url: string) => {
    if (!url) return;
    setIsPulling(true);
    try {
      const connectionMode = settings.cameraConnectionMode || 'direct';
      const actualFetchUrl = connectionMode === 'proxy' 
        ? `/api/camera-proxy?url=${encodeURIComponent(url)}`
        : url;

      const cacheBustUrl = `${actualFetchUrl}${actualFetchUrl.includes('?') ? '&' : '?'}_t=${Date.now()}`;
      const response = await fetch(cacheBustUrl);
      
      if (!response.ok) {
        if (connectionMode === 'proxy') {
          let errorDetail = 'Proxy failed to connect to camera.';
          try {
            const errData = await response.json();
            errorDetail = errData.detail || errData.error || errorDetail;
            if (errData.solution) {
              errorDetail += `\n\nSolution: ${errData.solution}`;
            }
          } catch (_) {}
          throw new Error(errorDetail);
        } else {
          throw new Error("HTTP connection failed. NVR might be offline or blocked.");
        }
      }
      
      const blob = await response.blob();
      const reader = new FileReader();
      reader.onloadend = async () => {
        const base64data = reader.result as string;
        const stamped = await stampImage(base64data);
        setCapturedPhoto(stamped);
        onCapture(stamped);
      };
      reader.readAsDataURL(blob);
    } catch (err: any) {
      console.error("Network Camera Error:", err);
      const isProxy = settings.cameraConnectionMode === 'proxy';
      if (isProxy) {
        alert(`Cloud Camera Proxy failed:\n${err.message || 'Unknown network error'}\n\nCheck your router settings or credentials.`);
      } else {
        alert("Camera connection blocked. Your browser blocks direct unencrypted HTTP connections inside an HTTPS website.\n\nTo resolve this:\n1. Open your camera settings and switch 'Camera Connection Mode' to 'Cloud Proxy Mode' (highly recommended for remote/cloud access).\n2. Alternatively, configure your browser's site settings to allow 'Insecure Content' for this application (click the lock icon in Chrome/Edge/Brave's address bar).");
      }
    } finally {
      setIsPulling(false);
    }
  };

  const startStream = async () => {
    setIsStreaming(true);
    setCapturedPhoto(null);
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Camera API not supported");
      }

      let stream: MediaStream;
      try {
        // Try preferred front camera
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'user',
            width: { ideal: 640 },
            height: { ideal: 480 }
          }
        });
      } catch (e) {
        console.warn("Preferred camera facingMode 'user' not found, trying any available camera.");
        try {
          // Try any camera with ideal resolution
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              width: { ideal: 640 },
              height: { ideal: 480 }
            }
          });
        } catch (e2) {
          // Final fallback: any video device at all
          stream = await navigator.mediaDevices.getUserMedia({
            video: true
          });
        }
      }

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch (err) {
      if (err instanceof Error && (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError')) {
        console.warn("No camera device found, using placeholder photo.");
      } else {
        console.error("Camera error:", err);
      }
      setIsStreaming(false);
      // Fallback
      onCapture(PHOTO_PLACEHOLDER_URL);
      setCapturedPhoto(PHOTO_PLACEHOLDER_URL);
    }
  };

  const capture = async () => {
    if (videoRef.current && canvasRef.current) {
      const context = canvasRef.current.getContext('2d');
      if (context) {
        canvasRef.current.width = videoRef.current.videoWidth;
        canvasRef.current.height = videoRef.current.videoHeight;
        context.drawImage(videoRef.current, 0, 0);
        
        const dataUrl = canvasRef.current.toDataURL('image/jpeg', 0.6);
        const stamped = await stampImage(dataUrl);
        setCapturedPhoto(stamped);
        onCapture(stamped);
        
        stopStream();
      }
    }
  };

  const stopStream = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach(track => track.stop());
      videoRef.current.srcObject = null;
    }
    setIsStreaming(false);
  };

  return (
    <div className={`space-y-3 ${className}`}>
      {!isStreaming && !capturedPhoto && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={startStream}
            className="flex items-center justify-center gap-2 w-full py-4 border-2 border-dashed border-slate-200 rounded-2xl text-slate-500 font-bold hover:bg-slate-50 hover:border-blue-300 hover:text-blue-600 transition-all cursor-pointer"
          >
            <Camera className="w-5 h-5" />
            {label} (Local)
          </button>
          
          {settings.useSwannCams && availableCams.length > 0 && (
            <div className="p-3 bg-slate-900 text-white rounded-2xl space-y-2.5 shadow-lg border border-slate-800">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Network Camera Selection</span>
                {availableCams.length > 1 && (
                  <select
                    className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-[10px] font-bold text-white outline-none cursor-pointer max-w-[160px] truncate"
                    value={selectedCamIdx}
                    onChange={(e) => setSelectedCamIdx(parseInt(e.target.value) || 0)}
                  >
                    {availableCams.map((cam, idx) => (
                      <option key={cam.id} value={idx}>
                        {cam.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <button
                type="button"
                onClick={() => {
                  const activeCam = availableCams[selectedCamIdx];
                  if (activeCam && activeCam.url) {
                    pullFromNetworkUrl(activeCam.url);
                  }
                }}
                disabled={isPulling || !availableCams[selectedCamIdx]?.url}
                className="flex items-center justify-center gap-2 w-full py-3 bg-slate-950 hover:bg-black text-white rounded-xl font-bold transition-all border border-slate-800 active:scale-95 disabled:opacity-50 cursor-pointer"
              >
                {isPulling ? <Loader2 className="w-5 h-5 animate-spin" /> : <Video className="w-5 h-5 text-emerald-400" />}
                <span>
                  Pull from {availableCams[selectedCamIdx]?.name || 'Camera'}
                </span>
              </button>
            </div>
          )}

          {!settings.useSwannCams && networkUrl && (
            <button
              type="button"
              onClick={() => pullFromNetworkUrl(networkUrl)}
              disabled={isPulling}
              className="flex items-center justify-center gap-2 w-full py-4 bg-slate-900 text-white rounded-2xl font-bold hover:bg-slate-800 transition-all shadow-lg active:scale-95 disabled:opacity-50 cursor-pointer"
            >
              {isPulling ? <Loader2 className="w-5 h-5 animate-spin" /> : <Video className="w-5 h-5 text-emerald-400" />}
              Pull from Camera
            </button>
          )}
        </div>
      )}

      {isStreaming && (
        <div className="relative rounded-2xl overflow-hidden bg-slate-900 aspect-video shadow-xl border border-slate-800">
          <video
            ref={videoRef}
            className="w-full h-full object-cover"
            playsInline
            muted
          />
          <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-3 px-4">
            <button
              type="button"
              onClick={capture}
              className="bg-blue-600 text-white px-6 py-2 rounded-full font-bold shadow-lg hover:bg-blue-700 active:scale-95 transition-all flex items-center gap-2"
            >
              <Camera className="w-4 h-4" />
              Capture
            </button>
            <button
              type="button"
              onClick={stopStream}
              className="bg-white/20 backdrop-blur-md text-white px-4 py-2 rounded-full font-bold hover:bg-white/30 transition-all"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {capturedPhoto && (
        <div className="relative rounded-2xl overflow-hidden bg-slate-100 aspect-video border border-slate-200 group">
          <img
            src={capturedPhoto}
            alt="Captured"
            className="w-full h-full object-cover"
            referrerPolicy="no-referrer"
          />
          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={startStream}
              className="bg-white text-slate-900 p-2 rounded-full hover:bg-blue-50 transition-colors"
              title="Retake"
            >
              <RefreshCw className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={() => {
                setCapturedPhoto(null);
                onCapture("");
              }}
              className="bg-white text-red-600 p-2 rounded-full hover:bg-red-50 transition-colors"
              title="Remove"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}

      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
};
