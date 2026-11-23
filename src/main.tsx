import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

// Canvas text uses the web font, so redraw the plots once it has loaded.
document.fonts?.ready.then(() => window.dispatchEvent(new Event('themechange')));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
