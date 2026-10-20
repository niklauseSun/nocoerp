import {
  useReactTable,
  getCoreRowModel,
  getPaginationRowModel,
  flexRender,
  type ColumnDef,
} from '@tanstack/react-table';
import type { ReactNode } from 'react';
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from '#components/ui/table';
import { Button } from '#components/ui/button';
import { useTranslation } from '@nocobase/i18n/client';

/** Application-owned client-paginated table. Column hiding/sorting stay off unless a caller supplies their controls. */
export function DataTable<T>({
  data,
  columns,
  getRowId,
  label,
  emptyMessage,
  pageSize = 10,
  pagination = true,
}: {
  data: T[];
  columns: ColumnDef<T>[];
  getRowId: (row: T) => string;
  label: string;
  emptyMessage: ReactNode;
  pageSize?: number;
  pagination?: boolean;
}) {
  const { t } = useTranslation();
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Table owns mutable table state; React Compiler must skip this call.
  const table = useReactTable({
    data,
    columns,
    getRowId,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: pagination ? getPaginationRowModel() : undefined,
    initialState: { pagination: { pageIndex: 0, pageSize } },
  });
  return (
    <div className='flex min-w-0 flex-col gap-4'>
      <Table aria-label={label}>
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id}>
              {group.headers.map((header) => (
                <TableHead key={header.id}>
                  {header.isPlaceholder
                    ? null
                    : flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.length ? (
            table.getRowModel().rows.map((row) => (
              <TableRow key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <TableCell
                    key={cell.id}
                    className='break-words whitespace-normal'
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={columns.length}>{emptyMessage}</TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      {pagination && table.getPageCount() > 1 ? (
        <div className='flex flex-wrap items-center justify-end gap-2'>
          <span className='text-sm text-muted-foreground'>
            {t('organization.tablePage', {
              page: table.getState().pagination.pageIndex + 1,
              total: table.getPageCount(),
              count: data.length,
            })}
          </span>
          <Button
            variant='outline'
            disabled={!table.getCanPreviousPage()}
            onClick={() => table.previousPage()}
          >
            {t('organization.previousPage')}
          </Button>
          <Button
            variant='outline'
            disabled={!table.getCanNextPage()}
            onClick={() => table.nextPage()}
          >
            {t('organization.nextPage')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
