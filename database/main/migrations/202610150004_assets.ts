import { defineMigration } from '@nocobase/db';
export default defineMigration({
  name: '202610150004_assets',
  async up({ builder }) {
    await builder.createCollection('hylAssets', c => {
      c.string('id', { length: 36, nullable: false }); c.primary('id');
      c.string('number', { length: 40, nullable: false }); c.unique('number');
      c.string('name', { length: 100, nullable: false });
      c.string('type', { length: 20, nullable: false });
      c.string('parentId', { length: 36, nullable: true });
      c.string('projectId', { length: 36, nullable: false });
      c.string('area', { length: 20, nullable: false });
      c.string('lettableArea', { length: 20, nullable: false });
      c.string('state', { length: 20, nullable: false });
      c.string('address', { length: 300, nullable: false });
      c.string('floor', { length: 50, nullable: false });
      c.string('location', { length: 300, nullable: false });
      c.string('ownershipType', { length: 100, nullable: false });
      c.string('ownerName', { length: 100, nullable: false });
      c.string('ownershipNumber', { length: 100, nullable: false });
      c.string('manager', { length: 100, nullable: false });
      c.text('notes', { nullable: false });
      c.integer('version', { nullable: false, defaultValue: 0 });
      c.datetimeTz('createdAt', { nullable: false }); c.datetimeTz('updatedAt', { nullable: false });
      c.index('parentId'); c.index(['projectId', 'type', 'state']);
    });
    await builder.createCollection('hylAssetHistory', c => {
      c.string('id', { length: 36, nullable: false }); c.primary('id');
      c.string('assetId', { length: 36, nullable: false });
      c.string('actor', { length: 100, nullable: false });
      c.string('action', { length: 50, nullable: false });
      c.text('reason', { nullable: false });
      c.json('before', { nullable: true }); c.json('after', { nullable: false });
      c.datetimeTz('createdAt', { nullable: false }); c.index(['assetId', 'createdAt']);
    });
    await builder.createCollection('hylAssetBindings', c => {
      c.string('id', { length: 36, nullable: false }); c.primary('id');
      c.string('assetId', { length: 36, nullable: false });
      c.string('merchantId', { length: 100, nullable: false });
      c.string('requestId', { length: 36, nullable: false });
      c.string('start', { length: 10, nullable: false }); c.string('end', { length: 10, nullable: false });
      c.string('area', { length: 20, nullable: false });
      c.integer('version', { nullable: false, defaultValue: 0 });
      c.string('actor', { length: 100, nullable: false });
      c.datetimeTz('createdAt', { nullable: false });
      c.unique(['merchantId', 'requestId']); c.index(['assetId', 'start', 'end']); c.index('merchantId');
    });
    await builder.createCollection('hylContractAssets', c => {
      c.string('id', { length: 36, nullable: false }); c.primary('id');
      c.string('assetId', { length: 36, nullable: false }); c.string('merchantId', { length: 100, nullable: false });
      c.string('contractId', { length: 100, nullable: false });
      c.string('start', { length: 10, nullable: false }); c.string('end', { length: 10, nullable: false });
      c.json('snapshot', { nullable: false }); c.datetimeTz('createdAt', { nullable: false });
      c.unique(['contractId', 'assetId']); c.index(['assetId', 'end']); c.index('merchantId');
    });
    await builder.createCollection('hylAssetFiles', c => {
      c.string('id', { length: 36, nullable: false }); c.primary('id');
      c.string('disk', { length: 255, nullable: false }); c.text('key', { nullable: false });
      c.text('filename', { nullable: false }); c.string('ext', { length: 32, nullable: false });
      c.string('mimeType', { length: 255, nullable: false }); c.bigInt('size', { nullable: false });
      c.datetimeTz('createdAt', { nullable: false }); c.datetimeTz('updatedAt', { nullable: false });
      c.string('assetId', { length: 36, nullable: false, defaultValue: '' });
      c.string('ownerId', { length: 100, nullable: false, defaultValue: '' });
      c.boolean('linked', { nullable: false, defaultValue: false });
      c.string('category', { length: 30, nullable: false, defaultValue: '' });
      c.string('title', { length: 100, nullable: false, defaultValue: '' });
      c.string('uploadId', { length: 36, nullable: true });
      c.string('uploadHash', { length: 64, nullable: false, defaultValue: '' });
      c.unique(['assetId', 'ownerId', 'uploadId']); c.index(['assetId', 'linked']);
    });
    await builder.createCollection('hylAssetFileCleanup', c => {
      c.string('id', { length: 36, nullable: false }); c.primary('id');
      c.string('assetId', { length: 36, nullable: false }); c.string('ownerId', { length: 100, nullable: false });
      c.string('disk', { length: 255, nullable: false }); c.text('key', { nullable: false });
    });
    await builder.createCollection('hylAssetSetup', c => { c.string('id', { length: 100, nullable: false }); c.primary('id'); });
  },
  async down({ builder }) {
    for (const name of ['hylAssetSetup', 'hylAssetFileCleanup', 'hylAssetFiles', 'hylContractAssets', 'hylAssetBindings', 'hylAssetHistory', 'hylAssets']) await builder.dropCollection(name);
  },
});
