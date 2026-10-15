#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { dataTable, oggMetadata } = require("../tools/lib/catquest");
const { compareTexts, jaccard } = require("../tools/audit_catquest_coverage");
const { safeArchiveEntries } = require("../tools/prepare_catquest_update");
const { compareVersions, fileVersion, isNewer, latestFile } = require("../tools/check_catquest_update");
const {
    buildLookupData,
    normalizeTitle,
    renderCatQuestLookup,
    renderTextLookup,
} = require("../tools/build_octowow_quest_text_lookup");

assert.strictEqual(compareVersions("0.7.0", "0.6.1") > 0, true);
assert.strictEqual(compareVersions("0.7.0", "0.7.0"), 0);
assert.strictEqual(isNewer("0.7.0", "0.5.0"), true);
assert.strictEqual(isNewer("0.5.0", "0.7.0"), false);
assert.strictEqual(fileVersion({ name: "CatQuest_Voices-0.7.0.zip" }), "0.7.0");
assert.strictEqual(latestFile([
    { id: 2, name: "CatQuest_Voices-0.6.1.zip", filesize: 1 },
    { id: 1, name: "CatQuest_Voices-0.7.0.zip", filesize: 1 },
]).version, "0.7.0");

const archive = [
    "CatQuest_Voices/CatQuest_Voices.toc",
    "CatQuest_Voices/Index.lua",
    "CatQuest_Voices/index.json",
    "CatQuest_Voices/Sounds/q/2.ogg",
].join("\n");
assert.deepStrictEqual(safeArchiveEntries(archive), { entries: 4, oggFiles: 1, expandedBytes: null });
assert.throws(() => safeArchiveEntries(`${archive}\n../escape.ogg`), /Unsafe ZIP path/);
assert.throws(() => safeArchiveEntries(`${archive}\nCatQuest_Voices\/README.exe`), /Unexpected ZIP entry/);
assert.throws(() => safeArchiveEntries(`${archive}\nCatQuest_Voices\/Sounds\/q\/2.ogg`), /Duplicate ZIP path/);

assert.strictEqual(jaccard("Привет, герой!", "привет герой"), 1);
assert.strictEqual(jaccard("один два", "три четыре"), 0);

const conservativeRecord = {
    id: 2,
    stage: "accept",
    variants: ["x"],
    entry: { c: { x: { 0: { 2: "Совместимый текст" } } } },
};
const conservative = compareTexts([conservativeRecord], new Set([2]),
    { 2: { D: "Совместимый текст" } }, null, { sections: new Set(), overrides: new Set() });
assert.strictEqual(conservative.statuses.get("2:accept").status, "notPreviouslyAudited");
const prior = compareTexts([conservativeRecord], new Set([2]),
    { 2: { D: "Совместимый текст" } }, null, { sections: new Set(["2:accept"]), overrides: new Set() });
assert.strictEqual(prior.statuses.get("2:accept").status, "same");

const packagedOgg = path.resolve(__dirname, "..", "generated", "sounds", "catquest", "quests", "2.ogg");
if (fs.existsSync(packagedOgg)) {
    const valid = fs.readFileSync(packagedOgg);
    assert(oggMetadata(valid).duration > 0);
    const corrupt = Buffer.from(valid);
    corrupt[corrupt.length - 1] ^= 1;
    assert.throws(() => oggMetadata(corrupt), /Invalid OGG page CRC/);
}

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "catquest-tools-"));
try {
    const lua = path.join(temporary, "Index.lua");
    fs.writeFileSync(lua, "CatQuestVoicePack = CatQuestVoicePack or {}\n"
        + "CatQuestVoicePack.quests = { [2] = { d = 1.5, v = \"voice\", c = { x = { [0] = { 0, \"Текст\" } } } } }\n");
    const parsed = dataTable(lua, "CatQuestVoicePack.quests");
    assert.strictEqual(parsed[2].d, 1.5);
    assert.strictEqual(parsed[2].c.x[0][2], "Текст");
    fs.writeFileSync(lua, "CatQuestVoicePack.quests = { [2] = os.execute(\"bad\") }\n");
    assert.throws(() => dataTable(lua, "CatQuestVoicePack.quests"), /Unsupported Lua data expression/);

    const locales = path.join(temporary, "locales.json");
    const base = path.join(temporary, "quest_id_lookups.lua");
    const catquest = path.join(temporary, "catquest_audio.lua");
    fs.writeFileSync(locales, JSON.stringify({ quests: {
        1: { T: "Existing", D: "existing description" },
        2: { T: "Wanted:  \"Quoted\"", D: "quoted description" },
        3: { T: "Shared", D: "first shared description" },
        4: { T: "Shared", D: "second shared description" },
    } }));
    fs.writeFileSync(base, "AI_VoiceOverData_Vanilla.QuestIDLookup = { accept = { Existing = 1, Shared = 4 } }\n");
    fs.writeFileSync(catquest, "AI_VoiceOverData_Vanilla.CatQuestData = { Entries = { [\"2-accept\"] = { 1, \"2.ogg\" }, [\"3-accept\"] = { 1, \"3.ogg\" } } }\n");
    const generated = buildLookupData(locales, base, catquest, "fixture");
    assert.strictEqual(normalizeTitle("Wanted:  \"Quoted\""), "Wanted:  'Quoted'");
    assert.strictEqual(generated.overrides.get("Wanted:  'Quoted'"), 2);
    assert.deepStrictEqual(generated.overrides.get("Shared"), {});
    assert(generated.reachableIDs.has(2));
    assert(generated.reachableIDs.has(3));
    const regenerated = buildLookupData(locales, base, catquest, "fixture");
    assert.strictEqual(renderCatQuestLookup(generated), renderCatQuestLookup(regenerated));
    assert.strictEqual(renderTextLookup(generated), renderTextLookup(regenerated));
} finally {
    fs.rmSync(temporary, { recursive: true, force: true });
}

console.log("CatQuest tooling tests passed");
