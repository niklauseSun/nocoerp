import { defineMigration } from '@nocobase/db';
export default defineMigration({
  name:'202610200006_integration_checks',
  async up({builder}) {
    await builder.createCollection('hylIntegrationChecks',c=>{
      c.string('id',{length:100,nullable:false});c.primary('id');
      c.string('actor',{length:100,nullable:false});c.index('actor');
      c.string('type',{length:30,nullable:false});
      c.json('payload',{nullable:false});c.datetimeTz('createdAt',{nullable:false});
    });
  },
  async down({builder}) {await builder.dropCollection('hylIntegrationChecks');},
});
