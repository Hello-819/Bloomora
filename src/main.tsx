import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AppStoreProvider } from './state/AppStore';
import { ErrorBoundary } from './ErrorBoundary';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <AppStoreProvider>
        <App />
      </AppStoreProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
