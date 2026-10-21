import { ApiClientError } from '@nocobase/app-client';
/** API validation uses the public error.fieldViolations envelope, never raw English exceptions. */
export function fieldMessages(
  error: unknown,
  translate: (key: string) => string,
) {
  if (!(error instanceof ApiClientError)) return {};
  const payload = error.payload as {
    error?: { fieldViolations?: { field: string }[] };
  };
  return Object.fromEntries(
    (payload?.error?.fieldViolations ?? []).map(({ field }) => {
      const path = field
        .replace(/^(json|body)\./, '')
        .replace(/^property\.price$/, 'propertyPrice')
        .replace(/^utilities\./, '');
      return [path, translate('billing.invalidField')];
    }),
  );
}
