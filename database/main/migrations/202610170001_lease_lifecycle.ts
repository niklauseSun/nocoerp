import { defineMigration } from '@nocobase/db';

export default defineMigration({
  name: '202610170001_lease_lifecycle',
  async up({ builder }) {
    await builder.createCollection('hylLeases', (c) => {
      c.string('id', { length: 100, nullable: false }); c.primary('id');
      c.string('merchantId', { length: 100, nullable: false }); c.index('merchantId');
      c.string('status', { length: 30, nullable: false });
      c.integer('lifecycleVersion', { nullable: false, defaultValue: 0 });
      c.datetimeTz('statusChangedAt', { nullable: false });
      c.integer('version', { nullable: false, defaultValue: 0 });
      c.string('actualEnd', { length: 10, nullable: false, defaultValue: '' });
      c.json('payload', { nullable: false });
    });
    await builder.createCollection('hylLeaseEntries', (c) => {
      c.string('id', { length: 100, nullable: false }); c.primary('id');
      c.string('contractId', { length: 100, nullable: false }); c.index('contractId');
      c.string('merchantId', { length: 100, nullable: false });
      c.string('requestId', { length: 100, nullable: false });
      c.string('reference', { length: 100, nullable: true });
      c.string('kind', { length: 30, nullable: false });
      c.bigInt('amountCents', { nullable: false });
      c.string('sourceId', { length: 100, nullable: false, defaultValue: '' });
      c.string('reverseOf', { length: 100, nullable: true });
      c.string('pairId', { length: 100, nullable: false, defaultValue: '' });
      c.json('payload', { nullable: false });
      c.datetimeTz('createdAt', { nullable: false });
      c.unique(['contractId', 'requestId']);
      c.unique(['contractId', 'reference']);
      c.unique('reverseOf');
    });
  },
  async down({ builder }) {
    await builder.dropCollection('hylLeaseEntries');
    await builder.dropCollection('hylLeases');
  },
});
