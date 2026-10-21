// @vitest-environment node
import { PDFDocument } from 'pdf-lib';
import { randomBytes, randomUUID } from 'node:crypto';
import { expect, vi } from 'vitest';
import { userManagementServiceToken } from '@nocobase/app-plugin-users/server/tokens';
import { driveManagerToken } from '@nocobase/app-server/drive';
import { authorizationToken } from '@nocobase/app-plugin-authorization';
import { definePermissionSet } from '@nocobase/authorization/permission-sets';
import { resources } from '../../server/hyl/resources.js';
import { createAppTest } from '@nocobase/app-testing/server';
import {
  signIn,
  DEFAULT_ADMIN_CREDENTIALS,
} from '@nocobase/app-plugin-authentication/testing';
import { createStandaloneServer } from '../../server/standalone.js';
const test = createAppTest({
  createServer: createStandaloneServer,
  config: {
    secrets: { keys: [{ version: 1, key: randomBytes(32).toString('hex') }] },
    logging: { enabled: false },
  },
});
test('stores append-only follow-ups with authorization, validation and idempotency', async ({
  testApp,
  request,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const post = (path: string, body: unknown) =>
    admin.fetch(path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost',
      },
      body: JSON.stringify(body),
    });
  const m = await post('/merchants', {
    code: 'profile-test',
    name: '测试商户',
    unit: 'A1',
    contact: '李',
    phone: '123',
    accountName: '李',
    bank: '银行',
    account: '123',
  });
  expect(m.status).toBe(201);
  const { data: merchant } = (await m.json()) as { data: { id: string } };
  const path = `/merchants/${merchant.id}/interactions`;
  expect((await request(path + '?type=visit')).status).toBe(401);
  const values = {
    requestId: randomUUID(),
    type: 'visit',
    date: '2026-10-14',
    person: '张三',
    content: '现场走访，确认营业时间',
    outcome: '已确认',
    nextDate: '2026-10-15',
  };
  const first = await post(path, values);
  expect(first.status).toBe(201);
  const a = (await first.json()) as {
    data: { id: string; actor: string; payload: Record<string, unknown> };
  };
  expect(a.data.actor).toBe(admin.user.id);
  const retry = await post(path, values);
  expect(retry.status).toBe(201);
  expect(((await retry.json()) as typeof a).data.id).toBe(a.data.id);
  expect((await post(path, { ...values, content: 'changed' })).status).toBe(
    409,
  );
  expect(
    (
      await post(path, {
        ...values,
        requestId: randomUUID(),
        nextDate: '2026-10-01',
      })
    ).status,
  ).toBe(400);
  expect(
    (await post(path, { ...values, requestId: randomUUID(), type: 'contact' }))
      .status,
  ).toBe(400);
  expect(
    (await post(path, { ...values, requestId: randomUUID(), actor: 'forged' }))
      .status,
  ).toBe(400);
  expect(
    (
      await post(path, {
        ...values,
        requestId: randomUUID(),
        type: 'contact',
        channel: '电话',
      })
    ).status,
  ).toBe(201);
  const list = await admin.fetch(path + '?type=visit');
  const body = (await list.json()) as {
    data: unknown[];
    meta: { total: number };
  };
  expect(body.meta.total).toBe(1);
  expect(body.data).toHaveLength(1);
  expect(
    (
      await post(`/merchants/${randomUUID()}/interactions`, {
        ...values,
        requestId: randomUUID(),
      })
    ).status,
  ).toBe(404);
});

test('protects certificate uploads, binding and downloads by merchant scope', async ({
  testApp,
  request,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const password = randomBytes(24).toString('hex');
  const member = await testApp.application.container
    .resolve(userManagementServiceToken)
    .create({
      name: 'Profile scope',
      email: 'profile-scope@example.test',
      password,
    });
  const limited = await signIn(testApp, { email: member.email, password });
  const post = (path: string, body: unknown, session = admin) =>
    session.fetch(path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost',
      },
      body: JSON.stringify(body),
    });
  const merchant = async (code: string, userId = '') => {
    const response = await post('/merchants', {
      code,
      name: code,
      unit: 'A1',
      contact: 'Test',
      phone: '123',
      accountName: 'Test',
      bank: 'Test',
      account: '123',
      userId,
    });
    expect(response.status).toBe(201);
    return ((await response.json()) as { data: { id: string } }).data;
  };
  const own = await merchant('files-own', member.id),
    other = await merchant('files-other');
  const authz = testApp.application.container.resolve(authorizationToken);
  const upload = (id: string, file: File, session = limited) => {
    const body = new FormData();
    body.append('file', file);
    return session.fetch(`/merchantLicenseFiles/uploadOne?merchantId=${id}`, {
      method: 'POST',
      headers: { origin: 'http://localhost' },
      body,
    });
  };
  const document = await PDFDocument.create();
  document.addPage();
  const originalPdf = new Uint8Array(await document.save());
  // A PDF magic header alone is insufficient; malformed uploads must fail closed.

  const pdf = () =>
    new File([originalPdf], 'license.pdf', { type: 'application/pdf' });
  expect(
    (await request('/merchantLicenseFiles/uploadOne', { method: 'POST' }))
      .status,
  ).toBe(401);
  expect((await upload(own.id, pdf())).status).toBe(403);
  await authz.permissionSets.create(
    definePermissionSet('profile-scope')
      .grant(
        resources.merchants.reference().grant({
          read: { records: 'hyl.ownMerchant' },
          write: { records: 'hyl.ownMerchant' },
        }),
      )
      .build(),
  );
  const assignment = await authz.permissionSets.assign({
    permissionSet: 'profile-scope',
    subject: { type: 'user', id: member.id },
  });
  expect([403, 404]).toContain((await upload(other.id, pdf())).status);
  expect(
    (
      await upload(
        own.id,
        new File(['<script>'], 'fake.pdf', { type: 'application/pdf' }),
      )
    ).status,
  ).toBe(415);
  expect(
    (
      await upload(
        own.id,
        new File(['x'.repeat(10 * 1024 * 1024 + 1)], 'large.pdf', {
          type: 'application/pdf',
        }),
      )
    ).status,
  ).toBe(413);
  const uploadId = randomUUID();
  const uploadRetry = async () => {
    const body = new FormData();
    body.append('file', pdf());
    return limited.fetch(
      `/merchantLicenseFiles/uploadOne?merchantId=${own.id}&uploadId=${uploadId}`,
      { method: 'POST', headers: { origin: 'http://localhost' }, body },
    );
  };
  const response = await uploadRetry();
  if (!response.ok) throw new Error(await response.text());
  expect(response.status).toBe(201);
  const file = (
    (await response.json()) as {
      data: { record: { id: string; contentUrl: string } };
    }
  ).data.record;
  const replay = await uploadRetry();
  expect(replay.status).toBe(201);
  expect(
    ((await replay.json()) as { data: { record: { id: string } } }).data.record
      .id,
  ).toBe(file.id);
  const unfinished = await limited.fetch(`/merchants/${own.id}/licenseUploads`);
  expect(
    (
      (await unfinished.json()) as { data: { files: { id: string }[] } }
    ).data.files.map((row) => row.id),
  ).toContain(file.id);
  expect(
    (
      await upload(
        own.id,
        new File(['%PDF-broken'], 'broken.pdf', { type: 'application/pdf' }),
      )
    ).status,
  ).toBe(400);
  const url = `http://localhost${file.contentUrl}`;
  expect((await request(url)).status).toBe(401);
  const watermarked = await limited.fetch(url);
  expect(watermarked.status).toBe(200);
  expect(watermarked.headers.get('cache-control')).toBe('private, no-store');
  const downloaded = new Uint8Array(await watermarked.arrayBuffer());
  expect(Buffer.from(downloaded).equals(Buffer.from(originalPdf))).toBe(false);
  expect((await PDFDocument.load(downloaded)).getPageCount()).toBe(1);
  const head = await limited.fetch(url, { method: 'HEAD' });
  expect(head.status).toBe(200);
  expect(head.headers.get('content-type')).toBe('application/pdf');
  expect(await head.text()).toBe('');
  const ranged = await limited.fetch(url, { headers: { Range: 'bytes=0-9' } });
  expect(ranged.status).toBe(200);
  expect((await ranged.arrayBuffer()).byteLength).toBeGreaterThan(10);
  const license = {
    requestId: randomUUID(),
    name: '营业执照',
    category: '营业执照',
    fileId: file.id,
    permanent: true,
  };
  expect((await post(`/merchants/${other.id}/licenses`, license)).status).toBe(
    409,
  );
  const saved = await post(`/merchants/${own.id}/licenses`, license, limited);
  expect(saved.status).toBe(201);
  expect(
    (await post(`/merchants/${own.id}/licenses`, license, limited)).status,
  ).toBe(201);
  const rows = await limited.fetch(`/merchants/${own.id}/licenses`);
  const body = (await rows.json()) as {
    data: { file: { contentUrl: string; key?: string } }[];
    meta: { total: number };
  };
  expect(body.meta.total).toBe(1);
  expect(body.data[0].file.contentUrl).toBe(file.contentUrl);
  expect(body.data[0].file.key).toBeUndefined();
  expect(
    (
      await post(
        `/merchantLicenseFiles/deleteOne?merchantId=${own.id}`,
        { filter: { id: file.id } },
        limited,
      )
    ).status,
  ).toBe(409);
  expect((await limited.fetch(url)).status).toBe(200);
  const tempResponse = await upload(own.id, pdf());
  const tempFile = (
    (await tempResponse.json()) as { data: { record: { id: string } } }
  ).data.record;
  const stored = await testApp.database
    .repository<{ id: string; key: string; disk: string; ownerId: string }>(
      'hylMerchantFiles',
    )
    .findOne({ filter: { id: tempFile.id } });
  expect(stored?.ownerId).toBe(member.id);
  const disk = testApp.application.container
    .resolve(driveManagerToken)
    .use(stored!.disk);
  expect(await disk.exists(stored!.key)).toBe(true);
  const deletion = vi
    .spyOn(disk, 'delete')
    .mockRejectedValueOnce(new Error('simulated disk failure'));
  expect(
    (
      await post(
        `/merchantLicenseFiles/deleteOne?merchantId=${own.id}`,
        { filter: { id: tempFile.id } },
        limited,
      )
    ).status,
  ).toBe(500);
  expect(
    await testApp.database
      .repository('hylMerchantFileCleanup')
      .exists({ filter: { id: tempFile.id } }),
  ).toBe(true);

  expect(
    (
      await post(
        `/merchantLicenseFiles/deleteOne?merchantId=${own.id}`,
        { filter: { id: tempFile.id } },
        limited,
      )
    ).status,
  ).toBe(200);
  expect(
    await testApp.database
      .repository('hylMerchantFiles')
      .exists({ filter: { id: tempFile.id } }),
  ).toBe(false);
  expect(await disk.exists(stored!.key)).toBe(false);
  deletion.mockRestore();
  expect(
    await testApp.database
      .repository('hylMerchantFileCleanup')
      .exists({ filter: { id: tempFile.id } }),
  ).toBe(false);
  await authz.permissionSets.revoke(assignment.id);
  expect((await limited.fetch(url)).status).toBe(403);
  expect((await limited.fetch(`/merchants/${own.id}/licenses`)).status).toBe(
    403,
  );
  expect(
    (await limited.fetch(`/merchants/${own.id}/interactions?type=visit`))
      .status,
  ).toBe(403);
});
test('edits identity and opening hours without losing existing merchant fields', async ({
  testApp,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const values = {
    name: '档案编辑测试',
    unit: 'A01',
    contact: '张三',
    phone: '123',
    accountName: '张三',
    bank: '银行',
    account: '123',
  };
  const create = await admin.fetch('/merchants', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost' },
    body: JSON.stringify(values),
  });
  expect(create.status).toBe(201);
  const row = (
    (await create.json()) as { data: { id: string; version: number } }
  ).data;
  const changed = {
    ...values,
    category: 'other',
    categoryName: '民宿',
    legalRepresentative: '李四',
    creditCode: '91370200123456789X',
    businessHours: '周一至周日 09:00–次日01:00',
  };
  const response = await admin.fetch(`/merchants/${row.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', origin: 'http://localhost' },
    body: JSON.stringify({ values: changed, expectedVersion: row.version }),
  });
  expect(response.status).toBe(200);
  const detail = await admin.fetch(`/merchants/${row.id}`);
  expect(
    ((await detail.json()) as { data: { payload: unknown } }).data.payload,
  ).toMatchObject(changed);
  const saved = await admin.fetch(`/merchants/${row.id}`);
  const savedRow = ((await saved.json()) as { data: { version: number } }).data;
  const switchCategory = await admin.fetch(`/merchants/${row.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', origin: 'http://localhost' },
    body: JSON.stringify({
      expectedVersion: savedRow.version,
      values: { ...changed, category: 'merchantRetail' },
    }),
  });
  expect(switchCategory.status).toBe(200);
  expect(
    ((await switchCategory.json()) as { data: { payload: unknown } }).data
      .payload,
  ).toMatchObject({ category: 'merchantRetail', categoryName: '' });
}, 5000);

test('generates unique merchant numbers and preserves generated and legacy numbers on edit', async ({
  testApp,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const values = {
    name: '自动编号商户',
    unit: 'A1',
    contact: '张三',
    phone: '123',
    accountName: '张三',
    bank: '银行',
    account: '123',
  };
  const send = (path: string, body: unknown, method = 'POST') =>
    admin.fetch(path, {
      method,
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost',
      },
      body: JSON.stringify(body),
    });
  type Merchant = {
    id: string;
    number: string;
    version: number;
    payload: Record<string, unknown>;
  };
  const responses = await Promise.all([
    send('/merchants', values),
    send('/merchants', { ...values, code: 'client-number' }),
  ]);
  const rows: Merchant[] = [];
  for (const response of responses) {
    expect(response.status).toBe(201);
    const row = ((await response.json()) as { data: Merchant }).data;
    expect(row.number).toMatch(/^SH[0-9A-F]{24}$/);
    expect(row.payload.code).toBe(row.number);
    rows.push(row);
  }
  expect(rows[0].number).not.toBe(rows[1].number);
  const edit = await send(
    `/merchants/${rows[0].id}`,
    {
      expectedVersion: rows[0].version,
      values: { ...values, code: 'tampered', name: '修改名称' },
    },
    'PATCH',
  );
  expect(edit.status).toBe(200);
  const edited = ((await edit.json()) as { data: Merchant }).data;
  expect(edited.number).toBe(rows[0].number);
  expect(edited.payload).toMatchObject({
    code: rows[0].number,
    name: '修改名称',
  });
  // Model an existing installation's manually assigned number; no migration should renumber it.
  await testApp.database.repository('hylMerchants').updateOne({
    filter: { id: rows[1].id },
    values: {
      number: 'OLD-001',
      payload: { ...rows[1].payload, code: 'OLD-001' },
    },
  });
  const legacyEdit = await send(
    `/merchants/${rows[1].id}`,
    {
      expectedVersion: rows[1].version,
      values,
    },
    'PATCH',
  );
  expect(legacyEdit.status).toBe(200);
  const legacy = ((await legacyEdit.json()) as { data: Merchant }).data;
  expect(legacy.number).toBe('OLD-001');
  expect(legacy.payload.code).toBe('OLD-001');
});

test('creates a merchant and staged license atomically with owner isolation and idempotent retries', async ({
  testApp,
  request,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const id = randomUUID();
  const document = await PDFDocument.create();
  document.addPage();
  const file = new File(
    [new Uint8Array(await document.save())],
    '营业执照.pdf',
    { type: 'application/pdf' },
  );
  const form = new FormData();
  form.append('file', file);
  const upload = await admin.fetch(
    `/merchantLicenseFiles/uploadOne?merchantId=${id}&uploadId=${randomUUID()}`,
    { method: 'POST', headers: { origin: 'http://localhost' }, body: form },
  );
  expect(upload.status).toBe(201);
  const attachment = (
    (await upload.json()) as {
      data: { record: { id: string; contentUrl: string } };
    }
  ).data.record;
  expect(
    await testApp.database
      .repository('hylMerchants')
      .exists({ filter: { id } }),
  ).toBe(false);
  expect(
    (await admin.fetch(`http://localhost${attachment.contentUrl}`)).status,
  ).toBe(200);
  expect(
    (await request(`http://localhost${attachment.contentUrl}`)).status,
  ).toBe(401);
  const recovered = await admin.fetch(`/merchants/${id}/licenseUploads`);
  expect(
    (
      (await recovered.json()) as { data: { files: { id: string }[] } }
    ).data.files.map((f) => f.id),
  ).toContain(attachment.id);
  const values = {
    name: '一并保存测试',
    unit: 'B1',
    contact: '张三',
    phone: '123',
    accountName: '张三',
    bank: '银行',
    account: '123',
    creationId: id,
    licenseFileId: attachment.id,
  };
  const create = (body: unknown) =>
    admin.fetch('/merchants', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost',
      },
      body: JSON.stringify(body),
    });
  const failedId = randomUUID();
  expect((await create({ ...values, creationId: failedId })).status).toBe(409);
  expect(
    await testApp.database
      .repository('hylMerchants')
      .exists({ filter: { id: failedId } }),
  ).toBe(false);
  expect(
    await testApp.database
      .repository('hylMerchantCreations')
      .exists({ filter: { id: failedId } }),
  ).toBe(false);
  expect(
    (
      await testApp.database
        .repository('hylMerchantFiles')
        .findOne({ filter: { id: attachment.id } })
    )?.linked,
  ).toBe(false);
  const users = testApp.application.container.resolve(
    userManagementServiceToken,
  );
  const password = randomBytes(24).toString('hex');
  const user = await users.create({
    name: 'Other uploader',
    email: 'other-uploader@example.test',
    password,
    roleScopes: { app: ['hyl-finance'] },
  });
  const other = await signIn(testApp, { email: user.email, password });
  expect(
    (await other.fetch(`http://localhost${attachment.contentUrl}`)).status,
  ).toBe(403);
  const foreignClaim = await other.fetch('/merchants', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost' },
    body: JSON.stringify(values),
  });
  expect(foreignClaim.status).toBe(409);
  expect(
    await testApp.database
      .repository('hylMerchants')
      .exists({ filter: { id } }),
  ).toBe(false);
  const results = await Promise.all([create(values), create(values)]);
  for (const result of results) {
    expect(result.status).toBe(201);
    expect(((await result.json()) as { data: { id: string } }).data.id).toBe(
      id,
    );
  }
  expect(
    await testApp.database
      .repository('hylMerchantRecords')
      .count({ filter: { merchantId: id, type: 'license' } }),
  ).toBe(1);
  expect(
    (
      await testApp.database
        .repository('hylMerchantFiles')
        .findOne({ filter: { id: attachment.id } })
    )?.linked,
  ).toBe(true);
  expect((await create({ ...values, name: 'changed retry' })).status).toBe(409);
  const licenses = await admin.fetch(`/merchants/${id}/licenses`);
  expect(
    (
      (await licenses.json()) as {
        data: { payload: { fileId: string; name: string } }[];
      }
    ).data[0].payload,
  ).toMatchObject({ fileId: attachment.id, name: '营业执照' });
  const edited = await admin.fetch(`/merchants/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', origin: 'http://localhost' },
    body: JSON.stringify({ expectedVersion: 0, values }),
  });
  expect(edited.status).toBe(400);
});
