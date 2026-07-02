# Local LLM Resource Pack

This directory is the tracked scaffold for the packaged embedded llama.cpp runtime.
Real binaries and model files stay local-only and are ignored by Git.

Expected runtime layout:

```text
resources/local-llm/
  manifest.json
  runtime/
    win32-x64/
      llama-server.exe
      *.dll
  models/
    model.gguf
  licenses/
    THIRD_PARTY_NOTICES.md
```

Use `manifest.example.json` as the template for local `manifest.json`.
The manifest must use relative paths inside this directory. Absolute paths and
`..` parent traversal are rejected by the validator and runtime resolver.
Replace `sizeBytes` / `sha256` with real values before packaging, or remove
those optional fields while preparing a local smoke pack.

Before packaging or acceptance, validate the local-only pack:

```powershell
npm.cmd run validate:local-llm
```

To validate a pack outside the repo without printing full paths:

```powershell
$env:AI_DESKTOP_PET_LOCAL_LLM_SOURCE_ROOT = "C:\path\to\local-llm"
npm.cmd run validate:local-llm
```

The validator prints only safe summaries: status, resource source, root basename,
runtime/model basenames, and hash or size check state.
