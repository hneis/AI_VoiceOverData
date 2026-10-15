# AI VoiceOver Data Maintenance

These instructions apply only to this addon repository.

## Runtime Contract

- Target OctoWoW / Vanilla WoW 1.12 and Lua 5.0.
- The client UI is English. Preserve all English quest, NPC and gossip lookup tables.
- Audio priority is compatible CatQuest, existing RU, then EN fallback.
- CatQuest may override an existing RU recording only when its Russian transcript passed the compatibility audit.
- Future locally generated Octo audio may fill missing keys only. It must never replace CatQuest or the existing RU pack automatically.
- Preserve player-gender variants. Never substitute the opposite gender or another quest stage.

## Repository Layout

- Keep `AI_VoiceOverData.toc` at the repository root for GitAddonsManager. Keep `AI_VoiceOverData_Vanilla.toc` synchronized for legacy manual installations.
- Keep one addon in this repository.
- Do not use Git LFS; the Qt GitAddonsManager uses libgit2 without LFS support.
- Commit runtime audio as ordinary Git blobs.
- Monitor packed repository size after every audio update. Do not rewrite published history without a migration plan for GitAddonsManager users.
- Do not commit CurseForge archives, model weights, caches, temporary databases, logs or audit artifacts.
- Do not commit `audio_check.txt`; it is a local validation report.

## CatQuest Import

- Never execute upstream `Index.lua`; parse it as data.
- Validate archive paths, every selected OGG, duration, size and SHA-256.
- Include only Octo quest IDs with text status `same` at Jaccard `>= 0.85`.
- Exclude `close`, `different`, `missing` and unresolved class/race templates.
- Record the upstream CatQuest version, file ID and archive SHA-256.
- Copy only files selected by the generated whitelist.
- Regenerate CatQuest quest-log title routes from the same pinned Octo revision after every overlay rebuild.
- Every packaged CatQuest accept ID must be marked reachable or safely blocked; never guess between indistinguishable quests.
- A changed upstream schema must fail the import instead of publishing partial data.
- Vanilla cannot detect an individual failed OGG at runtime. Package validation and GitAddonsManager Repair/Reclone are the recovery path for local corruption.

## English Fallback

- The repository intentionally stores only EN files selected after RU fallback resolution.
- Preserve the 657-file base fallback independently of CatQuest so a future CatQuest removal can return to RU → EN without restoring upstream media.
- Before pruning, require zero unavailable routes.
- Keep complete EN manifests and lookup tables even when their audio file is omitted.
- Rebuild `generated/installed_audio.lua` after any base audio change.

## Future AI Generation

- Follow `docs/FUTURE_AI_GENERATION.md`.
- Generate only the exact difference after CatQuest and current RU coverage.
- Require an English-client-resolvable quest ID before generating runtime audio.
- Preserve WoW tokens such as `$N`, `$C`, `$R`, `$B` and `$g...;` during translation.
- Unknown NPC voices require collected race/sex/model data or an explicit narrator policy.

## Validation

Run after every relevant change:

```bash
npm ci
npm test
luac -p Module.lua Hybrid.lua generated/*.lua
python CheckAudio.py
node --check tools/audit_catquest_coverage.js
node --check tools/build_catquest_overlay.js
node --check tools/build_octowow_quest_text_lookup.js
node --check tools/check_catquest_update.js
node --check tools/prepare_catquest_update.js
node --check tools/prune_english_fallback.js
node --check tools/validate_package.js
node tools/validate_package.js
lua tests/quest_resolver.lua
```

`.github/workflows/check-catquest.yml` performs lightweight scheduled update detection and opens a draft audit PR. `.github/workflows/validate.yml` validates publishable PR changes. Continue to run the same validation locally before every push.

Also confirm:

- every path in the TOC exists with matching case;
- CatQuest/RU/EN routing has no unavailable keys;
- generated CatQuest entry count matches the copied OGG count;
- the version matches the TOC, source metadata and README;
- a full game restart and representative playback succeed in OctoWoW.
