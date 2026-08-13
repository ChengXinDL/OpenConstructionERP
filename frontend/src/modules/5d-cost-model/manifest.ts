// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
import { TrendingUp } from 'lucide-react';
import type { ModuleManifest } from '../_types';

export const manifest: ModuleManifest = {
  id: '5d',
  name: 'nav.5d_cost_model',
  description: 'modules.5d_desc',
  version: '1.0.0',
  icon: TrendingUp,
  category: 'planning',
  defaultEnabled: true,
  routes: [],
  navItems: [],
  translations: {
    en: {
      'modules.5d_desc':
        '5D cost model tying quantities, rates and the schedule into one cash-flow view.',
    },
    de: {
      'modules.5d_desc':
        '5D-Kostenmodell, das Mengen, Preise und Termine zu einer Zahlungsstromsicht verbindet.',
    },
  },
};
