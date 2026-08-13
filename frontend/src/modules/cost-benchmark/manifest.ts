// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
import { lazy } from 'react';
import { BarChart3 } from 'lucide-react';
import type { ModuleManifest } from '../_types';

const BenchmarkModule = lazy(() => import('./BenchmarkModule'));

export const manifest: ModuleManifest = {
  id: 'cost-benchmark',
  // `nav.benchmarks` rather than a key of this module's own: the locale files
  // already carry it in every language, and it names the same destination as
  // the sidebar row and the page heading.
  name: 'nav.benchmarks',
  description: 'modules.cost_benchmark.description',
  version: '1.0.0',
  icon: BarChart3,
  category: 'tools',
  defaultEnabled: true,
  depends: ['costs'],
  routes: [
    {
      path: '/benchmarks',
      title: 'nav.benchmarks',
      component: BenchmarkModule,
    },
  ],
  // navItems intentionally empty. The /benchmarks row already lives in the
  // sidebar as a static entry in the grp_cost_data group (Sidebar.tsx), gated
  // by moduleKey 'cost-benchmark' and advancedOnly. The sidebar only pulls
  // dynamic module navItems for its static group ids (grp_*, regional), never
  // for the legacy 'tools' group string a manifest would declare here, so an
  // entry would either render nowhere or duplicate the existing nav source.
  navItems: [],
  translations: {
    en: {
      'modules.cost_benchmark.description':
        'Compare cost per square metre against reference projects and percentile bands.',
    },
    de: {
      'modules.cost_benchmark.description':
        'Kosten je Quadratmeter mit Referenzprojekten und Perzentilbändern vergleichen.',
    },
  },
};
