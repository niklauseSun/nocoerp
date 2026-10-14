import { defineMigration } from '@nocobase/db';
export default defineMigration({
  name: '202610150001_merchant_file_recovery',
  async up({ builder }) {
    await builder.addField('hylMerchantFiles', { name: 'uploadId', type: 'string', length: 36, nullable: true });
    await builder.addField('hylMerchantFiles', { name: 'uploadHash', type: 'string', length: 64, nullable: false, defaultValue: '' });
    await builder.addConstraint('hylMerchantFiles', { name: 'hyl_merchant_upload_identity', fields: ['merchantId', 'ownerId', 'uploadId'], type: 'unique', mode: 'index' });
    await builder.createCollection('hylMerchantFileCleanup', (c) => {
      c.string('id', { length: 100, nullable: false }); c.primary('id');
      c.string('merchantId', { length: 100, nullable: false });
      c.string('ownerId', { length: 100, nullable: false });
      c.string('disk', { length: 255, nullable: false });
      c.text('key', { nullable: false });
      c.datetimeTz('createdAt', { nullable: false });
      c.index(['merchantId', 'ownerId']);
    });
  },
  async down({ builder }) {
    await builder.dropCollection('hylMerchantFileCleanup');
    await builder.dropConstraint('hylMerchantFiles', 'hyl_merchant_upload_identity');
    await builder.dropField('hylMerchantFiles', 'uploadHash');
    await builder.dropField('hylMerchantFiles', 'uploadId');
  },
});
