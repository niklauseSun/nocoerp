import { defineMigration } from '@nocobase/db';
export default defineMigration({
  name: '202610150003_merchant_creation',
  async up({ builder }) {
    await builder.createCollection('hylMerchantCreations', (c) => {
      c.string('id', { length: 36, nullable: false }); c.primary('id');
      c.string('ownerId', { length: 100, nullable: false });
      c.string('requestHash', { length: 64, nullable: false });
      c.datetimeTz('createdAt', { nullable: false });
    });
  },
  async down({ builder }) { await builder.dropCollection('hylMerchantCreations'); },
});
