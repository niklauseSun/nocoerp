import { Navigate, Outlet, useLocation, useResolvedPath } from 'react-router';
export default function InvoiceIndex() {
  const path = useResolvedPath('.').pathname,
    l = useLocation();
  return l.pathname === path || l.pathname === path + '/' ? (
    <Navigate to={{ pathname: path + '/sources', search: l.search }} replace />
  ) : (
    <Outlet />
  );
}
