import React from 'react';
import ReactDOM from 'react-dom/client';
import { Provider } from 'react-redux';
import { BrowserRouter } from 'react-router-dom';
import { store } from './app/store';
import App from './App';
import './index.css';
import './api/registerEndpoints';
import { initializeSavedData, startSavedDataSync } from './offline/savedData';
import { SavedDataGate } from './offline/SavedDataStatus';
import { registerOfflineShell } from './offline/shell';

async function startApp() {
  await initializeSavedData(store);
  startSavedDataSync(store);
  registerOfflineShell(store);
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <Provider store={store}>
        <BrowserRouter>
          <SavedDataGate><App /></SavedDataGate>
        </BrowserRouter>
      </Provider>
    </React.StrictMode>
  );
}
void startApp();
