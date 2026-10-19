import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from 'react';
import { TableBody } from '#components/ui/table';
import { Card, CardHeader, CardTitle, CardContent } from '#components/ui/card';
import { useIsMobile } from '#hooks/use-mobile';
import { useTranslation } from '@nocobase/i18n/client';
import { Choice } from '../pages/hyl/common.js';
type Node = ReactElement<{ children?: ReactNode; className?: string }>;
const nodes = (children: ReactNode) =>
  // eslint-disable-next-line @eslint-react/no-children-to-array -- Explicit Table/Body/Row contract preserves each existing keyed cell subtree.
  Children.toArray(children).filter(isValidElement) as Node[];
/** Reuses the existing cells, links and action subtrees: phone cards cannot drift from desktop eligibility checks.
 * Direct TableBody/TableRow children are intentional. titleIndex accounts for optional leading selection columns. */
export function ResponsiveTable({
  children,
  labels,
  titleIndex = 0,
  sort,
}: {
  children: Node;
  labels: string[];
  titleIndex?: number;
  sort?: ReactNode;
}) {
  const mobile = useIsMobile();
  if (!mobile) return <div className='overflow-x-auto'>{children}</div>;
  const body = nodes(children.props.children).find((x) => x.type === TableBody);
  return (
    <div className='flex min-w-0 flex-col gap-3'>
      {sort}
      {nodes(body?.props.children).map((row) => {
        const cells = nodes(row.props.children);
        return (
          <Card key={row.key} data-slot='mobile-record'>
            <CardHeader>
              <CardTitle
                role='heading'
                aria-level={2}
                className='min-w-0 break-words leading-6'
              >
                {cells[titleIndex]?.props.children}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <dl className='flex min-w-0 flex-col gap-3'>
                {cells.map((cell, i) =>
                  i === titleIndex ? null : (
                    <div
                      key={cell.key}
                      className='grid min-w-0 grid-cols-3 items-start gap-3'
                    >
                      <dt className='text-sm text-muted-foreground'>
                        {labels[i]}
                      </dt>
                      <dd
                        className={
                          'col-span-2 min-w-0 break-words text-sm ' +
                          (cell.props.className ?? '')
                        }
                      >
                        {i < titleIndex ? (
                          <label className='flex min-h-11 items-center'>
                            {cell.props.children}
                          </label>
                        ) : (
                          cell.props.children
                        )}
                      </dd>
                    </div>
                  ),
                )}
              </dl>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
export function MobileSort({
  value,
  onChange,
  fields,
}: {
  value: string;
  onChange: (v: string) => void;
  fields: { value: string; label: string }[];
}) {
  const { t } = useTranslation();
  return (
    <Choice
      ariaLabel={t('mobile.sort')}
      value={value}
      onChange={onChange}
      options={fields.flatMap((f) => [
        { value: f.value, label: f.label + ' · ' + t('mobile.ascending') },
        {
          value: '-' + f.value,
          label: f.label + ' · ' + t('mobile.descending'),
        },
      ])}
    />
  );
}
