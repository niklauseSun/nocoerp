import { Alert, AlertDescription } from '#components/ui/alert';
import { Link, Outlet, useSearchParams } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { Button } from '#components/ui/button';
import { Input } from '#components/ui/input';
import { Label } from '#components/ui/label';
import { Badge } from '#components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#components/ui/table';
import { LogRange } from './date-range.js';
import { Spinner } from '#components/ui/spinner';
import {
  Choice,
  Paged,
  LoadingRows,
  ErrorBox,
  OrgEmpty,
} from '../organization/common.js';
import { logDay, logQuery, useLogs, type Log } from './data.js';
export default function OperationLogs() {
  const { t, i18n } = useTranslation(),
    [params, setParams] = useSearchParams(),
    query = logQuery(params),
    invalidRange = !!query.from && !!query.to && query.from > query.to,
    r = useLogs<{
      data: Log[];
      meta: { total: number; page: number; pageSize: number };
    }>('/operationLogs', query, !invalidRange);
  const change = (key: string, value: string) => {
    const n = new URLSearchParams(params);
    if (value) n.set(key, value);
    else n.delete(key);
    if (key !== 'page') n.delete('page');
    setParams(n, { replace: true });
  };
  const hasFilters = ['q', 'module', 'result', 'from', 'to'].some((k) =>
    params.has(k),
  );
  const date = (value: string) =>
    new Intl.DateTimeFormat(i18n.language, {
      dateStyle: 'short',
      timeStyle: 'medium',
      timeZone: 'Asia/Shanghai',
    }).format(new Date(value));
  return (
    <PageContainer>
      <PageHeader
        title={t('operationLogs.title')}
        description={t('operationLogs.description')}
        actions={
          <Button
            variant='outline'
            disabled={r.isFetching || invalidRange}
            onClick={() => void r.refetch()}
          >
            {r.isFetching ? <Spinner aria-hidden='true' /> : null}
            {t('operationLogs.refresh')}
          </Button>
        }
      />
      <div className='flex flex-wrap items-end gap-3'>
        <div className='w-full sm:w-72'>
          <Label htmlFor='log-search' className='sr-only'>
            {t('operationLogs.search')}
          </Label>
          <Input
            id='log-search'
            placeholder={t('operationLogs.search')}
            value={params.get('q') ?? ''}
            onChange={(e) => change('q', e.target.value)}
          />
        </div>
        <div className='w-full sm:w-48'>
          <Choice
            value={params.get('module') ?? ''}
            onChange={(v) => change('module', v)}
            ariaLabel={t('operationLogs.module')}
            options={[
              { value: '', label: t('operationLogs.allModules') },
              ...Object.entries(
                t('operationLogs.modules', { returnObjects: true }) as Record<
                  string,
                  string
                >,
              ).map(([value, label]) => ({ value, label })),
            ]}
          />
        </div>
        <div className='w-full sm:w-40'>
          <Choice
            value={params.get('result') ?? ''}
            onChange={(v) => change('result', v)}
            ariaLabel={t('operationLogs.result')}
            options={['', 'success', 'failure'].map((value) => ({
              value,
              label: t('operationLogs.' + (value || 'allResults')),
            }))}
          />
        </div>
        <LogRange
          from={logDay(params.get('from'))}
          to={logDay(params.get('to'))}
          onChange={(from, to) => {
            const n = new URLSearchParams(params);
            if (from) n.set('from', from);
            else n.delete('from');
            if (to) n.set('to', to);
            else n.delete('to');
            n.delete('page');
            setParams(n, { replace: true });
          }}
        />
        {hasFilters ? (
          <Button
            variant='ghost'
            onClick={() => {
              const n = new URLSearchParams(params);
              for (const k of ['q', 'module', 'result', 'from', 'to', 'page'])
                n.delete(k);
              setParams(n);
            }}
          >
            {t('operationLogs.clear')}
          </Button>
        ) : null}
      </div>
      {invalidRange ? (
        <Alert variant='destructive'>
          <AlertDescription>{t('operationLogs.invalidRange')}</AlertDescription>
        </Alert>
      ) : null}
      <ErrorBox error={r.error} retry={() => void r.refetch()} />
      {r.isFetching && !r.data ? (
        <LoadingRows />
      ) : r.isError || invalidRange ? null : r.data?.data.length ? (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                {[
                  'id',
                  'createdAt',
                  'actor',
                  'module',
                  'action',
                  'targetId',
                  'result',
                ].map((key) => (
                  <TableHead
                    key={key}
                    aria-sort={
                      key === 'createdAt'
                        ? query.order === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : undefined
                    }
                  >
                    {key === 'createdAt' ? (
                      <Button
                        variant='ghost'
                        onClick={() =>
                          change(
                            'order',
                            query.order === 'asc' ? 'desc' : 'asc',
                          )
                        }
                      >
                        {t('operationLogs.createdAt')}{' '}
                        {query.order === 'asc' ? '↑' : '↓'}
                      </Button>
                    ) : (
                      t('operationLogs.' + key)
                    )}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {r.data.data.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <Link
                      className='text-primary underline-offset-4 hover:underline'
                      to={{ pathname: row.id, search: params.toString() }}
                      title={row.id}
                    >
                      {row.id.slice(0, 8)}
                    </Link>
                  </TableCell>
                  <TableCell className='whitespace-nowrap'>
                    {date(row.createdAt)}
                  </TableCell>
                  <TableCell>
                    <span
                      className='inline-block max-w-48 truncate align-middle'
                      title={row.actorName || row.actorId}
                    >
                      {row.actorName ||
                        row.actorId ||
                        t('operationLogs.unknownActor')}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge variant='outline'>
                      {t('operationLogs.modules.' + row.module)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {t('operationLogs.actions.' + row.action, {
                      defaultValue: row.action,
                    })}
                  </TableCell>
                  <TableCell>
                    <span
                      className='inline-block max-w-40 truncate align-middle'
                      title={row.targetId}
                    >
                      {row.targetId || '—'}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        row.result === 'failure' ? 'destructive' : 'secondary'
                      }
                    >
                      {t('operationLogs.' + row.result)}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Paged
            meta={r.data.meta}
            onChange={(p) => change('page', String(p))}
            busy={r.isFetching}
          />
        </>
      ) : (
        <OrgEmpty
          title={t('operationLogs.' + (hasFilters ? 'noResults' : 'empty'))}
          description={t(
            'operationLogs.' + (hasFilters ? 'noResultsHint' : 'emptyHint'),
          )}
        />
      )}
      <Outlet />
    </PageContainer>
  );
}
