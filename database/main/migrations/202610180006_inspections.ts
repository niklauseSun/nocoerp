import {defineMigration} from '@nocobase/db';
export default defineMigration({name:'202610180006_inspections',async up({builder}){
 for(const name of ['hylInspectionPlans','hylInspectionTasks','hylInspectionIssues'])await builder.createCollection(name,c=>{
 c.string('id',{length:100,nullable:false});c.primary('id');c.string('number',{length:100,nullable:false});c.unique('number');
 for(const f of ['assetId','projectId','planId','taskId','repairId','assigneeId','actor'])c.string(f,{length:100,nullable:false});
 for(const f of ['assetId','planId','taskId','repairId','assigneeId'])c.index(f);
 c.string('type',{length:30,nullable:false});c.string('title',{length:100,nullable:false});c.string('status',{length:40,nullable:false});c.index('status');c.string('day',{length:10,nullable:false});c.string('dueOn',{length:10,nullable:false});c.integer('version',{nullable:false});c.integer('lifecycleVersion',{nullable:false});c.datetimeTz('statusChangedAt',{nullable:false});c.string('generationKey',{length:250,nullable:true});c.string('activeItemKey',{length:250,nullable:true});c.json('payload',{nullable:false});c.datetimeTz('createdAt',{nullable:false});c.datetimeTz('updatedAt',{nullable:false});
 if(name==='hylInspectionTasks')c.unique('generationKey');if(name==='hylInspectionIssues')c.unique('activeItemKey');
 });
 await builder.createCollection('hylInspectionEvents',c=>{c.string('id',{length:100,nullable:false});c.primary('id');c.string('recordId',{length:100,nullable:false});c.index('recordId');c.string('kind',{length:20,nullable:false});c.integer('version',{nullable:false});c.string('actor',{length:100,nullable:false});c.string('action',{length:40,nullable:false});c.string('fromState',{length:40,nullable:false});c.string('toState',{length:40,nullable:false});c.json('payload',{nullable:false});c.datetimeTz('createdAt',{nullable:false});});
 await builder.createCollection('hylInspectionOperations',c=>{c.string('id',{length:100,nullable:false});c.primary('id');c.string('actor',{length:100,nullable:false});c.string('hash',{length:64,nullable:false});c.json('result',{nullable:false});c.datetimeTz('createdAt',{nullable:false});});
},async down({builder}){for(const name of ['hylInspectionOperations','hylInspectionEvents','hylInspectionIssues','hylInspectionTasks','hylInspectionPlans'])await builder.dropCollection(name);}});
