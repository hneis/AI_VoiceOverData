# CatQuest Import

## Current Snapshot

The initial import was audited on 2026-10-09.

| Field | Value |
| --- | --- |
| CatQuest Voices | 0.5.0 |
| CurseForge project | 1715207 |
| CurseForge file | 9108577 |
| ZIP SHA-256 | `2f91d17ad1a2482bf885672b91459495540f0c5a26b3b032eae004114895de5a` |
| Coverage CSV SHA-256 | `671ff29f1025e78057634be1824e5780ef5603f887844b91fe9ba4b60de441b3` |
| Audio manifest SHA-256 | `ed0693e47f64cc9d76f794ed262f24ea37950fe01ed962ae236bc7ede917a061` |
| Generated data SHA-256 | `2bbdb17d6ccfe8539d4dac75f7e0ad2edc3c9ce093800015ff948fec1003f72e` |
| Generated checksums SHA-256 | `0c4104a8a0276c6677776206ac47c433a36a96bf4706fd4ab6918a566eff8010` |
| Upstream OGG files | 7 715 |
| Selected OGG files | 3 806 |
| Selected quest IDs | 2 040 |
| Selected sections | 3 140 |
| Selected size | 397.3 MiB |

All upstream OGG files were checked as complete Vorbis streams and matched the audited size, duration and SHA-256 manifest. Only the selected files are stored in this addon.

## Selection Policy

A section is imported only when all conditions hold:

1. The quest ID exists in the Octo database.
2. The CatQuest transcript is available.
3. A Russian comparison text is available.
4. Word-set Jaccard similarity is at least `0.85`.
5. Both player genders pass when one recording serves gender-dependent text.
6. No unresolved class/race template remains.
7. Every referenced audio file matches the audited manifest.

`close`, `different`, `missing` and `conditional` sections are excluded.

## Rebuild

The importer consumes the full coverage CSV, an audited audio manifest and an extracted official `Sounds/q` directory:

```bash
node tools/build_catquest_overlay.js \
  /path/to/catquest-sections.csv \
  /path/to/forever-audio-manifest.json \
  /path/to/CatQuest_Voices/Sounds/q
```

It verifies every selected file, removes stale CatQuest OGG files, copies only the whitelist, and writes `generated/catquest_audio.lua`.

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

Run the public CurseForge metadata check manually:

```bash
node tools/check_catquest_update.js
```

It detects both a newer semantic version and a different CurseForge file ID for the same version. Import and publication remain gated by the full audit, preventing a new upstream schema or changed translation from silently replacing working audio.

GitHub Actions are intentionally not included in version 1.0.0 because the publishing OAuth token did not have the `workflow` scope. The scripts are CI-ready and can be wired into Actions later without changing the runtime addon.
