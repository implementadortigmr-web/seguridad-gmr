import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { FeedbackProvider } from './context/FeedbackContext.jsx';
import './index.css';

window.addEventListener('error', (event) => {
  console.error('Error global:', event.error || event.message);
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('Promesa rechazada:', event.reason);
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <FeedbackProvider>
      <HashRouter>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </HashRouter>
    </FeedbackProvider>
  </StrictMode>
);
