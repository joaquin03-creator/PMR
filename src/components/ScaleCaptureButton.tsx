import React, { useState, useRef } from 'react';
import { Scale, Camera, Video, Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { useSettings } from '../context/SettingsContext';
import { PHOTO_PLACEHOLDER_URL } from '../constants';

interface ScaleCaptureButtonProps {
  onCapture: (weight: number, photoUrl: string) => void;
}

export const ScaleCaptureButton: React.FC<ScaleCaptureButtonProps> = ({ onCapture }) => {
  const { settings } = useSettings();
  const brandLabel = settings.cameraBrand === 'reolink' ? 'Reolink' : settings.cameraBrand === 'swann' ? 'Swann' : 'Network';
  const [isCapturing, setIsCapturing] = useState(false);
  const [isNetworkPull, setIsNetworkPull] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const getCameraUrl = () => {
    if (settings.cameraBrand === 'reolink') {
      const nvrIp = settings.reolinkNvrIp || '';
      const user = settings.reolinkUsername || 'admin';
      const pass = settings.reolinkPassword || '';
      
      const channels = settings.reolinkChannels || [];
      const scaleCam = channels.find(ch => ch.isEnabled && (ch.id === 'cam1' || ch.id === 'material' || ch.channel === 0 || ch.name.toLowerCase().includes('scale') || ch.name.toLowerCase().includes('material')));
      
      const channelNum = scaleCam ? scaleCam.channel : 0;
      let base = nvrIp.trim();
      if (!base) return '';
      if (!base.startsWith('http://') && !base.startsWith('https://')) {
        base = `http://${base}`;
      }
      return `${base}/cgi-bin/api.cgi?cmd=Snap&channel=${channelNum}&user=${user}&password=${pass}`;
    }
    return settings.swannCams.material;
  };

  const pullFromCameraUrl = async (cameraUrl: string) => {
    setIsNetworkPull(true);
    try {
      const connectionMode = settings.cameraConnectionMode || 'direct';
      const actualFetchUrl = connectionMode === 'proxy' 
        ? `/api/camera-proxy?url=${encodeURIComponent(cameraUrl)}`
        : cameraUrl;

      const cacheBustUrl = `${actualFetchUrl}${actualFetchUrl.includes('?') ? '&' : '?'}_t=${Date.now()}`;
      const response = await fetch(cacheBustUrl);
      if (!response.ok) throw new Error("Failed to pull from camera");
      const blob = await response.blob();
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64data = reader.result as string;
        // Simulate scale weight reading
        const mockWeight = Math.floor(Math.random() * 800) + 100;
        onCapture(mockWeight, base64data);
        setIsNetworkPull(false);
      };
      reader.readAsDataURL(blob);
    } catch (err) {
      console.error("Network Camera Error:", err);
      // Fallback to local if network fails
      await startCaptureWithUrl(cameraUrl);
    }
  };

  const startCapture = async () => {
    const cameraUrl = getCameraUrl();
    if (settings.useSwannCams && cameraUrl) {
      await pullFromCameraUrl(cameraUrl);
      return;
    }
    await startCaptureWithUrl(cameraUrl);
  };

  const startCaptureWithUrl = async (cameraUrl?: string) => {

    setIsCapturing(true);
    try {
      // Check if mediaDevices API is available
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Camera API not supported");
      }

      let stream: MediaStream;
      try {
        // Try environment camera first (rear)
        stream = await navigator.mediaDevices.getUserMedia({ 
          video: { 
            facingMode: 'environment',
            width: { ideal: 640 },
            height: { ideal: 480 }
          } 
        });
      } catch (e) {
        console.warn("Preferred camera facingMode 'environment' not found, trying 'user' or any available.");
        try {
          // Try front camera
          stream = await navigator.mediaDevices.getUserMedia({ 
            video: { 
              facingMode: 'user',
              width: { ideal: 640 },
              height: { ideal: 480 }
            } 
          });
        } catch (e2) {
          try {
            // Try any camera with ideal resolution
            stream = await navigator.mediaDevices.getUserMedia({ 
              video: {
                width: { ideal: 640 },
                height: { ideal: 480 }
              }
            });
          } catch (e3) {
            // Final fallback: any video device at all
            stream = await navigator.mediaDevices.getUserMedia({ 
              video: true 
            });
          }
        }
      }
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      // Simulate scale stabilization delay (1.5 seconds)
      setTimeout(() => {
        capture();
      }, 1500);
    } catch (err) {
      // If camera fails, we still want to pull the weight
      // but we'll use a placeholder for the photo
      const mockWeight = Math.floor(Math.random() * 800) + 100;
      onCapture(mockWeight, PHOTO_PLACEHOLDER_URL);
      setIsCapturing(false);
      
      // Log a more helpful warning instead of an error if it's a device issue
      if (err instanceof Error && (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError')) {
        console.warn("No camera device found, using placeholder photo.");
      } else {
        console.error("Camera error:", err);
      }
    }
  };

  const capture = () => {
    if (videoRef.current && canvasRef.current) {
      const context = canvasRef.current.getContext('2d');
      if (context) {
        canvasRef.current.width = videoRef.current.videoWidth;
        canvasRef.current.height = videoRef.current.videoHeight;
        context.drawImage(videoRef.current, 0, 0);
        
        // Capture as a small, low-quality JPEG to keep payload manageable
        // In a real production app, this would be uploaded to Firebase Storage
        const dataUrl = canvasRef.current.toDataURL('image/jpeg', 0.4);
        
        // Stop all tracks to release camera
        const stream = videoRef.current.srcObject as MediaStream;
        if (stream) {
          stream.getTracks().forEach(track => track.stop());
        }

        // Simulate scale weight reading
        const mockWeight = Math.floor(Math.random() * 800) + 100;
        onCapture(mockWeight, dataUrl);
      }
    }
    setIsCapturing(false);
  };

  const active = isCapturing || isNetworkPull;

  return (
    <div className="inline-block">
      <button
        type="button"
        onClick={startCapture}
        disabled={active}
        className={cn(
          "flex items-center gap-2 px-5 py-3.5 rounded-2xl font-black text-xs uppercase tracking-wider transition-all shadow-sm border active:scale-95",
          active 
            ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed' 
            : settings.useSwannCams && getCameraUrl()
              ? 'bg-slate-900 text-white border-slate-800 hover:bg-black hover:shadow-md'
              : 'bg-blue-600 text-white border-blue-700 hover:bg-blue-700 hover:shadow-md'
        )}
      >
        {active ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>{isNetworkPull ? `Accessing ${brandLabel} Cam...` : 'Stabilizing...'}</span>
          </>
        ) : (
          <>
            <div className="flex -space-x-1 items-center">
              <Scale className="w-4 h-4" />
              {settings.useSwannCams && getCameraUrl() ? (
                <Video className="w-4 h-4 text-emerald-400" />
              ) : (
                <Camera className="w-4 h-4" />
              )}
            </div>
            <span>{settings.useSwannCams && getCameraUrl() ? `Sync ${brandLabel} & Scale` : 'Weight & Photo'}</span>
          </>
        )}
      </button>

      {/* Hidden elements for capture process */}
      <video 
        ref={videoRef} 
        className="hidden" 
        playsInline 
        muted 
      />
      <canvas 
        ref={canvasRef} 
        className="hidden" 
      />
    </div>
  );
};
