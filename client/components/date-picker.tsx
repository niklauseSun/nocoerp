import { useState } from 'react';
import { useTranslation } from '@nocobase/i18n/client';
import { CalendarIcon } from 'lucide-react';
import { zhCN, enUS } from 'react-day-picker/locale';
import { Button } from '#components/ui/button';
import { Calendar } from '#components/ui/calendar';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '#components/ui/popover';

// Shared calendar composition; ISO values stay date-only to avoid timezone shifts.
export function DatePicker({
  value,
  onChange,
  id,
  month = false,
  disabled = false,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  id: string;
  month?: boolean;
  disabled?: boolean;
  placeholder: string;
}) {
  const { i18n } = useTranslation();
  const [lastCalendarYear] = useState(() => new Date().getFullYear() + 20);
  const date = value
    ? new Date(`${value}${month ? '-01' : ''}T00:00:00`)
    : undefined;
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            id={id}
            variant='outline'
            disabled={disabled}
            className='w-full justify-start'
          />
        }
      >
        <CalendarIcon className='size-4' />
        {date
          ? new Intl.DateTimeFormat(i18n.language, {
              year: 'numeric',
              month: 'long',
              ...(month ? {} : { day: 'numeric' }),
            }).format(date)
          : placeholder}
      </PopoverTrigger>
      <PopoverContent className='w-auto p-0'>
        <Calendar
          mode='single'
          startMonth={new Date(2000, 0)}
          endMonth={new Date(lastCalendarYear, 11)}
          captionLayout='dropdown'
          locale={i18n.language.startsWith('zh') ? zhCN : enUS}
          selected={date}
          defaultMonth={date}
          onSelect={(d) => {
            if (d) {
              const s = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
              onChange(month ? s.slice(0, 7) : s);
            }
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
