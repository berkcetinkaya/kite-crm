import { useEffect, useState } from 'react';
import { isRouteId, type RouteId } from './navigation';

// Minimal hash router: "#/pipeline" -> "pipeline". Enough until real routing is needed.
function readRoute(): RouteId {
  const id = window.location.hash.replace(/^#\/?/, '');
  return isRouteId(id) ? id : 'home';
}

export function useHashRoute(): RouteId {
  const [route, setRoute] = useState<RouteId>(readRoute);

  useEffect(() => {
    const onChange = () => setRoute(readRoute());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  return route;
}
