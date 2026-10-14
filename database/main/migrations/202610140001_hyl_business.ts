import { defineMigration } from '@nocobase/db';

export default defineMigration({
 name: '202610140001_hyl_business',
 async up({ builder }) {
  await builder.createCollection('hylMerchants', (c) => {
   c.string('id', { length: 100, nullable: false }); c.primary('id');
   c.string('number', { length: 160, nullable: false });
   c.string('name', { length: 100, nullable: false });
   c.string('merchantId', { length: 100, nullable: false });
   c.string('userId', { length: 100, nullable: false });
   c.string('date', { length: 10, nullable: false });
   c.string('status', { length: 30, nullable: false });
   c.json('payload', { nullable: false });
   c.integer('version', { nullable: false, defaultValue: 0 });
   c.integer('lifecycleVersion', { nullable: false, defaultValue: 0 });
   c.datetimeTz('statusChangedAt', { nullable: false });
   c.datetimeTz('createdAt', { nullable: false }); c.datetimeTz('updatedAt', { nullable: false });
   c.bigInt('amountCents', { nullable: false, defaultValue: 0 });
   c.string('settlementId', { length: 100, nullable: true });
   c.unique('number'); c.index('merchantId'); c.index('userId'); c.index('date'); c.index(['status', 'statusChangedAt']);
  });
  await builder.createCollection('hylContracts', (c) => {
   c.string('id', { length: 100, nullable: false }); c.primary('id');
   c.string('number', { length: 160, nullable: false });
   c.string('name', { length: 100, nullable: false });
   c.string('merchantId', { length: 100, nullable: false });
   c.string('userId', { length: 100, nullable: false });
   c.string('date', { length: 10, nullable: false });
   c.string('status', { length: 30, nullable: false });
   c.json('payload', { nullable: false });
   c.integer('version', { nullable: false, defaultValue: 0 });
   c.integer('lifecycleVersion', { nullable: false, defaultValue: 0 });
   c.datetimeTz('statusChangedAt', { nullable: false });
   c.datetimeTz('createdAt', { nullable: false }); c.datetimeTz('updatedAt', { nullable: false });
   c.bigInt('amountCents', { nullable: false, defaultValue: 0 });
   c.string('settlementId', { length: 100, nullable: true });
   c.unique('number'); c.index('merchantId'); c.index('userId'); c.index('date'); c.index(['status', 'statusChangedAt']);
  });
  await builder.createCollection('hylRevenueReports', (c) => {
   c.string('id', { length: 100, nullable: false }); c.primary('id');
   c.string('number', { length: 160, nullable: false });
   c.string('name', { length: 100, nullable: false });
   c.string('merchantId', { length: 100, nullable: false });
   c.string('userId', { length: 100, nullable: false });
   c.string('date', { length: 10, nullable: false });
   c.string('status', { length: 30, nullable: false });
   c.json('payload', { nullable: false });
   c.integer('version', { nullable: false, defaultValue: 0 });
   c.integer('lifecycleVersion', { nullable: false, defaultValue: 0 });
   c.datetimeTz('statusChangedAt', { nullable: false });
   c.datetimeTz('createdAt', { nullable: false }); c.datetimeTz('updatedAt', { nullable: false });
   c.bigInt('amountCents', { nullable: false, defaultValue: 0 });
   c.string('settlementId', { length: 100, nullable: true });
   c.unique('number'); c.index('merchantId'); c.index('userId'); c.index('date'); c.index(['status', 'statusChangedAt']);
  });
  await builder.createCollection('hylExpenses', (c) => {
   c.string('id', { length: 100, nullable: false }); c.primary('id');
   c.string('number', { length: 160, nullable: false });
   c.string('name', { length: 100, nullable: false });
   c.string('merchantId', { length: 100, nullable: false });
   c.string('userId', { length: 100, nullable: false });
   c.string('date', { length: 10, nullable: false });
   c.string('status', { length: 30, nullable: false });
   c.json('payload', { nullable: false });
   c.integer('version', { nullable: false, defaultValue: 0 });
   c.integer('lifecycleVersion', { nullable: false, defaultValue: 0 });
   c.datetimeTz('statusChangedAt', { nullable: false });
   c.datetimeTz('createdAt', { nullable: false }); c.datetimeTz('updatedAt', { nullable: false });
   c.bigInt('amountCents', { nullable: false, defaultValue: 0 });
   c.string('settlementId', { length: 100, nullable: true });
   c.unique('number'); c.index('merchantId'); c.index('userId'); c.index('date'); c.index(['status', 'statusChangedAt']);
  });
  await builder.createCollection('hylSettlements', (c) => {
   c.string('id', { length: 100, nullable: false }); c.primary('id');
   c.string('number', { length: 160, nullable: false });
   c.string('name', { length: 100, nullable: false });
   c.string('merchantId', { length: 100, nullable: false });
   c.string('userId', { length: 100, nullable: false });
   c.string('date', { length: 10, nullable: false });
   c.string('status', { length: 30, nullable: false });
   c.json('payload', { nullable: false });
   c.integer('version', { nullable: false, defaultValue: 0 });
   c.integer('lifecycleVersion', { nullable: false, defaultValue: 0 });
   c.datetimeTz('statusChangedAt', { nullable: false });
   c.datetimeTz('createdAt', { nullable: false }); c.datetimeTz('updatedAt', { nullable: false });
   c.bigInt('amountCents', { nullable: false, defaultValue: 0 });
   c.string('settlementId', { length: 100, nullable: true });
   c.unique('number'); c.index('merchantId'); c.index('userId'); c.index('date'); c.index(['status', 'statusChangedAt']);
  });
  await builder.createCollection('hylPayments', (c) => {
   c.string('id', { length:100, nullable:false }); c.primary('id');
   c.string('settlementId', { length:100, nullable:false });
   c.string('reference', { length:100, nullable:false }); c.unique('reference');
   c.json('payload', { nullable:false }); c.index('settlementId');
  });
  await builder.createCollection('hylEvents', (c) => {
   c.string('id', { length:100, nullable:false }); c.primary('id');
   c.string('recordId', { length:100, nullable:false }); c.index('recordId');
   c.json('payload', { nullable:false });
  });
  await builder.createCollection('hylTransitions', (c) => {
   c.increments('id');
   c.string('lifecycle', { length:100, nullable:false }); c.string('recordId', { length:100, nullable:false });
   c.string('transition', { length:100, nullable:false }); c.string('from', { length:40, nullable:true }); c.string('to', { length:40, nullable:false });
   c.string('actorId', { length:100, nullable:false }); c.json('input', { nullable:false }); c.datetimeTz('at', { nullable:false });
   c.integer('version', { nullable:false }); c.string('requestId', { length:200, nullable:true }); c.string('requestKey', { length:200, nullable:false });
   c.unique(['lifecycle','recordId','version']); c.unique(['lifecycle','recordId','requestKey']); c.index(['lifecycle','recordId','id']);
  });
  await builder.createCollection('hylEffectRuns', (c) => {
   c.increments('id'); c.bigInt('transitionId', { nullable:false });
   c.string('lifecycle', { length:100, nullable:false }); c.string('recordId', { length:100, nullable:false }); c.string('effect', { length:100, nullable:false });
   c.boolean('stayBound', { nullable:false }); c.string('status', { length:30, nullable:false });
   c.integer('attempts', { nullable:false, defaultValue:0 }); c.integer('maxAttempts', { nullable:false, defaultValue:1 });
   c.json('result', { nullable:true }); c.text('error', { nullable:true });
   c.datetimeTz('createdAt', { nullable:false }); c.datetimeTz('updatedAt', { nullable:false });
   c.datetimeTz('claimedAt', { nullable:true }); c.datetimeTz('runAfter', { nullable:true });
   c.json('continuation', { nullable:true }); c.datetimeTz('continuationDueAt', { nullable:true }); c.datetimeTz('continuationAbandonedAt', { nullable:true });
   c.index(['status','id']); c.index(['lifecycle','recordId','id']); c.index('continuationDueAt'); c.index('continuationAbandonedAt');
  });
 },
 async down({ builder }) {
  await builder.dropCollection('hylEffectRuns');
  await builder.dropCollection('hylTransitions');
  await builder.dropCollection('hylEvents');
  await builder.dropCollection('hylPayments');
  await builder.dropCollection('hylSettlements');
  await builder.dropCollection('hylExpenses');
  await builder.dropCollection('hylRevenueReports');
  await builder.dropCollection('hylContracts');
  await builder.dropCollection('hylMerchants');
 }
});
