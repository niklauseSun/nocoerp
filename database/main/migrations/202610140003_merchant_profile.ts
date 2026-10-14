import { defineMigration } from '@nocobase/db';

export default defineMigration({
  name: '202610140003_merchant_profile',
  async up({ builder }) {
    await builder.createCollection('hylMerchantRecords', (c) => {
      c.string('id', { length: 100, nullable: false }); c.primary('id');
      c.string('merchantId', { length: 100, nullable: false });
      c.string('type', { length: 20, nullable: false });
      c.string('requestId', { length: 36, nullable: false });
      c.string('actor', { length: 100, nullable: false });
      c.string('date', { length: 10, nullable: false });
      c.json('payload', { nullable: false });
      c.datetimeTz('createdAt', { nullable: false });
      c.unique(['merchantId', 'type', 'requestId']);
      c.index(['merchantId', 'type', 'date', 'createdAt']);
    });
    await builder.createCollection('hylMerchantFiles', (c) => {
      c.string('id', { length: 100, nullable: false }); c.primary('id');
      c.string('disk', { length: 255, nullable: false });
      c.text('key', { nullable: false });
      c.text('filename', { nullable: false });
      c.string('ext', { length: 32, nullable: false });
      c.string('mimeType', { length: 255, nullable: false });
      c.bigInt('size', { nullable: false });
      c.datetimeTz('createdAt', { nullable: false });
      c.datetimeTz('updatedAt', { nullable: false });
      c.string('merchantId', { length: 100, nullable: false });
      c.string('ownerId', { length: 100, nullable: false });
      c.boolean('linked', { nullable: false, defaultValue: false });
      c.index(['merchantId', 'ownerId', 'linked']);
    });
  },
  async down({ builder }) {
    await builder.dropCollection('hylMerchantFiles');
    await builder.dropCollection('hylMerchantRecords');
  },
});
