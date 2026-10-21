import { defineMigration } from '@nocobase/db';
export default defineMigration({
  name: '202610210001_repair_photos',
  async up({ builder }) {
    await builder.createCollection('hylRepairFiles', (c) => {
      c.uuid('id').primary().notNull();
      c.string('disk', { length: 255 }).notNull();
      c.text('key').notNull();
      c.text('filename').notNull();
      c.string('ext', { length: 32 }).notNull();
      c.string('mimeType', { length: 255 }).notNull();
      c.bigInt('size').notNull();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.string('ownerId', { length: 100 }).notNull();
      c.string('assetId', { length: 100 }).notNull();
      c.string('orderId', { length: 100 }).notNull();
      c.string('stage', { length: 20 }).notNull();
      c.boolean('linked').notNull();
      c.index(['orderId', 'stage']);
      c.index(['ownerId', 'linked']);
    });
  },
  async down({ builder }) {
    await builder.dropCollection('hylRepairFiles');
  },
});
