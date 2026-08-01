from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from urllib import request

from submit_openai_batch import API_BASE, load_dotenv_key


def api_get(path: str, api_key: str) -> bytes:
    req = request.Request(f"{API_BASE}{path}", method="GET")
    req.add_header("Authorization", f"Bearer {api_key}")
    with request.urlopen(req, timeout=120) as resp:
        return resp.read()


def get_json(path: str, api_key: str) -> dict:
    return json.loads(api_get(path, api_key).decode("utf-8"))


def download_file(file_id: str, api_key: str, out_path: Path) -> Path:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_bytes(api_get(f"/files/{file_id}/content", api_key))
    return out_path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--batch-id", required=True)
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=Path("WORLD_COST_BASES/translation_pipeline/outputs/openai_results"),
    )
    args = parser.parse_args()

    api_key = os.environ.get("OPENAI_API_KEY") or load_dotenv_key()
    if not api_key:
        raise SystemExit("OPENAI_API_KEY is not set.")

    batch = get_json(f"/batches/{args.batch_id}", api_key)
    args.out_dir.mkdir(parents=True, exist_ok=True)
    status_path = args.out_dir / f"{args.batch_id}.status.json"
    status_path.write_text(
        json.dumps(batch, ensure_ascii=False, indent=2, sort_keys=True),
        encoding="utf-8",
    )
    result = {"status": batch["status"], "status_file": str(status_path)}
    if batch.get("output_file_id"):
        result["output_file"] = str(
            download_file(
                batch["output_file_id"],
                api_key,
                args.out_dir / f"{args.batch_id}.output.jsonl",
            )
        )
    if batch.get("error_file_id"):
        result["error_file"] = str(
            download_file(
                batch["error_file_id"],
                api_key,
                args.out_dir / f"{args.batch_id}.errors.jsonl",
            )
        )
    print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
