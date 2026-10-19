# Sources And Attribution

This repository is an aggregate of material with different source licenses. The repository's original Lua/JavaScript/documentation and the adapted RU portion are distributed under GPL-3.0-or-later. Individual audio sets retain the terms listed below; no single license relicenses third-party game content or CatQuest recordings.

## Original English VoiceOver

The English lookup data and retained fallback recordings originate from:

- VoiceOver / VoiceOver Sounds - Vanilla by MrThinger;
- https://github.com/mrthinger/wow-voiceover;
- CurseForge project `844277`, file `4486502`, `AI_VoiceOverData_Vanilla-v1.0.0.zip`.

The source repository is published under The Unlicense.

## Existing Russian VoiceOver

The Russian base recordings originate from the RU VoiceOver project:

- https://github.com/the-homeless-god/wow-voiceover;
- release `v1.2.0`, asset `AI_VoiceOverData_Vanilla-RU.zip`.

That repository is published under GPL-3.0. The local OGG layout is an adaptation for this English-client hybrid and is marked as modified by this repository.

## CatQuest

Selected recordings come from **CatQuest Voices** by Cathey (daniilcathey):

- https://www.curseforge.com/wow/addons/catquest-voices
- https://t.me/catheyco

Imported source for version 1.1.2:

- CatQuest Voices: `0.7.1`
- CurseForge file ID: `9233762`
- archive SHA-256: `c50420a3dc748df10773da6fb1bf136aef056c5e2bdb6093008b19da1c2963a1`

The upstream project describes the 0.7.1 speech as synthesized with ElevenLabs Eleven v4 and distributed under CC BY-NC-SA 4.0. The selected CatQuest recordings and their directly derived inventory remain a separately attributed, noncommercial component under those terms; see [`LICENSE-CATQUEST-AUDIO.md`](LICENSE-CATQUEST-AUDIO.md). This repository redistributes a modified subset selected for Octo compatibility and does not imply endorsement by CatQuest, ElevenLabs or Blizzard Entertainment. CatQuest material will be removed promptly if requested by its rights holder. World of Warcraft text, names and other game content remain the property of Blizzard Entertainment.

## Coverage Data

Compatibility research used:

- `FrancisEgan/OctoQuestDatabase`;
- RU OctoMeow by NeyMey;
- `WoWruRU/classicdb_ruRU`;
- the original English `AI_VoiceOverData_Vanilla` data;
- the existing Russian VoiceOver data supplied for this project.

No external source database, model checkpoint or downloaded archive is included in this repository.
