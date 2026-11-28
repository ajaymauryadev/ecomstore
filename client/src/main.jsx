import React from 'react';
import ReactDOM from 'react-dom/client';
import { Provider } from 'react-redux';
import { BrowserRouter } from 'react-router-dom';
import { store } from './app/store';
import App from './App';
import './index.css';
import './api/registerEndpoints';
import { initializeSavedData, startSavedDataSync } from './offline/savedData';
import StartupShell from './components/layout/StartupShell';
import { registerOfflineShell } from './offline/shell';

async function startApp() {
  const root = ReactDOM.createRoot(document.getElementById('root'));
  root.render(<StartupShell />);
  await initializeSavedData(store);
  startSavedDataSync(store);
  registerOfflineShell(store);
  root.render(
    <React.StrictMode>
      <Provider store={store}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </Provider>
    </React.StrictMode>
  );
}
void startApp();
