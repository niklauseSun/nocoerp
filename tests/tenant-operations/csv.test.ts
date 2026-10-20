import { expect, it } from 'vitest';
import {
  parseBankCsv,
  bankSample,
} from '../../client/pages/tenant-operations/csv.js';
it('TEST bank CSV handles quoted delimiters and rejects malformed, duplicate or imprecise money', () => {
  expect(parseBankCsv(bankSample)[0]).toMatchObject({
    externalId: 'TEST-BANK-001',
    amountCents: '10000',
  });
  expect(
    parseBankCsv(
      bankSample.replace('TEST-NOT-REAL-PAYMENT', '"TEST,quoted"'),
    )[0].reference,
  ).toBe('TEST,quoted');
  expect(() => parseBankCsv(bankSample.replace('10000', '100.01'))).toThrow();
  expect(() =>
    parseBankCsv(bankSample + bankSample.split('\r\n')[1]),
  ).toThrow();
  expect(() =>
    parseBankCsv(bankSample.replace('2026-10-20', '2026-02-30')),
  ).toThrow();
});
