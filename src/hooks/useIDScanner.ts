import { useState, useCallback } from 'react';
import { useSettings } from '../context/SettingsContext';

export interface ScannedIDData {
  name?: string;
  idNumber?: string;
  idType?: string;
  idExpiration?: string;
  address?: string;
  photoUrl?: string; // Base64 or local URL from bridge
  success: boolean;
  error?: string;
}

export function useIDScanner() {
  const { settings } = useSettings();
  const [isScanning, setIsScanning] = useState(false);
  const [lastScan, setLastScan] = useState<ScannedIDData | null>(null);

  const scan = useCallback(async (): Promise<ScannedIDData> => {
    if (!settings.scannerEnabled || !settings.scannerBridgeUrl) {
      return { success: false, error: 'Scanner is not enabled in settings.' };
    }

    setIsScanning(true);
    try {
      // We attempt to fetch from the local scanner bridge
      // This is a generic implementation that supports common industrial scanner bridge patterns
      const response = await fetch(settings.scannerBridgeUrl, {
        method: 'GET', // Some bridges use POST, others GET. We try to be flexible.
        headers: { 'Accept': 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`Scanner bridge returned status ${response.status}`);
      }

      const data = await response.json();
      
      // Mapping common fields (Gemalto/WizzForms/etc often use these keys)
      const mappedData: ScannedIDData = {
        success: true,
        name: data.fullName || data.name || `${data.firstName || ''} ${data.lastName || ''}`.trim(),
        idNumber: data.idNumber || data.documentNumber || data.id,
        idType: data.idType || data.documentType || 'ID Card',
        idExpiration: data.expirationDate || data.expiryDate || data.idExpiration,
        address: data.address || data.fullAddress || `${data.street || ''}, ${data.city || ''}, ${data.state || ''} ${data.zip || ''}`.trim(),
        photoUrl: data.photo || data.image || data.photoUrl,
      };

      setLastScan(mappedData);
      return mappedData;
    } catch (error: any) {
      console.error('ID Scanner Error:', error);
      const errData = { 
        success: false, 
        error: error.message || 'Failed to communicate with scanner bridge. Ensure your Gemalto service is running locally.' 
      };
      setLastScan(errData);
      return errData;
    } finally {
      setIsScanning(false);
    }
  }, [settings.scannerEnabled, settings.scannerBridgeUrl]);

  return { scan, isScanning, lastScan };
}
