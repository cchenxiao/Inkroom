import type { Finding } from './index';
/** Read-only projection of the exact assembly/review selected by the author. */
export interface ManuscriptInspection {
  title: string;
  parts: { id: string; title: string; segments: { id: string; text: string; version: number }[] }[];
  findings: Finding[];
  selectedFinding?: string;
}
