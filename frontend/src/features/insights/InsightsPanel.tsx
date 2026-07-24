// DDC-CWICR-OE: DataDrivenConstruction · OpenConstructionERP
// Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
/**
 * The Insights panel a module embeds under its header. It renders the module's
 * built-in KPIs and charts and lets the user add their own from the same data,
 * all client-side off the rows the module already loaded - no extra request.
 * The page owns the open/hide state (see useModuleInsights) and passes it in so
 * the header toggle and this panel stay in lock-step.
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart3, FlaskConical, Plus } from 'lucide-react';
import { Button } from '@/shared/ui';
import { computeKpi, measureFormat } from './aggregate';
import { KpiTile } from './charts';
import { CardControls, InsightCard } from './InsightCard';
import { InsightBuilder } from './InsightBuilder';
import type { InsightDataset, InsightDef } from './types';

interface InsightsPanelProps {
  open: boolean;
  title?: string;
  subtitle?: string;
  datasets: InsightDataset[];
  builtins: InsightDef[];
  custom: InsightDef[];
  onAdd: (def: InsightDef) => void;
  onUpdate: (def: InsightDef) => void;
  onRemove: (id: string) => void;
}

export function InsightsPanel({
  open,
  title,
  subtitle,
  datasets,
  builtins,
  custom,
  onAdd,
  onUpdate,
  onRemove,
}: InsightsPanelProps) {
  const { t } = useTranslation();
  const [building, setBuilding] = useState(false);
  const [editing, setEditing] = useState<InsightDef | null>(null);

  const dsMap = useMemo(() => {
    const m: Record<string, InsightDataset> = {};
    for (const d of datasets) m[d.id] = d;
    return m;
  }, [datasets]);

  const all = useMemo(() => [...builtins, ...custom], [builtins, custom]);
  const kpis = all.filter((d) => d.chart === 'kpi');
  const charts = all.filter((d) => d.chart !== 'kpi');
  const hasSample = datasets.some((d) => d.sample);

  if (!open) return null;

  const openEditor = (def: InsightDef) => {
    setEditing(def);
    setBuilding(true);
  };
  const closeEditor = () => {
    setBuilding(false);
    setEditing(null);
  };
  const save = (def: InsightDef) => {
    if (editing && !editing.builtin) onUpdate(def);
    else onAdd(def);
  };

  return (
    <section
      className="animate-fade-in overflow-hidden rounded-2xl border border-border-light bg-surface-secondary/30"
      aria-label={title ?? t('insights.toggle', { defaultValue: 'Insights' })}
    >
      {/* Header strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-light bg-surface-primary/60 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-oe-blue-subtle text-oe-blue-text">
            <BarChart3 size={16} />
          </span>
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-content-primary">
              {title ?? t('insights.toggle', { defaultValue: 'Insights' })}
              {hasSample && (
                <span
                  className="inline-flex items-center gap-1 rounded-full border border-semantic-warning/30 bg-semantic-warning-bg/50 px-2 py-0.5 text-2xs font-medium text-semantic-warning"
                  title={t('insights.sample_hint', {
                    defaultValue: 'This project has no data yet, so the panel shows sample figures to illustrate.',
                  })}
                >
                  <FlaskConical size={11} />
                  {t('insights.sample', { defaultValue: 'Sample data' })}
                </span>
              )}
            </h2>
            <p className="truncate text-xs text-content-tertiary">
              {subtitle ??
                t('insights.subtitle', {
                  defaultValue: 'Live charts from this module. Build your own and hide the panel any time.',
                })}
            </p>
          </div>
        </div>
        <Button
          variant="secondary"
          size="sm"
          icon={<Plus size={14} />}
          onClick={() => {
            setEditing(null);
            setBuilding(true);
          }}
          disabled={datasets.length === 0}
        >
          {t('insights.new_chart', { defaultValue: 'New chart' })}
        </Button>
      </div>

      <div className="space-y-4 p-4">
        {/* KPI row */}
        {kpis.length > 0 && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {kpis.map((def) => {
              const ds = dsMap[def.datasetId];
              return (
                <div key={def.id} className="group relative">
                  <KpiTile
                    label={def.title}
                    value={ds ? computeKpi(ds, def) : 0}
                    format={ds ? measureFormat(ds, def) : 'number'}
                    currency={ds?.currency}
                    color={def.color ?? 0}
                  />
                  {!def.builtin && (
                    <div className="absolute right-1.5 top-1.5 opacity-0 transition-opacity group-hover:opacity-100">
                      <CardControls onEdit={() => openEditor(def)} onRemove={() => onRemove(def.id)} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Chart grid */}
        {charts.length > 0 && (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {charts.map((def) => (
              <InsightCard
                key={def.id}
                def={def}
                dataset={dsMap[def.datasetId]}
                onEdit={def.builtin ? undefined : () => openEditor(def)}
                onRemove={def.builtin ? undefined : () => onRemove(def.id)}
              />
            ))}
          </div>
        )}

        {/* Nothing to show yet */}
        {all.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
            <BarChart3 size={26} className="text-content-tertiary" strokeWidth={1.5} />
            <p className="text-sm text-content-secondary">
              {t('insights.empty_title', { defaultValue: 'No charts yet' })}
            </p>
            <p className="max-w-sm text-xs text-content-tertiary">
              {t('insights.empty_desc', {
                defaultValue: 'Add a chart to visualise this module. You can build as many as you like.',
              })}
            </p>
            <Button
              variant="primary"
              size="sm"
              icon={<Plus size={14} />}
              onClick={() => setBuilding(true)}
              disabled={datasets.length === 0}
              className="mt-1"
            >
              {t('insights.new_chart', { defaultValue: 'New chart' })}
            </Button>
          </div>
        )}
      </div>

      {building && datasets.length > 0 && (
        <InsightBuilder
          datasets={datasets}
          initial={editing}
          nextColor={(all.length % 7) + 1}
          onSave={save}
          onClose={closeEditor}
        />
      )}
    </section>
  );
}
