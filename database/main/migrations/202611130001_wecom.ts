import { defineMigration } from '@nocobase/db';
export default defineMigration({ name: '202611130001_wecom', async up({ builder }) {
  await builder.createCollection('hylWecomMappings', c => {
    c.string('id', { length: 100, nullable: false }); c.primary('id');
    c.string('corpId', { length: 100, nullable: false }); c.string('kind', { length: 20, nullable: false });
    c.string('localId', { length: 100, nullable: false }); c.string('remoteId', { length: 64, nullable: false });
    c.boolean('localExists', { nullable: false }); c.boolean('remoteExists', { nullable: false });
    c.json('baseline', { nullable: true }); c.json('intent', { nullable: true }); c.string('state', { length: 30, nullable: false });
    c.integer('version', { nullable: false }); c.string('error', { length: 100, nullable: false });
    c.string('intentDirection', { length: 20, nullable: false });
    c.string('updatedAt', { length: 40, nullable: false });
    c.unique(['corpId','kind','localId']); c.unique(['corpId','kind','remoteId']);
  });
  await builder.createCollection('hylWecomAudit', c => {
    c.string('id', { length: 100, nullable: false }); c.primary('id');
    for (const f of ['mappingId','actor','result','direction','error']) c.string(f, { length: 100, nullable: false });
    c.string('at', { length: 40, nullable: false }); c.index(['mappingId','at']);
  });
  await builder.createCollection('hylWecomMessages', c => {
    c.string('id', { length: 150, nullable: false }); c.primary('id');
    c.string('userId', { length: 100, nullable: false }); c.string('corpId', { length: 100, nullable: false });
    c.json('payload', { nullable: false }); c.string('notificationId', { length: 100, nullable: false });
    c.string('createdAt', { length: 40, nullable: false });
  });
}, async down({builder}) {
  await builder.dropCollection('hylWecomMessages'); await builder.dropCollection('hylWecomAudit'); await builder.dropCollection('hylWecomMappings');
} });
