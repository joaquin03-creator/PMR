import React from 'react';
import { useSettings } from '../context/SettingsContext';
import { COMPANY_LOGO_URL, COMPANY_NAME, handleImageError } from '../constants';
import { cn } from '../lib/utils';

interface BrandLogoProps {
  className?: string;
  grayscale?: boolean;
}

export function BrandLogo({ className, grayscale = false }: BrandLogoProps) {
  const { settings } = useSettings();
  
  const logoUrl = settings.companyLogo || COMPANY_LOGO_URL;

  return (
    <img 
      src={logoUrl} 
      alt={COMPANY_NAME} 
      className={cn(className, grayscale && "grayscale")}
      referrerPolicy="no-referrer"
      onError={handleImageError}
    />
  );
}

export function useBrandLogo() {
  const { settings } = useSettings();
  return settings.companyLogo || COMPANY_LOGO_URL;
}
