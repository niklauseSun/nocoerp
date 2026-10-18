import { Navigate, Outlet, useLocation } from 'react-router';
export default function Cashier() {
  const l = useLocation();
  return /\/cashier\/?$/.test(l.pathname) ? (
    <Navigate to={{ pathname: 'orders', search: l.search }} replace />
  ) : (
    <Outlet />
  );
}
