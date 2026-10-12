// The real PMR logo, print version: copper mark + navy lettering on a transparent
// background (the website artwork sits on a dark navy panel, which would print as
// a solid block). Inlined so it prints offline and on a cold cache.
import companyLogoPrint from './assets/pmr-logo-print.png?inline';

export const COMPANY_LOGO_URL = companyLogoPrint;
export const COMPANY_NAME = "Preferred Metals & Recycling";
export const COMPANY_ADDRESS = "5619 Montgomery Rd.";
export const COMPANY_PHONE = "(513) 840-5274";

export const PHOTO_PLACEHOLDER_URL = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='300' viewBox='0 0 400 300'%3E%3Crect width='400' height='300' fill='%23f8fafc'/%3E%3Cpath d='M200 110a30 30 0 1 0 0 60 30 30 0 0 0 0-60zm-80 90h160v-20l-40-40-40 40-40-40-40 40z' fill='%23e2e8f0'/%3E%3C/svg%3E";

export const handleImageError = (e: React.SyntheticEvent<HTMLImageElement, Event>) => {
  const target = e.currentTarget;
  if (target.src !== PHOTO_PLACEHOLDER_URL) {
    target.src = PHOTO_PLACEHOLDER_URL;
  }
};
export const COMPANY_EMAIL = "tiffany@preferredmetalsrecycling.com";
export const COMPANY_WEBSITE = "www.preferredmetalsrecycling.com";
export const APP_VERSION = "1.0.0-rc2";
