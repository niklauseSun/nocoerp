import { defineMigration } from '@nocobase/db';
export default defineMigration({
  name: '202610200004_bank_resolutions',
  async up({ builder }) {
    await builder.createCollection('hylBankResolutions', c => {
      c.string('id', { length: 100, nullable: false }); c.primary('id');
      c.string('rowId', { length: 100, nullable: false }); c.index('rowId');
      c.string('conclusion', { length: 30, nullable: false });
      c.string('note', { length: 1000, nullable: false });
      c.string('nextDate', { length: 10, nullable: false });
      c.string('actor', { length: 100, nullable: false });
      c.datetimeTz('createdAt', { nullable: false });
    });
  },
  async down({ builder }) { await builder.dropCollection('hylBankResolutions'); },
});
