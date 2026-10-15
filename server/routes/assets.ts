import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { Application } from '@nocobase/app-server/application';
import {
  defineApiRoutes,
  apiValidator,
  describeRoute,
  apiErrorHandler,
} from '@nocobase/app-server/router';
import {
  authenticationToken,
  type AuthEnv,
} from '@nocobase/app-plugin-authentication';
import {
  authorizationToken,
  type AuthorizationEnv,
} from '@nocobase/app-plugin-authorization';
import { hylToken } from '../providers/hyl.js';
import { AssetService } from '../providers/assets.js';
import { assetSchema, assetTypes, bindingSchema } from '../assets/schema.js';
import { date } from '../hyl/schema.js';
export type AssetEnv = AuthEnv & AuthorizationEnv;
export const assetAccess = (c: Context<AssetEnv>) => ({
  actor: String(c.get('auth')?.user.id),
  authorization: c.get('authz'),
});
export const describeAsset = (operationId: string) =>
  describeRoute({
    tags: ['Assets'],
    operationId,
    summary: operationId,
    responses: {
      200: { description: 'Success' },
      201: { description: 'Created' },
      400: { description: 'Invalid input' },
      401: { description: 'Sign in required' },
      403: { description: 'Permission denied' },
      404: { description: 'Not found' },
      409: { description: 'Conflict' },
    },
  });
export const assetParams = z.object({ id: z.string().uuid() });
export const assetPaging = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
});
export default defineApiRoutes<Application>((app) => {
  const router = new Hono<AssetEnv>(),
    service = new AssetService(app.container.resolve(hylToken));
  router.onError(apiErrorHandler);
  for (const path of [
    '/assets',
    '/assets/*',
    '/assetsTree',
    '/merchants/:id/assets',
    '/merchants/:id/assets/*',
    '/contracts/:id/assets',
  ])
    router.use(
      path,
      app.container.resolve(authenticationToken).required(),
      app.container.resolve(authorizationToken).middleware(),
    );
  const query = assetPaging.extend({
    q: z.string().max(100).default(''),
    type: z.enum(['', ...assetTypes]).default(''),
    state: z.enum(['', 'normal', 'maintenance', 'inactive']).default(''),
    parentId: z.union([z.string().uuid(), z.literal('')]).optional(),
    occupancy: z.enum(['', 'occupied', 'vacant']).default(''),
    orderBy: z.string().default('updatedAt:desc'),
  });
  router.get(
    '/assets',
    describeAsset('assetsList'),
    apiValidator('query', query),
    async (c) =>
      c.json(await service.list(assetAccess(c), c.req.valid('query'))),
  );
  router.get(
    '/assetsTree',
    describeAsset('assetsTree'),
    apiValidator('query', assetPaging),
    async (c) =>
      c.json(
        await service.list(
          assetAccess(c),
          {
            ...c.req.valid('query'),
            q: '',
            type: '',
            state: '',
            occupancy: '',
            orderBy: 'number:asc',
          },
          true,
        ),
      ),
  );
  router.post(
    '/assets',
    describeAsset('assetsCreate'),
    apiValidator('json', assetSchema),
    async (c) =>
      c.json(
        { data: await service.save(assetAccess(c), c.req.valid('json')) },
        201,
      ),
  );
  router.get(
    '/assets/:id',
    describeAsset('assetsDetail'),
    apiValidator('param', assetParams),
    async (c) => {
      const row = await service.get(assetAccess(c), c.req.valid('param').id);
      return c.json({
        data: {
          ...row,
          occupied: (await service.occupied([row.id])).has(row.id),
        },
      });
    },
  );
  router.patch(
    '/assets/:id',
    describeAsset('assetsUpdate'),
    apiValidator('param', assetParams),
    apiValidator(
      'json',
      z
        .object({
          values: assetSchema,
          expectedVersion: z.number().int().min(0),
          reason: z.string().trim().min(1).max(1000),
        })
        .strict(),
    ),
    async (c) => {
      const body = c.req.valid('json');
      return c.json({
        data: await service.save(
          assetAccess(c),
          body.values,
          c.req.valid('param').id,
          body.expectedVersion,
          body.reason,
        ),
      });
    },
  );
  router.get(
    '/assets/:id/history',
    describeAsset('assetsHistory'),
    apiValidator('param', assetParams),
    apiValidator('query', assetPaging),
    async (c) =>
      c.json(
        await service.history(
          assetAccess(c),
          c.req.valid('param').id,
          c.req.valid('query').page,
          c.req.valid('query').pageSize,
        ),
      ),
  );
  router.get(
    '/assets/:id/associations',
    describeAsset('assetsAssociations'),
    apiValidator('param', assetParams),
    async (c) =>
      c.json({
        data: await service.associations(
          assetAccess(c),
          c.req.valid('param').id,
        ),
      }),
  );
  router.get(
    '/merchants/:id/assets',
    describeAsset('merchantAssets'),
    apiValidator('param', assetParams),
    async (c) =>
      c.json({
        data: await service.bindings(assetAccess(c), c.req.valid('param').id),
      }),
  );
  router.post(
    '/merchants/:id/assets',
    describeAsset('merchantAssetBind'),
    apiValidator('param', assetParams),
    apiValidator('json', bindingSchema),
    async (c) =>
      c.json(
        {
          data: await service.bind(
            assetAccess(c),
            c.req.valid('param').id,
            c.req.valid('json'),
          ),
        },
        201,
      ),
  );
  router.post(
    '/merchants/:id/assets/:bindingId/close',
    describeAsset('merchantAssetUnbind'),
    apiValidator('param', assetParams.extend({ bindingId: z.string().uuid() })),
    apiValidator(
      'json',
      z
        .object({
          end: date,
          reason: z.string().trim().min(1).max(1000),
          expectedVersion: z.number().int().min(0),
        })
        .strict(),
    ),
    async (c) => {
      const body = c.req.valid('json');
      return c.json({
        data: await service.closeBinding(
          assetAccess(c),
          c.req.valid('param').id,
          c.req.valid('param').bindingId,
          body.end,
          body.reason,
          body.expectedVersion,
        ),
      });
    },
  );
  router.get(
    '/contracts/:id/assets',
    describeAsset('contractAssets'),
    apiValidator('param', assetParams),
    async (c) =>
      c.json({
        data: await service.contractAssets(
          assetAccess(c),
          c.req.valid('param').id,
        ),
      }),
  );
  return new Hono().route('/', router);
});
