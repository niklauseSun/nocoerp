import { scalar } from '../hyl/model.js';
import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from '#components/ui/table';
import { Badge } from '#components/ui/badge';
import { LongText } from '#components/long-text';
import {
  Group,
  Money,
  RecordedAt,
  Paged,
  Truncated,
} from '../profit-sharing/common.js';
import type { Page } from './types.js';
export {
  Group,
  Money,
  RecordedAt,
  Paged,
  Truncated,
  Refresh,
  LoadingRows,
  BillingError,
  FormField,
  Confirm,
  RecordPicker,
  Choice,
  Search,
} from '../profit-sharing/common.js';
export function Metrics({
  row,
  keys,
}: {
  row: Record<string, unknown>;
  keys: string[];
}) {
  const { t } = useTranslation();
  return (
    <dl className='grid gap-3 sm:grid-cols-2 lg:grid-cols-4'>
      {keys.map((k) => (
        <div key={k} className='rounded-lg border bg-card p-4'>
          <dt className='text-sm text-muted-foreground'>
            {t('invoice.fields.' + k)}
          </dt>
          <dd className='mt-2 font-medium'>
            <Money cents={scalar(row[k]) || '0'} />
          </dd>
        </div>
      ))}
    </dl>
  );
}
export function Details({ values }: { values: Record<string, ReactNode> }) {
  const { t } = useTranslation();
  return (
    <dl className='grid grid-cols-[8rem_1fr] gap-3'>
      {Object.entries(values).map(([k, v]) => (
        <div key={k} className='contents'>
          <dt className='text-sm text-muted-foreground'>
            {t('invoice.fields.' + k)}
          </dt>
          <dd className='min-w-0 whitespace-pre-wrap break-words'>
            {v ?? '—'}
          </dd>
        </div>
      ))}
    </dl>
  );
}
export function LongNotes({ values }: { values: Record<string, unknown> }) {
  const { t } = useTranslation();
  return (
    <>
      {['reason', 'evidence', 'notes'].map((k) =>
        values[k] ? (
          <Group key={k} title={t('invoice.fields.' + k)}>
            <LongText>{scalar(values[k])}</LongText>
          </Group>
        ) : null,
      )}
    </>
  );
}
export function ChildTable({
  name,
  page,
  columns,
  set,
  order = '',
  link,
}: {
  name: string;
  page?: Page<Record<string, unknown>>;
  columns: string[];
  set: (k: string, v: string) => void;
  order?: string;
  link?: (r: Record<string, unknown>) => string;
}) {
  const { t } = useTranslation(),
    l = useLocation();
  if (!page) return null;
  return (
    <Group title={t('invoice.' + name)}>
      {page.restricted ? (
        <p className='text-muted-foreground'>{t('invoice.restricted')}</p>
      ) : !page.data.length ? (
        <p className='text-muted-foreground'>{t('invoice.empty')}</p>
      ) : (
        <div className='overflow-x-auto'>
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((k) => (
                  <TableHead
                    key={k}
                    className={k.endsWith('Cents') ? 'text-right' : ''}
                  >
                    {k.endsWith('Cents') ||
                    ['createdAt', 'issuedAt', 'revision', 'version'].includes(
                      k,
                    ) ? (
                      <button
                        onClick={() =>
                          set(name + 'Order', order === k ? '-' + k : k)
                        }
                      >
                        {t('invoice.fields.' + k)}
                        {order.replace(/^-/, '') === k
                          ? order.startsWith('-')
                            ? ' ↓'
                            : ' ↑'
                          : ''}
                      </button>
                    ) : (
                      t('invoice.fields.' + k)
                    )}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {page.data.map((r) => (
                <TableRow key={scalar(r.id) || JSON.stringify(r)}>
                  {columns.map((k, i) => (
                    <TableCell
                      key={k}
                      className={k.endsWith('Cents') ? 'text-right' : ''}
                    >
                      {k.endsWith('Cents') ? (
                        <Money cents={scalar(r[k]) || '0'} />
                      ) : k.endsWith('At') ? (
                        <RecordedAt value={scalar(r[k])} />
                      ) : k === 'status' ? (
                        <Badge variant='secondary'>
                          {t('invoice.states.' + String(r[k]))}
                        </Badge>
                      ) : k === 'included' ? (
                        t(r[k] ? 'invoice.included' : 'invoice.excludedFee')
                      ) : k === 'feeType' ? (
                        t('billing.fees.' + String(r[k]))
                      ) : i === 0 && link ? (
                        <Link
                          className='underline'
                          to={{ pathname: link(r), search: l.search }}
                        >
                          <Truncated>{scalar(r[k]) || '—'}</Truncated>
                        </Link>
                      ) : (
                        <Truncated>{scalar(r[k]) || '—'}</Truncated>
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {!page.restricted ? (
        <Paged
          meta={page.meta}
          busy={false}
          onChange={(n) => set(name, String(n))}
        />
      ) : null}
    </Group>
  );
}

export function PartySnapshot({
  party,
}: {
  party:
    | {
        name: string;
        taxNo: string;
        type: string;
        address: string;
        phone: string;
        bank: string;
        account: string;
        email: string;
      }
    | undefined;
}) {
  const { t } = useTranslation();
  return (
    <Details
      values={Object.fromEntries(
        [
          'type',
          'name',
          'taxNo',
          'address',
          'phone',
          'bank',
          'account',
          'email',
        ].map((k) => [
          k,
          k === 'type'
            ? t('invoice.' + (party?.type ?? 'company'))
            : party?.[k as keyof typeof party] || '—',
        ]),
      )}
    />
  );
}
