// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import { Ruler } from 'lucide-react';
import type { ModuleManifest } from '../_types';

// The module accepts optional props (for in-app embedding); cast to the
// module-route's `ComponentType<unknown>` signature so the manifest type
// remains uniform across all modules.
const TakeoffViewerModule = lazy(
  () => import('./TakeoffViewerModule'),
) as unknown as LazyExoticComponent<ComponentType<unknown>>;

// internal build lineage: ddc-lineage:a17f93c4-takeoff-02
export const manifest: ModuleManifest = {
  id: 'pdf-takeoff',
  name: 'modules.pdf_takeoff.name',
  description: 'modules.pdf_takeoff.description',
  version: '1.0.0',
  icon: Ruler,
  category: 'tools',
  defaultEnabled: true,
  routes: [
    {
      path: '/takeoff-viewer',
      title: 'nav.takeoff',
      component: TakeoffViewerModule,
    },
  ],
  navItems: [],
  translations: {
    en: {
      'modules.pdf_takeoff.name': 'PDF Takeoff Viewer',
      'modules.pdf_takeoff.description': 'View PDFs and take measurements directly on drawings',
    },
    de: {
      'modules.pdf_takeoff.name': 'PDF-Aufmaß-Viewer',
      'modules.pdf_takeoff.description': 'PDF-Pläne ansehen und Mengen direkt in der Zeichnung aufmessen',
    },
  },
};
