// A small hash router. Works on static hosts, inside the native shells and in the desktop app
// (no server rewrites needed) and falls back to in-memory navigation where the hash is not
// writable. Routes look like '#/tenants/ten_123'.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const RouterContext = createContext(null);

function readHash() {
  try {
    const raw = globalThis.location?.hash || '';
    const path = raw.replace(/^#/, '');
    return path.startsWith('/') ? path : '/';
  } catch {
    return '/';
  }
}

function writeHash(path, replace) {
  try {
    if (!globalThis.location) return false;
    const target = `#${path}`;
    if (globalThis.location.hash === target) return true;
    if (replace && globalThis.history?.replaceState) {
      globalThis.history.replaceState(null, '', target);
      globalThis.dispatchEvent(new HashChangeEvent('hashchange'));
    } else {
      globalThis.location.hash = path;
    }
    return true;
  } catch {
    return false;
  }
}

export function RouterProvider({ children }) {
  const [path, setPath] = useState(readHash);
  const [stack, setStack] = useState([]);

  useEffect(() => {
    const onChange = () => setPath(readHash());
    globalThis.addEventListener?.('hashchange', onChange);
    return () => globalThis.removeEventListener?.('hashchange', onChange);
  }, []);

  const navigate = useCallback((to, { replace = false } = {}) => {
    const target = to.startsWith('/') ? to : `/${to}`;
    setStack((s) => (replace ? s : [...s.slice(-30), readHash()]));
    if (!writeHash(target, replace)) setPath(target);
  }, []);

  const back = useCallback((fallback = '/') => {
    if (stack.length) {
      const prev = stack[stack.length - 1];
      setStack((s) => s.slice(0, -1));
      if (!writeHash(prev, false)) setPath(prev);
      return true;
    }
    navigate(fallback, { replace: true });
    return false;
  }, [stack, navigate]);

  const value = useMemo(() => ({ path, navigate, back, canGoBack: stack.length > 0 }), [path, navigate, back, stack.length]);
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter() {
  const ctx = useContext(RouterContext);
  if (!ctx) throw new Error('useRouter must be used inside RouterProvider');
  return ctx;
}

/**
 * Match a path against patterns like '/tenants/:id'. Returns { route, params } for the first match.
 * Patterns are checked in order; use '*' as the catch-all.
 */
export function matchRoute(path, patterns) {
  const [clean] = path.split('?');
  const segments = clean.split('/').filter(Boolean);
  for (const pattern of patterns) {
    if (pattern === '*') return { route: pattern, params: {} };
    const parts = pattern.split('/').filter(Boolean);
    if (parts.length !== segments.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].startsWith(':')) params[parts[i].slice(1)] = decodeURIComponent(segments[i]);
      else if (parts[i] !== segments[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return { route: pattern, params };
  }
  return null;
}

export function Link({ to, replace, className, children, onClick, ...rest }) {
  const { navigate } = useRouter();
  return (
    <a
      href={`#${to}`}
      className={className}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.button !== 0) return;
        e.preventDefault();
        onClick?.(e);
        navigate(to, { replace });
      }}
      {...rest}
    >
      {children}
    </a>
  );
}
