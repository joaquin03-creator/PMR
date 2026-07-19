import { createRoot, Root } from 'react-dom/client';
import { ReactElement } from 'react';
import React from 'react';
import { SettingsProvider } from '../context/SettingsContext';

let activePrintRoot: Root | null = null;
let cleanupTimeoutId: any = null;

export function printTicket(element: ReactElement, options?: { format?: 'letter' | 'thermal', thermalWidth?: '80mm' | '58mm', debugMode?: boolean }): Promise<void> {
  return new Promise((resolve) => {
    const container = document.getElementById('print-root')!;
    
    // Clear any pending cleanup timeout
    if (cleanupTimeoutId) {
      clearTimeout(cleanupTimeoutId);
      cleanupTimeoutId = null;
    }

    // Clean up previous print style tag if it exists
    const existingStyle = document.getElementById('thermal-print-styles');
    if (existingStyle) {
      try {
        existingStyle.remove();
      } catch (e) {
        console.error('Error removing existing style tag', e);
      }
    }

    if (activePrintRoot) {
      try {
        activePrintRoot.unmount();
      } catch (e) {
        console.error('Error unmounting dynamic print root', e);
      }
      activePrintRoot = null;
    }
    
    // Resolve thermal width from options or localStorage
    let activeWidth = options?.thermalWidth;
    if (!activeWidth && options?.format === 'thermal') {
      try {
        const stored = localStorage.getItem('preferred_metals_settings');
        if (stored) {
          const parsed = JSON.parse(stored);
          if (parsed.thermalWidth) {
            activeWidth = parsed.thermalWidth;
          }
        }
      } catch (e) {
        console.error('Error reading thermalWidth from localStorage settings', e);
      }
    }
    if (!activeWidth) {
      activeWidth = '80mm'; // Default fallback
    }
    
    // Create and inject custom style for thermal printing if needed
    let styleTag: HTMLStyleElement | null = null;
    if (options?.format === 'thermal') {
      styleTag = document.createElement('style');
      styleTag.id = 'thermal-print-styles';
      styleTag.innerHTML = `
        @media print {
          @page { size: ${activeWidth} auto !important; margin: 0 !important; }
          html, body { width: ${activeWidth} !important; margin: 0 !important; padding: 0 !important; }
        }
      `;
      document.head.appendChild(styleTag);
    }
    
    document.body.classList.add('printing-via-print-root');
    
    activePrintRoot = createRoot(container);
    activePrintRoot.render(React.createElement(SettingsProvider, null, element));
    
    // We use a robust combination of requestAnimationFrame and a small setTimeout
    // to guarantee React 18 finishes asynchronously rendering and committing to the DOM,
    // and the browser fully paints the layout before window.print() freezes the thread.
    setTimeout(() => {
      if (options?.debugMode) {
        console.log('DEBUG PRINT: window.print() and auto-cleanup bypassed. Print root will stay visible.');
        resolve();
        return;
      }

      window.print();
      resolve();

      // Defer DOM cleanup and React unmount to a very long 45-second timeout.
      // This guarantees that even if the print dialogue blocks JS, or if it runs
      // asynchronously in background tabs/iframes, the print engine has infinite
      // time to read the DOM tree. Since #print-root is display: none !important
      // on screen, this has zero visual impact to the active user!
      cleanupTimeoutId = setTimeout(() => {
        document.body.classList.remove('printing-via-print-root');
        if (activePrintRoot) {
          try {
            activePrintRoot.unmount();
          } catch (e) {
            console.error('Error unmounting print root', e);
          }
          activePrintRoot = null;
        }
        if (styleTag && document.head.contains(styleTag)) {
          try {
            document.head.removeChild(styleTag);
          } catch (e) {
            console.error('Error removing thermal style tag', e);
          }
        }
        container.innerHTML = '';
      }, 45000);
    }, 350);
  });
}

