import { expect, it } from 'vitest';
import { ApiClientError } from '@nocobase/app-client';
import { invoiceFieldMessages } from '../../client/pages/invoicing/form-errors.js';
it('maps nested validator fields to actual party, fee, source and original-line field IDs', () => {
  const error = new ApiClientError('validation', {
    status: 400,
    method: 'POST',
    url: '/invoices',
    payload: {
      error: {
        fieldViolations: [
          { field: 'json.values.buyer.email' },
          { field: 'values.fees.0.rate' },
          { field: 'body.sources.0.amounts.0.gross' },
          { field: 'lines.0.gross' },
        ],
      },
    },
  });
  expect(
    invoiceFieldMessages(error, 'invalid', {
      fees: [{ feeType: 'rent' }],
      sources: [{ id: 'source', lines: { data: [{ id: 'bill-line' }] } }],
      lines: [{ id: 'original-line' }],
    }),
  ).toEqual({
    'buyer.email': 'invalid',
    'rent.rate': 'invalid',
    'source:bill-line': 'invalid',
    'original-line': 'invalid',
  });
});
