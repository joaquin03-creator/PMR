export const COMPANY_LOGO_URL = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1000 350'%3E%3Cg transform='translate(50, 50)'%3E%3Cpath d='M0 250 L125 0 L250 250 Z' fill='%23B87333' /%3E%3Cpath d='M50 210 L125 60 L200 210 Z' fill='%23ffffff' opacity='0.3'/%3E%3C/g%3E%3Cg transform='translate(350, 100)' font-family='Arial, sans-serif' fill='%2310213C'%3E%3Ctext font-size='40' font-weight='700' letter-spacing='6'%3EPREFERRED%3C/text%3E%3Ctext y='90' font-size='110' font-weight='900' letter-spacing='1'%3EMETALS%3C/text%3E%3Ctext y='160' font-size='35' font-weight='400' letter-spacing='16'%3E%26 RECYCLING%3C/text%3E%3C/g%3E%3C/svg%3E";
export const COMPANY_NAME = "Preferred Metals & Recycling";
export const COMPANY_ADDRESS = "Preferred Metals & Recycling, LLC";
export const COMPANY_PHONE = "";

export const PHOTO_PLACEHOLDER_URL = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='300' viewBox='0 0 400 300'%3E%3Crect width='400' height='300' fill='%23f8fafc'/%3E%3Cpath d='M200 110a30 30 0 1 0 0 60 30 30 0 0 0 0-60zm-80 90h160v-20l-40-40-40 40-40-40-40 40z' fill='%23e2e8f0'/%3E%3C/svg%3E";

export const handleImageError = (e: React.SyntheticEvent<HTMLImageElement, Event>) => {
  const target = e.currentTarget;
  if (target.src !== PHOTO_PLACEHOLDER_URL) {
    target.src = PHOTO_PLACEHOLDER_URL;
  }
};
export const COMPANY_EMAIL = "preferredmetalsrecycling@gmail.com";
export const COMPANY_WEBSITE = "www.preferredmetalsrecycling.com";
export const APP_VERSION = "1.0.0-rc2";
