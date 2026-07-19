import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Handle chunk load / dynamic import errors by auto-refreshing the page to get the latest build
window.addEventListener('error', (e) => {
  const errorMessage = e.message || '';
  if (
    errorMessage.includes('Failed to fetch dynamically imported module') ||
    errorMessage.includes('ChunkLoadError')
  ) {
    console.warn('Chunk load failed. A new deployment may be available. Auto-refreshing to the latest version...');
    window.location.reload();
  }
}, true); // Use capture phase to catch resource loading errors

window.addEventListener('unhandledrejection', (e) => {
  const reason = e.reason;
  const errorMsg = reason && (reason.message || String(reason));
  if (
    errorMsg && (
      errorMsg.includes('Failed to fetch dynamically imported module') ||
      errorMsg.includes('ChunkLoadError')
    )
  ) {
    console.warn('Unhandled chunk load failure. A new deployment may be available. Auto-refreshing to the latest version...');
    window.location.reload();
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
