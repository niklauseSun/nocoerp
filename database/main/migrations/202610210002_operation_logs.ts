import { defineMigration } from '@nocobase/db';
export default defineMigration({
  name: '202610210002_operation_logs',
  async up({ builder }) {
    await builder.createCollection('hylOperationLogs', (c) => {
      c.uuid('id').primary().notNull();
      c.datetime('createdAt').notNull();
      for (const field of ['actorId', 'actorName', 'module', 'action', 'targetId', 'method', 'result', 'errorCode', 'requestId']) c.string(field, {length: 150}).notNull();
      c.string('pathTemplate', {length: 300}).notNull();
      c.integer('httpStatus').notNull();
      c.integer('durationMs').notNull();
      c.index(['createdAt', 'id']);
      c.index(['module', 'result', 'createdAt']);
      c.index(['actorId', 'createdAt']);
    });
  },
  async down({builder}) { await builder.dropCollection('hylOperationLogs'); },
});
