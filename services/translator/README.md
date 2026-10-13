# Optional local translation

MyCrobo can use a locally installed `google/translategemma-4b-it` checkpoint through
an offline Python worker. The application never downloads weights. Before enabling
it, the operator must accept Google's Gemma license, obtain the checkpoint separately,
and place it in a local directory.

Each tenant directory may contain `local-translator.json`:

```json
{
  "version": 1,
  "tenantId": "tenant-0000000000000001",
  "provider": "translategemma-4b-it",
  "modelPath": "C:\\Models\\translategemma-4b-it",
  "licenseAccepted": true,
  "pythonExecutable": "python"
}
```

The tenant identifier must match the active tenant. The model path must be an
absolute local directory containing `config.json`. Status does not expose that path.
Inference is deterministic, bounded by TranslateGemma's 2,048-token context, uses
`local_files_only=True`, and communicates with the gateway over inherited stdio.
No input or translation is written to logs.
