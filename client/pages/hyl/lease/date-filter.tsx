import { useState } from 'react';
import { useTranslation } from '@nocobase/i18n/client';
import { zhCN, enUS } from 'react-day-picker/locale';
import { CalendarIcon } from 'lucide-react';
import { useIsMobile } from '#hooks/use-mobile';
import { Calendar } from '#components/ui/calendar';
import { Button } from '#components/ui/button';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '#components/ui/popover';
const iso = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export function LeaseDateFilter({
  from,
  to,
  onChange,
  label,
}: {
  label?: string;
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
}) {
  const { t, i18n } = useTranslation(),
    [open, setOpen] = useState(false),
    mobile = useIsMobile();
  const start = from ? new Date(from + 'T00:00:00') : undefined,
    end = to ? new Date(to + 'T00:00:00') : undefined;
  const preset = (value: string) => {
    const now = new Date(),
      begin = new Date(now),
      last = new Date(now);
    if (value === 'month') begin.setDate(1);
    else if (value === 'previousMonth') {
      begin.setDate(1);
      begin.setMonth(begin.getMonth() - 1);
      last.setDate(0);
    } else begin.setDate(begin.getDate() - Number(value) + 1);
    onChange(iso(begin), iso(last));
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant='outline'
            aria-label={label ?? t('lease.dateRange')}
          />
        }
      >
        <CalendarIcon className='size-4' />
        {from || to
          ? `${from || '—'} — ${to || '—'}`
          : (label ?? t('lease.dateRange'))}
      </PopoverTrigger>
      <PopoverContent
        className='w-auto max-w-[calc(100vw-2rem)] p-2'
        align='start'
      >
        <div className='flex max-w-xl flex-wrap gap-1 border-b pb-2'>
          {['7', '30', '90', 'month', 'previousMonth'].map((p) => (
            <Button
              type='button'
              key={p}
              variant='ghost'
              size='sm'
              onClick={() => preset(p)}
            >
              {t(`lease.presets.${p}`)}
            </Button>
          ))}
        </div>
        <Calendar
          mode='range'
          numberOfMonths={mobile ? 1 : 2}
          locale={i18n.language.startsWith('zh') ? zhCN : enUS}
          selected={{ from: start, to: end }}
          defaultMonth={start}
          onSelect={(range) => {
            onChange(
              range?.from ? iso(range.from) : '',
              range?.to ? iso(range.to) : '',
            );
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
