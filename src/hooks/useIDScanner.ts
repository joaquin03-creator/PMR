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

export interface ParsedDLData {
  name: string;
  idNumber: string;
  address: string;
  idType: string;
  idExpiration: string;
}

export function parseAAMVABarcode(raw: string): ParsedDLData | null {
  if (!raw) return null;
  
  const cleanRaw = raw.trim();
  
  // AAMVA typically contains "DL", "DAQ", or starts with "@" / "ANSI "
  if (!cleanRaw.includes("DAQ") && !cleanRaw.includes("DL") && !cleanRaw.includes("ANSI") && !cleanRaw.includes("@")) {
    // Fallback for raw 1D barcodes or manual input of just an ID number
    const cleanId = cleanRaw.replace(/[^A-Za-z0-9]/g, '');
    if (cleanId.length >= 3 && cleanId.length <= 30) {
      return {
        name: 'Unknown Customer',
        idNumber: cleanId.toUpperCase(),
        address: '',
        idType: "Driver's License",
        idExpiration: ''
      };
    }
    return null;
  }

  const result: Record<string, string> = {};
  
  const prefixes = [
    { key: 'firstName', code: 'DAC' },
    { key: 'lastName', code: 'DCS' },
    { key: 'lastNameAlt', code: 'DAB' },
    { key: 'middleName', code: 'DAD' },
    { key: 'fullName', code: 'DAA' },
    { key: 'idNumber', code: 'DAQ' },
    { key: 'address1', code: 'DAG' },
    { key: 'address2', code: 'DAH' },
    { key: 'city', code: 'DAI' },
    { key: 'state', code: 'DAJ' },
    { key: 'zip', code: 'DAK' },
    { key: 'expiration', code: 'DBA' },
    { key: 'dob', code: 'DBB' }
  ];

  // Robustly extract fields using lookahead on known standard prefixes.
  // This is highly resilient to lack of newlines or carriage returns (e.g. if stripped by browser single-line inputs).
  const codesPattern = '(?:DAA|DAB|DAC|DAD|DAG|DAH|DAI|DAJ|DAK|DBA|DBB|DBC|DBD|DCS|DCG|DCD|DDF|DDE|DDK|DAQ|DDG)';

  for (const item of prefixes) {
    const regex = new RegExp(`${item.code}([^\\r\\n\\t]*?)(?=(?:${codesPattern})|\\r|\\n|\\t|$)`);
    const match = cleanRaw.match(regex);
    if (match && match[1]) {
      const val = match[1].trim();
      if (val) {
        result[item.key] = val;
      }
    }
  }

  // Fallback to line-by-line parsing if some key elements are missing
  if (!result.idNumber || (!result.firstName && !result.fullName)) {
    const lines = cleanRaw.split(/[\r\n\t]+/);
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine) continue;
      
      for (const item of prefixes) {
        if (!result[item.key]) {
          if (trimmedLine.startsWith(item.code)) {
            const val = trimmedLine.substring(item.code.length).trim();
            if (val) {
              result[item.key] = val;
            }
          } else {
            const regex = new RegExp(`(?:^|[^A-Z])${item.code}([^\\r\\n\\t]+)`, 'g');
            let match;
            while ((match = regex.exec(trimmedLine)) !== null) {
              const val = match[1].trim();
              if (val) {
                result[item.key] = val;
              }
            }
          }
        }
      }
    }

    for (const item of prefixes) {
      if (!result[item.key]) {
        const regex = new RegExp(`${item.code}([^a-z\\r\\n\\t\\f\\v]{2,100}?)(?=[A-Z]{3}[A-Z0-9]|$)`);
        const match = cleanRaw.match(regex);
        if (match && match[1]) {
          const val = match[1].trim();
          result[item.key] = val;
        }
      }
    }
  }

  let parsedName = '';
  if (result.fullName) {
    parsedName = result.fullName;
  } else {
    const first = result.firstName || '';
    const middle = result.middleName ? ` ${result.middleName}` : '';
    const last = result.lastName || result.lastNameAlt || '';
    parsedName = `${first}${middle} ${last}`.trim().replace(/\s+/g, ' ');
  }

  if (parsedName.includes(',')) {
    const parts = parsedName.split(',');
    if (parts.length >= 2) {
      const last = parts[0].trim();
      const firstAndMiddle = parts[1].trim();
      parsedName = `${firstAndMiddle} ${last}`.trim();
    }
  }

  parsedName = parsedName.replace(/[^A-Za-z0-9\s,\.-]/g, '').trim();

  let parsedIdNumber = result.idNumber || '';
  parsedIdNumber = parsedIdNumber.replace(/[^A-Za-z0-9]/g, '').toUpperCase();

  let parsedAddress = '';
  if (result.address1) {
    const ad1 = result.address1;
    const ad2 = result.address2 ? ` ${result.address2}` : '';
    const city = result.city ? `, ${result.city}` : '';
    const state = result.state ? `, ${result.state}` : '';
    const zip = result.zip ? ` ${result.zip}` : '';
    parsedAddress = `${ad1}${ad2}${city}${state}${zip}`.replace(/[^A-Za-z0-9\s,\.-]/g, '').trim();
  }

  let parsedExpiration = '';
  if (result.expiration) {
    const rawExp = result.expiration.replace(/[^0-9]/g, '');
    if (rawExp.length === 8) {
      const part1 = parseInt(rawExp.substring(0, 4));
      if (part1 > 1900 && part1 < 2100) {
        parsedExpiration = `${rawExp.substring(0, 4)}-${rawExp.substring(4, 6)}-${rawExp.substring(6, 8)}`;
      } else {
        parsedExpiration = `${rawExp.substring(4, 8)}-${rawExp.substring(0, 2)}-${rawExp.substring(2, 4)}`;
      }
    } else if (rawExp.length === 6) {
      const yy = parseInt(rawExp.substring(0, 2));
      const year = yy > 50 ? `19${yy}` : `20${yy}`;
      parsedExpiration = `${year}-${rawExp.substring(2, 4)}-${rawExp.substring(4, 6)}`;
    }
  }

  if (!parsedIdNumber && !parsedName) {
    return null;
  }

  return {
    name: parsedName || 'Unknown Customer',
    idNumber: parsedIdNumber,
    address: parsedAddress,
    idType: "Driver's License",
    idExpiration: parsedExpiration
  };
}
