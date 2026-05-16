import React, { useState, useRef } from 'react';
import { Camera, RefreshCw, X, Video, Loader2 } from 'lucide-react';
import { PHOTO_PLACEHOLDER_URL } from '../constants';

interface CameraCaptureProps {
  onCapture: (photoUrl: string) => void;
  label?: string;
  className?: string;
  networkUrl?: string; // Swann Snapshot URL
}

export const CameraCapture: React.FC<CameraCaptureProps> = ({ 
  onCapture, 
  label = "Take Photo", 
  className = "",
  networkUrl 
}) => {
  const [isStreaming, setIsStreaming] = useState(false);
  const [isPulling, setIsPulling] = useState(false);
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const pullFromNetwork = async () => {
    if (!networkUrl) return;
    setIsPulling(true);
    try {
      // Use a timestamp to bust cache
      const cacheBustUrl = `${networkUrl}${networkUrl.includes('?') ? '&' : '?'}_t=${Date.now()}`;
      
      // We try to fetch the image. If the camera doesn't have CORS, this will fail.
      // But we can also try to use a proxy if needed.
      // For now, let's try direct fetch or a proxy if configured.
      const response = await fetch(cacheBustUrl);
      if (!response.ok) throw new Error("Failed to pull from camera");
      
      const blob = await response.blob();
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64data = reader.result as string;
        setCapturedPhoto(base64data);
        onCapture(base64data);
      };
      reader.readAsDataURL(blob);
    } catch (err) {
      console.error("Network Camera Error:", err);
      // Fallback: If fetch fails (likely CORS), we inform the user
      alert("Browser blocked direct capture from network camera (CORS). Ensure your camera permits cross-origin requests or use the standard camera capture.");
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

  const capture = () => {
    if (videoRef.current && canvasRef.current) {
      const context = canvasRef.current.getContext('2d');
      if (context) {
        canvasRef.current.width = videoRef.current.videoWidth;
        canvasRef.current.height = videoRef.current.videoHeight;
        context.drawImage(videoRef.current, 0, 0);
        
        const dataUrl = canvasRef.current.toDataURL('image/jpeg', 0.6);
        setCapturedPhoto(dataUrl);
        onCapture(dataUrl);
        
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
            className="flex items-center justify-center gap-2 w-full py-4 border-2 border-dashed border-slate-200 rounded-2xl text-slate-500 font-bold hover:bg-slate-50 hover:border-blue-300 hover:text-blue-600 transition-all"
          >
            <Camera className="w-5 h-5" />
            {label} (Local)
          </button>
          
          {networkUrl && (
            <button
              type="button"
              onClick={pullFromNetwork}
              disabled={isPulling}
              className="flex items-center justify-center gap-2 w-full py-4 bg-slate-900 text-white rounded-2xl font-bold hover:bg-slate-800 transition-all shadow-lg active:scale-95 disabled:opacity-50"
            >
              {isPulling ? <Loader2 className="w-5 h-5 animate-spin" /> : <Video className="w-5 h-5 text-emerald-400" />}
              Pull from Swann Camera (Network)
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
