import React, { Profiler } from 'react';
import ReactDOM from 'react-dom/client';
import { Provider } from 'react-redux';
import { BrowserRouter } from 'react-router-dom';
import { store } from './app/store';
import App from './App';
import './index.css';
import './api/registerEndpoints';
import { initializeSavedData, startSavedDataSync } from './offline/savedData';
import { registerOfflineShell } from './offline/shell';
import { diagnosticsEnabled, markPerformance, recordRender } from './diagnostics/performance';

markPerformance('boot:start');

async function startApp() {
  const root = ReactDOM.createRoot(document.getElementById('root'));
  const app = (
    <React.StrictMode>
      <Provider store={store}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </Provider>
    </React.StrictMode>
  );
  root.render(import.meta.env.DEV && diagnosticsEnabled()
    ? <Profiler id="App" onRender={(id, phase, duration) => recordRender(id, phase, duration)}>{app}</Profiler>
    : app);
  requestAnimationFrame(() => markPerformance('shell:first-frame'));
  startSavedDataSync(store);
  registerOfflineShell(store);
  void initializeSavedData(store).finally(() => markPerformance('hydration:complete'));
}
void startApp();
