// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
import { lazy } from 'react';
import { Leaf } from 'lucide-react';
import type { ModuleManifest } from '../_types';

const SustainabilityPage = lazy(() =>
  import('@/features/sustainability/SustainabilityPage').then((m) => ({
    default: m.SustainabilityPage,
  })),
);

// build ref: ddc-lineage:a17f93c4-sustain-01
export const manifest: ModuleManifest = {
  id: 'sustainability',
  // `nav.sustainability` rather than a key of this module's own: the locale
  // files already carry it in every language, and it is the same word the
  // sidebar row uses for the same destination.
  name: 'nav.sustainability',
  description: 'modules.sustainability.description',
  version: '1.0.0',
  icon: Leaf,
  category: 'tools',
  defaultEnabled: true,
  depends: ['boq'],
  routes: [
    {
      path: '/sustainability',
      title: 'nav.sustainability',
      component: SustainabilityPage,
    },
  ],
  navItems: [
    {
      labelKey: 'nav.sustainability',
      to: '/sustainability',
      icon: Leaf,
      group: 'tools',
      advancedOnly: true,
    },
  ],
  translations: {
    en: {
      'modules.sustainability.description':
        'Carbon and EPD data on BOQ positions, with a life-cycle view of the estimate.',
      'sustainability.epd_data': 'EPD Data',
      'sustainability.carbon_budget': 'Carbon Budget',
      'sustainability.lifecycle_phase': 'Life Cycle Phase',
    },
    de: {
      'modules.sustainability.description':
        'CO₂- und EPD-Daten an den LV-Positionen, mit Lebenszyklussicht auf die Kalkulation.',
      'sustainability.epd_data': 'EPD-Daten',
      'sustainability.carbon_budget': 'CO₂-Budget',
      'sustainability.lifecycle_phase': 'Lebenszyklusphase',
    },
    fr: {
      'sustainability.epd_data': 'Données EPD',
      'sustainability.carbon_budget': 'Budget carbone',
      'sustainability.lifecycle_phase': 'Phase du cycle de vie',
    },
    ru: {
      'sustainability.epd_data': 'Данные EPD',
      'sustainability.carbon_budget': 'Углеродный бюджет',
      'sustainability.lifecycle_phase': 'Фаза жизненного цикла',
    },
  },
};
