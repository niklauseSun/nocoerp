import { PDFDocument } from 'pdf-lib';
// @vitest-environment node
import { randomBytes, randomUUID } from 'node:crypto';
import { expect, vi } from 'vitest';
import { driveManagerToken } from '@nocobase/app-server/drive';
import { defineRecordAccess } from '@nocobase/authorization/core';
import { buildFilter } from '@nocobase/repository-input';
import { provisionAssetDefaults } from '../../server/assets/resources.js';
import { createAppTest } from '@nocobase/app-testing/server';
import {
  signIn,
  DEFAULT_ADMIN_CREDENTIALS,
} from '@nocobase/app-plugin-authentication/testing';
import { authorizationToken } from '@nocobase/app-plugin-authorization';
import { userManagementServiceToken } from '@nocobase/app-plugin-users/server/tokens';
import { definePermissionSet } from '@nocobase/authorization/permission-sets';
import { assetResource } from '../../server/assets/resources.js';
import { createStandaloneServer } from '../../server/standalone.js';
import type { Asset } from '../../server/assets/schema.js';
import type { Row } from '../../server/hyl/schema.js';
const test = createAppTest({
  createServer: createStandaloneServer,
  config: {
    secrets: { keys: [{ version: 1, key: randomBytes(32).toString('hex') }] },
    logging: { enabled: false },
  },
});
test('hierarchical ledger, history, allocation, contract snapshots and rollback', async ({
  testApp,
  request,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const send = async <T = Asset>(
    path: string,
    body: unknown,
    status = 201,
    method = 'POST',
  ): Promise<T> => {
    const response = await admin.fetch(path, {
      method,
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost',
      },
      body: JSON.stringify(body),
    });
    const json = (await response.json()) as { data: T };
    expect(response.status).toBe(status);
    return json.data;
  };
  expect((await request('/assets')).status).toBe(401);
  const project = await send('/assets', {
    name: '景区',
    type: 'project',
    area: '2000',
    lettableArea: '1000',
  });
  expect(project.number).toMatch(/^ZC[0-9A-F]{20}$/);
  const street = await send('/assets', {
    name: '街区',
    type: 'street',
    parentId: project.id,
  });
  const building = await send('/assets', {
    name: '楼栋',
    type: 'building',
    parentId: street.id,
  });
  const unit = await send('/assets', {
    name: '铺位',
    type: 'unit',
    parentId: building.id,
    area: '20',
    lettableArea: '15',
  });
  const stall = await send('/assets', {
    name: '摊位',
    type: 'stall',
    parentId: street.id,
    area: '3',
    lettableArea: '3',
  });
  await send(
    '/assets',
    { name: '错误', type: 'building', parentId: project.id },
    400,
  );
  await send(
    '/assets',
    { name: '错误', type: 'project', area: '1', lettableArea: '2' },
    400,
  );
  for (const area of ['x', '-1', '1.001'])
    await send('/assets', { name: '非法面积', type: 'project', area }, 400);
  const values = (a: Asset) =>
    Object.fromEntries(
      [
        'name',
        'type',
        'parentId',
        'area',
        'lettableArea',
        'state',
        'address',
        'floor',
        'location',
        'ownershipType',
        'ownerName',
        'ownershipNumber',
        'manager',
        'notes',
      ].map((k) => [k, a[k as keyof Asset]]),
    );
  await send(
    `/assets/${street.id}`,
    {
      values: { ...values(street), parentId: project.id, type: 'unit' },
      expectedVersion: street.version,
      reason: '类型错误',
    },
    400,
    'PATCH',
  );
  const merchant = await send<Row>('/merchants', {
    name: '商户',
    unit: '旧铺位',
    contact: '李',
    phone: '123',
    accountName: '李',
    bank: '银行',
    account: '123',
  });
  const shared = await send<Row>('/merchants', {
    name: '其他商户',
    unit: '独立铺位',
    contact: '王',
    phone: '123',
    accountName: '王',
    bank: '银行',
    account: '123',
  });
  await send(`/merchants/${shared.id}/assets`, {
    requestId: randomUUID(),
    assetId: unit.id,
    start: '2025-01-01',
    end: '2025-12-31',
    area: '15',
  });
  await send(`/merchants/${merchant.id}/assets`, {
    requestId: randomUUID(),
    assetId: stall.id,
    start: '2025-01-01',
    end: '2025-12-31',
    area: '3',
  });
  const binding = {
    assetId: unit.id,
    requestId: randomUUID(),
    start: '2026-01-01',
    end: '2026-12-31',
    area: '12',
  };
  const bound = await send<{ id: string; version: number }>(
    `/merchants/${merchant.id}/assets`,
    binding,
  );
  expect(
    (await send<{ id: string }>(`/merchants/${merchant.id}/assets`, binding))
      .id,
  ).toBe(bound.id);
  await send(
    `/merchants/${merchant.id}/assets`,
    { ...binding, requestId: randomUUID() },
    409,
  );
  // Exclusive usage applies across merchants, including inclusive date boundaries.
  for (const dates of [
    { start: '2026-06-01', end: '2026-06-30' },
    { start: '2025-12-31', end: '2026-01-01' },
    { start: '2026-12-31', end: '2027-01-31' },
    { start: '2026-06-01', end: '' },
  ])
    await send(
      `/merchants/${shared.id}/assets`,
      { ...binding, ...dates, requestId: randomUUID() },
      409,
    );
  const next = {
    ...binding,
    requestId: randomUUID(),
    start: '2027-01-01',
    end: '',
  };
  await send(`/merchants/${shared.id}/assets`, next);
  await send(
    `/merchants/${merchant.id}/assets`,
    {
      ...binding,
      requestId: randomUUID(),
      start: '2028-01-01',
      end: '2028-12-31',
    },
    409,
  );
  // Separately registered units may be occupied in parallel.
  const splitUnit = await send('/assets', {
    name: '独立铺位B',
    type: 'unit',
    parentId: building.id,
    area: '30',
    lettableArea: '15',
  });
  await send(`/merchants/${shared.id}/assets`, {
    ...binding,
    requestId: randomUUID(),
    assetId: splitUnit.id,
  });
  await send(
    `/merchants/${merchant.id}/assets`,
    { ...binding, assetId: building.id, requestId: randomUUID() },
    400,
  );
  const contractValues = {
    merchantId: merchant.id,
    assetIds: [unit.id],
    start: '2026-10-01',
    end: '2026-10-31',
    cycle: 'month',
    method: 'fixed',
    basis: 'receipts',
    rate: '0',
    fixedFee: '100',
    minimum: '0',
    rent: '0',
    includeActivity: true,
    includeCash: true,
    includeHospitality: false,
  };
  const contract = await send<Row>('/contracts', contractValues);
  const edited = await send(
    `/assets/${unit.id}`,
    {
      values: { ...values(unit), name: '铺位新名称' },
      expectedVersion: unit.version,
      reason: '更名',
    },
    200,
    'PATCH',
  );
  const snapshots = (await (
    await admin.fetch(`/contracts/${contract.id}/assets`)
  ).json()) as { data: { snapshot: { name: string } }[] };
  expect(snapshots.data[0]?.snapshot.name).toBe('铺位');
  const associations = (await (
    await admin.fetch(`/assets/${unit.id}/associations`)
  ).json()) as {
    data: { restricted: boolean; merchants: unknown[]; contracts: unknown[] };
  };
  expect(associations.data.restricted).toBe(false);
  expect(associations.data.merchants).toHaveLength(3);
  expect(associations.data.contracts).toHaveLength(1);
  await send(
    `/contracts/${contract.id}`,
    {
      values: { ...contractValues, end: '2027-01-01' },
      expectedVersion: contract.version,
    },
    400,
    'PATCH',
  );
  const unchanged = (await (
    await admin.fetch(`/contracts/${contract.id}`)
  ).json()) as { data: Row };
  expect(unchanged.data.payload.end).toBe('2026-10-31');
  await send(
    `/merchants/${merchant.id}/assets/${bound.id}/close`,
    { end: '2026-10-01', reason: '提前结束', expectedVersion: 0 },
    400,
  );
  await send(
    `/assets/${unit.id}`,
    {
      values: { ...values(edited), state: 'inactive' },
      expectedVersion: edited.version,
      reason: '停用',
    },
    400,
    'PATCH',
  );
  await send(
    `/assets/${unit.id}`,
    { values: values(unit), expectedVersion: unit.version, reason: '旧版本' },
    409,
    'PATCH',
  );
  const history = (await (
    await admin.fetch(`/assets/${unit.id}/history`)
  ).json()) as { data: { action: string; reason: string }[] };
  expect(
    history.data.some((h) => h.action === 'edit' && h.reason === '更名'),
  ).toBe(true);
  const sorted = (await (
    await admin.fetch('/assets?type=unit&orderBy=area:asc')
  ).json()) as { data: Asset[] };
  expect(sorted.data[0]?.id).toBe(unit.id);
  const tree = (await (await admin.fetch('/assetsTree?pageSize=2')).json()) as {
    data: unknown[];
    meta: { total: number };
  };
  expect(tree.data).toHaveLength(2);
  expect(tree.meta.total).toBe(6);
  await send(
    `/assets/${stall.id}`,
    {
      values: { ...values(stall), state: 'inactive' },
      expectedVersion: stall.version,
      reason: '停用摊位',
    },
    200,
    'PATCH',
  );
});
test('asset access defaults, read-only permissions and private attachment lifecycle', async ({
  testApp,
  request,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const users = testApp.application.container.resolve(
    userManagementServiceToken,
  );
  const user = await users.create({
    name: 'asset-reader',
    email: 'assets@example.com',
    password: 'password123',
  });
  const reader = await signIn(testApp, {
    email: 'assets@example.com',
    password: 'password123',
  });
  expect((await reader.fetch('/assets')).status).toBe(403);
  const authz = testApp.application.container.resolve(authorizationToken);
  await authz.permissionSets.create(
    definePermissionSet('asset-reader')
      .grant(
        assetResource.reference().grant({ read: { records: 'allRecords' } }),
      )
      .build(),
  );
  await authz.permissionSets.assign({
    permissionSet: 'asset-reader',
    subject: { type: 'user', id: user.id },
  });
  expect((await reader.fetch('/assets')).status).toBe(200);
  const post = (session: typeof admin, path: string, body: unknown) =>
    session.fetch(path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost',
      },
      body: JSON.stringify(body),
    });
  expect(
    (await post(reader, '/assets', { name: '无权', type: 'project' })).status,
  ).toBe(403);
  const project = (await (
    await post(admin, '/assets', { name: '附件项目', type: 'project' })
  ).json()) as { data: Asset };
  const pdf = await PDFDocument.create();
  pdf.addPage();
  const bytes = new Uint8Array(await pdf.save());
  const uploadId = randomUUID();
  const upload = () => {
    const form = new FormData();
    form.append(
      'file',
      new File([bytes], 'drawing.pdf', { type: 'application/pdf' }),
    );
    return admin.fetch(
      `/assetFiles/uploadOne?assetId=${project.data.id}&uploadId=${uploadId}`,
      { method: 'POST', headers: { origin: 'http://localhost' }, body: form },
    );
  };
  const response = await upload();
  const uploaded = (await response.json()) as {
    data: { record: { id: string; contentUrl?: string } };
  };
  expect(response.status).toBe(201);
  const fileId = uploaded.data.record.id;
  expect((await upload()).status).toBe(201);
  expect(
    (await request(`http://localhost/main/uploads/assets/${fileId}.pdf`))
      .status,
  ).toBe(401);
  expect(
    (await reader.fetch(`http://localhost/main/uploads/assets/${fileId}.pdf`))
      .status,
  ).toBe(403);
  expect(
    (
      await post(admin, `/assets/${project.data.id}/files`, {
        fileId,
        title: '总平面图',
        category: 'drawing',
      })
    ).status,
  ).toBe(201);
  const list = (await (
    await reader.fetch(`/assets/${project.data.id}/files`)
  ).json()) as { data: { contentUrl: string }[] };
  expect(list.data).toHaveLength(1);
  expect(
    (await reader.fetch(`http://localhost/main/uploads/assets/${fileId}.pdf`))
      .status,
  ).toBe(200);
  expect(
    (
      await post(admin, `/assetFiles/deleteOne?assetId=${project.data.id}`, {
        filter: { id: fileId },
      })
    ).status,
  ).toBe(409);
  const pendingForm = new FormData();
  pendingForm.append(
    'file',
    new File([bytes], 'pending.pdf', { type: 'application/pdf' }),
  );
  const pendingResponse = await admin.fetch(
    `/assetFiles/uploadOne?assetId=${project.data.id}&uploadId=${randomUUID()}`,
    {
      method: 'POST',
      headers: { origin: 'http://localhost' },
      body: pendingForm,
    },
  );
  expect(pendingResponse.status).toBe(201);
  const pendingFile = (
    (await pendingResponse.json()) as { data: { record: { id: string } } }
  ).data.record;
  const disk = testApp.application.container
    .resolve(driveManagerToken)
    .use('local');
  const deletion = vi
    .spyOn(disk, 'delete')
    .mockRejectedValueOnce(new Error('storage unavailable'));
  expect(
    (
      await post(admin, `/assetFiles/deleteOne?assetId=${project.data.id}`, {
        filter: { id: pendingFile.id },
      })
    ).status,
  ).toBe(500);
  const recovery = (await (
    await admin.fetch(`/assets/${project.data.id}/fileUploads`)
  ).json()) as { data: { cleanupIds: string[] } };
  expect(recovery.data.cleanupIds).toContain(pendingFile.id);
  expect(
    (
      await post(admin, `/assetFiles/deleteOne?assetId=${project.data.id}`, {
        filter: { id: pendingFile.id },
      })
    ).status,
  ).toBe(200);
  deletion.mockRestore();
  expect(
    await testApp.database
      .repository('hylAssetFileCleanup')
      .exists({ filter: { id: pendingFile.id } }),
  ).toBe(false);
  const otherProject = (await (
    await post(admin, '/assets', { name: 'Other', type: 'project' })
  ).json()) as { data: Asset };
  expect(
    (
      await post(admin, `/assets/${otherProject.data.id}/files`, {
        fileId,
        title: 'cross asset',
        category: 'drawing',
      })
    ).status,
  ).toBe(409);
  const download = await reader.fetch(
    `http://localhost/main/uploads/assets/${fileId}.pdf`,
  );
  expect(download.headers.get('cache-control')).toBe('private, no-store');
  expect(new Uint8Array(await download.arrayBuffer())).toEqual(bytes);
  const form = new FormData();
  form.append(
    'file',
    new File(['bad'], 'fake.pdf', { type: 'application/pdf' }),
  );
  expect(
    (
      await admin.fetch(`/assetFiles/uploadOne?assetId=${project.data.id}`, {
        method: 'POST',
        headers: { origin: 'http://localhost' },
        body: form,
      })
    ).status,
  ).toBe(400);
});

test('record scope hides assets, files, history and unrelated identities; default grants stay editable', async ({
  testApp,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const authz = testApp.application.container.resolve(authorizationToken);
  const users = testApp.application.container.resolve(
    userManagementServiceToken,
  );
  const user = await users.create({
    name: 'Scoped assets',
    email: 'scope-assets@example.com',
    password: 'password123',
  });
  const scoped = await signIn(testApp, {
    email: 'scope-assets@example.com',
    password: 'password123',
  });
  const create = async (name: string) => {
    const response = await admin.fetch('/assets', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost',
      },
      body: JSON.stringify({ name, type: 'project' }),
    });
    expect(response.status).toBe(201);
    return ((await response.json()) as { data: Asset }).data;
  };
  const own = await create('Visible'),
    hidden = await create('Hidden');
  authz.recordAccess.define(
    defineRecordAccess('assets.testScope', (scope) =>
      scope
        .title('Test')
        .collections('hylAssets')
        .resolver(() => buildFilter((f) => f.string('id').eq(own.id))),
    ),
  );
  await authz.permissionSets.create(
    definePermissionSet('asset-scope-test')
      .grant(
        assetResource
          .reference()
          .grant({ read: { records: 'assets.testScope' } }),
      )
      .build(),
  );
  await authz.permissionSets.assign({
    permissionSet: 'asset-scope-test',
    subject: { type: 'user', id: user.id },
  });
  const list = (await (await scoped.fetch('/assets')).json()) as {
    data: Asset[];
    meta: { total: number };
  };
  expect(list.data.map((a) => a.id)).toEqual([own.id]);
  expect(list.meta.total).toBe(1);
  for (const suffix of ['', '/files', '/history', '/associations'])
    expect((await scoped.fetch(`/assets/${hidden.id}${suffix}`)).status).toBe(
      404,
    );
  const related = (await (
    await scoped.fetch(`/assets/${own.id}/associations`)
  ).json()) as {
    data: { merchants: unknown[]; contracts: unknown[]; restricted: boolean };
  };
  expect(related.data).toEqual({
    merchants: [],
    contracts: [],
    restricted: true,
  });
  for (const key of ['hyl-finance', 'hyl-observer']) {
    const set = await authz.permissionSets.get(key);
    expect(set?.grants.some((g) => g.resource.id === 'hyl.assets')).toBe(true);
  }
  const finance = (await authz.permissionSets.get('hyl-finance'))!;
  await authz.permissionSets.update('hyl-finance', {
    key: finance.key,
    title: finance.title,
    grants: finance.grants.filter((g) => g.resource.id !== 'hyl.assets'),
  });
  await provisionAssetDefaults(authz, testApp.database);
  expect(
    (await authz.permissionSets.get('hyl-finance'))?.grants.some(
      (g) => g.resource.id === 'hyl.assets',
    ),
  ).toBe(false);
  const swagger = (await (await admin.fetch('/swagger')).json()) as {
    paths: Record<string, unknown>;
  };
  expect(
    Object.keys(swagger.paths).some((path) =>
      path.endsWith('/assets/{id}/history'),
    ),
  ).toBe(true);
});
