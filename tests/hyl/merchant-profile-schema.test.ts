// @vitest-environment node
import { expect, it } from 'vitest';
import { merchantSchema } from '../../server/hyl/schema.js';
const merchant = {
  code: 'm',
  name: '商户',
  unit: 'A1',
  contact: '联系人',
  phone: '123',
  accountName: '商户',
  bank: '银行',
  account: '123',
};
it('accepts profile additions and preserves compatibility with old merchants', () => {
  expect(merchantSchema.parse(merchant)).toMatchObject({
    legalRepresentative: '',
    creditCode: '',
    businessHours: '',
  });
  expect(
    merchantSchema.parse({
      ...merchant,
      legalRepresentative: '张三',
      creditCode: '91370200123456789X',
      businessHours: '周一至周日 09:00–次日01:00',
    }),
  ).toMatchObject({ legalRepresentative: '张三' });
});
it('rejects malformed credit codes and excessive hours', () => {
  expect(
    merchantSchema.safeParse({ ...merchant, creditCode: 'invalid' }).success,
  ).toBe(false);
  expect(
    merchantSchema.safeParse({ ...merchant, businessHours: 'a'.repeat(501) })
      .success,
  ).toBe(false);
});
it('requires a specific name for other categories and supports legacy categories', () => {
  expect(
    merchantSchema.safeParse({ ...merchant, category: 'other' }).success,
  ).toBe(false);
  expect(
    merchantSchema.safeParse({
      ...merchant,
      category: 'other',
      categoryName: '   ',
    }).success,
  ).toBe(false);
  expect(
    merchantSchema.parse({
      ...merchant,
      category: 'other',
      categoryName: '  民宿  ',
    }),
  ).toMatchObject({ category: 'other', categoryName: '民宿' });
  expect(
    merchantSchema.parse({ ...merchant, category: '旧品类' }).category,
  ).toBe('旧品类');
  expect(
    merchantSchema.safeParse({
      ...merchant,
      category: 'other',
      categoryName: 'a'.repeat(51),
    }).success,
  ).toBe(false);
});
