import React from 'react';
import ReactDOM from 'react-dom/client';
import { setUseCaseEnv } from '@omega-harness/usecase-kit';
import App from './App.js';
import './index.css';

// The one place the plugin contract is handed something the host owns.
//
// A use-case shell repoints its backend with `VITE_UC_<ID>_URL`, and the kit
// resolves that out of an env bag it cannot read for itself: it ships as
// pre-built `dist/`, which Vite does not rewrite `import.meta.env` inside. So
// the substitution happens here, in app source, where it works. Resolution in
// the kit is lazy, so this lands before any shell's client makes a request even
// though the shells' modules evaluated during the import above.
setUseCaseEnv(import.meta.env);

const root = document.getElementById('root');
if (!root) {
  throw new Error('Root element not found');
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
