# Coverage Snapshot

Audit date: 2026-10-15.

OctoQuestDatabase revision: `da341873737e0b11079ccadb90a40e82514d6367`.

## Source Coverage

| Source | IDs with any stage | IDs with accept + complete |
| --- | ---: | ---: |
| Current EN | 3 640 | 2 690 |
| Current RU | 3 582 | 2 409 |
| CatQuest 0.7.0 full source | 4 101 | 3 335 |
| Audited CatQuest selection | 1 992 | 1 044 |
| EN + audited CatQuest | 3 816 | 2 989 |

OctoQuestDatabase contains 6 704 effective quest IDs. The full CatQuest source has 7 436 accept/complete sections associated with those IDs; only the text-compatible selection is packaged.

## Text Comparison

From 7 436 CatQuest sections associated with Octo IDs:

| Status | Sections |
| --- | ---: |
| Russian baseline match | 3 036 |
| Close, manual review required | 252 |
| Different | 672 |
| Conditional class/race template | 422 |
| Missing comparison text or transcript | 22 |
| Prior Octo override unavailable | 140 |
| Absent from previous audit | 2 892 |

Only the 3 036 matching sections are included. They reference 3 707 physical OGG files across 1 992 quest IDs and occupy 408.8 MiB.

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
| CatQuest | 3 723 |
| Existing RU | 6 879 |
| EN fallback | 632 |
| Neutral aliases | 18 |
| Unavailable | 0 |

## Limitations

- OctoQuestDatabase explicitly states that it is not a complete server dump.
- RU OctoMeow was unavailable for this refresh. The 140 sections previously identified as Octo overrides were excluded rather than compared to standard Vanilla text.
- CatQuest sections absent from the previous audit were excluded even when their current transcript matched `classicdb_ruRU`.
- Russian baseline matching is not proof of the current live server text.
- Real playback must be checked after a full client restart.

## Repeated English Titles

The current Octo text resolver contains 406 ambiguous titles, 937 unique accept-text routes and 92 indistinguishable compacted texts that are safely blocked when the NPC name is unavailable. Exact NPC matches still take priority.

Version 1.1.1 overlays 417 title routes required by selected CatQuest accepts: 173 unique titles map directly to an ID and 244 ambiguous titles replace legacy NPC mappings and use the current text resolver. Of 1 828 selected CatQuest accept IDs, 1 736 are safely reachable from the Vanilla quest log and 92 remain blocked because neither title nor text distinguishes them reliably.
