# Cost base translation and publication pipeline

Produces the localized CWICR parquet editions published at
`OpenConstructionEstimate-DDC-CWICR`. This code used to live beside the data it reads, inside
a directory excluded wholesale by `.gitignore`. The exclusion was written to keep tens of
gigabytes of parquet out of the repository and it swept up the source as well, so the code
that builds a public artifact was untracked, unreviewable and ungated. Code lives here; data
stays out of the repository.

## Data location

Nothing here infers where the cost bases are from its own path on disk. Set the directory
holding the canonical `*_workitems_costs_resources_DDC_CWICR.parquet` files:

```bash
export OE_COSTBASE_DIR=/path/to/bases      # or pass --base-dir to any entry point
```

An unset value is refused rather than guessed. The previous behaviour derived it from
`__file__`, which produced a real-looking path with no parquet in it and reported an empty
run instead of an error.

## Entry points

| script | what it does |
|---|---|
| `extract_translation_corpus.py` | harvests translatable text from the bases into a corpus |
| `build_translation_batches.py`, `prepare_openai_batch_requests.py`, `submit_openai_batch.py`, `fetch_openai_batch.py`, `parse_openai_batch_results.py` | batch translation round trip |
| `run_openrouter_jsonl.py`, `run_openrouter_shards.py`, `openrouter_resume.py` | the alternative translation route |
| `qa_translation_table.py`, `quarantine_qa_failures.py`, `normalize_translation_statuses.py` | QA over the translation table |
| `materialize_localized_outputs.py` | writes one localized edition per economy, with a QA sidecar |
| `extract_controlled_vocabulary.py` | recovers the canonical to native label mapping from the published editions |
| `publish_editions.py` | builds a published language edition: base + free text + controlled vocabulary |
| `unit_localization.py`, `ppp_fx_pipeline.py` | unit conversion and purchasing-power multipliers |

`publish_editions.py` and `extract_controlled_vocabulary.py` were reconstructed from the
published artifacts on 2026-08-01; there was no script for the publication step anywhere in
the repository before that. Their module docstrings record which rules are measurements and
which parts could not be recovered.

## Tests

```bash
cd tools/costbase_pipeline && pytest tests -q
```

They run in the `CI (PostgreSQL)` workflow, which is merge-blocking. They need no database;
they are attached to that lane because it is the only blocking lane that runs pytest.

## What publication will not do

`assert_publishable` in `publish_editions.py` refuses a frame whose schema or row count moved,
whose numbers changed, or whose native edition came back less native than the base it was
built from. That last check is the one that would have caught the Turkish edition shipping
English content: its schema was correct, its row count was correct, and its numbers
reconciled. Writing into a git working tree is refused unless explicitly allowed, because
publishing cost data is a human decision.
