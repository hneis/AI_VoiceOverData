# Future AI Generation For Missing Octo Voiceovers

This is a future phase. The current package imports compatible official CatQuest audio only.

## Scope Rule

Generate only missing runtime keys:

```text
Octo quest and Russian text exist
AND no compatible CatQuest recording exists
AND no current RU recording exists
AND the English client can resolve the quest ID
AND the speaker policy is known
```

Never regenerate or replace existing CatQuest or RU audio automatically.

Future routing must remain:

```text
compatible CatQuest
→ current RU
→ locally generated missing Octo audio
→ EN fallback
```

## What Was Found In CatQuest

The public CatQuest package documents a private production pipeline but does not include its tools, model checkpoint, voice references, stress dictionary or docs. Mentioned tools include:

- `questcache.py` and `/cq mine` for quest text extraction;
- `import_reports.py` for player reports;
- `build_npcdata.py` for NPC race/sex data;
- `build_voice_references.py` for voice references;
- `build_pack.py` for detail/complete/book generation;
- `stress_snapshot.py` and `stress_dict.txt` for pronunciation;
- `qa_all.py` and ASR comparison for quality control.

The author has no public CatQuest Git repository as of the audit date.

## Open Replacement Stack

| Component | Candidate | License |
| --- | --- | --- |
| TTS code | `SWivid/F5-TTS` | MIT |
| Russian checkpoint | `Misha24-10/F5-TTS_RUSSIAN` | CC BY-NC 4.0 |
| Stress placement | RUAccent | Apache 2.0 |
| Text preparation and QA | `ilyautov/rusvoice` | Apache 2.0 |

The exact CatQuest checkpoint is unknown. Matching CatQuest quality is not guaranteed without the author's references and pronunciation data.

## Russian Text Availability

Combining `classicdb_ruRU` and RU OctoMeow provides a Russian record for 6 625 of 6 704 Octo IDs.

Available stage texts:

| Stage | Texts |
| --- | ---: |
| Accept description | 6 075 |
| Progress/request | 5 477 |
| Complete/reward | 6 506 |

Missing translation must be produced only for a selected runtime candidate, not for the entire database in advance.

## First Practical Missing Batch

After current CatQuest and RU coverage:

| Stage | Missing with Russian text | Resolvable by current EN lookup | Needs new lookup |
| --- | ---: | ---: | ---: |
| Accept | 2 993 | 435 | 2 558 |
| Complete | 3 029 | 328 | 2 701 |

The first immediately usable batch is at most 763 sections, about 4.0 hours of final audio.

Speaker readiness for those 763 sections:

| Speaker status | Accept | Complete | Total |
| --- | ---: | ---: | ---: |
| Known CatQuest race/sex profile | 231 | 254 | 485 |
| NPC profile must be collected in game | 54 | 31 | 85 |
| Item/object or other non-NPC source | 150 | 43 | 193 |

Unknown NPCs require a Vanilla-compatible collector. Item/object quests need an explicit narrator policy. Do not silently guess a character voice.

## Voice References

Preferred order:

1. Ask Cathey for the original tools, checkpoint, stress dictionary and reference clips.
2. If unavailable, derive a 10-15 second clean reference from existing CatQuest audio grouped by voice ID and use the exact cue transcript from `Index.lua`.
3. For better fidelity, extract suitable Russian NPC lines from the client audio and record the exact transcript.

## Machine Translation

For the small set without Russian text:

- use a Warcraft glossary;
- preserve `$N`, `$C`, `$R`, `$B`, `$g...;` and other WoW markup;
- verify that input and output contain identical control tokens;
- store the English source with the machine translation;
- mark machine-translated records;
- require review before synthesis and publication.

## Synthesis And QA

1. Expand player-gender variants only when required.
2. Normalize names, numbers and abbreviations.
3. Apply RUAccent plus project pronunciation overrides.
4. Generate 24 kHz mono audio using the selected F5-TTS checkpoint.
5. Normalize loudness and encode the runtime OGG profile.
6. Run ASR and compare recognized words with the target text.
7. Check silence, clipping, duration, stream completion and file hash.
8. Retry failed records; never publish partial output as successful.
9. Store source text, voice profile, model version, reference hash and generation settings in a manifest.

## Compute Estimate

The first 763-section batch is estimated at about 4.0 hours of final audio. An RTX 4060 should be sufficient for a pilot and this first batch, likely within one evening plus QA retries.

The full currently missing accept/complete upper bound is about 45.1 hours of final audio, but it must not be generated until the English lookup and speaker metadata exist.

RunPod prices observed on 2026-10-09 included RTX 4090 Community at about `$0.34/hour` and Secure Cloud at about `$0.74/hour`. Cloud generation is optional; validate the pipeline locally first.

## Release Boundary

AI-generated Octo recordings must remain distinguishable from official CatQuest and the existing RU pack in metadata and documentation. Adding this future source requires a new audited addon version and updated attribution.
