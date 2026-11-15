// @vitest-environment node
import { randomBytes, randomUUID } from 'node:crypto';
import { expect, vi } from 'vitest';
import sharp from 'sharp';
import { createAppTest } from '@nocobase/app-testing/server';
import {
  signIn,
  DEFAULT_ADMIN_CREDENTIALS,
} from '@nocobase/app-plugin-authentication/testing';
import { createStandaloneServer } from '../../server/standalone.js';
import { repairToday } from '../../server/repairs/service.js';
import type { Row } from '../../server/hyl/schema.js';
import { hylToken } from '../../server/providers/hyl.js';
import { merchantMiniappToken } from '../../server/providers/merchant-miniapp.js';
import type { Bill } from '../../server/billing/model.js';

const appId = 'wx0123456789abcdef';
const test = createAppTest({
  createServer: createStandaloneServer,
  config: {
    secrets: { keys: [{ version: 1, key: randomBytes(32).toString('hex') }] },
    logging: { enabled: false },
    merchantMiniapp: { enabled: true, appId, appSecret: 'test-only-secret' },
  },
});
const prefix = '/merchantMiniapp';
const phoneA = '13800000001',
  phoneB = '13800000002',
  ungrantedPhone = '13800000003';
test('serves real ERP rows to verified merchants, with images, lifecycle events, cross-merchant isolation and immediate partial/full revocation', async ({
  testApp,
  request,
}) => {
  const admin = await signIn(testApp, DEFAULT_ADMIN_CREDENTIALS);
  const fake = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input) => {
      const url = new URL(String(input));
      expect(url.origin).toBe('https://api.weixin.qq.com');
      if (url.pathname === '/sns/jscode2session') {
        expect(url.searchParams.get('appid')).toBe(appId);
        const code = url.searchParams.get('js_code') ?? '';
        return Response.json(
          code.startsWith('bad')
            ? { errcode: 40029 }
            : { openid: 'openid-' + code.split('-')[0], session_key: 'unused' },
        );
      }
      if (url.pathname === '/cgi-bin/token')
        return Response.json({
          access_token: 'test-only-platform-token',
          expires_in: 7200,
        });
      if (url.pathname === '/wxa/business/getuserphonenumber') {
        // Request body is checked by the separate verifier test; choose the verified phone via each test code.
        const current = phoneFixtures.shift();
        return Response.json({
          errcode: 0,
          phone_info: {
            purePhoneNumber: current?.phone,
            countryCode: '86',
            watermark: {
              appid: current?.appId ?? appId,
              timestamp: Math.floor(Date.now() / 1000),
            },
          },
        });
      }
      throw Error('Unexpected outbound request');
    });
  const phoneFixtures: { phone: string; appId?: string }[] = [];
  const post = (body: unknown, method = 'POST', token = ''): RequestInit => ({
    method,
    headers: {
      origin: 'http://localhost',
      'content-type': 'application/json',
      ...(token && { authorization: 'Bearer ' + token }),
    },
    body: JSON.stringify(body),
  });
  const client = (token: string, path: string, init: RequestInit = {}) =>
    request(path, {
      ...init,
      headers: { ...init.headers, authorization: 'Bearer ' + token },
    });
  async function read<T>(
    response: Promise<Response>,
    status = 200,
  ): Promise<T> {
    const r = await response,
      body = await r.json();
    if (r.status !== status)
      throw new Error(
        `Expected ${status}, received ${r.status}: ${JSON.stringify(body)}`,
      );
    return body.data as T;
  }
  const create = <T>(path: string, body: unknown) =>
    read<T>(admin.fetch(path, post(body)), 201);
  const today = repairToday();
  const month = today.slice(0, 7);
  const monthEnd = new Date(
    Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0),
  )
    .toISOString()
    .slice(0, 10);
  try {
    const project = await create<{ id: string }>('/assets', {
      name: 'Mini-program test project',
      type: 'project',
    });
    const street = await create<{ id: string }>('/assets', {
      name: 'Test street',
      type: 'street',
      parentId: project.id,
    });
    async function shop(label: string, contactPhone: string) {
      const merchant = await create<Row>('/merchants', {
        name: label,
        unit: label,
        contact: 'Test',
        phone: contactPhone,
        accountName: 'Test',
        bank: 'Test',
        account: '0',
      });
      const asset = await create<{ id: string }>('/assets', {
        name: label + ' unit',
        type: 'unit',
        parentId: street.id,
        area: '10',
        lettableArea: '10',
      });
      await create('/merchants/' + merchant.id + '/assets', {
        requestId: randomUUID(),
        assetId: asset.id,
        start: month + '-01',
        area: '10',
      });
      const contract = await create<Row>('/contracts', {
        merchantId: merchant.id,
        title: label,
        assetIds: [asset.id],
        start: month + '-01',
        end: monthEnd,
        cycle: 'month',
        method: 'fixed',
        basis: 'receipts',
        rate: '0',
        fixedFee: '0',
        minimum: '0',
        rent: '3100',
        includeActivity: true,
        includeCash: true,
        includeHospitality: false,
      });
      return {
        merchant,
        asset,
        contract,
        path: prefix + '/merchants/' + merchant.id,
      };
    }
    // A contact number by itself must not act as an app grant.
    const a = await shop('TEST A', ungrantedPhone),
      b = await shop('TEST B', ungrantedPhone),
      c = await shop('TEST C', ungrantedPhone);
    const set = (shop: typeof a, phone: string, active = true) =>
      read<{ active: boolean }>(
        admin.fetch(shop.path + '/grants', post({ phone, active }, 'PUT')),
      );
    await set(a, phoneA);
    await set(b, phoneB);
    await set(c, phoneA);
    async function login(
      subject: string,
      phone: string,
      status = 200,
      options: { appId?: string; proof?: string } = {},
    ) {
      const proof = options.proof ?? randomUUID();
      if (!subject.startsWith('bad'))
        phoneFixtures.push({ phone, appId: options.appId });
      return read<{ token: string }>(
        request(
          prefix + '/signIn',
          post({ loginCode: subject + '-' + proof, phoneCode: proof }),
        ),
        status,
      );
    }
    await login('C', ungrantedPhone, 403);
    await login('D', phoneA, 401, { appId: 'wx1111111111111111' });
    await login('bad', phoneA, 401);
    const replay = randomUUID();
    let { token } = await login('A', phoneA, 200, { proof: replay });
    await login('A', phoneA, 403, { proof: replay });
    await login('A', phoneB, 403);
    const { token: other } = await login('B', phoneB);
    expect((await request(prefix + '/merchants')).status).toBe(401);
    expect((await client(token, '/merchants')).status).toBe(403);
    const hyl = testApp.application.container.resolve(hylToken);
    const identity = await testApp.database
      .repository<{ phone: string; userId: string }>('hylMiniappIdentities')
      .findOne({ filter: { phone: phoneA } });
    const user = await hyl.users.get(identity!.userId);
    const otherPassword = randomBytes(36).toString('base64url');
    await hyl.users.resetPassword(user!.id, otherPassword);
    const passwordSession = await signIn(testApp, {
      email: user!.email,
      password: otherPassword,
    });
    expect((await passwordSession.fetch(prefix + '/merchants')).status).toBe(
      403,
    );
    expect((await client(token, prefix + '/merchants')).status).toBe(401);
    ({ token } = await login('A', phoneA));

    expect(
      (
        await client(
          token,
          a.path + '/grants',
          post({ phone: phoneB, active: true }, 'PUT'),
        )
      ).status,
    ).toBe(403);
    const shops = await read<{ id: string }[]>(
      client(token, prefix + '/merchants'),
    );
    expect(shops.map((s) => s.id)).toEqual([a.merchant.id, c.merchant.id]);
    expect((await client(token, b.path + '/bills')).status).toBe(403);
    expect((await client(token, a.path + '/assets')).status).toBe(200);

    const draftInput = {
      date: month + '-01',
      amount: '123.45',
      orders: 7,
      note: '验收测试',
    };
    const draft = await read<{ id: string; status: string; version: number }>(
      client(token, a.path + '/reports', post(draftInput)),
    );
    expect(draft.status).toBe('draft');
    expect(
      await read(client(token, a.path + '/reports', post(draftInput))),
    ).toMatchObject({ id: draft.id });
    expect(
      (
        await client(
          other,
          b.path + '/reports',
          post({ ...draftInput, id: draft.id, version: draft.version }),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await client(
          token,
          a.path + '/reports/' + draft.id + '/submit',
          post({ version: draft.version }),
        )
      ).status,
    ).toBe(400);
    const bytes = await sharp({
      create: { width: 2, height: 2, channels: 3, background: '#ffffff' },
    })
      .png()
      .toBuffer();
    function upload(session: string, id: string) {
      const form = new FormData();
      form.append(
        'file',
        new File([new Uint8Array(bytes)], 'evidence.png', {
          type: 'image/png',
        }),
      );
      return client(
        session,
        '/reportingFiles/uploadOne?kind=revenueReports&recordId=' + id,
        { method: 'POST', headers: { origin: 'http://localhost' }, body: form },
      );
    }
    expect((await upload(other, draft.id)).status).toBe(403);
    const attachment = await read<{ record: { id: string } }>(
      upload(token, draft.id),
      201,
    );
    const files = await read<{ id: string; contentUrl: string }[]>(
      client(token, '/reportingEvidence/revenueReports/' + draft.id),
    );
    expect(files[0].id).toBe(attachment.record.id);
    const fileRequest = (session: string) =>
      testApp.fetch(
        new Request(new URL(files[0].contentUrl, 'http://localhost'), {
          headers: { authorization: 'Bearer ' + session },
        }),
      );
    expect((await fileRequest(token)).status).toBe(200);
    expect((await fileRequest(other)).status).toBe(403);
    // Pause an upload after the file exists privately, before it is attached.
    const service = testApp.application.container.resolve(merchantMiniappToken);
    const original = service.attachEvidence.bind(service);
    const staged = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const pause = vi
      .spyOn(service, 'attachEvidence')
      .mockImplementationOnce(async (...args) => {
        staged.resolve();
        await release.promise;
        await original(...args);
      });
    const delayed = upload(token, draft.id);
    await Promise.race([
      staged.promise,
      delayed.then((r) => {
        throw Error('Upload completed before attachment barrier: ' + r.status);
      }),
    ]);
    expect(
      await read(
        client(
          token,
          a.path + '/reports/' + draft.id + '/submit',
          post({ version: draft.version }),
        ),
      ),
    ).toMatchObject({ status: 'pending' });
    release.resolve();
    expect((await delayed).status).toBe(400);
    pause.mockRestore();
    expect(
      await testApp.database.repository('hylReportingFiles').count({}),
    ).toBe(1);

    expect((await upload(token, draft.id)).status).toBe(400);
    const report = await read<Row>(admin.fetch('/revenueReports/' + draft.id));
    expect(report).toMatchObject({
      merchantId: a.merchant.id,
      status: 'pending',
      payload: { receipts: '123.45', orderCount: 7 },
    });
    const returned = await read<Row>(
      admin.fetch(
        '/revenueReports/' + draft.id + '/return',
        post({ expectedVersion: report.version, reason: '请核对订单数量' }),
      ),
    );
    expect(await read(client(token, a.path + '/reports'))).toEqual([
      expect.objectContaining({
        status: 'returned',
        editable: true,
        returnReason: '请核对订单数量',
      }),
    ]);
    const updated = await read<{ version: number }>(
      client(
        token,
        a.path + '/reports',
        post({
          ...draftInput,
          orders: 8,
          id: draft.id,
          version: returned.version,
        }),
      ),
    );
    const pending = await read<{ version: number }>(
      client(
        token,
        a.path + '/reports/' + draft.id + '/submit',
        post({ version: updated.version }),
      ),
    );
    expect(
      (
        await read<Row>(
          admin.fetch(
            '/revenueReports/' + draft.id + '/approve',
            post({ expectedVersion: pending.version }),
          ),
        )
      ).status,
    ).toBe('approved');
    expect(await read(client(token, a.path + '/reports'))).toEqual([
      expect.objectContaining({
        status: 'approved',
        orders: 8,
        editable: false,
      }),
    ]);

    const base = '/contracts/' + a.contract.id;
    await read(
      admin.fetch(
        base + '/billingConfig',
        post(
          {
            requestId: randomUUID(),
            expectedVersion: 0,
            effectiveFrom: month + '-01',
            rentChannel: 'bill',
            property: { enabled: false, method: 'fixed', price: '0' },
            utilities: {},
            meters: [],
          },
          'PUT',
        ),
      ),
    );
    const bill = await create<Bill>('/bills', {
      contractId: a.contract.id,
      expectedContractVersion: a.contract.version,
      configVersion: 1,
      requestId: randomUUID(),
      month,
      part: 'month',
      dueDate: monthEnd,
      fees: ['rent'],
      readings: [],
      others: [],
    });
    expect(await read(client(token, a.path + '/bills'))).toEqual([]);
    const issued = await read<Bill>(
      admin.fetch(
        '/bills/' + bill.id + '/issue',
        post({ requestId: randomUUID(), expectedVersion: bill.version }),
      ),
    );
    expect(await read(client(token, a.path + '/bills'))).toEqual([
      expect.objectContaining({
        id: bill.id,
        remainingCents: issued.remainingCents,
        amountCents: issued.amountCents,
      }),
    ]);
    expect(await read(client(other, b.path + '/bills'))).toEqual([]);

    const repair = {
      assetId: a.asset.id,
      title: '测试漏水',
      description: '测试水管持续渗水',
      category: 'plumbing',
      requestId: randomUUID(),
    };
    expect(
      (await client(other, b.path + '/repairs', post(repair))).status,
    ).toBe(404);
    const ticket = await read<{ id: string; status: string }>(
      client(token, a.path + '/repairs', post(repair)),
    );
    expect(ticket.status).toBe('reported');
    expect(
      await read(client(token, a.path + '/repairs', post(repair))),
    ).toMatchObject({ id: ticket.id });
    expect((await client(other, b.path + '/repairs/' + ticket.id)).status).toBe(
      404,
    );
    const path = '/repairOrders/' + ticket.id + '/actions';
    const assigned = await read<{ version: number }>(
      admin.fetch(
        path,
        post({
          action: 'assign',
          requestId: randomUUID(),
          expectedVersion: 0,
          assigneeId: admin.user.id,
          dueOn: today,
          note: '已派单',
        }),
      ),
    );
    const started = await read<{ version: number }>(
      admin.fetch(
        path,
        post({
          action: 'start',
          requestId: randomUUID(),
          expectedVersion: assigned.version,
          note: '开始处理',
        }),
      ),
    );
    expect(
      await read(client(token, a.path + '/repairs/' + ticket.id)),
    ).toMatchObject({
      status: 'processing',
      events: expect.arrayContaining([
        expect.objectContaining({ status: 'assigned' }),
        expect.objectContaining({ status: 'processing' }),
      ]),
    });

    const done = await read<{ version: number }>(
      admin.fetch(
        path,
        post({
          action: 'complete',
          requestId: randomUUID(),
          expectedVersion: started.version,
          note: '已修复',
          evidence: '现场测试',
          cost: '0',
        }),
      ),
    );
    const accepted = await read<{ version: number }>(
      admin.fetch(
        path,
        post({
          action: 'accept',
          requestId: randomUUID(),
          expectedVersion: done.version,
          note: '已验收',
        }),
      ),
    );
    await read(
      admin.fetch(
        path,
        post({
          action: 'close',
          requestId: randomUUID(),
          expectedVersion: accepted.version,
          note: '已关闭',
        }),
      ),
    );
    expect(
      await read(client(token, a.path + '/repairs/' + ticket.id)),
    ).toMatchObject({ status: 'closed' });
    expect((await client(token, c.path + '/repairs/' + ticket.id)).status).toBe(
      404,
    );
    expect(
      (
        await client(
          token,
          c.path + '/reports/' + draft.id + '/submit',
          post({ version: draft.version }),
        )
      ).status,
    ).toBe(404);

    await set(a, phoneA, false);
    for (const path of [
      '/reports',
      '/bills',
      '/assets',
      '/repairs',
      '/repairs/' + ticket.id,
    ])
      expect((await client(token, a.path + path)).status).toBe(403);
    expect(
      (await client(token, a.path + '/reports', post(draftInput))).status,
    ).toBe(403);
    expect(
      (await client(token, a.path + '/repairs', post(repair))).status,
    ).toBe(403);
    expect((await fileRequest(token)).status).toBe(403);
    expect((await upload(token, draft.id)).status).toBe(403);
    expect(await read(client(token, prefix + '/merchants'))).toEqual([
      expect.objectContaining({ id: c.merchant.id }),
    ]);
    await set(c, phoneA, false);
    expect((await client(token, prefix + '/merchants')).status).toBe(403);
    await login('A', phoneA, 403);
    expect((await client(other, prefix + '/merchants')).status).toBe(200);
    expect((await client(other, '/auth/sign-out', post({}))).status).toBe(200);
    expect((await client(other, prefix + '/merchants')).status).toBe(401);
  } finally {
    fake.mockRestore();
  }
});
