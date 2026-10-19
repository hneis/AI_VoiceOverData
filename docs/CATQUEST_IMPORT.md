# CatQuest Import

## Current Snapshot

The current import was audited on 2026-10-19.

| Field | Value |
| --- | --- |
| CatQuest Voices | 0.7.1 |
| CurseForge project | 1715207 |
| CurseForge file | 9233762 |
| ZIP SHA-256 | `c50420a3dc748df10773da6fb1bf136aef056c5e2bdb6093008b19da1c2963a1` |
| Coverage CSV SHA-256 | `d04f5a17b19f8ff494899c7601efdff58a0f2d2954ebf17efd9ff442d92ef0a3` |
| Audio manifest SHA-256 | `c88918c0c75206e867999550a95dd4639720c554a50decaaab6c76b47195970c` |
| Generated data SHA-256 | `324dcca886b7014f1e97b1e6d565bac5ab96d1a1be64b89838d7dbe4dcade73d` |
| Generated checksums SHA-256 | `c9ae91c87f2bf2957a179f581eaff54db482015c2761d18e3b9b439c76f0a46a` |
| Upstream OGG files | 11 835 |
| Selected OGG files | 3 704 |
| Selected quest IDs | 1 991 |
| Selected sections | 3 035 |
| Selected size | 409.7 MiB |

All upstream OGG files were checked as complete Vorbis streams and matched the audited size, duration and SHA-256 manifest. Only the selected files are stored in this addon.

The 0.7.1 audit used OctoQuestDatabase revision `da341873737e0b11079ccadb90a40e82514d6367` and `classicdb_ruRU` revision `93f8aabbde2a7328a1f27f86539393471ed32b6c`. The former RU OctoMeow source was no longer available, so 140 sections identified as Octo overrides and 2 892 sections absent from the previous audit were conservatively excluded. They continue through RU/EN fallback instead of being approved against incomplete evidence.

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
  --file-id 9233762 \
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
