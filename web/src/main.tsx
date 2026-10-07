import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/saira-stencil-one/400.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/600.css';
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
