import { defineMigration } from '@nocobase/db';
export default defineMigration({name:'202610180004_energy',async up({builder}) {
  // These fields are immutable migration history, not imported runtime schemas.
  for(const name of ['hylEnergyMeters','hylEnergyAssignments','hylEnergyReadings','hylEnergyBillLinks','hylEnergyOperations','hylEnergyAudit']) {
    await builder.createCollection(name,c=>{
      c.string('id',{length:100,nullable:false}); c.primary('id');
      c.string('number',{length:100,nullable:false}); c.unique('number');
      c.string('assetId',{length:100,nullable:false}); c.index('assetId');
      c.string('projectId',{length:100,nullable:false});
      c.string('meterId',{length:100,nullable:false}); c.index('meterId');
      c.string('contractId',{length:100,nullable:false}); c.index('contractId');
      c.string('merchantId',{length:100,nullable:false});
      c.string('status',{length:40,nullable:false});
      c.integer('version',{nullable:false});c.integer('lifecycleVersion',{nullable:false});c.datetimeTz('statusChangedAt',{nullable:false});
      c.string('code',{length:100,nullable:true});
      c.string('start',{length:10,nullable:false});c.string('end',{length:10,nullable:false});
      c.string('usageKey',{length:32,nullable:false});
      c.string('activeReadingId',{length:100,nullable:true});
      c.string('billId',{length:100,nullable:false}); c.index('billId');
      c.string('actor',{length:100,nullable:false});c.text('searchText',{nullable:false});
      c.json('payload',{nullable:false});c.datetimeTz('createdAt',{nullable:false});c.datetimeTz('updatedAt',{nullable:false});
      if(name==='hylEnergyMeters')c.unique('code');
      if(name==='hylEnergyBillLinks')c.unique('activeReadingId');
    });
  }
},async down({builder}) {
  await builder.dropCollection('hylEnergyAudit');await builder.dropCollection('hylEnergyOperations');await builder.dropCollection('hylEnergyBillLinks');await builder.dropCollection('hylEnergyReadings');await builder.dropCollection('hylEnergyAssignments');await builder.dropCollection('hylEnergyMeters');
}});
