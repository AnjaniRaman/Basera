import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { I18nProvider } from './app/i18n.jsx';
import { ThemeProvider } from './app/theme.jsx';
import { RouterProvider } from './app/router.jsx';
import { AppProvider } from './app/store.jsx';
import { UiProvider } from './ui/kit.jsx';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider>
      <I18nProvider>
        <RouterProvider>
          <AppProvider>
            <UiProvider>
              <App />
            </UiProvider>
          </AppProvider>
        </RouterProvider>
      </I18nProvider>
    </ThemeProvider>
  </StrictMode>
);
