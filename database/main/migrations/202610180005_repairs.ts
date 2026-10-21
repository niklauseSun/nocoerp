import {defineMigration} from '@nocobase/db';
export default defineMigration({name:'202610180005_repairs',async up({builder}){
 await builder.createCollection('hylRepairOrders',c=>{
 c.string('id',{length:100,nullable:false});c.primary('id');c.string('number',{length:100,nullable:false});c.unique('number');
 for(const field of ['assetId','projectId','merchantId','contractId','assigneeId','actor'])c.string(field,{length:100,nullable:false});
 c.index('assetId');c.index('merchantId');c.index('contractId');c.index('assigneeId');
 c.string('title',{length:100,nullable:false});c.string('category',{length:40,nullable:false});c.string('priority',{length:20,nullable:false});c.string('status',{length:40,nullable:false});c.index('status');
 c.string('occurredOn',{length:10,nullable:false});c.string('dueOn',{length:10,nullable:false});c.string('costCents',{length:30,nullable:false});c.integer('version',{nullable:false});c.integer('lifecycleVersion',{nullable:false});c.datetimeTz('statusChangedAt',{nullable:false});c.json('payload',{nullable:false});c.datetimeTz('createdAt',{nullable:false});c.datetimeTz('updatedAt',{nullable:false});
 });
 await builder.createCollection('hylRepairEvents',c=>{
 c.string('id',{length:100,nullable:false});c.primary('id');c.string('orderId',{length:100,nullable:false});c.index('orderId');c.string('actor',{length:100,nullable:false});c.string('action',{length:40,nullable:false});c.string('fromState',{length:40,nullable:false});c.string('toState',{length:40,nullable:false});c.json('payload',{nullable:false});c.datetimeTz('createdAt',{nullable:false});
 });
 await builder.createCollection('hylRepairOperations',c=>{
 c.string('id',{length:100,nullable:false});c.primary('id');c.string('actor',{length:100,nullable:false});c.string('hash',{length:64,nullable:false});c.json('result',{nullable:false});c.datetimeTz('createdAt',{nullable:false});
 });
},async down({builder}){await builder.dropCollection('hylRepairOperations');await builder.dropCollection('hylRepairEvents');await builder.dropCollection('hylRepairOrders');}});
