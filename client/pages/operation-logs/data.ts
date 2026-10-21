import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '@nocobase/app-client';
import { useAuthentication } from '@nocobase/app-plugin-authentication/client';
import { useAuthorizationRevision } from '@nocobase/app-plugin-authorization/client';
export interface Log {
  id: string;
  createdAt: string;
  actorId: string;
  actorName: string;
  module: string;
  action: string;
  targetId: string;
  method: string;
  pathTemplate: string;
  result: 'success' | 'failure';
  httpStatus: number;
  errorCode: string;
  requestId: string;
  durationMs: number;
}
export function useLogs<T>(
  path: string,
  query?: Record<string, string>,
  enabled = true,
) {
  const api = useApiClient(),
    { session } = useAuthentication(),
    revision = useAuthorizationRevision();
  return useQuery({
    queryKey: ['operationLogs', session?.user.id, revision, path, query],
    queryFn: () => api.request<T>({ path, query }),
    placeholderData: (previous, old) =>
      old?.queryKey[1] === session?.user.id &&
      old?.queryKey[2] === revision &&
      old?.queryKey[3] === path
        ? previous
        : undefined,
    enabled,
    retry: false,
    refetchOnWindowFocus: true,
  });
}
export function logDay(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.valueOf()) &&
    date.toISOString().slice(0, 10) === value
    ? value
    : '';
}
export function logQuery(params: URLSearchParams) {
  const out: Record<string, string> = {};
  for (const key of ['q', 'module', 'result', 'order', 'page'])
    if (params.get(key)) out[key] = params.get(key)!;
  for (const key of ['from', 'to']) {
    const day = logDay(params.get(key));
    if (day)
      out[key] =
        `${day}T${key === 'from' ? '00:00:00.000' : '23:59:59.999'}+08:00`;
  }
  return out;
}
