// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
import { Box } from 'lucide-react';
import type { ModuleManifest } from '../_types';

export const manifest: ModuleManifest = {
  id: 'ddc-rvt-converter',
  name: 'converter.rvt.name',
  description: 'modules.ddc_rvt_converter.description',
  version: '1.0.0',
  icon: Box,
  category: 'converter',
  defaultEnabled: false,
  depends: [],
  routes: [],
  navItems: [],
  translations: {
    en: {
      'converter.rvt.name': 'DDC cad2data - RVT Converter',
      'converter.rvt.desc': 'Convert RVT (.rvt) files to DataFrame + COLLADA geometry',
      'modules.ddc_rvt_converter.description':
        'Converts RVT (.rvt) files into element data (DataFrame) and 3D geometry (COLLADA). Extracts families, types, parameters, quantities, and spatial structure via the DDC cad2data pipeline - no BIM authoring software required.',
    },
    de: {
      'converter.rvt.name': 'DDC cad2data - RVT Konverter',
      'converter.rvt.desc': 'RVT-Dateien (.rvt) in DataFrame + COLLADA-Geometrie konvertieren',
      'modules.ddc_rvt_converter.description':
        'Wandelt RVT-Dateien (.rvt) in Bauteildaten (DataFrame) und 3D-Geometrie (COLLADA) um. Familien, Typen, Parameter, Mengen und Bauwerksstruktur liest die DDC-cad2data-Pipeline aus, ganz ohne BIM-Autorensoftware.',
    },
    ru: {
      'converter.rvt.name': 'DDC cad2data - RVT Конвертер',
      'converter.rvt.desc': 'Конвертация файлов RVT (.rvt) в DataFrame + COLLADA геометрию',
    },
  },
};
