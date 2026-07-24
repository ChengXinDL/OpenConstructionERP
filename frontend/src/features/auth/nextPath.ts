// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction

/**
 * Resolve a safe post-login redirect target from a URL query string.
 *
 * A guarded route sends a signed-out visitor to `/login?next=/where/they/wanted`
 * (see RequireAuth). After a successful sign-in we want to send them on to that
 * path, but only when it is a genuine internal, non-auth destination. Anything
 * else - missing, external, protocol-relative, or an auth route that would
 * dead-end or loop - falls back to `/`, which the app resolves to the dashboard.
 *
 * This is the single source of truth for that decision so the login form and
 * the already-authenticated route guards cannot disagree. When `setTokens`
 * flips the auth state a tick before the form's own `navigate(next)` runs, the
 * `/login` guard re-renders and redirects too; if the guard hard-coded `/` it
 * won that race and silently dropped the `next`. That was the demo deep-link
 * bug: every case-study "open in the demo" link landed on the dashboard instead
 * of its module. With both the form and the guard routing through this helper,
 * whichever navigation wins lands on the same validated place.
 *
 * @param search - a location search string, with or without the leading `?`.
 */
export function safeNextPath(search: string): string {
  // Never bounce back into an auth route after a successful login - a
  // next=/login (or /onboarding before completion) would dead-end or re-loop.
  const authRoutes = ['/login', '/register', '/forgot-password', '/reset-password', '/onboarding'];
  try {
    const next = new URLSearchParams(search).get('next');
    if (
      next &&
      next.startsWith('/') &&
      !next.startsWith('//') &&
      !authRoutes.some((r) => next === r || next.startsWith(`${r}/`) || next.startsWith(`${r}?`))
    ) {
      return next;
    }
  } catch {
    /* malformed query - fall through to the safe default */
  }
  return '/';
}
