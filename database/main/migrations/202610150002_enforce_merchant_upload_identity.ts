import { defineMigration } from '@nocobase/db';
export default defineMigration({
  name: '202610150002_enforce_merchant_upload_identity',
  async up({ builder }) {
    // Existing development databases may have the initial non-unique lookup index.
    // A forward migration enforces identity without rolling back files or cleanup receipts.
    await builder.addConstraint('hylMerchantFiles', {
      type: 'unique', mode: 'index', name: 'hyl_merchant_upload_identity_guard',
      fields: ['merchantId', 'ownerId', 'uploadId'],
    });
  },
  async down({ builder }) {
    await builder.dropConstraint('hylMerchantFiles', 'hyl_merchant_upload_identity_guard');
  },
});
