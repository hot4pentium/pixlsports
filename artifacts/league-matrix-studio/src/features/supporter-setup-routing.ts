export function shouldRequireSupporterSetup(pathname: string): boolean {
  const path = pathname.split(/[?#]/, 1)[0].replace(/\/+$/, '') || '/';
  return (path === '/studio' || path.startsWith('/studio/'))
    && path !== '/studio/setup';
}