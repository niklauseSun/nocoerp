import { useState } from 'react';
import { useTranslation } from '@nocobase/i18n/client';
import { CalendarIcon } from 'lucide-react';
import { enUS, zhCN } from 'react-day-picker/locale';
import type { DateRange } from 'react-day-picker';
import { useIsMobile } from '#hooks/use-mobile';
import { Calendar } from '#components/ui/calendar';
import { Button } from '#components/ui/button';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '#components/ui/popover';
import { today } from './hooks.js';
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export function ReportRange({
  from,
  to,
  onChange,
}: {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
}) {
  const { t, i18n } = useTranslation(),
    mobile = useIsMobile(),
    [open, setOpen] = useState(false),
    [range, setRange] = useState<DateRange | undefined>(),
    [last, setLast] = useState('');
  const valid = (s: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    !Number.isNaN(Date.parse(s + 'T00:00:00')) &&
    new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
  const key = from + to;
  if (last !== key) {
    setLast(key);
    setRange(
      valid(from) && valid(to)
        ? { from: new Date(from + 'T00:00:00'), to: new Date(to + 'T00:00:00') }
        : undefined,
    );
  }
  const format = (s: string) =>
    new Intl.DateTimeFormat(i18n.language, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(new Date(s + 'T00:00:00'));
  const commit = (a: Date, b: Date) => {
    onChange(iso(a), iso(b));
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button variant='outline' aria-label={t('finance.range')} />}
      >
        <CalendarIcon data-icon='inline-start' />
        {valid(from) && valid(to)
          ? `${format(from)} – ${format(to)}`
          : t('finance.range')}
      </PopoverTrigger>
      <PopoverContent className='w-auto max-w-full p-3'>
        <div className='flex flex-wrap gap-2'>
          {['last7', 'last30', 'thisMonth', 'lastMonth', 'last90'].map((p) => (
            <Button
              key={p}
              variant='ghost'
              size='sm'
              onClick={() => {
                const end = new Date(today() + 'T00:00:00'),
                  start = new Date(end);
                if (p === 'thisMonth') start.setDate(1);
                else if (p === 'lastMonth') {
                  end.setDate(0);
                  start.setFullYear(end.getFullYear(), end.getMonth(), 1);
                } else
                  start.setDate(
                    start.getDate() - Number(p.replace('last', '')) + 1,
                  );
                commit(start, end);
              }}
            >
              {t('finance.presets.' + p)}
            </Button>
          ))}
        </div>
        <Calendar
          mode='range'
          numberOfMonths={mobile ? 1 : 2}
          selected={range}
          defaultMonth={range?.from}
          locale={i18n.language.startsWith('zh') ? zhCN : enUS}
          onSelect={(r) => {
            setRange(r);
            if (r?.from && r.to) commit(r.from, r.to);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
