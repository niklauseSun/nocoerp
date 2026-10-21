import {defineMigration} from '@nocobase/db';
export default defineMigration({name:'202610190002_messages',async up({builder}){
 await builder.createCollection('hylMessagePreferences',c=>{
 c.string('userId',{length:100,nullable:false});c.primary('userId');c.integer('version',{nullable:false});
 for(const f of ['enabled','contracts','bills','repairs','purchases'])c.boolean(f,{nullable:false});
 c.integer('contractDays',{nullable:false});c.integer('billDays',{nullable:false});c.string('locale',{length:10,nullable:false});c.string('scanToken',{length:100,nullable:false});
 for(const f of ['leaseUntil','lastCheckedAt'])c.string(f,{length:40,nullable:false});c.string('lastError',{length:100,nullable:false});
 c.datetimeTz('createdAt',{nullable:false});c.datetimeTz('updatedAt',{nullable:false});
 });
 await builder.createCollection('hylMessageTodos',c=>{
 c.string('id',{length:100,nullable:false});c.primary('id');c.string('userId',{length:100,nullable:false});c.index('userId');
 c.string('dedupeKey',{length:400,nullable:false});c.unique('dedupeKey');
 for(const f of ['kind','sourceType','reason','status'])c.string(f,{length:50,nullable:false});
 c.index('status');c.string('sourceId',{length:100,nullable:false});c.string('dueOn',{length:10,nullable:false});c.integer('generation',{nullable:false});c.string('notificationId',{length:100,nullable:false});c.json('payload',{nullable:false});c.integer('lifecycleVersion',{nullable:false});c.datetimeTz('statusChangedAt',{nullable:false});c.datetimeTz('createdAt',{nullable:false});c.datetimeTz('updatedAt',{nullable:false});
 });
 },async down({builder}){await builder.dropCollection('hylMessageTodos');await builder.dropCollection('hylMessagePreferences');}});
