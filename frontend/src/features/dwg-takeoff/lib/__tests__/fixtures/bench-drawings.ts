// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * Two drawings from the render bench, exactly as the entities endpoint returns
 * them. Both were authored as DXF and put through the product's own conversion
 * pipeline; nothing here is hand-written, which is what makes a fit scale
 * computed from them a fact rather than an estimate.
 *
 * They are in the tree rather than in a scratchpad because the defects they
 * pin - see `issue-426-render.test.ts` - shipped once already, and both were
 * only visible on a drawing with a wide authored text range or with a
 * paper-space sheet beside its model space. Neither shape existed in the
 * suite before, which is how the regression got through it twice.
 */
import type { DxfEntity } from '../../../api';

/** One converted drawing: the payload shape the viewer is handed. */
export interface BenchDrawing {
  name: string;
  /** Drawing units, as the converter reported them. */
  units: string;
  /** Layout (sheet) names present in the file, in wire order. */
  layouts: string[];
  entities: DxfEntity[];
}

/**
 * The wire carries entity types the client union does not list - VIEWPORT is
 * one, and a real paper-space sheet always has them. The renderer falls
 * through its switch for those and `computeExtents` still counts their
 * geometry, so they stay in the fixture and are widened here rather than
 * trimmed out: trimming would quietly change the fit these tests measure.
 */
type WireEntity = Omit<DxfEntity, 'type'> & { type: string };

/**
 * A 6 x 4 m room in millimetres carrying five deliberate annotation heights,
 * from a 25 mm room tag to a 20000 mm sheet title. That 800:1 authored range
 * is the range an ordinary floor plan uses, and it is what a readable-band
 * clamp destroys - on a drawing small enough that the band never binds, the
 * same clamp is invisible.
 */
const TEXT_HEIGHTS_ENTITIES: WireEntity[] = [
  {
    "id": "e_0",
    "type": "LWPOLYLINE",
    "layer": "A-WALL",
    "color": "#ffffff",
    "layout": "Model",
    "vertices": [
      {
        "x": 0,
        "y": 0
      },
      {
        "x": 6000,
        "y": 0
      },
      {
        "x": 6000,
        "y": 4000
      },
      {
        "x": 0,
        "y": 4000
      }
    ],
    "closed": true
  },
  {
    "id": "e_1",
    "type": "TEXT",
    "layer": "A-ANNO-TEXT",
    "color": "#ffff00",
    "layout": "Model",
    "start": {
      "x": 200,
      "y": 400
    },
    "text": "HEIGHT 25",
    "height": 25,
    "rotation": 0,
    "style": "Standard",
    "font": "txt"
  },
  {
    "id": "e_2",
    "type": "TEXT",
    "layer": "A-ANNO-TEXT",
    "color": "#ffff00",
    "layout": "Model",
    "start": {
      "x": 200,
      "y": 1200
    },
    "text": "HEIGHT 80",
    "height": 80,
    "rotation": 0,
    "style": "Standard",
    "font": "txt"
  },
  {
    "id": "e_3",
    "type": "TEXT",
    "layer": "A-ANNO-TEXT",
    "color": "#ffff00",
    "layout": "Model",
    "start": {
      "x": 200,
      "y": 2000
    },
    "text": "HEIGHT 200",
    "height": 200,
    "rotation": 0,
    "style": "Standard",
    "font": "txt"
  },
  {
    "id": "e_4",
    "type": "TEXT",
    "layer": "A-ANNO-TEXT",
    "color": "#ffff00",
    "layout": "Model",
    "start": {
      "x": 200,
      "y": 2800
    },
    "text": "HEIGHT 600",
    "height": 600,
    "rotation": 0,
    "style": "Standard",
    "font": "txt"
  },
  {
    "id": "e_5",
    "type": "TEXT",
    "layer": "A-ANNO-BIG",
    "color": "#ff0000",
    "layout": "Model",
    "start": {
      "x": 0,
      "y": -26000
    },
    "text": "GROUND FLOOR",
    "height": 20000,
    "rotation": 0,
    "style": "Standard",
    "font": "txt"
  },
  {
    "id": "e_6",
    "type": "TEXT",
    "layer": "A-ANNO-TEXT",
    "color": "#ffff00",
    "layout": "Model",
    "start": {
      "x": 5800,
      "y": 400
    },
    "text": "ROTATED 90",
    "height": 200,
    "rotation": 1.5707963267948966,
    "style": "Standard",
    "font": "txt"
  },
  {
    "id": "e_7",
    "type": "TEXT",
    "layer": "A-ANNO-TEXT",
    "color": "#ffff00",
    "layout": "Model",
    "start": {
      "x": 5600,
      "y": 3800
    },
    "text": "ROTATED 180",
    "height": 200,
    "rotation": 3.141592653589793,
    "style": "Standard",
    "font": "txt"
  },
  {
    "id": "e_8",
    "type": "TEXT",
    "layer": "A-ANNO-TEXT",
    "color": "#ffff00",
    "layout": "Model",
    "start": {
      "x": 2400,
      "y": 3600
    },
    "text": "ROOM SCHEDULE\nLIVING 6.0 x 4.0\nFINISH: SCREED",
    "height": 180,
    "rotation": 0,
    "style": "Standard",
    "font": "txt"
  },
  {
    "id": "e_9",
    "type": "TEXT",
    "layer": "A-ANNO-TEXT",
    "color": "#ffff00",
    "layout": "Model",
    "start": {
      "x": 3200,
      "y": 900
    },
    "text": "MTEXT AT 45",
    "height": 220,
    "rotation": 0,
    "style": "Standard",
    "font": "txt"
  }
];

export const TEXT_HEIGHTS: BenchDrawing = {
  name: "05-text-heights",
  units: "mm",
  layouts: ["Model"],
  entities: TEXT_HEIGHTS_ENTITIES as DxfEntity[],
};

/**
 * An 18 m building in model space and a 400 mm title block on Layout1: the
 * ordinary shape of a construction drawing, and two coordinate systems that
 * share neither origin nor scale. Fitting both into one box is fitting a
 * building and a sheet of paper into one window.
 */
const MODEL_AND_PAPERSPACE_ENTITIES: WireEntity[] = [
  {
    "id": "e_0",
    "type": "LWPOLYLINE",
    "layer": "A-WALL",
    "color": "#ffffff",
    "layout": "Model",
    "vertices": [
      {
        "x": 0,
        "y": 0
      },
      {
        "x": 18000,
        "y": 0
      },
      {
        "x": 18000,
        "y": 11000
      },
      {
        "x": 0,
        "y": 11000
      }
    ],
    "closed": true
  },
  {
    "id": "e_1",
    "type": "LINE",
    "layer": "A-WALL",
    "color": "#ffffff",
    "layout": "Model",
    "start": {
      "x": 3000,
      "y": 0
    },
    "end": {
      "x": 3000,
      "y": 11000
    }
  },
  {
    "id": "e_2",
    "type": "LINE",
    "layer": "A-WALL",
    "color": "#ffffff",
    "layout": "Model",
    "start": {
      "x": 6000,
      "y": 0
    },
    "end": {
      "x": 6000,
      "y": 11000
    }
  },
  {
    "id": "e_3",
    "type": "LINE",
    "layer": "A-WALL",
    "color": "#ffffff",
    "layout": "Model",
    "start": {
      "x": 9000,
      "y": 0
    },
    "end": {
      "x": 9000,
      "y": 11000
    }
  },
  {
    "id": "e_4",
    "type": "LINE",
    "layer": "A-WALL",
    "color": "#ffffff",
    "layout": "Model",
    "start": {
      "x": 12000,
      "y": 0
    },
    "end": {
      "x": 12000,
      "y": 11000
    }
  },
  {
    "id": "e_5",
    "type": "LINE",
    "layer": "A-WALL",
    "color": "#ffffff",
    "layout": "Model",
    "start": {
      "x": 15000,
      "y": 0
    },
    "end": {
      "x": 15000,
      "y": 11000
    }
  },
  {
    "id": "e_6",
    "type": "TEXT",
    "layer": "A-ANNO",
    "color": "#ffff00",
    "layout": "Model",
    "start": {
      "x": 500,
      "y": 11400
    },
    "text": "MODEL SPACE PLAN",
    "height": 500,
    "rotation": 0,
    "style": "Standard",
    "font": "txt"
  },
  {
    "id": "e_7",
    "type": "VIEWPORT",
    "layer": "VIEWPORTS",
    "color": "#ffffff",
    "layout": "Layout1"
  },
  {
    "id": "e_8",
    "type": "LWPOLYLINE",
    "layer": "G-SHEET",
    "color": "#808080",
    "layout": "Layout1",
    "vertices": [
      {
        "x": 10,
        "y": 10
      },
      {
        "x": 410,
        "y": 10
      },
      {
        "x": 410,
        "y": 287
      },
      {
        "x": 10,
        "y": 287
      }
    ],
    "closed": true
  },
  {
    "id": "e_9",
    "type": "LWPOLYLINE",
    "layer": "G-SHEET",
    "color": "#808080",
    "layout": "Layout1",
    "vertices": [
      {
        "x": 280,
        "y": 10
      },
      {
        "x": 410,
        "y": 10
      },
      {
        "x": 410,
        "y": 70
      },
      {
        "x": 280,
        "y": 70
      }
    ],
    "closed": true
  },
  {
    "id": "e_10",
    "type": "LINE",
    "layer": "G-SHEET",
    "color": "#808080",
    "layout": "Layout1",
    "start": {
      "x": 280,
      "y": 40
    },
    "end": {
      "x": 410,
      "y": 40
    }
  },
  {
    "id": "e_11",
    "type": "TEXT",
    "layer": "A-ANNO",
    "color": "#ffff00",
    "layout": "Layout1",
    "start": {
      "x": 288,
      "y": 50
    },
    "text": "GROUND FLOOR PLAN",
    "height": 8,
    "rotation": 0,
    "style": "Standard",
    "font": "txt"
  },
  {
    "id": "e_12",
    "type": "TEXT",
    "layer": "A-ANNO",
    "color": "#ffff00",
    "layout": "Layout1",
    "start": {
      "x": 288,
      "y": 22
    },
    "text": "SCALE 1:100",
    "height": 5,
    "rotation": 0,
    "style": "Standard",
    "font": "txt"
  },
  {
    "id": "e_13",
    "type": "VIEWPORT",
    "layer": "VIEWPORTS",
    "color": "#ffffff",
    "layout": "Layout1"
  }
];

export const MODEL_AND_PAPERSPACE: BenchDrawing = {
  name: "09-model-and-paperspace",
  units: "mm",
  layouts: ["Model","Layout1"],
  entities: MODEL_AND_PAPERSPACE_ENTITIES as DxfEntity[],
};
