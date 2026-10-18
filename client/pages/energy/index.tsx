import { Navigate, Outlet, useLocation, useResolvedPath } from 'react-router';
export default function EnergyIndex() {
  const path = useResolvedPath('.').pathname,
    l = useLocation();
  return l.pathname === path || l.pathname === path + '/' ? (
    <Navigate to={{ pathname: path + '/meters', search: l.search }} replace />
  ) : (
    <Outlet />
  );
}
