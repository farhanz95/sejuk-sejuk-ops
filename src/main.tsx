import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AppStateProvider } from './state/AppState';
import { AuthProvider } from './state/AuthState';
import { registerSW } from 'virtual:pwa-register';
import './index.css';

// Service worker: precache the shell so the portal opens offline, and take
// updates immediately (a stale job sheet is worse than a tiny reload).
registerSW({ immediate: true });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <AppStateProvider>
          <App />
        </AppStateProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
