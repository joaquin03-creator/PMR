import React, { createContext, useContext, useEffect, useState } from 'react';

type Theme = 'light' | 'dark' | 'system';
type FontSize = 'small' | 'medium' | 'large' | 'xl';
type FontFamily = 'inter' | 'outfit' | 'mono';

interface AppSettings {
  theme: Theme;
  fontSize: FontSize;
  fontFamily: FontFamily;
  compactMode: boolean;
  autoPrint: boolean;
  debugPrintMode: boolean;
  scannerEnabled: boolean;
  scannerBridgeUrl: string;
  useSwannCams: boolean;
  companyLogo?: string;
  swannCams: {
    material: string;
    customer: string;
    entrance: string;
  };
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
  scannerEnabled: false,
  scannerBridgeUrl: 'http://localhost:16272/scan', // Common default port for some scan bridges
  useSwannCams: false,
  companyLogo: '',
  swannCams: {
    material: '',
    customer: '',
    entrance: '',
  },
};

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(() => {
    const saved = localStorage.getItem('app_settings');
    return saved ? { ...defaultSettings, ...JSON.parse(saved) } : defaultSettings;
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
