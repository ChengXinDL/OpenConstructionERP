# OpenConstructionERP × batimatech (Canada)

Partner pack pre-configuring [OpenConstructionERP](https://github.com/DataDrivenConstruction/openconstructionerp)
for Canadian construction companies.

> **Pré-configuré pour les entreprises canadiennes de construction —
> CNB 2020, contrats CCDC, normes CSA, conformité provinciale.**

## What this pack does

When installed alongside the OCERP core, this pack registers via the
`openconstructionerp.partner_packs` entry-point and the host application:

- Switches the default locale to **fr-CA** (Canadian French, Québec
  terminology), with **en-CA** available as a secondary locale. Falls back
  to `en` for untranslated keys.
- Preloads the CWICR cost region **cwicr-eng-toronto** (the only Canadian
  snapshot live in the marketplace today; Montréal / Vancouver / Calgary /
  Halifax / Ottawa are flagged "upcoming" in the onboarding wizard and will
  auto-activate when published).
- Sets default currency to **CAD** and applies the **`ca_gst_pst`** tax
  template (note: the tax-template runtime is a roadmap item — the slug is
  recorded on the manifest but no rules currently consume it).
- Enables **nine** Canadian validation rule packs:
  - `nbc_2020` — National Building Code of Canada 2020 (Parts 1–10)
  - `ccdc_2` — CCDC 2-2020 Stipulated Price Contract
  - `ccdc_5a` — CCDC 5A-2025 Construction Management for Services
  - `ccdc_14` — CCDC 14-2013 Design-Build Stipulated Price
  - `csa_a23_1` — CSA A23.1:19 Concrete Materials & Methods
  - `csa_a23_3` — CSA A23.3:19 Design of Concrete Structures
  - `csa_s16` — CSA S16:19 Design of Steel Structures
  - `quebec_ccq` — Québec CCQ / RBQ licensing & compliance (Loi R-20)
  - `ontario_obc` — Ontario Building Code (O. Reg. 332/12) + WSIB
- Applies batimatech branding (`#1C9BD7` cyan + `#1B3A5B` navy) and replaces
  the boot logo / favicon.
- Replaces the default first-login onboarding wizard with a 9-step
  Canadian workflow (firm profile + province, GST/QST/HST + RBQ/CCQ/WSIB
  registrations, NBC 2020 Parts, CCDC contract default, CWICR regions,
  team invites, bilingual EN-CA/FR-CA mode, summary).

The pack ships **no** new validation rule classes (Shape A) — it only
switches on rules already present in the OCERP core. No modules are hidden;
the full sidebar remains available.

## Cost data

**No commercial cost database is bundled, and none can be.** The Canadian
unit-price databases sold by subscription are licensed products whose terms
forbid redistribution, so shipping one inside an AGPL pack is not something a
licence would permit us to do.

This pack is therefore the structure, not the data. It gives you the code
compliance and contract rules to estimate against, the CAD currency and tax
defaults, and the import path for the rates you are licensed to use, whether
that is your own historical cost history, a subscription you hold, or a public
schedule of prices. The onboarding wizard asks which regions you work in; it
never assumes a particular vendor.

For national-average rates with regional adjustment, the pack points at the
`cwicr-eng-toronto` region, which loads on demand.

## Standards referenced

- NBC 2020, National Building Code of Canada
- CCDC 2-2020, 5A-2025 and 14-2013 contract forms
- CSA A23.1:19, A23.3:19 and S16:19
- Ontario Building Code, O. Reg. 332/12, and WSIB requirements
- Québec Loi R-20 with CCQ and RBQ licensing

These are referenced for interoperability and compliance checking. Clause and
article numbers are interoperability facts and are used as such; the
publishers' own text and tables are not reproduced here.

## Install

```bash
pip install openconstructionerp-batimatech-ca
# then restart the OCERP backend — the pack is auto-discovered.
```

To deactivate, simply `pip uninstall openconstructionerp-batimatech-ca`
and restart.

## License

AGPL-3.0-or-later, same as the OCERP core. The batimatech name and brand
colours are trademarks of batimatech and used under partnership agreement.
