import { LongText } from '#components/long-text';
import { useTranslation } from '@nocobase/i18n/client';
import { scalar } from '../hyl/model.js';
import { Group } from './common.js';
import { formatMoney } from '../billing/format.js';
export function Snapshot({
  kind,
  source,
}: {
  kind: string;
  source: Record<string, unknown>;
}) {
  const { t, i18n } = useTranslation(),
    fields =
      kind === 'contracts'
        ? [
            'title',
            'start',
            'end',
            'rent',
            'depositTarget',
            'cycle',
            'method',
            'assetIds',
          ]
        : kind === 'bills'
          ? ['amountCents', 'start', 'end', 'dueDate']
          : ['amountCents', 'neededOn', 'reason'],
    items = Array.isArray(source.items) ? source.items : [];
  return (
    <Group title={t('approval.snapshot')}>
      <dl className='grid gap-4 sm:grid-cols-2'>
        {fields.map((key) => {
          const v = source[key];
          return (
            <div
              key={key}
              className='grid grid-cols-[8rem_1fr] items-start gap-3'
            >
              <dt className='text-sm text-muted-foreground'>
                {t('approval.snapshotFields.' + key)}
              </dt>
              <dd className='min-w-0'>
                <LongText>
                  {v == null
                    ? '—'
                    : key === 'amountCents'
                      ? formatMoney(scalar(v), i18n.language, true)
                      : ['rent', 'depositTarget'].includes(key)
                        ? formatMoney(scalar(v), i18n.language)
                        : key === 'assetIds'
                          ? t('approval.assetCount', {
                              count: Array.isArray(v) ? v.length : 0,
                            })
                          : key === 'cycle' || key === 'method'
                            ? t('hyl.enums.' + scalar(v))
                            : scalar(v)}
                </LongText>
              </dd>
            </div>
          );
        })}
      </dl>
      {items.length ? (
        <ul className='flex list-inside list-disc flex-col gap-2'>
          {items.map((v, i) => {
            const item = v as Record<string, unknown>;
            return (
              <li key={scalar(item.id ?? i)}>
                {scalar(item.name ?? '')} · {scalar(item.quantity ?? '')}{' '}
                {scalar(item.unit ?? '')} ·{' '}
                {formatMoney(
                  scalar(item.unitPriceCents ?? '0'),
                  i18n.language,
                  true,
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </Group>
  );
}
