const fs = require('fs');
const content = fs.readFileSync('src/lib/utils.ts', 'utf8');

const replacement = `export async function compressImageToBase64(dataUrl: string, maxBytes: number): Promise<string> {
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
}`;

const startIndex = content.indexOf('export async function compressImageToBase64');
const newContent = content.slice(0, startIndex) + replacement;

fs.writeFileSync('src/lib/utils.ts', newContent);
console.log("Updated utils.ts");
