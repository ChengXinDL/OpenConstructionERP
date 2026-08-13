// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
import { Box } from 'lucide-react';
import type { ModuleManifest } from '../_types';

export const manifest: ModuleManifest = {
  id: 'ddc-ifc-converter',
  name: 'converter.ifc.name',
  description: 'modules.ddc_ifc_converter.description',
  version: '1.0.0',
  icon: Box,
  category: 'converter',
  defaultEnabled: false,
  depends: [],
  routes: [],
  navItems: [],
  translations: {
    en: {
      'converter.ifc.name': 'DDC cad2data - IFC Converter',
      'converter.ifc.desc': 'Convert IFC files to DataFrame + COLLADA geometry',
      'modules.ddc_ifc_converter.description':
        'Converts IFC (Industry Foundation Classes) files into element data (DataFrame) and 3D geometry (COLLADA). Enables automatic extraction of walls, slabs, columns, beams, doors, windows, MEP elements with quantities, properties, and storey classification.',
    },
    de: {
      'converter.ifc.name': 'DDC cad2data - IFC Konverter',
      'converter.ifc.desc': 'IFC-Dateien in DataFrame + COLLADA-Geometrie konvertieren',
      'modules.ddc_ifc_converter.description':
        'Wandelt IFC-Dateien (Industry Foundation Classes) in Bauteildaten (DataFrame) und 3D-Geometrie (COLLADA) um. Wände, Decken, Stützen, Träger, Türen, Fenster und TGA-Bauteile werden mit Mengen, Eigenschaften und Geschosszuordnung automatisch ausgelesen.',
    },
    ru: {
      'converter.ifc.name': 'DDC cad2data - IFC Конвертер',
      'converter.ifc.desc': 'Конвертация IFC файлов в DataFrame + COLLADA геометрию',
    },
  },
};
