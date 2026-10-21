// @vitest-environment node
import { randomBytes, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { expect } from 'vitest';
import { createAppTest } from '@nocobase/app-testing/server';
import {
  signIn,
  DEFAULT_ADMIN_CREDENTIALS,
} from '@nocobase/app-plugin-authentication/testing';
import { userManagementServiceToken } from '@nocobase/app-plugin-users/server/tokens';
import { authorizationToken } from '@nocobase/app-plugin-authorization';
import { definePermissionSet } from '@nocobase/authorization/permission-sets';
import { repairResource } from '../../server/repairs/resources.js';
import { assetResource } from '../../server/assets/resources.js';
import { createStandaloneServer } from '../../server/standalone.js';
const test = createAppTest({
  createServer: createStandaloneServer,
  config: {
    secrets: { keys: [{ version: 1, key: randomBytes(32).toString('hex') }] },
    logging: { enabled: false },
  },
});
test('pending ownership, shared report editing, retained history and scoped content access', async ({
  testApp,
  request,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const call = async (
    path: string,
    body?: unknown,
    session = admin,
    status = 200,
  ) => {
    const response = await session.fetch(path, {
      method: body ? 'POST' : 'GET',
      headers: {
        origin: 'http://localhost',
        'content-type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    expect(response.status).toBe(status);
    return ((await response.json()) as any).data;
  };
  const asset = await call(
    '/assets',
    { name: 'Photo project', type: 'project' },
    admin,
    201,
  );
  const bytes = await sharp({
    create: { width: 2, height: 2, channels: 3, background: '#ffffff' },
  })
    .png()
    .toBuffer();
  const upload = async () => {
    const form = new FormData();
    form.append(
      'file',
      new File([new Uint8Array(bytes)], 'photo.png', { type: 'image/png' }),
    );
    const r = await admin.fetch(
      `/repairFiles/uploadOne?assetId=${asset.id}&stage=report`,
      { method: 'POST', body: form, headers: { origin: 'http://localhost' } },
    );
    expect(r.status).toBe(201);
    return ((await r.json()) as any).data.record;
  };
  const file = await upload();
  const password = randomBytes(20).toString('hex'),
    users = testApp.application.container.resolve(userManagementServiceToken),
    authz = testApp.application.container.resolve(authorizationToken);
  const user = await users.create({
    name: 'Repair editor',
    email: randomUUID() + '@example.test',
    password,
  });
  await authz.permissionSets.create(
    definePermissionSet('photo-editor')
      .grant(
        repairResource.reference().grant({
          read: { assets: 'allRecords' },
          report: { assets: 'allRecords' },
        }),
      )
      .grant(
        assetResource.reference().grant({ read: { records: 'allRecords' } }),
      )
      .build(),
  );
  await authz.permissionSets.assign({
    permissionSet: 'photo-editor',
    subject: { type: 'user', id: user.id },
  });
  const editor = await signIn(testApp, { email: user.email, password });
  await call('/repairPhotos/' + file.id, undefined, editor, 403);
  const fields = {
    title: 'Report photos',
    description: 'Leak',
    category: 'plumbing',
    priority: 'normal',
    reporterName: 'Test',
    reporterPhone: '0',
    location: '',
    evidence: '',
    reportPhotoIds: [file.id],
  };
  const values = {
    ...fields,
    assetId: asset.id,
    merchantId: '',
    contractId: '',
    occurredOn: '2026-10-17',
  };
  await call('/repairOrders', { requestId: randomUUID(), values }, editor, 400);
  let order = await call('/repairOrders', { requestId: randomUUID(), values });
  expect((await call('/repairPhotos/' + file.id, undefined, editor)).id).toBe(
    file.id,
  );
  order = await call(
    '/repairOrders/' + order.id + '/actions',
    {
      requestId: randomUUID(),
      expectedVersion: order.version,
      action: 'edit',
      values: { ...fields, title: 'Other editor retains image' },
    },
    editor,
  );
  order = await call(
    '/repairOrders/' + order.id + '/actions',
    {
      requestId: randomUUID(),
      expectedVersion: order.version,
      action: 'edit',
      values: { ...fields, title: 'Remove current image', reportPhotoIds: [] },
    },
    editor,
  );
  const detail = await call('/repairOrders/' + order.id, undefined, editor);
  expect(detail.photos.report).toEqual([]);
  expect(
    detail.events.data.some((e: any) =>
      e.photos.some((f: any) => f.id === file.id),
    ),
  ).toBe(true);
  expect(
    (
      await editor.fetch(
        'http://localhost/main/uploads/repairPhotos/' + file.id + '.png',
      )
    ).status,
  ).toBe(200);
  expect((await request('/repairPhotos/' + file.id)).status).toBe(401);
  const spec = await admin.fetch('/swagger');
  expect(spec.status).toBe(200);
  expect(await spec.text()).toContain('repairPhotoRead');
});
