#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { dataTable } = require("./lib/catquest");

const root = path.resolve(__dirname, "..");
const questKey = /^(?:[mf]-)?\d+-(?:accept|progress|complete)$/;
const oggCRCTable = Array.from({ length: 256 }, (_, value) => {
    let checksum = value << 24;
    for (let bit = 0; bit < 8; bit++) {
        checksum = checksum & 0x80000000 ? (checksum << 1) ^ 0x04c11db7 : checksum << 1;
    }
    return checksum >>> 0;
});

function oggPageCRC(buffer, start, end) {
    let checksum = 0;
    for (let offset = start; offset < end; offset++) {
        const byte = offset >= start + 22 && offset < start + 26 ? 0 : buffer[offset];
        checksum = ((checksum << 8) ^ oggCRCTable[((checksum >>> 24) ^ byte) & 0xff]) >>> 0;
    }
    return checksum;
}

function lengthManifest(file) {
    const source = fs.readFileSync(file, "utf8");
    const result = new Set();
    for (const match of source.matchAll(/\["([a-z0-9-]+)"\]\s*=\s*([0-9]+(?:\.[0-9]+)?)/g)) {
        if (Number(match[2]) > 0) result.add(match[1]);
    }
    return result;
}

function installedInventory(file) {
    const source = fs.readFileSync(file, "utf8");
    const split = source.indexOf('["ru"]');
    if (split < 0) throw new Error("Missing RU installed-audio inventory");
    const parts = { en: source.slice(0, split), ru: source.slice(split) };
    const result = { en: new Map(), ru: new Map() };
    for (const language of ["en", "ru"]) {
        for (const match of parts[language].matchAll(/\["([a-z0-9-]+)"\]\s*=\s*"(mp3|ogg)"/g)) {
            result[language].set(match[1], match[2]);
        }
    }
    return result;
}

function catquestData(file) {
    const source = fs.readFileSync(file, "utf8");
    const schema = Number(/SchemaVersion = (\d+)/.exec(source)?.[1]);
    const version = /SourceVersion = "([^"]+)"/.exec(source)?.[1];
    const coverageSha256 = /CoverageSha256 = "([0-9a-f]{64})"/.exec(source)?.[1];
    const audioManifestSha256 = /AudioManifestSha256 = "([0-9a-f]{64})"/.exec(source)?.[1];
    const counts = {
        quests: Number(/QuestCount = (\d+)/.exec(source)?.[1]),
        sections: Number(/SectionCount = (\d+)/.exec(source)?.[1]),
        files: Number(/EntryCount = (\d+)/.exec(source)?.[1]),
    };
    const entries = new Map();
    const filenames = new Set();
    const questIDs = new Set();
    const sections = new Set();
    for (const match of source.matchAll(/\["([a-z0-9-]+)"\]\s*=\s*\{\s*([0-9]+(?:\.[0-9]+)?),\s*"([a-z0-9_]+\.ogg)"\s*\}/g)) {
        if (entries.has(match[1])) throw new Error(`Duplicate CatQuest key: ${match[1]}`);
        const duration = Number(match[2]);
        if (!(duration > 0)) throw new Error(`Invalid CatQuest duration: ${match[1]}`);
        if (filenames.has(match[3])) throw new Error(`Duplicate CatQuest filename: ${match[3]}`);
        const semantic = /^(?:[mf]-)?(\d+)-(accept|complete)$/.exec(match[1]);
        if (!semantic) throw new Error(`Invalid CatQuest key: ${match[1]}`);
        entries.set(match[1], { duration, file: match[3] });
        filenames.add(match[3]);
        questIDs.add(Number(semantic[1]));
        sections.add(`${semantic[1]}-${semantic[2]}`);
    }
    if (entries.size !== counts.files) throw new Error(`CatQuest entry count mismatch: ${entries.size}/${counts.files}`);
    if (questIDs.size !== counts.quests) throw new Error(`CatQuest quest count mismatch: ${questIDs.size}/${counts.quests}`);
    if (sections.size !== counts.sections) throw new Error(`CatQuest section count mismatch: ${sections.size}/${counts.sections}`);
    return { source, schema, version, coverageSha256, audioManifestSha256, counts, entries };
}

function sha256(buffer) {
    return crypto.createHash("sha256").update(buffer).digest("hex");
}

function oggDuration(buffer) {
    let offset = 0, rate, serial, granule = 0n, ended = false;
    while (offset < buffer.length) {
        if (offset + 27 > buffer.length || buffer.toString("ascii", offset, offset + 4) !== "OggS"
            || buffer[offset + 4] !== 0) throw new Error("Invalid OGG page");
        const count = buffer[offset + 26];
        const packet = offset + 27 + count;
        if (packet > buffer.length) throw new Error("Truncated OGG header");
        let size = 0;
        for (let i = offset + 27; i < packet; i++) size += buffer[i];
        if (packet + size > buffer.length) throw new Error("Truncated OGG data");
        if (oggPageCRC(buffer, offset, packet + size) !== buffer.readUInt32LE(offset + 22)) {
            throw new Error("Invalid OGG page CRC");
        }
        const currentSerial = buffer.readUInt32LE(offset + 14);
        if (serial === undefined) {
            serial = currentSerial;
            if (size < 16 || buffer[packet] !== 1
                || buffer.toString("ascii", packet + 1, packet + 7) !== "vorbis") {
                throw new Error("Expected Vorbis identification packet");
            }
            rate = buffer.readUInt32LE(packet + 12);
        } else if (serial !== currentSerial) throw new Error("Chained OGG stream");
        const position = buffer.readBigUInt64LE(offset + 6);
        if (position !== 0xffffffffffffffffn) granule = position;
        ended = (buffer[offset + 5] & 4) !== 0;
        offset = packet + size;
    }
    if (!ended || !rate || granule <= 0n) throw new Error("Incomplete OGG stream");
    return Number((Number(granule) / rate).toFixed(6));
}

function checksumManifest(file) {
    const result = new Map();
    for (const line of fs.readFileSync(file, "utf8").trim().split(/\r?\n/)) {
        const match = /^([0-9a-f]{64})  ([a-z0-9_]+\.ogg)$/.exec(line);
        if (!match) throw new Error(`Invalid checksum line: ${line}`);
        if (result.has(match[2])) throw new Error(`Duplicate checksum filename: ${match[2]}`);
        result.set(match[2], match[1]);
    }
    return result;
}

function metadata(toc, field) {
    return new RegExp(`^## ${field}:\\s*(\\S+)`, "m").exec(toc)?.[1];
}

function actualAudio(language, entries) {
    for (const [key, extension] of entries) {
        const folder = questKey.test(key) ? "quests" : "gossip";
        const file = path.join(root, "generated", "sounds", language, folder, `${key}.${extension}`);
        if (!fs.existsSync(file) || fs.statSync(file).size <= 0) throw new Error(`Missing ${language.toUpperCase()} audio: ${file}`);
    }
}

function assertEqual(actual, expected, label) {
    if (actual !== expected) throw new Error(`${label}: expected ${expected}, got ${actual}`);
}

function spacedNumber(value) {
    return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function numericKeys(value) {
    return new Set(Object.keys(value || {}).filter(key => /^\d+$/.test(key)).map(Number));
}

function main() {
    const lock = JSON.parse(fs.readFileSync(path.join(root, "sources.lock.json"), "utf8"));
    const packageMetadata = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    const packageLock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
    const toc = fs.readFileSync(path.join(root, "AI_VoiceOverData.toc"), "utf8");
    const legacyToc = fs.readFileSync(path.join(root, "AI_VoiceOverData_Vanilla.toc"), "utf8");
    assertEqual(legacyToc, toc, "Legacy and GitAddonsManager TOCs");
    for (const line of toc.split(/\r?\n/)) {
        if (!line || line.startsWith("##")) continue;
        const location = path.join(root, line.replace(/\\/g, path.sep));
        if (!fs.existsSync(location)) throw new Error(`Missing TOC path with matching case: ${line}`);
    }
    const en = lengthManifest(path.join(root, "generated", "sound_length_table.lua"));
    const ru = lengthManifest(path.join(root, "generated", "sound_length_table_ru.lua"));
    const installed = installedInventory(path.join(root, "generated", "installed_audio.lua"));
    const catquest = catquestData(path.join(root, "generated", "catquest_audio.lua"));
    const baseQuestLookup = dataTable(path.join(root, "generated", "quest_id_lookups.lua"),
        "AI_VoiceOverData_Vanilla.QuestIDLookup");
    const catquestQuestLookup = dataTable(path.join(root, "generated", "catquest_quest_id_lookups.lua"),
        "AI_VoiceOverData_Vanilla.CatQuestQuestLookup");
    const octoTextLookup = dataTable(path.join(root, "generated", "octo_quest_text_lookups.lua"),
        "AI_VoiceOverData_Vanilla.OctoQuestTextLookup");
    const catChecksums = checksumManifest(path.join(root, "generated", "catquest_files.sha256"));
    assertEqual(catquest.schema, 1, "CatQuest schema version");
    assertEqual(catquestQuestLookup.SchemaVersion, 1, "CatQuest quest lookup schema version");
    assertEqual(octoTextLookup.SchemaVersion, 1, "Octo text lookup schema version");
    assertEqual(lock.catquest.curseForgeProjectId, 1715207, "CatQuest project ID");
    assertEqual(sha256(fs.readFileSync(path.join(root, "generated", "catquest_audio.lua"))),
        lock.catquest.generatedDataSha256, "Generated CatQuest data hash");
    assertEqual(sha256(fs.readFileSync(path.join(root, "generated", "catquest_files.sha256"))),
        lock.catquest.generatedChecksumsSha256, "Generated CatQuest checksums hash");

    assertEqual(metadata(toc, "Version"), lock.addonVersion, "Addon version");
    assertEqual(packageMetadata.version, lock.addonVersion, "Tool package version");
    assertEqual(packageLock.version, packageMetadata.version, "Package lock version");
    assertEqual(packageLock.packages[""].version, packageMetadata.version, "Root package lock version");
    const moduleSource = fs.readFileSync(path.join(root, "Module.lua"), "utf8");
    assertEqual(/module\.Version = "([^"]+)"/.exec(moduleSource)?.[1], lock.addonVersion, "Lua module version");
    assertEqual(/module\.HybridBuild = "en-ui-catquest-ru-en-([^"]+)"/.exec(moduleSource)?.[1],
        lock.addonVersion, "Hybrid build version");
    const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
    assertEqual(/\*\*Version:\*\*\s*(\S+)/.exec(readme)?.[1], lock.addonVersion, "README version");
    for (const value of [lock.catquest.questIds, lock.catquest.sections, lock.catquest.files]) {
        if (!readme.includes(spacedNumber(value))) throw new Error(`README is missing CatQuest count: ${value}`);
    }
    assertEqual(metadata(toc, "X-CatQuest-Voices-Version"), lock.catquest.version, "CatQuest TOC version");
    assertEqual(metadata(toc, "X-CatQuest-Curse-File-ID"), String(lock.catquest.curseForgeFileId), "CatQuest file ID");
    assertEqual(metadata(toc, "X-CatQuest-Archive-SHA256"), lock.catquest.archiveSha256, "CatQuest archive hash");
    assertEqual(catquest.version, lock.catquest.version, "CatQuest data version");
    assertEqual(catquest.coverageSha256, lock.catquest.coverageSha256, "CatQuest coverage audit hash");
    assertEqual(catquest.audioManifestSha256, lock.catquest.audioManifestSha256, "CatQuest audio manifest hash");
    assertEqual(catquest.counts.quests, lock.catquest.questIds, "CatQuest quest count");
    assertEqual(catquest.counts.sections, lock.catquest.sections, "CatQuest section count");
    assertEqual(catquest.entries.size, lock.catquest.files, "CatQuest file count");
    assertEqual(catChecksums.size, lock.catquest.files, "CatQuest checksum count");
    assertEqual(catquestQuestLookup.SourceRevision, lock.catquest.octoQuestDatabaseRevision,
        "CatQuest quest lookup source revision");
    assertEqual(octoTextLookup.SourceRevision, lock.catquest.octoQuestDatabaseRevision,
        "Octo text lookup source revision");

    const selectedAcceptIDs = new Set();
    for (const key of catquest.entries.keys()) {
        const match = /^(?:[mf]-)?(\d+)-accept$/.exec(key);
        if (match) selectedAcceptIDs.add(Number(match[1]));
    }
    const selectedTitleIDs = numericKeys(catquestQuestLookup.SelectedTitles);
    const reachableIDs = numericKeys(catquestQuestLookup.ReachableIDs);
    const blockedIDs = numericKeys(catquestQuestLookup.BlockedIDs);
    assertEqual(selectedTitleIDs.size, selectedAcceptIDs.size, "CatQuest selected title count");
    assertEqual(selectedTitleIDs.size, catquestQuestLookup.SelectedAcceptCount, "CatQuest lookup selected count");
    assertEqual(reachableIDs.size, catquestQuestLookup.ReachableAcceptCount, "CatQuest reachable accept count");
    assertEqual(blockedIDs.size, catquestQuestLookup.BlockedAcceptCount, "CatQuest blocked accept count");
    assertEqual(reachableIDs.size + blockedIDs.size, selectedAcceptIDs.size, "CatQuest reachability partition");
    assertEqual(selectedAcceptIDs.size, lock.catquest.questLookup.selectedAccepts, "Locked CatQuest selected accepts");
    assertEqual(reachableIDs.size, lock.catquest.questLookup.reachableAccepts, "Locked CatQuest reachable accepts");
    assertEqual(blockedIDs.size, lock.catquest.questLookup.blockedAccepts, "Locked CatQuest blocked accepts");
    assertEqual(catquestQuestLookup.AddedTitleCount, lock.catquest.questLookup.addedTitles, "Locked added title routes");
    assertEqual(catquestQuestLookup.AddedDirectCount, lock.catquest.questLookup.addedDirect, "Locked direct title routes");
    assertEqual(catquestQuestLookup.AddedAmbiguousCount, lock.catquest.questLookup.addedAmbiguous,
        "Locked ambiguous title routes");
    for (const id of selectedAcceptIDs) {
        if (!selectedTitleIDs.has(id)) throw new Error(`Missing selected CatQuest title: ${id}`);
        if (reachableIDs.has(id) === blockedIDs.has(id)) throw new Error(`Invalid CatQuest reachability state: ${id}`);
        const title = catquestQuestLookup.SelectedTitles[id];
        const baseRoute = baseQuestLookup.accept && baseQuestLookup.accept[title];
        const route = Object.prototype.hasOwnProperty.call(catquestQuestLookup.Routes, title)
            ? catquestQuestLookup.Routes[title] : baseRoute;
        let reachable = false;
        if (typeof route === "number") {
            if (route !== id) throw new Error(`CatQuest title resolves to another quest: ${title} -> ${route}/${id}`);
            reachable = true;
        } else if (route && typeof route === "object") {
            if (Object.prototype.hasOwnProperty.call(catquestQuestLookup.Routes, title)
                && Object.keys(route).length !== 0) {
                throw new Error(`CatQuest ambiguous override retained legacy routes: ${title}`);
            }
            reachable = Object.values(octoTextLookup.Routes && octoTextLookup.Routes[title] || {}).includes(id);
        } else {
            throw new Error(`Missing CatQuest title route: ${id} / ${title}`);
        }
        if (reachable !== reachableIDs.has(id)) throw new Error(`CatQuest reachability metadata mismatch: ${id}`);
    }
    assertEqual(catquestQuestLookup.Routes["Ledger from Tanaris"], 4450, "Ledger from Tanaris journal route");
    assertEqual(catquestQuestLookup.Routes["Trinkets..."], 3481, "Trinkets journal route");
    assertEqual(installed.en.size, lock.baseInventory.enFiles, "EN inventory files");
    assertEqual(installed.ru.size, lock.baseInventory.ruFiles, "RU inventory files");
    actualAudio("en", installed.en);
    actualAudio("ru", installed.ru);

    const catDirectory = path.join(root, "generated", "sounds", "catquest", "quests");
    const catFiles = fs.readdirSync(catDirectory);
    const unexpectedCat = catFiles.find(file => !/^[a-z0-9_]+\.ogg$/.test(file));
    if (unexpectedCat) throw new Error(`Unexpected CatQuest audio file: ${unexpectedCat}`);
    const actualCat = new Set(catFiles);
    assertEqual(actualCat.size, catquest.entries.size, "CatQuest directory file count");
    let selectedBytes = 0;
    for (const entry of catquest.entries.values()) {
        const file = path.join(catDirectory, entry.file);
        if (!actualCat.has(entry.file) || fs.statSync(file).size <= 0) throw new Error(`Missing CatQuest audio: ${entry.file}`);
        const buffer = fs.readFileSync(file);
        selectedBytes += buffer.length;
        if (sha256(buffer) !== catChecksums.get(entry.file)) throw new Error(`CatQuest hash mismatch: ${entry.file}`);
        if (oggDuration(buffer) !== entry.duration) throw new Error(`CatQuest duration mismatch: ${entry.file}`);
    }
    assertEqual(selectedBytes, lock.catquest.selectedBytes, "CatQuest selected byte count");
    if (!Number.isInteger(lock.catquest.upstreamFiles) || lock.catquest.upstreamFiles < lock.catquest.files) {
        throw new Error("Invalid CatQuest upstream file count");
    }
    if (lock.catquest.auditMode !== "prior-sections-only-with-octo-overrides-excluded") {
        throw new Error(`Unexpected CatQuest audit mode: ${lock.catquest.auditMode}`);
    }
    for (const field of ["previousCoverageSha256", "classicRuSha256", "referenceManifestSha256"]) {
        if (!/^[0-9a-f]{64}$/.test(lock.catquest[field] || "")) throw new Error(`Invalid CatQuest ${field}`);
    }
    for (const field of ["octoQuestDatabaseRevision", "classicRuRevision"]) {
        if (!/^[0-9a-f]{40}$/.test(lock.catquest[field] || "")) throw new Error(`Invalid CatQuest ${field}`);
    }
    for (const file of catChecksums.keys()) {
        if (!actualCat.has(file)) throw new Error(`Checksum references absent CatQuest audio: ${file}`);
    }

    const importDocumentation = fs.readFileSync(path.join(root, "docs", "CATQUEST_IMPORT.md"), "utf8");
    const coverageDocumentation = fs.readFileSync(path.join(root, "docs", "COVERAGE.md"), "utf8");
    const notice = fs.readFileSync(path.join(root, "NOTICE.md"), "utf8");
    const audioLicense = fs.readFileSync(path.join(root, "LICENSE-CATQUEST-AUDIO.md"), "utf8");
    for (const [label, source] of [["CatQuest import documentation", importDocumentation], ["NOTICE", notice]]) {
        if (!source.includes(lock.catquest.version) || !source.includes(String(lock.catquest.curseForgeFileId))
            || !source.includes(lock.catquest.archiveSha256)) {
            throw new Error(`${label} is not synchronized with sources.lock.json`);
        }
    }
    for (const value of Object.values(lock.finalRouting)) {
        if (!coverageDocumentation.includes(spacedNumber(value))) {
            throw new Error(`Coverage documentation is missing routing count: ${value}`);
        }
    }
    if (!notice.includes("CC BY-NC-SA 4.0") || !audioLicense.includes(lock.catquest.version)
        || !audioLicense.includes(String(lock.catquest.curseForgeFileId))
        || !audioLicense.includes(lock.catquest.archiveSha256)
        || !audioLicense.includes("creativecommons.org/licenses/by-nc-sa/4.0")) {
        throw new Error("Missing or stale CatQuest audio license attribution");
    }

    for (const [file, expected] of Object.entries(lock.authoritativeTables)) {
        const location = path.join(root, file);
        if (sha256(fs.readFileSync(location)) !== expected) throw new Error(`Authoritative table hash mismatch: ${file}`);
    }

    const allKeys = new Set([...en, ...ru, ...catquest.entries.keys()]);
    const routes = { catquest: 0, ru: 0, en: 0, aliases: 0, missing: 0 };
    for (const key of allKeys) {
        const neutral = /^[mf]-/.test(key) ? key.slice(2) : null;
        let source, sourceKey;
        for (const [candidateSource, candidateKey, available] of [
            ["catquest", key, catquest.entries.has(key)],
            ["catquest", neutral, neutral && catquest.entries.has(neutral)],
            ["ru", key, ru.has(key) && installed.ru.has(key)],
            ["ru", neutral, neutral && ru.has(neutral) && installed.ru.has(neutral)],
            ["en", key, en.has(key) && installed.en.has(key)],
            ["en", neutral, neutral && en.has(neutral) && installed.en.has(neutral)],
        ]) {
            if (available) {
                source = candidateSource;
                sourceKey = candidateKey;
                break;
            }
        }
        if (!source) routes.missing++;
        else {
            routes[source]++;
            if (sourceKey !== key) routes.aliases++;
        }
    }
    for (const key of Object.keys(lock.finalRouting)) assertEqual(routes[key], lock.finalRouting[key], `Final route ${key}`);

    const result = {
        addonVersion: lock.addonVersion,
        catquest: { version: catquest.version, ...catquest.counts },
        questLookup: {
            selectedAccepts: selectedAcceptIDs.size,
            reachableAccepts: reachableIDs.size,
            blockedAccepts: blockedIDs.size,
            addedTitles: catquestQuestLookup.AddedTitleCount,
        },
        inventory: { en: installed.en.size, ru: installed.ru.size, catquest: actualCat.size },
        routes,
    };
    console.log(JSON.stringify(result, null, 2));
}

main();
