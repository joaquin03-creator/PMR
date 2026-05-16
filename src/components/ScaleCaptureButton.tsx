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
  const [isCapturing, setIsCapturing] = useState(false);
  const [isNetworkPull, setIsNetworkPull] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const pullFromSwann = async () => {
    if (!settings.swannCams.material) return;
    setIsNetworkPull(true);
    try {
      const cacheBustUrl = `${settings.swannCams.material}${settings.swannCams.material.includes('?') ? '&' : '?'}_t=${Date.now()}`;
      const response = await fetch(cacheBustUrl);
      if (!response.ok) throw new Error("Failed to pull from material cam");
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
      console.error("Swann Material Cam Error:", err);
      // Fallback to local if network fails
      startCapture();
    }
  };

  const startCapture = async () => {
    if (settings.useSwannCams && settings.swannCams.material) {
      await pullFromSwann();
      return;
    }

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
            : settings.useSwannCams && settings.swannCams.material
              ? 'bg-slate-900 text-white border-slate-800 hover:bg-black hover:shadow-md'
              : 'bg-blue-600 text-white border-blue-700 hover:bg-blue-700 hover:shadow-md'
        )}
      >
        {active ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>{isNetworkPull ? 'Accessing Swann Cam...' : 'Stabilizing...'}</span>
          </>
        ) : (
          <>
            <div className="flex -space-x-1 items-center">
              <Scale className="w-4 h-4" />
              {settings.useSwannCams && settings.swannCams.material ? (
                <Video className="w-4 h-4 text-emerald-400" />
              ) : (
                <Camera className="w-4 h-4" />
              )}
            </div>
            <span>{settings.useSwannCams && settings.swannCams.material ? 'Sync Swann & Scale' : 'Weight & Photo'}</span>
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
