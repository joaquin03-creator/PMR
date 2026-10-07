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
/** PMR operates in Ohio: business clock time is always US Eastern, whatever the computer is set to. */
export const BUSINESS_TIME_ZONE = 'America/New_York';

/** Wall-clock parts of a moment in Eastern time (two-digit strings, 24-hour clock). */
export function getEasternDateParts(date: Date = new Date()): { year: string; month: string; day: string; hours: string; minutes: string; seconds: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  const get = (type: string) => parts.find(p => p.type === type)?.value || '00';
  return { year: get('year'), month: get('month'), day: get('day'), hours: get('hour'), minutes: get('minute'), seconds: get('second') };
}

/**
 * How many minutes this computer's clock setting differs from Eastern time right now
 * (0 = set correctly; -60 = set to Central). Used only to warn; nothing depends on it.
 */
export function getLocalOffsetFromEasternMinutes(date: Date = new Date()): number {
  const e = getEasternDateParts(date);
  const easternAsLocal = new Date(Number(e.year), Number(e.month) - 1, Number(e.day), Number(e.hours), Number(e.minutes), Number(e.seconds));
  const local = new Date(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds());
  return Math.round((local.getTime() - easternAsLocal.getTime()) / 60000);
}

export function generateTicketId(prefix: 'BUY' | 'TRIP'): string {
  // Eastern time, not the computer's own zone: a station set to Central used to stamp ids an hour early.
  const { year, month, day, hours, minutes, seconds } = getEasternDateParts(new Date());
  
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