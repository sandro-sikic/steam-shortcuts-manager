import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { installDemoBridge } from './demoBridge.js';
import './styles.css';

// Plain browser (npm run ui:dev): there is no Electron preload, so use example data.
if (!window.steamManager) installDemoBridge();

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
