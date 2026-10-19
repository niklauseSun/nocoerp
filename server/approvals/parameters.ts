import {
  StoredLifecycleParameters,
  createRepositoryLifecycleStore,
} from '@nocobase/lifecycle';
import type { DatabaseManager } from '@nocobase/db';
import { parameterCollections } from './model.js';
const stores = new WeakMap<DatabaseManager, StoredLifecycleParameters>();
export function parameters(db: DatabaseManager) {
  let s = stores.get(db);
  if (!s) {
    s = new StoredLifecycleParameters(
      createRepositoryLifecycleStore(db, {
        collections: {
          transitions: 'hylTransitions',
          effectRuns: 'hylEffectRuns',
        },
      }),
      parameterCollections,
    );
    stores.set(db, s);
  }
  return s;
}
export const scope = (projectId: string, kind: string) =>
  projectId + ':' + kind;
