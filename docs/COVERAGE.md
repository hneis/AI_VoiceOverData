# Coverage Snapshot

Audit date: 2026-10-09.

OctoQuestDatabase revision: `50ec75b24cc6c5ede825fec78c27e4624da4c8a6`.

## Source Coverage

| Source | IDs with any stage | IDs with accept + complete |
| --- | ---: | ---: |
| Current EN | 3 640 | 2 690 |
| Current RU | 3 582 | 2 409 |
| CatQuest 0.5.0 | 2 309 | 2 235 |
| EN + CatQuest | 3 861 | 3 178 |

OctoQuestDatabase contains 6 704 effective quest IDs. CatQuest shares 221 IDs absent from the current EN audio set and covers no Octo IDs at or above 10 000.

## Text Comparison

From 4 544 CatQuest sections associated with Octo IDs:

| Status | Sections |
| --- | ---: |
| Russian baseline match | 3 140 |
| Close, manual review required | 196 |
| Different | 710 |
| Conditional class/race template | 444 |
| Missing comparison text or transcript | 54 |

Only the 3 140 matching sections are included.

## Base Hybrid Coverage

After English-audio pruning, the base hybrid still resolves all original Vanilla manifest keys:

| Route | Lookup keys |
| --- | ---: |
| Existing RU | 8 898 |
| EN fallback | 657 |
| Unavailable | 0 |

CatQuest is evaluated before these routes.

Final CatQuest/RU/EN routing:

| Route | Lookup keys |
| --- | ---: |
| CatQuest | 3 826 |
| Existing RU | 6 787 |
| EN fallback | 632 |
| Neutral aliases | 22 |
| Unavailable | 0 |

## Limitations

- OctoQuestDatabase explicitly states that it is not a complete server dump.
- RU OctoMeow and the Octo database may be updated independently.
- Russian baseline matching is not proof of the current live server text.
- Real playback must be checked after a full client restart.
