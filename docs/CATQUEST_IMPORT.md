# CatQuest Import

## Current Snapshot

The current import was audited on 2026-10-15.

| Field | Value |
| --- | --- |
| CatQuest Voices | 0.7.0 |
| CurseForge project | 1715207 |
| CurseForge file | 9152956 |
| ZIP SHA-256 | `4f52c422fb5a0a90050c1ec9e70f2e0a3267fdf87c065b6053fde8ad33d69680` |
| Coverage CSV SHA-256 | `dbac247671ed6b13e6bb43d31ebaf6f0af3e97267a273fb85d5a3026539516e8` |
| Audio manifest SHA-256 | `db83a3d00c029bcce0b8237d31b49cae7cd38bd15614a6ba2e861e0b4fd03b51` |
| Generated data SHA-256 | `838ac9504bed12b0d63399e09543d3557d4f402483191a80fabd0e8f8c0773fd` |
| Generated checksums SHA-256 | `c44e00c277dda620aeefa7a69e172b83867c3fcd67ae6c7895a9b3f2144a6ddf` |
| Upstream OGG files | 11 974 |
| Selected OGG files | 3 707 |
| Selected quest IDs | 1 992 |
| Selected sections | 3 036 |
| Selected size | 408.8 MiB |

All upstream OGG files were checked as complete Vorbis streams and matched the audited size, duration and SHA-256 manifest. Only the selected files are stored in this addon.

The 0.7.0 audit used OctoQuestDatabase revision `da341873737e0b11079ccadb90a40e82514d6367` and `classicdb_ruRU` revision `93f8aabbde2a7328a1f27f86539393471ed32b6c`. The former RU OctoMeow source was no longer available, so 140 sections identified as Octo overrides and 2 892 sections absent from the previous audit were conservatively excluded. They continue through RU/EN fallback instead of being approved against incomplete evidence.

## Selection Policy

A section is imported only when all conditions hold:

1. The quest ID exists in the Octo database.
2. The CatQuest transcript is available.
3. A Russian comparison text is available.
4. Word-set Jaccard similarity is at least `0.85`.
5. Both player genders pass when one recording serves gender-dependent text.
6. No unresolved class/race template remains.
7. Every referenced audio file matches the audited manifest.
8. A section known to use an Octo-specific override is excluded when the matching RU Octo source is unavailable.
9. Without that RU Octo source, a section must also exist in the previous full coverage audit.

`close`, `different`, `missing`, `conditional`, `requiresOctoOverride` and `notPreviouslyAudited` sections are excluded.

## Rebuild

Install the pinned local tooling once:

```bash
npm ci
```

The end-to-end local command downloads or resumes the official archive, validates its paths and CRC, parses `Index.lua` as data, checks every referenced OGG, regenerates the coverage audit, and optionally installs the selected overlay:

```bash
npm run catquest:prepare -- \
  --file-id 9152956 \
  --work-dir /path/outside/the/repository/catquest-work \
  --octo-revision da341873737e0b11079ccadb90a40e82514d6367 \
  --classic-revision 93f8aabbde2a7328a1f27f86539393471ed32b6c \
  --previous-coverage /path/to/0.5.0/catquest-sections.csv \
  --reference-manifest /path/to/forever-audio-manifest.json \
  --install
```

The command above reproduces the current conservative audit. Use `--octo-ru /path/to/TurtleRuQuests_DB.lua` instead of `--previous-coverage` for a complete audit when that exact source is available. Conservative mode excludes every section previously known to use an Octo override and every section absent from the previous audit. It never treats a standard-Vanilla comparison as evidence for a new or overridden Octo section. The work directory and generated audit artifacts remain outside Git and can be deleted after release verification.

Pass the revisions recorded in `sources.lock.json` to reproduce an existing audit. Omit them only when intentionally refreshing the external databases for a new candidate; record the resulting revisions before publication.

The lower-level importer consumes the generated coverage CSV, locally audited audio manifest, and extracted official `Sounds/q` directory:

```bash
node tools/build_catquest_overlay.js \
  /path/to/catquest-sections.csv \
  /path/to/forever-audio-manifest.json \
  /path/to/CatQuest_Voices/Sounds/q
```

It verifies every selected file, removes stale CatQuest OGG files, copies only the whitelist, and writes `generated/catquest_audio.lua`.

After installing the overlay, regenerate the quest-log title routes from the same pinned Octo revision:

```bash
node tools/build_octowow_quest_text_lookup.js \
  /path/to/OctoQuestDatabase/source/locales.json \
  generated/quest_id_lookups.lua \
  generated/catquest_audio.lua \
  generated/octo_quest_text_lookups.lua \
  generated/catquest_quest_id_lookups.lua \
  <octo-revision>
```

`catquest:prepare --install` runs this step automatically. Unique titles receive direct IDs. Ambiguous titles are resolved from quest text, and indistinguishable records remain disabled instead of selecting another quest.

## Upstream Update Procedure

1. Detect a new CatQuest Voices file on CurseForge.
2. Download it outside the repository and record file ID, version and SHA-256.
3. Reject unsafe ZIP paths and unexpected schema changes.
4. Parse `Index.lua` as data; never execute it.
5. Measure and hash every referenced OGG.
6. Refresh Octo and Russian text sources.
7. Regenerate the coverage report.
8. Build the new whitelist and copy selected audio.
9. Run all validation from `AGENTS.md`.
10. Review and update the CatQuest hashes and counts in `sources.lock.json`.
11. Update TOC source metadata, README statistics and `NOTICE.md`.
12. Publish only after the generated module passes OctoWoW playback tests.

If an update fails, keep the last working files in `main`. The game must never receive a partially imported upstream pack.

## Update Detection

Run the public CurseForge metadata check manually at any time:

```bash
node tools/check_catquest_update.js
```

It validates the pinned lock/TOC metadata, examines all valid release files, and detects both a newer semantic version and a different CurseForge file ID for the same version. Import and publication remain gated by the full audit, preventing a new upstream schema or changed translation from silently replacing working audio.

`.github/workflows/check-catquest.yml` runs this metadata-only check every 12 hours. It uses sparse checkout and opens one draft PR per new CurseForge file ID; it never downloads or publishes audio. The heavy audit is run locally and pushed to that branch. `.github/workflows/validate.yml` then validates the completed package changes before manual merge.
