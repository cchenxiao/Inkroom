import { setupWorker } from 'msw/browser';
import { handlers, enablePersistence } from './handlers';
enablePersistence();
export const worker = setupWorker(...handlers);
