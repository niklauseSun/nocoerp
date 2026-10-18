import { Navigate, Outlet, useLocation } from 'react-router';
export default function Index() {
  const l = useLocation();
  return (
    <>
      {l.pathname.endsWith('/inspections') ? (
        <Navigate
          to={{ pathname: l.pathname + '/plans', search: l.search }}
          replace
        />
      ) : null}
      <Outlet />
    </>
  );
}
