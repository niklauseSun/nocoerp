import { Navigate, Outlet, useLocation } from 'react-router';
export default function BillingPage() {
  const location = useLocation();
  return /\/billing\/?$/.test(location.pathname) ? (
    <Navigate to={{ pathname: 'bills', search: location.search }} replace />
  ) : (
    <Outlet />
  );
}
