export {
  Group,
  Amounts,
  Money,
  Day,
  RecordedAt,
  Value,
  Refresh,
  LoadingRows,
  BillingError,
  FormField,
  Confirm,
  Search,
  Choice,
  DateField,
  RecordPicker,
  Paged,
  Truncated,
} from '../cashier/common.js';
import { useTranslation } from '@nocobase/i18n/client';
import { Money } from '../cashier/common.js';
export function SplitAmounts({ values }: { values: Record<string, string> }) {
  const { t } = useTranslation();
  return (
    <dl className='grid gap-3 sm:grid-cols-2 lg:grid-cols-4'>
      {Object.entries(values).map(([k, v]) => (
        <div key={k} className='rounded-lg border bg-card p-4'>
          <dt className='text-sm text-muted-foreground'>
            {t(`split.fields.${k}`)}
          </dt>
          <dd className='mt-2 font-medium'>
            <Money cents={v} />
          </dd>
        </div>
      ))}
    </dl>
  );
}
