import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const getCustomerDataGaps = (customer: { idImageUrl?: string; photoUrl?: string } | null | undefined): string[] => {
  if (!customer) return [];
  const gaps: string[] = [];
  if (!customer.idImageUrl) gaps.push('ID photo');
  if (!customer.photoUrl) gaps.push('Seller photo');
  return gaps;
};

/**
 * Generates a ticket ID following a date/time scheme down to the second
 * e.g., BUY-20260605-033717
 */
export function generateTicketId(prefix: 'BUY' | 'TRIP'): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  
  // Keep length under 20 characters to comply with state XML constraints (Error 105)
  return `${prefix}-${year}${month}${day}-${hours}${minutes}${seconds}`;
}


export async function compressImageToBase64(dataUrl: string, maxBytes: number): Promise<string> {
  const isDataUrl = dataUrl.startsWith('data:');
  const base64Data = isDataUrl ? dataUrl.split(',')[1] : dataUrl;
  
  if (isDataUrl && base64Data && base64Data.length <= maxBytes) {
    return base64Data;
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      let width = img.width;
      let height = img.height;
      const MAX_SIZE = 1280;

      if (width > height && width > MAX_SIZE) {
        height *= MAX_SIZE / width;
        width = MAX_SIZE;
      } else if (height > MAX_SIZE) {
        width *= MAX_SIZE / height;
        height = MAX_SIZE;
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==');
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);

      let quality = 0.85;
      let compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
      let compressedBase64 = compressedDataUrl.split(',')[1];

      while (compressedBase64.length > maxBytes && quality > 0.1) {
        quality -= 0.1;
        compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
        compressedBase64 = compressedDataUrl.split(',')[1];
      }

      resolve(compressedBase64);
    };
    img.onerror = () => {
      resolve('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==');
    };
    img.src = dataUrl;
  });
}