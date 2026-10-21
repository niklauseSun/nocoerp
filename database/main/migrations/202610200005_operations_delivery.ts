import { defineMigration } from '@nocobase/db';
export default defineMigration({
  name: '202610200005_operations_delivery',
  async up({ builder }) {
    await builder.createCollection('hylSettlementBatches', c => {
      c.string('id', { length: 100, nullable: false }); c.primary('id');
      c.string('number', { length: 100, nullable: false }); c.unique('number');
      c.string('month', { length: 7, nullable: false });
      c.string('part', { length: 10, nullable: false });
      c.string('projectId', { length: 100, nullable: false });
      c.string('actor', { length: 100, nullable: false });
      c.string('leaseToken', { length: 100, nullable: false });
      c.string('leaseUntil', { length: 30, nullable: false });
      c.json('payload', { nullable: false });
      c.datetimeTz('createdAt', { nullable: false }); c.datetimeTz('updatedAt', { nullable: false });
    });
    await builder.createCollection('hylSettlementBatchItems', c => {
      c.string('id', { length: 100, nullable: false }); c.primary('id');
      c.string('batchId', { length: 100, nullable: false }); c.index('batchId');
      c.string('contractId', { length: 100, nullable: false });
      c.unique(['batchId', 'contractId']);
      c.string('settlementId', { length: 100, nullable: false });
      c.integer('version', { nullable: false });
      c.json('payload', { nullable: false });
      c.datetimeTz('updatedAt', { nullable: false });
    });
    await builder.createCollection('hylTenantServiceRecords', c => {
      c.string('id', { length: 100, nullable: false }); c.primary('id');
      c.string('number', { length: 100, nullable: false }); c.unique('number');
      c.string('merchantId', { length: 100, nullable: false }); c.index('merchantId');
      c.string('type', { length: 30, nullable: false });
      c.string('title', { length: 100, nullable: false });
      c.text('body', { nullable: false });
      c.string('start', { length: 10, nullable: false });
      c.string('dueDate', { length: 10, nullable: false });
      c.string('actor', { length: 100, nullable: false });
      c.string('status', { length: 30, nullable: false });
      c.integer('version', { nullable: false }); c.integer('lifecycleVersion', { nullable: false });
      c.datetimeTz('statusChangedAt', { nullable: false }); c.index(['status', 'statusChangedAt']);
      c.json('payload', { nullable: false });
      c.datetimeTz('createdAt', { nullable: false }); c.datetimeTz('updatedAt', { nullable: false });
    });
    await builder.createCollection('hylTenantServiceEvents', c => {
      c.string('id', { length: 100, nullable: false }); c.primary('id');
      c.string('recordId', { length: 100, nullable: false }); c.index('recordId');
      c.string('action', { length: 30, nullable: false });
      c.string('actor', { length: 100, nullable: false });
      c.json('payload', { nullable: false }); c.datetimeTz('createdAt', { nullable: false });
    });
  },
  async down({ builder }) {
    await builder.dropCollection('hylTenantServiceEvents');
    await builder.dropCollection('hylTenantServiceRecords');
    await builder.dropCollection('hylSettlementBatchItems');
    await builder.dropCollection('hylSettlementBatches');
  },
});
