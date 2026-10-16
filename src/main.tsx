import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { Providers } from './app/providers';
import { router } from './app/router';
import { useUIStore } from './shared/lib/ui-store';
import './styles/globals.css';
import './styles/layout.css';
document.documentElement.dataset.theme = useUIStore.getState().theme;
async function start() {
  if (import.meta.env.VITE_ENABLE_MOCK !== 'false') {
    const { worker } = await import('./mocks/browser');
    await worker.start({
      onUnhandledRequest: 'bypass',
      serviceWorker: { url: '/mockServiceWorker.js' },
    });
  }
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <Providers>
        <RouterProvider router={router} />
      </Providers>
    </React.StrictMode>,
  );
}
void start().catch((error) => {
  console.error(error);
  document.getElementById('root')!.textContent = '启动失败，请检查网络后刷新页面。';
});
