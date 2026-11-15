// @vitest-environment node
import { randomBytes, randomUUID } from 'node:crypto';
import { expect, vi } from 'vitest';
import { createAppTest } from '@nocobase/app-testing/server';
import {
  signIn,
  DEFAULT_ADMIN_CREDENTIALS,
} from '@nocobase/app-plugin-authentication/testing';
import { createStandaloneServer } from '../../server/standalone.js';
import { wecomToken } from '../../server/providers/wecom.js';
import { WecomError } from '../../server/wecom/client.js';
import { WecomReminders } from '../../server/wecom/notification.js';
import type { NotificationService } from '@nocobase/app-plugin-notification/server';
import type { Todo } from '../../server/messages/model.js';
const test = createAppTest({
  createServer: createStandaloneServer,
  config: {
    secrets: { keys: [{ version: 1, key: randomBytes(32).toString('hex') }] },
    logging: { enabled: false },
    wecom: {
      enabled: true,
      corpId: 'test-corp',
      agentId: '1000001',
      appSecret: 'test-app-secret',
      contactsSecret: 'test-contact-secret',
      readSecret: '',
      autoSync: false,
      notifications: true,
    },
  },
});
test('two-way identity, hierarchy, membership, conflicts, protected failures and recovery through isolated API/database', async ({
  testApp,
  request,
}) => {
  const s = testApp.application.container.resolve(wecomToken),
    admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const actor = (
    await s.org.users.list({ search: DEFAULT_ADMIN_CREDENTIALS.email })
  ).items[0].id;
  const departments = new Map<
    number,
    { id: number; name: string; parentid: number }
  >([
    [1, { id: 1, name: 'Company', parentid: 0 }],
    [2, { id: 2, name: 'Property', parentid: 1 }],
  ]);
  const users = new Map<
    string,
    {
      userid: string;
      name: string;
      email: string;
      department: number[];
      main_department: number;
      status: number;
    }
  >([
    [
      'alice',
      {
        userid: 'alice',
        name: 'Alice',
        email: 'alice@example.test',
        department: [2],
        main_department: 2,
        status: 1,
      },
    ],
  ]);
  vi.spyOn(s.read, 'call').mockImplementation(async (path, q = {}) => {
    if (path === 'department/list')
      return {
        errcode: 0,
        department: q.id
          ? [departments.get(Number(q.id))].filter(Boolean)
          : [...departments.values()],
      };
    if (path === 'user/get') {
      const u = users.get(q.userid);
      if (!u) throw new WecomError(60111);
      return { errcode: 0, ...u };
    }
    throw Error('unexpected');
  });
  const outbound = vi
    .spyOn(s.write, 'call')
    .mockImplementation(async (path, _q, body) => {
      const b = body as Record<string, any>;
      if (path.startsWith('department/'))
        departments.set(Number(b.id), {
          id: Number(b.id),
          name: b.name,
          parentid: Number(b.parentid),
        });
      else if (path.startsWith('user/'))
        users.set(b.userid, {
          userid: b.userid,
          name: b.name,
          email: b.email,
          department: b.department,
          main_department: b.main_department,
          status: b.enable ? 1 : 2,
        });
      return { errcode: 0 };
    });
  async function call(
    path: string,
    body?: unknown,
    status = 200,
    session = admin,
  ): Promise<any> {
    const r = await session.fetch(path, {
      method: body ? 'POST' : 'GET',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const j = await r.json();
    if (r.status !== status)
      throw new Error(path + ': ' + r.status + ' ' + JSON.stringify(j));
    return j.data;
  }
  expect((await request('/wecom')).status).toBe(401);
  const plain = await s.org.users.create({
      email: 'plain@example.test',
      name: 'Plain',
      password: 'test-password-123',
    }),
    plainSession = await signIn(testApp, {
      email: plain.email,
      password: 'test-password-123',
    });
  await call('/wecom', undefined, 403, plainSession);
  await call(
    '/wecom/mappings',
    { kind: 'department', remoteId: '1' },
    403,
    plainSession,
  );
  const status = await call('/wecom');
  expect(JSON.stringify(status)).not.toContain('test-app-secret');
  expect(JSON.stringify(status)).not.toContain('test-contact-secret');
  const root = await call('/wecom/mappings', {
    kind: 'department',
    remoteId: '1',
  });
  let p = await call('/wecom/mappings/' + root.id);
  await call('/wecom/mappings/' + root.id + '/sync', {
    fingerprint: p.fingerprint,
    direction: 'pull',
  });
  // A rejected root push never submitted externally and must remain retryable.
  departments.get(1)!.name = 'Remote company';
  p = await s.preview(root.id);
  const beforeRootPush = outbound.mock.calls.length;
  await expect(
    s.sync(actor, root.id, p.fingerprint, 'push'),
  ).rejects.toMatchObject({ reason: 'WECOM_SYNC_FAILED' });
  expect(outbound.mock.calls.length).toBe(beforeRootPush);
  expect((await s.get(root.id)).state).toBe('failed');
  p = await s.preview(root.id);
  await s.sync(actor, root.id, p.fingerprint, 'pull');
  const child = await call('/wecom/mappings', {
    kind: 'department',
    remoteId: '2',
  });
  p = await s.preview(child.id);
  await s.sync(actor, child.id, p.fingerprint, 'pull');
  await call('/wecom/mappings', { kind: 'department', remoteId: '2' }, 400);
  const exportDept = await s.org.department(actor, {
    title: 'Export department',
    parentId: root.localId,
    active: true,
  });
  const exportMap = await s.create(actor, {
    kind: 'department',
    localId: exportDept.id,
    remoteId: '',
  });
  p = await s.preview(exportMap.id);
  await s.sync(actor, exportMap.id, p.fingerprint, 'push');
  expect(departments.get(Number(exportMap.remoteId))?.name).toBe(
    'Export department',
  );
  const exportUser = await s.org.users.create({
    name: 'Export user',
    email: 'export@example.test',
    username: 'export_test',
    password: randomBytes(36).toString('hex'),
  });
  await s.org.member(actor, exportDept.id, {
    userId: exportUser.id,
    active: true,
    primary: true,
  });
  const exportPerson = await s.create(actor, {
    kind: 'user',
    localId: exportUser.id,
    remoteId: '',
  });
  p = await s.preview(exportPerson.id);
  await s.sync(actor, exportPerson.id, p.fingerprint, 'push');
  expect(users.get(exportPerson.remoteId)?.department).toEqual([
    Number(exportMap.remoteId),
  ]);
  p = await s.preview(exportPerson.id);
  expect(p.suggested).toBe('equal');
  const person = await call('/wecom/mappings', {
    kind: 'user',
    remoteId: 'alice',
  });
  p = await s.preview(person.id);
  await s.sync(actor, person.id, p.fingerprint, 'pull');
  let mapped = await s.get(person.id);
  const local = await s.org.users.get(mapped.localId);
  expect(local?.name).toBe('Alice');
  expect(await s.org.subjects(mapped.localId)).toContain(child.localId);
  await s.org.users.update(mapped.localId, { name: 'Local Alice' });
  p = await s.preview(person.id);
  expect(p.suggested).toBe('push');
  await s.sync(actor, person.id, p.fingerprint, 'auto');
  expect(users.get('alice')?.name).toBe('Local Alice');
  users.get('alice')!.name = 'Remote Alice';
  p = await s.preview(person.id);
  expect(p.suggested).toBe('pull');
  await s.sync(actor, person.id, p.fingerprint, 'auto');
  expect((await s.org.users.get(mapped.localId))?.name).toBe('Remote Alice');
  users.get('alice')!.name = 'Other';
  await s.org.users.update(mapped.localId, { name: 'Competing' });
  p = await s.preview(person.id);
  expect(p.suggested).toBe('conflict');
  await expect(
    s.sync(actor, person.id, p.fingerprint, 'auto'),
  ).rejects.toMatchObject({ reason: 'WECOM_CONFLICT' });
  users.get('alice')!.name = 'Newer';
  await expect(
    s.sync(actor, person.id, p.fingerprint, 'pull'),
  ).rejects.toMatchObject({ reason: 'WECOM_STALE' });
  p = await s.preview(person.id);
  await s.sync(actor, person.id, p.fingerprint, 'pull');
  users.get('alice')!.status = 2;
  p = await s.preview(person.id);
  await s.sync(actor, person.id, p.fingerprint, 'pull');
  expect((await s.org.users.get(mapped.localId))?.disabledAt).toBeTruthy();
  users.get('alice')!.status = 1;
  p = await s.preview(person.id);
  await s.sync(actor, person.id, p.fingerprint, 'pull');
  // Incomplete directory data never empties the local email.
  users.get('alice')!.email = '';
  await expect(s.preview(person.id)).rejects.toMatchObject({
    reason: 'WECOM_INCOMPLETE_DIRECTORY',
  });
  users.get('alice')!.email = 'alice@example.test';
  await s.org.users.update(mapped.localId, { name: 'Uncertain' });
  p = await s.preview(person.id);
  outbound.mockImplementationOnce(async () => {
    users.get('alice')!.name = 'Uncertain';
    throw new WecomError(-1, true);
  });
  await expect(
    s.sync(actor, person.id, p.fingerprint, 'push'),
  ).rejects.toMatchObject({ reason: 'WECOM_UNKNOWN' });
  mapped = await s.get(person.id);
  expect(mapped.state).toBe('unknown');
  const count = outbound.mock.calls.length;
  await s.reconcile(actor, person.id);
  expect(outbound.mock.calls.length).toBe(count);
  expect((await s.get(person.id)).state).toBe('synced');
  // A second successful synchronization never provisions a duplicate person.
  p = await s.preview(person.id);
  await s.sync(actor, person.id, p.fingerprint, 'auto');
  expect((await s.org.users.list({ search: 'alice@example.test' })).total).toBe(
    1,
  );
  // Freeze external recipient and message before queueing; a lost enqueue reply reuses original identity.
  const send = vi
    .fn()
    .mockRejectedValueOnce(Error('lost reply'))
    .mockResolvedValue({ notificationId: 'queued', deduplicated: false });
  const reminders = new WecomReminders(
    s,
    { send } as unknown as NotificationService,
    'https://erp.example.test/main',
  );
  const todo = {
    id: randomUUID(),
    generation: 1,
    payload: { title: 'Reminder', body: 'Open the application.' },
  } as Todo;
  await expect(reminders.send(mapped.localId, todo)).rejects.toThrow(
    'lost reply',
  );
  await s.org.db
    .repository('hylWecomMappings')
    .updateMany({ filter: { id: person.id }, values: { remoteId: 'renamed' } });
  await reminders.send(mapped.localId, todo);
  expect(send.mock.calls[1][0]).toEqual(send.mock.calls[0][0]);
  expect(send.mock.calls[1][0].messages.wecom.to).toBe('alice');
  const other = { ...s.config, corpId: 'other' };
  Object.assign(s.config, other);
  await expect(s.get(person.id)).rejects.toMatchObject({
    reason: 'WECOM_NOT_FOUND',
  });
});
