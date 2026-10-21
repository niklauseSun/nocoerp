import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { it, expect, vi, afterEach } from 'vitest';
import { MemoryRouter, Link } from 'react-router';
import { ResponsiveTable } from '../../client/components/responsive-table.js';
import {
  Table,
  TableBody,
  TableRow,
  TableCell,
} from '../../client/components/ui/table.js';
vi.mock('../../client/hooks/use-mobile.js', () => ({
  useIsMobile: () => true,
}));
afterEach(cleanup);
it('preserves selection and action handlers without treating the checkbox as a title', () => {
  const select = vi.fn(),
    act = vi.fn();
  render(
    <MemoryRouter>
      <ResponsiveTable labels={['选择', '编号', '状态', '操作']} titleIndex={1}>
        <Table>
          <TableBody>
            <TableRow>
              <TableCell>
                <input
                  type='checkbox'
                  aria-label='选择读数'
                  onChange={select}
                />
              </TableCell>
              <TableCell>
                <Link to='/readings/one'>读数001</Link>
              </TableCell>
              <TableCell>已审核</TableCell>
              <TableCell>
                <button onClick={act}>生成账单</button>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </ResponsiveTable>
    </MemoryRouter>,
  );
  expect(screen.getByRole('heading', { name: '读数001' })).toBeVisible();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText('选择读数'));
  fireEvent.click(screen.getByRole('button', { name: '生成账单' }));
  expect(select).toHaveBeenCalledOnce();
  expect(act).toHaveBeenCalledOnce();
  expect(screen.getByRole('link')).toHaveAttribute('href', '/readings/one');
  expect(screen.getByText('状态')).toBeVisible();
});
