import { contractLifecycle } from '../approvals/model.js';
import type { Row } from './schema.js';
import {
  createRepositoryLifecycleStore,
  LifecycleRuntime,
  type LifecycleStore,
} from '@nocobase/lifecycle';
import type {
  DatabaseManager,
  DatabaseConnection,
  RepositoryPolicy,
} from '@nocobase/db';
import { reportingLifecycle, settlementLifecycle } from './lifecycles.js';

/** Creation also applies this business action's read scope to the proposed row. The authorization adapter
 * treats raw database create as collection-level, so business creation must explicitly narrow it.
 * Lifecycle owns state; scoped Repository owns permission enforcement, in the same transaction. */
export function creationRuntime(
  db: DatabaseManager,
  collection: string,
  policy: RepositoryPolicy,
) {
  const wrap = (store: LifecycleStore): LifecycleStore => ({
    transactionHandle: store.transactionHandle,
    transaction: (work, options) =>
      store.transaction((tx) => work(wrap(tx)), options),
    afterCommit: (callback) => store.afterCommit(callback),
    findRecord: (...args) => store.findRecord(...args),
    async createRecord(target, values) {
      if (target !== collection || !store.transactionHandle)
        throw new Error('Invalid lifecycle creation scope');
      const connection = store.transactionHandle as DatabaseConnection;
      const { record } = await connection
        .repository<Row>(target)
        .withPolicy(policy)
        .narrow({
          create:
            policy.read === false
              ? false
              : policy.read === true
                ? true
                : { scope: policy.read.scope },
        })
        .createOne({ values: values });
      if (!record.id) throw new Error('Created record lacks its identifier');
      return Object.freeze({
        ...Object.fromEntries(
          Object.entries(record).map(([key, value]) => [
            key,
            value instanceof Date ? value.toISOString() : value,
          ]),
        ),
        id: record.id,
      });
    },
    updateRecordIf: (...args) => store.updateRecordIf(...args),
    findIdleRecords: (...args) => store.findIdleRecords(...args),
    appendTransition: (...args) => store.appendTransition(...args),
    findTransition: (...args) => store.findTransition(...args),
    findTransitionByRequest: (...args) =>
      store.findTransitionByRequest(...args),
    listTransitions: (...args) => store.listTransitions(...args),
    createEffectRun: (...args) => store.createEffectRun(...args),
    findEffectRun: (...args) => store.findEffectRun(...args),
    updateEffectRun: (...args) => store.updateEffectRun(...args),
    listEffectRuns: (...args) => store.listEffectRuns(...args),
    deleteEffectRuns: (...args) => store.deleteEffectRuns(...args),
  });
  const runtime = new LifecycleRuntime({
    store: wrap(
      createRepositoryLifecycleStore(db, {
        collections: {
          transitions: 'hylTransitions',
          effectRuns: 'hylEffectRuns',
        },
      }),
    ),
  });
  runtime.register(
    collection === 'hylContracts'
      ? contractLifecycle
      : collection === 'hylSettlements'
        ? settlementLifecycle
        : reportingLifecycle(collection),
  );
  return runtime;
}
