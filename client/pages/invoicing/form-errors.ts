import { ApiClientError } from '@nocobase/app-client';

/** Convert validator paths to the stable IDs used by invoice form fields. */
export function invoiceFieldMessages(
  error: unknown,
  message: string,
  context: {
    fees?: { feeType: string }[];
    sources?: { id: string; lines: { data: { id: string }[] } }[];
    lines?: { id: string }[];
  } = {},
) {
  if (!(error instanceof ApiClientError)) return {};
  const payload = error.payload as {
    error?: { fieldViolations?: { field: string }[] };
  };
  return Object.fromEntries(
    (payload?.error?.fieldViolations ?? []).map((v) => {
      let name = v.field.replace(/^(json|body)\./, '').replace(/^values\./, '');
      const fee = name.match(/^fees\.(\d+)\.(.+)$/);
      const source = name.match(/^sources\.(\d+)\.amounts\.(\d+)(?:\..+)?$/);
      const line = name.match(/^lines\.(\d+)(?:\..+)?$/);
      if (fee && context.fees?.[Number(fee[1])])
        name = context.fees[Number(fee[1])].feeType + '.' + fee[2];
      if (source) {
        const s = context.sources?.[Number(source[1])],
          l = s?.lines.data[Number(source[2])];
        if (s && l) name = s.id + ':' + l.id;
      }
      if (line && context.lines?.[Number(line[1])])
        name = context.lines[Number(line[1])].id;
      return [name, message];
    }),
  );
}
