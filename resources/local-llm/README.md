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
$env:AI_DESKTOP_PET_LOCAL_LLM_SOURCE_ROOT = "<local-llm-pack-root>"
npm.cmd run validate:local-llm
```

The validator prints only safe summaries: status, resource source, root basename,
runtime/model basenames, and hash or size check state.

## Offline Pack to Install Layout

P2-20I adds an install-like layout check before a real installer is introduced.
Prepare or receive a local-only `local-llm` pack with the layout above, then
validate and stage it into the repo-local install layout:

```powershell
$env:AI_DESKTOP_PET_LOCAL_LLM_SOURCE_ROOT = "<local-llm-pack-root>"
npm.cmd run stage:offline-local-llm
```

The staging command resolves source roots in this order:

```text
AI_DESKTOP_PET_LOCAL_LLM_SOURCE_ROOT
AI_DESKTOP_PET_BUNDLED_LLAMA_CPP_ROOT
resources/local-llm
```

It validates the source pack first, then copies it to:

```text
.tmp/p2-20i-install-layout/resources/local-llm
```

To verify the staged layout with the embedded runtime resolver and a real short
chat, run:

```powershell
npm.cmd run build
npm.cmd run accept:offline-local-llm-install-layout
```

The acceptance script uses an empty resolver env, an unrelated cwd, and
`.tmp/p2-20i-install-layout/resources` as the packaged `resourcesPath`. It
requires `resourceSource=packaged`. On success it removes the P2-20I staging
directory unless explicitly kept:

```powershell
$env:P2_20I_KEEP_TMP = "1"
npm.cmd run accept:offline-local-llm-install-layout
```

Do not commit generated `manifest.json`, runtime binaries, DLLs, GGUF models,
archives, installers, or `.tmp` staging output.
