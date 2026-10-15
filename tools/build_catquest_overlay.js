#!/usr/bin/env node

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function parseCSV(source) {
    const rows = [];
    let row = [], field = "", quoted = false;
    for (let i = 0; i < source.length; i++) {
        const character = source[i];
        if (quoted) {
            if (character === '"' && source[i + 1] === '"') {
                field += '"';
                i++;
            } else if (character === '"') {
                quoted = false;
            } else {
                field += character;
            }
        } else if (character === '"') {
            quoted = true;
        } else if (character === ",") {
            row.push(field);
            field = "";
        } else if (character === "\n") {
            row.push(field.replace(/\r$/, ""));
            if (row.some(value => value !== "")) rows.push(row);
            row = [];
            field = "";
        } else {
            field += character;
        }
    }
    if (field || row.length) {
        row.push(field.replace(/\r$/, ""));
        rows.push(row);
    }
    const header = rows.shift();
    if (!header || new Set(header).size !== header.length) throw new Error("Missing or duplicate CSV header columns");
    for (const values of rows) {
        if (values.length !== header.length) throw new Error(`Malformed CSV row: expected ${header.length} fields, got ${values.length}`);
    }
    return {
        header,
        rows: rows.map(values => Object.fromEntries(header.map((name, index) => [name, values[index] || ""]))),
    };
}

function luaString(value) {
    return '"' + value.replace(/[\\"\x00-\x1f\x7f]/g, character => {
        if (character === "\\" || character === '"') return "\\" + character;
        return "\\" + character.charCodeAt(0).toString().padStart(3, "0");
    }) + '"';
}

function sha256(buffer) {
    return crypto.createHash("sha256").update(buffer).digest("hex");
}

function requireInside(root, target, label) {
    const relative = path.relative(root, target);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error(`${label} must be inside the addon root: ${target}`);
    }
}

function main() {
    const coverageFile = process.argv[2];
    const manifestFile = process.argv[3];
    const sourceDirectory = process.argv[4];
    const addonRoot = path.resolve(__dirname, "..");
    const dataFile = process.argv[5] || path.join(addonRoot, "generated", "catquest_audio.lua");
    const audioDirectory = process.argv[6] || path.join(addonRoot, "generated", "sounds", "catquest", "quests");
    const checksumsFile = path.join(addonRoot, "generated", "catquest_files.sha256");
    if (!coverageFile || !manifestFile || !sourceDirectory) {
        throw new Error("Usage: node tools/build_catquest_overlay.js <catquest-sections.csv> <audio-manifest.json> <Sounds/q> [data.lua] [audio-dir]");
    }

    requireInside(addonRoot, dataFile, "Data output");
    requireInside(addonRoot, audioDirectory, "Audio output");
    requireInside(addonRoot, checksumsFile, "Checksum output");

    const coverageBuffer = fs.readFileSync(coverageFile);
    const manifestBuffer = fs.readFileSync(manifestFile);
    const parsedCoverage = parseCSV(coverageBuffer.toString("utf8"));
    const requiredColumns = [
        "quest_id", "stage", "gender_variants", "files", "in_octo", "text_status", "text_score", "text_source",
    ];
    for (const column of requiredColumns) {
        if (!parsedCoverage.header.includes(column)) throw new Error(`Missing coverage column: ${column}`);
    }
    const coverage = parsedCoverage.rows;
    const manifest = JSON.parse(manifestBuffer.toString("utf8"));
    if (!manifest || typeof manifest !== "object" || !Array.isArray(manifest.files)) {
        throw new Error("Invalid audio manifest schema");
    }
    if (!/^\d+\.\d+\.\d+$/.test(manifest.version || "")) throw new Error("Invalid source version in audio manifest");
    for (const file of manifest.files) {
        if (!file || !/^[a-z0-9_]+\.ogg$/.test(file.file || "")
            || !Number.isInteger(file.bytes) || file.bytes <= 0
            || !Number.isFinite(file.duration) || file.duration <= 0
            || !/^[0-9a-f]{64}$/.test(file.sha256 || "")) {
            throw new Error(`Invalid audio manifest entry: ${JSON.stringify(file)}`);
        }
    }
    const audio = new Map(manifest.files.map(file => [file.file, file]));
    if (audio.size !== manifest.files.length) throw new Error("Duplicate filenames in audio manifest");
    const entries = [];
    const selectedFiles = new Set();
    const quests = new Set();
    const sections = new Set();

    const coverageSections = new Set();
    const allowedTextStatuses = new Set(["", "same", "close", "different", "missing", "missingTranscript", "conditional", "requiresOctoOverride", "notPreviouslyAudited"]);
    for (const row of coverage) {
        const id = Number(row.quest_id);
        if (!Number.isInteger(id) || id <= 0) throw new Error(`Invalid quest ID: ${row.quest_id}`);
        if (row.stage !== "accept" && row.stage !== "complete") throw new Error(`Unsupported stage: ${row.stage}`);
        if (row.in_octo !== "true" && row.in_octo !== "false") throw new Error(`Invalid in_octo value: ${row.in_octo}`);
        if (!allowedTextStatuses.has(row.text_status)
            || row.in_octo === "true" && row.text_status === "") {
            throw new Error(`Invalid text status: ${row.text_status}`);
        }
        const section = `${id}-${row.stage}`;
        if (coverageSections.has(section)) throw new Error(`Duplicate coverage section: ${section}`);
        coverageSections.add(section);
        const variants = row.gender_variants.split("|");
        const files = row.files.split("|");
        if (variants.length !== files.length) throw new Error(`Variant/file mismatch for ${section}`);
        if (!(variants.length === 1 && variants[0] === "x")
            && !(variants.length === 2 && variants[0] === "m" && variants[1] === "f")) {
            throw new Error(`Unsafe gender variants for ${section}: ${row.gender_variants}`);
        }
        if (row.in_octo !== "true" || row.text_status !== "same") continue;
        const score = Number(row.text_score);
        if (!Number.isFinite(score) || score < 0.85 || score > 1) {
            throw new Error(`Invalid compatible text score for ${row.quest_id}-${row.stage}: ${row.text_score}`);
        }
        if (row.text_source !== "classicBase" && row.text_source !== "octoOverride") {
            throw new Error(`Invalid compatible text source for ${row.quest_id}-${row.stage}: ${row.text_source}`);
        }
        const stage = row.stage === "accept" ? "accept" : row.stage === "complete" ? "complete" : null;
        if (!stage) throw new Error(`Unsupported stage: ${row.stage}`);

        for (let i = 0; i < variants.length; i++) {
            const variant = variants[i];
            const file = files[i];
            if (!/^[a-z0-9_]+\.ogg$/.test(file)) throw new Error(`Unsafe audio filename: ${file}`);
            const stem = `${id}${stage === "complete" ? "_t" : ""}`;
            const expectedFile = `${stem}${variant === "x" ? "" : `_${variant}`}.ogg`;
            if (file !== expectedFile) throw new Error(`Unexpected audio route for ${id}-${stage}: ${file}`);
            const expected = audio.get(file);
            if (!expected || !(expected.duration > 0) || !expected.sha256) {
                throw new Error(`Missing audited metadata: ${file}`);
            }
            const source = path.join(sourceDirectory, file);
            const buffer = fs.readFileSync(source);
            if (buffer.length !== expected.bytes || sha256(buffer) !== expected.sha256) {
                throw new Error(`Audio does not match the audited manifest: ${file}`);
            }
            const key = `${variant === "x" ? "" : variant + "-"}${id}-${stage}`;
            entries.push({ id, stage, variant, key, file, duration: expected.duration, buffer });
            if (selectedFiles.has(file)) throw new Error(`Duplicate selected audio file: ${file}`);
            selectedFiles.add(file);
        }
        quests.add(id);
        sections.add(`${id}-${stage}`);
    }

    const stageOrder = { accept: 0, complete: 1 };
    const variantOrder = { x: 0, m: 1, f: 2 };
    entries.sort((left, right) => left.id - right.id || stageOrder[left.stage] - stageOrder[right.stage]
        || variantOrder[left.variant] - variantOrder[right.variant]);
    const duplicate = entries.find((entry, index) => index > 0 && entry.key === entries[index - 1].key);
    if (duplicate) throw new Error(`Duplicate VoiceOver key: ${duplicate.key}`);
    if (!entries.length) throw new Error("The CatQuest whitelist is empty");

    const lines = [
        "-- Generated by tools/build_catquest_overlay.js; do not edit manually.",
        "-- Policy: Octo quest ID plus Russian baseline Jaccard >= 0.85; all non-same statuses are excluded.",
        "AI_VoiceOverData_Vanilla.CatQuestData = {",
        "    SchemaVersion = 1,",
        `    SourceVersion = ${luaString(manifest.version)},`,
        `    CoverageSha256 = ${luaString(sha256(coverageBuffer))},`,
        `    AudioManifestSha256 = ${luaString(sha256(manifestBuffer))},`,
        `    QuestCount = ${quests.size},`,
        `    SectionCount = ${sections.size},`,
        `    EntryCount = ${entries.length},`,
        "    Entries = {",
    ];
    for (const entry of entries) {
        lines.push(`        [${luaString(entry.key)}] = { ${entry.duration}, ${luaString(entry.file)} },`);
    }
    lines.push("    },", "}", "");

    const stagingDirectory = audioDirectory + ".staging";
    const backupDirectory = audioDirectory + ".previous";
    const temporaryData = dataFile + ".tmp";
    const backupData = dataFile + ".previous";
    const temporaryChecksums = checksumsFile + ".tmp";
    const backupChecksums = checksumsFile + ".previous";
    fs.rmSync(stagingDirectory, { recursive: true, force: true });
    fs.rmSync(backupDirectory, { recursive: true, force: true });
    fs.rmSync(temporaryData, { force: true });
    fs.rmSync(backupData, { force: true });
    fs.rmSync(temporaryChecksums, { force: true });
    fs.rmSync(backupChecksums, { force: true });
    fs.mkdirSync(stagingDirectory, { recursive: true });
    for (const entry of entries) fs.writeFileSync(path.join(stagingDirectory, entry.file), entry.buffer);
    fs.mkdirSync(path.dirname(dataFile), { recursive: true });
    fs.writeFileSync(temporaryData, lines.join("\n"));
    fs.writeFileSync(temporaryChecksums,
        entries.map(entry => `${audio.get(entry.file).sha256}  ${entry.file}`).join("\n") + "\n");

    const hadAudio = fs.existsSync(audioDirectory);
    const hadData = fs.existsSync(dataFile);
    const hadChecksums = fs.existsSync(checksumsFile);
    let installed = false;
    try {
        if (hadAudio) fs.renameSync(audioDirectory, backupDirectory);
        if (hadData) fs.renameSync(dataFile, backupData);
        if (hadChecksums) fs.renameSync(checksumsFile, backupChecksums);
        fs.renameSync(stagingDirectory, audioDirectory);
        fs.renameSync(temporaryData, dataFile);
        fs.renameSync(temporaryChecksums, checksumsFile);
        installed = true;
    } catch (error) {
        fs.rmSync(audioDirectory, { recursive: true, force: true });
        if (hadAudio && fs.existsSync(backupDirectory)) fs.renameSync(backupDirectory, audioDirectory);
        fs.rmSync(dataFile, { force: true });
        if (hadData && fs.existsSync(backupData)) fs.renameSync(backupData, dataFile);
        fs.rmSync(checksumsFile, { force: true });
        if (hadChecksums && fs.existsSync(backupChecksums)) fs.renameSync(backupChecksums, checksumsFile);
        fs.rmSync(stagingDirectory, { recursive: true, force: true });
        fs.rmSync(temporaryData, { force: true });
        fs.rmSync(temporaryChecksums, { force: true });
        throw error;
    }
    if (installed) {
        try { fs.rmSync(backupDirectory, { recursive: true, force: true }); } catch (error) { console.warn(error.message); }
        try { fs.rmSync(backupData, { force: true }); } catch (error) { console.warn(error.message); }
        try { fs.rmSync(backupChecksums, { force: true }); } catch (error) { console.warn(error.message); }
    }
    console.log(`CatQuest ${manifest.version}: ${quests.size} quests, ${sections.size} sections, ${entries.length} files`);
}

main();
