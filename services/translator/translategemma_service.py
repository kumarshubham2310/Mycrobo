#!/usr/bin/env python3
"""Tenant-bound, offline TranslateGemma JSON-lines worker.

The worker deliberately has no HTTP server. A local gateway starts it with inherited
stdio, so private text is never sent to a network inference endpoint.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import sys
from typing import Any


CONTRACT_VERSION = "mycrobo-local-translation.1"
MODEL_ID = "google/translategemma-4b-it"
CONTEXT_TOKENS = 2048
MAX_NEW_TOKENS = 512
MAX_TEXT_CODE_POINTS = 1536
MAX_TEXT_BYTES = 12288
TENANT_ID = re.compile(r"^tenant-[a-f0-9]{16}$")
LANGUAGE_CODE = re.compile(r"^[a-z]{2}(?:-[A-Z]{2})?$")


class RequestError(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def emit(payload: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def validate_local_configuration(model_path: str, tenant_id: str, license_accepted: bool) -> Path:
    if not TENANT_ID.fullmatch(tenant_id):
        raise RequestError("TENANT_INVALID")
    if not license_accepted:
        raise RequestError("LICENSE_NOT_ACCEPTED")
    path = Path(model_path).expanduser()
    if not path.is_absolute() or not path.is_dir():
        raise RequestError("MODEL_PATH_INVALID")
    path = path.resolve(strict=True)
    if not (path / "config.json").is_file():
        raise RequestError("MODEL_FILES_INCOMPLETE")
    return path


def normalize_request(raw: Any, expected_tenant_id: str) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise RequestError("REQUEST_INVALID")
    request_id = raw.get("id")
    if not isinstance(request_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{8,80}", request_id):
        raise RequestError("REQUEST_ID_INVALID")
    if raw.get("contract_version") != CONTRACT_VERSION:
        raise RequestError("CONTRACT_UNSUPPORTED")
    if raw.get("tenant_id") != expected_tenant_id:
        raise RequestError("TENANT_MISMATCH")
    text = raw.get("text")
    if not isinstance(text, str) or not text.strip():
        raise RequestError("TEXT_REQUIRED")
    if len(text) > MAX_TEXT_CODE_POINTS or len(text.encode("utf-8")) > MAX_TEXT_BYTES or "\x00" in text:
        raise RequestError("TEXT_TOO_LARGE")
    source = raw.get("source_lang_code")
    target = raw.get("target_lang_code")
    if not isinstance(source, str) or not LANGUAGE_CODE.fullmatch(source):
        raise RequestError("SOURCE_LANGUAGE_INVALID")
    if not isinstance(target, str) or not LANGUAGE_CODE.fullmatch(target):
        raise RequestError("TARGET_LANGUAGE_INVALID")
    if source == target:
        raise RequestError("LANGUAGE_SAME")
    max_new_tokens = raw.get("max_new_tokens", 256)
    if isinstance(max_new_tokens, bool) or not isinstance(max_new_tokens, int) or not 1 <= max_new_tokens <= MAX_NEW_TOKENS:
        raise RequestError("OUTPUT_BOUND_INVALID")
    return {
        "id": request_id,
        "text": text,
        "source_lang_code": source,
        "target_lang_code": target,
        "max_new_tokens": max_new_tokens,
    }


class TranslateGemmaRuntime:
    def __init__(self, model_path: Path) -> None:
        # These switches are defense in depth in addition to local_files_only.
        os.environ["HF_HUB_OFFLINE"] = "1"
        os.environ["TRANSFORMERS_OFFLINE"] = "1"
        os.environ["HF_DATASETS_OFFLINE"] = "1"
        import torch
        from transformers import AutoModelForImageTextToText, AutoProcessor

        self.torch = torch
        self.dtype = torch.bfloat16 if torch.cuda.is_available() else torch.float32
        torch.manual_seed(0)
        if torch.cuda.is_available():
            torch.cuda.manual_seed_all(0)
        torch.use_deterministic_algorithms(True, warn_only=True)
        self.processor = AutoProcessor.from_pretrained(
            str(model_path), local_files_only=True, trust_remote_code=False
        )
        self.model = AutoModelForImageTextToText.from_pretrained(
            str(model_path), local_files_only=True, trust_remote_code=False,
            dtype=self.dtype, device_map="auto"
        )
        self.model.eval()

    def translate(self, request: dict[str, Any]) -> str:
        messages = build_messages(request)
        inputs = self.processor.apply_chat_template(
            messages,
            tokenize=True,
            add_generation_prompt=True,
            return_dict=True,
            return_tensors="pt",
        )
        input_tokens = int(inputs["input_ids"].shape[-1])
        if input_tokens + request["max_new_tokens"] > CONTEXT_TOKENS:
            raise RequestError("TOKEN_BUDGET_EXCEEDED")
        inputs = inputs.to(self.model.device, dtype=self.dtype)
        with self.torch.inference_mode():
            output = self.model.generate(
                **inputs,
                do_sample=False,
                num_beams=1,
                max_new_tokens=request["max_new_tokens"],
                use_cache=True,
            )
        generated = output[0][input_tokens:]
        return self.processor.decode(generated, skip_special_tokens=True).strip()


def build_messages(request: dict[str, Any]) -> list[dict[str, Any]]:
    return [{
        "role": "user",
        "content": [{
            "type": "text",
            "source_lang_code": request["source_lang_code"],
            "target_lang_code": request["target_lang_code"],
            "text": request["text"],
        }],
    }]


def serve(model_path: Path, tenant_id: str) -> int:
    try:
        runtime = TranslateGemmaRuntime(model_path)
    except Exception:
        emit({"type": "fatal", "code": "MODEL_LOAD_FAILED"})
        return 3
    emit({"type": "ready", "contract_version": CONTRACT_VERSION, "model": MODEL_ID})
    for line in sys.stdin:
        if len(line.encode("utf-8")) > MAX_TEXT_BYTES + 4096:
            emit({"type": "result", "id": None, "ok": False, "code": "REQUEST_TOO_LARGE"})
            continue
        try:
            request = normalize_request(json.loads(line), tenant_id)
            translated = runtime.translate(request)
            if not translated:
                raise RequestError("EMPTY_RESULT")
            emit({"type": "result", "id": request["id"], "ok": True, "text": translated})
        except RequestError as error:
            request_id = None
            try:
                candidate = json.loads(line).get("id")
                request_id = candidate if isinstance(candidate, str) else None
            except Exception:
                pass
            emit({"type": "result", "id": request_id, "ok": False, "code": error.code})
        except Exception:
            emit({"type": "result", "id": None, "ok": False, "code": "INFERENCE_FAILED"})
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Offline TranslateGemma worker for MyCrobo")
    parser.add_argument("--model-path", required=True)
    parser.add_argument("--tenant-id", required=True)
    parser.add_argument("--license-accepted", action="store_true")
    parser.add_argument("--check", action="store_true", help="Validate local configuration without loading model weights")
    args = parser.parse_args()
    try:
        path = validate_local_configuration(args.model_path, args.tenant_id, args.license_accepted)
    except RequestError as error:
        emit({"type": "status", "ok": False, "code": error.code})
        return 2
    if args.check:
        emit({"type": "status", "ok": True, "contract_version": CONTRACT_VERSION, "model": MODEL_ID})
        return 0
    return serve(path, args.tenant_id)


if __name__ == "__main__":
    raise SystemExit(main())
