import { ClipboardCheck } from 'lucide-react';
import { StatusBadge } from '#components/status-badge';
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from '#components/ui/empty';
import { useBusinessQuery } from './hooks.js';
import { Link, Outlet, useLocation, useSearchParams } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { RouteChildPage } from '#components/route-child-page';
import { Button } from '#components/ui/button';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '#components/ui/table';
import {
  Truncated,
  KindBadge,
  Nav,
  BillingError,
  LoadingRows,
  Refresh,
  Paged,
  RecordedAt,
  Search,
} from './common.js';
export interface Config {
  id: string;
  projectId: string;
  projectName: string;
  kind: string;
  enabled: boolean;
  revision: number;
  updatedAt: string;
  levels: {
    name: string;
    userIds: string[];
    users: { id: string; name: string; active: boolean }[];
  }[];
}
export default function Configs() {
  const { t } = useTranslation(),
    l = useLocation(),
    [q, setQ] = useSearchParams(),
    can = useCan({
      resource: { type: 'composite', id: 'hyl.approvals' },
      action: 'configure',
    }),
    r = useBusinessQuery<{ data: Config[] }>('approvalConfigs'),
    search = q.get('configQ') || '',
    order = q.get('configOrder') || '-updatedAt',
    page = Number(q.get('configPage')) || 1,
    rows = r.error
      ? []
      : (r.data?.data ?? [])
          .filter((x) =>
            (x.projectName + ' ' + t('approval.kinds.' + x.kind))
              .toLowerCase()
              .includes(search.toLowerCase()),
          )
          .sort(
            (a, b) =>
              (order.startsWith('-') ? -1 : 1) *
                a.updatedAt.localeCompare(b.updatedAt) ||
              a.id.localeCompare(b.id),
          );
  const clear = () => {
    const n = new URLSearchParams(q);
    n.delete('configQ');
    n.delete('configPage');
    setQ(n, { replace: true });
  };
  const primary = (
    <Button
      nativeButton={false}
      render={
        <Link to={{ pathname: '/approvals/configs/new', search: l.search }} />
      }
    >
      {t('approval.newConfig')}
    </Button>
  );
  return (
    <>
      <RouteChildPage>
        <PageContainer>
          <PageHeader
            title={t('approval.configs')}
            description={t('approval.freezeHint')}
            actions={
              <>
                {can.can && (r.data?.data.length || search) ? primary : null}
                <Refresh busy={r.isFetching} onClick={() => void r.refetch()} />
              </>
            }
          />
          <Nav />
          <div className='flex flex-wrap gap-3'>
            <Search
              value={search}
              onChange={(v) => {
                const n = new URLSearchParams(q);
                n.set('configQ', v);
                n.delete('configPage');
                setQ(n, { replace: true });
              }}
              placeholder={t('approval.searchConfigs')}
            />
            {search ? (
              <Button variant='outline' onClick={clear}>
                {t('approval.clear')}
              </Button>
            ) : null}
          </div>
          {r.error ? (
            <BillingError error={r.error} retry={() => void r.refetch()} />
          ) : r.isPending ? (
            <LoadingRows />
          ) : rows.length ? (
            <>
              <div className='overflow-x-auto' aria-busy={r.isFetching}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      {['project', 'kind', 'enabled', 'levels'].map((k) => (
                        <TableHead key={k}>{t('approval.' + k)}</TableHead>
                      ))}
                      <TableHead
                        aria-sort={
                          order.startsWith('-') ? 'descending' : 'ascending'
                        }
                      >
                        <Button
                          variant='ghost'
                          onClick={() => {
                            const n = new URLSearchParams(q);
                            n.set(
                              'configOrder',
                              order === 'updatedAt'
                                ? '-updatedAt'
                                : 'updatedAt',
                            );
                            n.delete('configPage');
                            setQ(n);
                          }}
                        >
                          {t('approval.updatedAt')}{' '}
                          {order.startsWith('-') ? '↓' : '↑'}
                        </Button>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.slice((page - 1) * 20, page * 20).map((d) => (
                      <TableRow key={d.id}>
                        <TableCell>
                          {r.isFetching ? (
                            <Truncated>{d.projectName}</Truncated>
                          ) : (
                            <Link
                              className='font-medium underline underline-offset-4'
                              to={{
                                pathname:
                                  '/approvals/configs/' +
                                  d.projectId +
                                  '/' +
                                  d.kind,
                                search: l.search,
                              }}
                            >
                              <Truncated>{d.projectName}</Truncated>
                            </Link>
                          )}
                        </TableCell>
                        <TableCell>
                          <KindBadge value={d.kind} />
                        </TableCell>
                        <TableCell>
                          <StatusBadge tone={d.enabled ? 'success' : 'neutral'}>
                            {t(d.enabled ? 'approval.yes' : 'approval.no')}
                          </StatusBadge>
                        </TableCell>
                        <TableCell>
                          <Truncated>
                            {d.levels.map((x) => x.name).join(' → ')}
                          </Truncated>
                        </TableCell>
                        <TableCell>
                          <RecordedAt value={d.updatedAt} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <Paged
                meta={{ page, pageSize: 20, total: rows.length }}
                onChange={(p) => {
                  const n = new URLSearchParams(q);
                  n.set('configPage', String(p));
                  setQ(n);
                }}
              />
            </>
          ) : (
            <Empty className='min-h-48 border border-dashed'>
              <EmptyHeader>
                <EmptyMedia variant='icon'>
                  <ClipboardCheck />
                </EmptyMedia>
                <EmptyTitle>
                  {t(search ? 'approval.noResults' : 'approval.noConfigsTitle')}
                </EmptyTitle>
                <EmptyDescription>
                  {t(
                    search
                      ? 'approval.noResultsHint'
                      : 'approval.noConfigsHint',
                  )}
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                {search ? (
                  <Button variant='outline' onClick={clear}>
                    {t('approval.clear')}
                  </Button>
                ) : can.can ? (
                  primary
                ) : null}
              </EmptyContent>
            </Empty>
          )}
        </PageContainer>
      </RouteChildPage>
      <Outlet />
    </>
  );
}
