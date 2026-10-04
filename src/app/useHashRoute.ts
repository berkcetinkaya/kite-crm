import { useEffect, useState } from 'react';
import { isRouteId, type RouteId } from './navigation';

// Minimal hash router: "#/pipeline" -> "pipeline". An optional query ("#/discover?sector=…")
// is ignored here and read by the page that needs it (see readHashParams).
function readRoute(): RouteId {
  const id = window.location.hash.replace(/^#\/?/, '').split('?')[0];
  return isRouteId(id) ? id : 'home';
}

/** Query parameters after the route in the hash, e.g. "#/discover?city=Dubai". */
export function readHashParams(): URLSearchParams {
  const query = window.location.hash.split('?')[1] ?? '';
  return new URLSearchParams(query);
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
