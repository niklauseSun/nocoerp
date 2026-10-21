import type { AssetValues } from './model.js';
// Session-scoped in-memory drafts survive in-app navigation without writing private data to localStorage.
export const assetDrafts = new Map<
  string,
  { values: AssetValues & { reason: string }; version?: number }
>();
export const fileDrafts = new Map<
  string,
  {
    title: string;
    category: string;
    uploadedIds?: string[];
    uploadIds?: string[];
  }
>();
export const bindingDrafts = new Map<
  string,
  {
    assetId: string;
    start: string;
    end: string;
    area: string;
    reason: string;
    requestId: string;
  }
>();
