import { defineMigration } from '@nocobase/db';

export default defineMigration({
  name: '202610170002_billing',
  async up({ builder }) {
    await builder.createCollection('hylBillingConfigs', (c) => {
      c.string('id', { length: 100, nullable: false }); c.primary('id');
      c.string('contractId', { length: 100, nullable: false }); c.string('merchantId', { length: 100, nullable: false });
      c.integer('version', { nullable: false }); c.string('effectiveFrom', { length: 10, nullable: false });
      c.json('payload', { nullable: false }); c.datetimeTz('createdAt', { nullable: false });
      c.unique(['contractId', 'effectiveFrom']); c.unique(['contractId', 'version']); c.index('merchantId');
    });
    await builder.createCollection('hylBills', (c) => {
      c.string('id', { length: 100, nullable: false }); c.primary('id');
      c.string('number', { length: 100, nullable: false }); c.unique('number');
      c.string('contractId', { length: 100, nullable: false }); c.index('contractId');
      c.string('merchantId', { length: 100, nullable: false }); c.index('merchantId');
      c.string('status', { length: 30, nullable: false }); c.integer('version', { nullable: false, defaultValue: 0 });
      c.integer('lifecycleVersion', { nullable: false, defaultValue: 0 }); c.datetimeTz('statusChangedAt', { nullable: false });
      c.string('cycleStart', { length: 10, nullable: false }); c.string('cycleEnd', { length: 10, nullable: false });
      c.string('start', { length: 10, nullable: false }); c.string('end', { length: 10, nullable: false });
      c.string('date', { length: 10, nullable: false }); c.string('dueDate', { length: 10, nullable: false });
      c.bigInt('amountCents', { nullable: false }); c.bigInt('depositCents', { nullable: false, defaultValue: 0 });
      c.bigInt('allocatedCents', { nullable: false, defaultValue: 0 }); c.bigInt('remainingCents', { nullable: false, defaultValue: 0 });
      c.json('payload', { nullable: false }); c.datetimeTz('createdAt', { nullable: false }); c.datetimeTz('updatedAt', { nullable: false });
      c.index(['status', 'dueDate']);
    });
    await builder.createCollection('hylBillLines', (c) => {
      c.string('id', { length: 100, nullable: false }); c.primary('id');
      c.string('billId', { length: 100, nullable: false }); c.index('billId');
      c.string('contractId', { length: 100, nullable: false }); c.index('contractId');
      c.string('feeType', { length: 30, nullable: false }); c.string('assetId', { length: 100, nullable: false, defaultValue: '' });
      c.string('meterCode', { length: 100, nullable: false, defaultValue: '' });
      c.string('start', { length: 10, nullable: false }); c.string('end', { length: 10, nullable: false });
      c.string('sourceKey', { length: 500, nullable: false }); c.index('sourceKey'); c.bigInt('amountCents', { nullable: false }); c.json('payload', { nullable: false });
    });
    await builder.createCollection('hylReceipts', (c) => {
      c.string('id', { length: 100, nullable: false }); c.primary('id');
      c.string('number', { length: 100, nullable: false }); c.unique('number');
      c.string('contractId', { length: 100, nullable: false }); c.index('contractId');
      c.string('merchantId', { length: 100, nullable: false }); c.index('merchantId');
      c.string('status', { length: 30, nullable: false }); c.integer('version', { nullable: false, defaultValue: 0 });
      c.integer('lifecycleVersion', { nullable: false, defaultValue: 0 }); c.datetimeTz('statusChangedAt', { nullable: false });
      c.string('date', { length: 10, nullable: false }); c.string('reference', { length: 100, nullable: false });
      c.bigInt('amountCents', { nullable: false }); c.bigInt('allocatedCents', { nullable: false, defaultValue: 0 });
      c.bigInt('refundedCents', { nullable: false, defaultValue: 0 }); c.bigInt('unusedCents', { nullable: false });
      c.json('payload', { nullable: false }); c.datetimeTz('createdAt', { nullable: false }); c.datetimeTz('updatedAt', { nullable: false });
      c.unique(['merchantId', 'reference']);
    });
    await builder.createCollection('hylReceiptEntries', (c) => {
      c.string('id', { length: 100, nullable: false }); c.primary('id');
      c.string('receiptId', { length: 100, nullable: false }); c.index('receiptId');
      c.string('contractId', { length: 100, nullable: false }); c.index('contractId');
      c.string('merchantId', { length: 100, nullable: false }); c.string('kind', { length: 30, nullable: false });
      c.bigInt('amountCents', { nullable: false }); c.string('billId', { length: 100, nullable: false, defaultValue: '' }); c.index('billId');
      c.string('reverseOf', { length: 100, nullable: true }); c.unique('reverseOf');
      c.string('reference', { length: 100, nullable: true }); c.unique(['merchantId', 'reference']);
      c.json('payload', { nullable: false }); c.datetimeTz('createdAt', { nullable: false });
    });
    await builder.createCollection('hylBillingOperations', (c) => {
      c.string('id', { length: 100, nullable: false }); c.primary('id');
      c.string('contractId', { length: 100, nullable: false }); c.index('contractId');
      c.string('actor', { length: 100, nullable: false }); c.string('hash', { length: 64, nullable: false });
      c.json('payload', { nullable: false }); c.datetimeTz('createdAt', { nullable: false });
    });
  },
  async down({ builder }) {
    await builder.dropCollection('hylBillingOperations'); await builder.dropCollection('hylReceiptEntries');
    await builder.dropCollection('hylReceipts'); await builder.dropCollection('hylBillLines');
    await builder.dropCollection('hylBills'); await builder.dropCollection('hylBillingConfigs');
  },
});
