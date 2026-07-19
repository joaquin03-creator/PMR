import React, { createContext, useContext, useEffect, useState } from 'react';

type Theme = 'light' | 'dark' | 'system';
type FontSize = 'small' | 'medium' | 'large' | 'xl';
type FontFamily = 'inter' | 'outfit' | 'mono';

export interface NvrCamera {
  id: string;
  name: string;
  channel: number;
  isEnabled: boolean;
}

export interface AppSettings {
  theme: Theme;
  fontSize: FontSize;
  fontFamily: FontFamily;
  compactMode: boolean;
  autoPrint: boolean;
  debugPrintMode: boolean;
  receiptFormat: 'letter' | 'thermal';
  thermalWidth: '80mm' | '58mm';
  thermalFont: 'mono' | 'sans';
  thermalShowBarcode: boolean;
  thermalPrintDensity: 'compact' | 'normal';
  scannerEnabled: boolean;
  scannerBridgeUrl: string;
  useSwannCams: boolean;
  cameraConnectionMode?: 'direct' | 'proxy';
  companyLogo?: string;
  cameraBrand?: 'swann' | 'reolink' | 'universal';
  swannCams: {
    material: string;
    customer: string;
    entrance: string;
  };
  reolinkNvrIp?: string;
  reolinkUsername?: string;
  reolinkPassword?: string;
  reolinkChannels?: NvrCamera[];
  ohioScrapPortalUrl: string;
  ohioScrapUsername: string;
  ohioScrapPassword?: string;
  ohioScrapDealerId?: string;
}

interface SettingsContextType {
  settings: AppSettings;
  updateSettings: (newSettings: Partial<AppSettings>) => void;
  resetToDefaults: () => void;
}

const defaultSettings: AppSettings = {
  theme: 'light',
  fontSize: 'medium',
  fontFamily: 'inter',
  compactMode: false,
  autoPrint: true,
  debugPrintMode: false,
  receiptFormat: 'letter',
  thermalWidth: '80mm',
  thermalFont: 'mono',
  thermalShowBarcode: true,
  thermalPrintDensity: 'normal',
  scannerEnabled: false,
  scannerBridgeUrl: 'http://localhost:16272/scan', // Common default port for some scan bridges
  useSwannCams: false,
  cameraConnectionMode: 'direct',
  companyLogo: '',
  cameraBrand: 'swann',
  swannCams: {
    material: '',
    customer: '',
    entrance: '',
  },
  reolinkNvrIp: 'http://192.168.1.50:80',
  reolinkUsername: 'admin',
  reolinkPassword: '',
  reolinkChannels: [
    { id: 'cam1', name: 'Scale Cam (Ch 1)', channel: 0, isEnabled: true },
    { id: 'cam2', name: 'Customer Face Cam (Ch 2)', channel: 1, isEnabled: true },
    { id: 'cam3', name: 'Entrance/Vehicle Cam (Ch 3)', channel: 2, isEnabled: true },
    { id: 'cam4', name: 'Yard Cam (Ch 4)', channel: 3, isEnabled: true },
  ],
  ohioScrapPortalUrl: 'https://services.dps.ohio.gov/ScrapDealer/DoNotBuyList',
  ohioScrapUsername: 'preferredmetalsrecycling@gmail.com',
  ohioScrapPassword: '47301b0a2d61bdf1',
  ohioScrapDealerId: '',
};

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(() => {
    const saved = localStorage.getItem('app_settings');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Migrate legacy/registration URLs to the new direct DoNotBuyList address
        if (
          !parsed.ohioScrapPortalUrl || 
          parsed.ohioScrapPortalUrl === 'https://scrapmetal.dps.ohio.gov/' ||
          parsed.ohioScrapPortalUrl.includes('IdentityManager/Login/Index')
        ) {
          parsed.ohioScrapPortalUrl = 'https://services.dps.ohio.gov/ScrapDealer/DoNotBuyList';
        }

        // Fill in default credentials if they are currently blank in saved settings
        if (!parsed.ohioScrapUsername || parsed.ohioScrapUsername.trim() === '') {
          parsed.ohioScrapUsername = 'preferredmetalsrecycling@gmail.com';
        }
        if (!parsed.ohioScrapPassword || parsed.ohioScrapPassword.trim() === '') {
          parsed.ohioScrapPassword = '47301b0a2d61bdf1';
        }

        return { ...defaultSettings, ...parsed };
      } catch (err) {
        console.error('Failed to parse app_settings', err);
        return defaultSettings;
      }
    }
    return defaultSettings;
  });

  useEffect(() => {
    localStorage.setItem('app_settings', JSON.stringify(settings));
    
    // Apply theme
    const root = window.document.documentElement;
    const isDark = settings.theme === 'dark' || 
      (settings.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    
    if (isDark) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }

    // Apply font size
    const sizeMap = {
      small: '14px',
      medium: '16px',
      large: '18px',
      xl: '20px',
    };
    root.style.fontSize = sizeMap[settings.fontSize];

    // Apply font family
    const fontMap = {
      inter: '"Inter", sans-serif',
      outfit: '"Outfit", sans-serif',
      mono: '"JetBrains Mono", monospace',
    };
    root.style.setProperty('--font-sans', fontMap[settings.fontFamily]);
  }, [settings]);

  const updateSettings = (newSettings: Partial<AppSettings>) => {
    setSettings(prev => ({ ...prev, ...newSettings }));
  };

  const resetToDefaults = () => {
    setSettings(defaultSettings);
  };

  return (
    <SettingsContext.Provider value={{ settings, updateSettings, resetToDefaults }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (context === undefined) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
}
