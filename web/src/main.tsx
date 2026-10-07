import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { loadFirebaseConfig } from './lib/firebase';
import { installAudioUnlock } from './audio/manager';

installAudioUnlock();

const root = createRoot(document.getElementById('root')!);

loadFirebaseConfig().finally(() => {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
