import { useState } from 'react';
import { useTranslation } from '@nocobase/i18n/client';
import { Button } from '#components/ui/button';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '#components/ui/popover';
import { Picker } from './common.js';
import { useBusinessQuery } from '../hyl/hooks.js';
import { scalar } from './helpers.js';
export function FilterPicker({
  kind,
  value,
  onChange,
}: {
  kind: 'assets' | 'contracts';
  value: string;
  onChange: (v: string) => void;
}) {
  const { t } = useTranslation(),
    [open, setOpen] = useState(false),
    name = kind === 'assets' ? 'assetId' : 'contractId',
    selected = useBusinessQuery<{ data: Record<string, unknown> }>(
      kind + '/' + value,
      undefined,
      !!value,
    ),
    label = selected.data?.data;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant='outline' />}>
        {t('energy.fields.' + name)}
        {value
          ? ' · ' +
            (scalar(label?.number) ||
              scalar(label?.name) ||
              t('energy.filtered'))
          : ''}
      </PopoverTrigger>
      <PopoverContent className='w-80'>
        <Picker
          name={name}
          kind={kind}
          value={value}
          required={false}
          onChange={(v) => {
            onChange(v);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
