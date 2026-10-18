import { Navigate, Outlet, useLocation, useResolvedPath } from 'react-router';
export default function SplitIndex() {
  const path = useResolvedPath('.').pathname,
    l = useLocation();
  return l.pathname === path || l.pathname === path + '/' ? (
    <Navigate to={{ pathname: path + '/orders', search: l.search }} replace />
  ) : (
    <Outlet />
  );
}
