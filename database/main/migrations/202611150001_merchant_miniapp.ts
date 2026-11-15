import { defineMigration } from '@nocobase/db';

export default defineMigration({
  name: '202611150001_merchant_miniapp',
  async up({ builder }) {
    await builder.createCollection('hylMiniappGrants', (c) => {
      c.uuid('id').primary().notNull();
      c.string('merchantId', { length: 100 }).notNull();
      c.string('phone', { length: 11 }).notNull();
      c.boolean('active').notNull();
      c.string('actor', { length: 100 }).notNull();
      c.datetimeTz('updatedAt').notNull();
      c.unique(['merchantId', 'phone']);
      c.index(['phone', 'active']);
    });
    await builder.createCollection('hylMiniappIdentities', (c) => {
      c.string('id', { length: 64 }).primary().notNull();
      c.string('userId', { length: 100 }).notNull();
      c.string('appId', { length: 40 }).notNull();
      c.string('phone', { length: 11 }).notNull();
      c.unique('userId');
    });
    await builder.createCollection('hylMiniappDaily', (c) => {
      c.uuid('id').primary().notNull();
      c.string('merchantId', { length: 100 }).notNull();
      c.string('date', { length: 10 }).notNull();
      c.unique(['merchantId', 'date']);
    });
    await builder.createCollection('hylMiniappSessions', (c) => {
      c.string('id', { length: 100 }).primary().notNull();
      c.string('userId', { length: 100 }).notNull();
      c.string('appId', { length: 40 }).notNull();
      c.datetimeTz('expiresAt').notNull();
      c.index('expiresAt');
    });
    await builder.createCollection('hylMiniappLoginProofs', (c) => {
      c.string('id', { length: 64 }).primary().notNull();
      c.datetimeTz('expiresAt').notNull();
      c.index('expiresAt');
    });
  },
  async down({ builder }) {
    for (const table of ['hylMiniappLoginProofs', 'hylMiniappSessions', 'hylMiniappDaily', 'hylMiniappIdentities', 'hylMiniappGrants'])
      await builder.dropCollection(table);
  },
});
