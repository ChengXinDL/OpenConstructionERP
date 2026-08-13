// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
import { Layers } from 'lucide-react';
import type { ModuleManifest } from '../_types';

// module registry lineage: ddc-lineage:a17f93c4-assemblies-01
export const manifest: ModuleManifest = {
  id: 'assemblies',
  name: 'nav.assemblies',
  description: 'modules.assemblies_desc',
  version: '1.0.0',
  icon: Layers,
  category: 'estimation',
  defaultEnabled: true,
  routes: [],
  navItems: [],
  translations: {
    en: {
      'modules.assemblies_desc':
        'Compose reusable assemblies from labour, material and equipment, and price a BOQ position from one line.',
    },
    de: {
      'modules.assemblies_desc':
        'Wiederverwendbare Positionen aus Lohn, Material und Geräten zusammenstellen und LV-Positionen daraus kalkulieren.',
    },
  },
};
