import { Navigate, Outlet, useLocation } from 'react-router';
export default function Index() {
  const l = useLocation();
  return (
    <>
      {l.pathname.endsWith('/procurement') ? (
        <Navigate
          to={{ pathname: l.pathname + '/requests', search: l.search }}
          replace
        />
      ) : null}
      <Outlet />
    </>
  );
}
