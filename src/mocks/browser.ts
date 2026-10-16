import { enableLibraryPersistence } from './library/store';
import { setupWorker } from 'msw/browser';
import { handlers, enablePersistence } from './handlers';
enablePersistence();
enableLibraryPersistence();
export const worker = setupWorker(...handlers);
