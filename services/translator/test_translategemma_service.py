import tempfile
from pathlib import Path
import unittest

from services.translator.translategemma_service import (
    CONTRACT_VERSION,
    RequestError,
    build_messages,
    normalize_request,
    validate_local_configuration,
)


TENANT_ID = "tenant-0000000000000001"


class TranslateGemmaServiceTests(unittest.TestCase):
    def test_requires_license_and_complete_absolute_local_model(self):
        with tempfile.TemporaryDirectory() as root:
            model = Path(root) / "model"
            model.mkdir()
            (model / "config.json").write_text("{}", encoding="utf-8")
            self.assertEqual(validate_local_configuration(str(model), TENANT_ID, True), model.resolve())
            with self.assertRaisesRegex(RequestError, "LICENSE_NOT_ACCEPTED"):
                validate_local_configuration(str(model), TENANT_ID, False)

    def test_request_is_tenant_bound_and_structured_for_official_interface(self):
        request = normalize_request({
            "id": "request_0001",
            "contract_version": CONTRACT_VERSION,
            "tenant_id": TENANT_ID,
            "text": "Dobré ráno",
            "source_lang_code": "cs",
            "target_lang_code": "de-DE",
            "max_new_tokens": 128,
        }, TENANT_ID)
        self.assertEqual(build_messages(request), [{
            "role": "user",
            "content": [{
                "type": "text",
                "source_lang_code": "cs",
                "target_lang_code": "de-DE",
                "text": "Dobré ráno",
            }],
        }])
        with self.assertRaisesRegex(RequestError, "TENANT_MISMATCH"):
            normalize_request({
                "id": "request_0002",
                "contract_version": CONTRACT_VERSION,
                "tenant_id": "tenant-0000000000000002",
                "text": "Hello",
                "source_lang_code": "en",
                "target_lang_code": "hi",
            }, TENANT_ID)

    def test_enforces_context_compatible_request_bounds_without_loading_model(self):
        with self.assertRaisesRegex(RequestError, "TEXT_TOO_LARGE"):
            normalize_request({
                "id": "request_0003",
                "contract_version": CONTRACT_VERSION,
                "tenant_id": TENANT_ID,
                "text": "x" * 1537,
                "source_lang_code": "en",
                "target_lang_code": "hi",
            }, TENANT_ID)
        with self.assertRaisesRegex(RequestError, "OUTPUT_BOUND_INVALID"):
            normalize_request({
                "id": "request_0004",
                "contract_version": CONTRACT_VERSION,
                "tenant_id": TENANT_ID,
                "text": "Hello",
                "source_lang_code": "en",
                "target_lang_code": "hi",
                "max_new_tokens": 513,
            }, TENANT_ID)


if __name__ == "__main__":
    unittest.main()
