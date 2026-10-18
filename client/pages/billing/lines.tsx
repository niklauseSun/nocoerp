import { scalar } from '../hyl/model.js';
import { useTranslation } from '@nocobase/i18n/client';
import {
  Table,
  TableHeader,
  TableHead,
  TableRow,
  TableBody,
  TableCell,
} from '#components/ui/table';
import { LongText } from '#components/long-text';
import { Day, Money } from './common.js';
import type { Line } from './types.js';
export function Calculation({ lines }: { lines: Line[] }) {
  const { t } = useTranslation();
  return (
    <div className='overflow-x-auto'>
      <Table>
        <TableHeader>
          <TableRow>
            {['feeType', 'start', 'end', 'formula', 'amount', 'evidence'].map(
              (key) => (
                <TableHead
                  key={key}
                  className={key === 'amount' ? 'text-right' : ''}
                >
                  {t(`billing.fields.${key}`)}
                </TableHead>
              ),
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((line) => (
            <TableRow key={line.id}>
              <TableCell>
                {t(`billing.fees.${line.feeType}`)}
                {line.meterCode ? (
                  <p className='text-sm text-muted-foreground'>
                    {line.meterCode}
                  </p>
                ) : null}
                {line.payload.title ? (
                  <p className='text-sm'>{scalar(line.payload.title)}</p>
                ) : null}
              </TableCell>
              <TableCell>
                <Day value={line.start} />
              </TableCell>
              <TableCell>
                <Day value={line.end} />
              </TableCell>
              <TableCell className='whitespace-normal'>
                {line.payload.monthly !== undefined ? (
                  <>
                    {scalar(line.payload.monthly)}
                    {line.payload.method === 'area'
                      ? ` × ${scalar(line.payload.area)} m²`
                      : ''}{' '}
                    × {scalar(line.payload.days)} /{' '}
                    {scalar(line.payload.calendarDays)}
                  </>
                ) : line.payload.previous !== undefined ? (
                  <>
                    <span>
                      ({scalar(line.payload.current)} −{' '}
                      {scalar(line.payload.previous)}) ×{' '}
                      {scalar(line.payload.multiplier)} ={' '}
                      {scalar(line.payload.usage)}{' '}
                      {line.feeType === 'electricity' ? 'kWh' : 'm³'}
                    </span>
                    <p>× {scalar(line.payload.unitPrice)}</p>
                  </>
                ) : (
                  <LongText>{scalar(line.payload.reason ?? '—')}</LongText>
                )}
              </TableCell>
              <TableCell className='text-right'>
                <Money cents={line.amountCents} />
              </TableCell>
              <TableCell className='whitespace-normal'>
                <LongText>{scalar(line.payload.evidence ?? '—')}</LongText>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
