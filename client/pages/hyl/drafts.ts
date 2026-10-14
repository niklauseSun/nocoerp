import type { Values } from './model.js';
// In-memory drafts survive in-app Back/navigation without persisting merchant banking data to browser storage.
export const drafts = new Map<string, { values: Values; version?: number }>();
