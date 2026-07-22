/*
 * cases-constants.mjs  (shared, single source of truth)
 *
 * Small facts shared by the case generators. Keep numbers here so they never
 * drift between the gallery and the detail pages.
 */

// The platform's advertised module total, shown in the honeycomb caption
// ("N / TOTAL platform modules"). This is the number the homepage advertises,
// NOT the count of modules that happen to appear in the case playbooks (that
// undercounts). Update this one place when the advertised figure changes.
export const PLATFORM_MODULE_TOTAL = 161;

// Canonical module -> URL slug. Used to build the /cases/?module=<slug> filter
// links on the honeycomb hexes and to match them back on the gallery. The
// gallery filter script inlines the identical rule, so keep them in sync.
export const moduleSlug = (s) =>
  String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
