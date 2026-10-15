#!/usr/bin/env node

const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");
const {
    catquestRecords,
    cueText,
    dataTable,
    fileSha256,
    oggMetadata,
    sha256,
} = require("./lib/catquest");

function parseArguments(argv) {
    const result = {};
    for (let index = 2; index < argv.length; index += 2) {
        const key = argv[index];
        const value = argv[index + 1];
        if (!key || !key.startsWith("--") || !value || value.startsWith("--")) {
            throw new Error("Arguments must be --name value pairs");
        }
        result[key.slice(2)] = path.resolve(value);
    }
    return result;
}

function requireInputs(args, names) {
    for (const name of names) {
        if (!args[name]) throw new Error(`Missing --${name}`);
        if (!fs.existsSync(args[name])) throw new Error(`Missing input: ${args[name]}`);
    }
}

function gitRevision(directory) {
    let current = path.resolve(directory);
    while (current !== path.dirname(current) && !fs.existsSync(path.join(current, ".git"))) {
        current = path.dirname(current);
    }
    if (!fs.existsSync(path.join(current, ".git"))) return null;
    const status = childProcess.execFileSync("git", ["status", "--porcelain"], {
        cwd: current,
        encoding: "utf8",
    }).trim();
    if (status) throw new Error(`Source Git worktree is dirty: ${current}`);
    return childProcess.execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: current,
        encoding: "utf8",
    }).trim();
}

function parseClassicRussianQuests(file) {
    const source = fs.readFileSync(file, "utf8");
    const marker = "INSERT INTO `locales_quest`";
    const result = {};
    let cursor = 0;
    function skipWhitespace(index) {
        while (index < source.length && /[\s,]/.test(source[index])) index++;
        return index;
    }
    function value(index) {
        if (source[index] === "'") {
            let text = "";
            index++;
            while (index < source.length) {
                const character = source[index++];
                if (character === "\\") {
                    const escaped = source[index++];
                    const replacements = { n: "\n", r: "\r", t: "\t", 0: "\0" };
                    text += replacements[escaped] !== undefined ? replacements[escaped] : escaped;
                } else if (character === "'" && source[index] === "'") {
                    text += "'";
                    index++;
                } else if (character === "'") {
                    return { value: text, index };
                } else {
                    text += character;
                }
            }
            throw new Error("Unterminated SQL string in locales_quest");
        }
        const start = index;
        while (index < source.length && source[index] !== "," && source[index] !== ")") index++;
        const literal = source.slice(start, index).trim();
        return { value: /^null$/i.test(literal) ? null : Number(literal), index };
    }
    while (true) {
        const statement = source.indexOf(marker, cursor);
        if (statement < 0) break;
        const values = source.indexOf("VALUES", statement + marker.length);
        if (values < 0) throw new Error("Missing VALUES after locales_quest INSERT");
        let index = values + "VALUES".length;
        while (index < source.length) {
            index = skipWhitespace(index);
            if (source[index] === ";") {
                cursor = index + 1;
                break;
            }
            if (source.startsWith("ON DUPLICATE KEY UPDATE", index)) {
                const end = source.indexOf(";", index);
                if (end < 0) throw new Error("Unterminated locales_quest INSERT");
                cursor = end + 1;
                break;
            }
            if (source[index] !== "(") throw new Error(`Expected SQL tuple at byte ${index}`);
            index++;
            const row = [];
            while (index < source.length) {
                index = skipWhitespace(index);
                if (source[index] === ")") {
                    index++;
                    break;
                }
                const parsed = value(index);
                row.push(parsed.value);
                index = skipWhitespace(parsed.index);
            }
            if (row.length !== 11) throw new Error(`Expected 11 locales_quest fields, got ${row.length}`);
            result[row[0]] = { T: row[1], D: row[2], O: row[3], R: row[4], P: row[5], E: row[6] };
        }
    }
    if (!Object.keys(result).length) throw new Error("No locales_quest records found");
    return result;
}

function parseLengthManifest(file) {
    const source = fs.readFileSync(file, "utf8");
    const sections = new Set();
    for (const match of source.matchAll(/\["(?:[mf]-)?(\d+)-(accept|progress|complete)"\]\s*=\s*[0-9]/g)) {
        sections.add(`${match[1]}:${match[2]}`);
    }
    return sections;
}

function expandGameText(text, gender) {
    return String(text || "")
        .replace(/\$g([^:;]*):([^;]*);/gi, (_, male, female) => gender === "f" ? female : male)
        .replace(/\$[Bb]/g, " ")
        .replace(/\$[NnCcRr]/g, " ")
        .replace(/\|n/gi, " ")
        .replace(/[<>]/g, " ");
}

function words(text) {
    const result = new Set();
    for (const word of String(text || "").toLowerCase().replace(/ё/g, "е").split(/[^\p{L}\p{N}]+/u)) {
        if (Array.from(word).length >= 2) result.add(word);
    }
    return result;
}

function jaccard(left, right) {
    const a = words(left);
    const b = words(right);
    if (!a.size && !b.size) return 1;
    let common = 0;
    for (const word of a) if (b.has(word)) common++;
    return common / (a.size + b.size - common);
}

function compareTexts(records, octoIDs, classicRu, octoRu, previousCoverage) {
    const blockedOverrides = previousCoverage ? previousCoverage.overrides : new Set();
    const previouslyAudited = previousCoverage ? previousCoverage.sections : new Set();
    const statuses = new Map();
    const summary = {
        compared: 0, same: 0, close: 0, different: 0, missing: 0,
        missingTranscript: 0, conditional: 0, requiresOctoOverride: 0, notPreviouslyAudited: 0,
        textSources: { classicBase: 0, octoOverride: 0 },
    };
    const mismatches = [];
    for (const record of records) {
        const key = `${record.id}:${record.stage}`;
        if (!octoIDs.has(record.id)) continue;
        if (!octoRu && !previouslyAudited.has(key)) {
            summary.notPreviouslyAudited++;
            statuses.set(key, { status: "notPreviouslyAudited", score: null, textSource: null });
            continue;
        }
        if (!octoRu && blockedOverrides.has(key)) {
            summary.requiresOctoOverride++;
            statuses.set(key, { status: "requiresOctoOverride", score: null, textSource: "octoOverride" });
            continue;
        }
        const field = record.stage === "accept" ? "D" : "R";
        const override = octoRu && octoRu[record.id] && octoRu[record.id][field];
        const base = classicRu[record.id] && classicRu[record.id][field];
        const source = typeof override === "string" && override.trim() ? override : base;
        const textSource = source === override ? "octoOverride" : "classicBase";
        if (typeof source !== "string" || !source.trim()) {
            summary.missing++;
            statuses.set(key, { status: "missing", score: null, textSource: null });
            continue;
        }
        if (/\$[cCrR]/.test(source)) {
            summary.conditional++;
            statuses.set(key, { status: "conditional", score: null, textSource });
            continue;
        }
        const variants = record.variants.length === 1 && record.variants[0] === "x"
            && /\$g[^:;]*:[^;]*;/i.test(source) ? ["m", "f"] : record.variants;
        const comparisons = [];
        for (const variant of variants) {
            const transcript = cueText(record.entry, record.variants[0] === "x" ? "x" : variant);
            if (!transcript) break;
            const expanded = expandGameText(source, variant);
            comparisons.push({ variant, source: expanded, transcript, score: jaccard(expanded, transcript) });
        }
        if (comparisons.length !== variants.length) {
            summary.missingTranscript++;
            statuses.set(key, { status: "missingTranscript", score: null, textSource });
            continue;
        }
        const score = Math.min(...comparisons.map(item => item.score));
        const status = score >= 0.85 ? "same" : score >= 0.65 ? "close" : "different";
        summary.compared++;
        summary[status]++;
        summary.textSources[textSource]++;
        statuses.set(key, { status, score, textSource });
        if (status !== "same") {
            const worst = comparisons.sort((left, right) => left.score - right.score)[0];
            mismatches.push({
                quest_id: record.id,
                stage: record.stage,
                variant: worst.variant,
                score: Number(worst.score.toFixed(6)),
                octo_text: worst.source,
                catquest_text: worst.transcript,
            });
        }
    }
    mismatches.sort((left, right) => left.score - right.score || left.quest_id - right.quest_id);
    return { statuses, summary, mismatches };
}

function csvValue(value) {
    const text = value == null ? "" : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csv(rows) {
    return rows.map(row => row.map(csvValue).join(",")).join("\n") + "\n";
}

function sortedFiles(values) {
    return Array.from(values).sort((left, right) => left.localeCompare(right, "en", { numeric: true }));
}

function readPreviousCoverage(file) {
    if (!file) return null;
    const lines = fs.readFileSync(file, "utf8").trim().split(/\r?\n/);
    const header = lines.shift().split(",");
    const id = header.indexOf("quest_id");
    const stage = header.indexOf("stage");
    const source = header.indexOf("text_source");
    if (id < 0 || stage < 0 || source < 0) throw new Error("Invalid previous coverage schema");
    const result = { sections: new Set(), overrides: new Set() };
    for (const line of lines) {
        const values = line.split(",");
        if (values.length !== header.length) throw new Error("Malformed previous coverage row");
        const key = `${values[id]}:${values[stage]}`;
        result.sections.add(key);
        if (values[source] === "octoOverride") result.overrides.add(key);
    }
    return result;
}

function compareReference(manifest, file) {
    if (!file) return null;
    const reference = JSON.parse(fs.readFileSync(file, "utf8"));
    if (reference.version !== manifest.version) throw new Error("Reference manifest version mismatch");
    const expected = new Map(reference.files.map(item => [item.file, item]));
    if (expected.size !== manifest.files.length) throw new Error("Reference manifest file count mismatch");
    for (const actual of manifest.files) {
        const item = expected.get(actual.file);
        if (!item || item.bytes !== actual.bytes || item.duration !== actual.duration || item.sha256 !== actual.sha256) {
            throw new Error(`Reference manifest mismatch: ${actual.file}`);
        }
    }
    return { file: path.resolve(file), sha256: fileSha256(file), files: expected.size };
}

function main() {
    const args = parseArguments(process.argv);
    requireInputs(args, ["catquest", "octo", "classic-ru", "vanilla", "output"]);
    if (args["octo-ru"] && !fs.existsSync(args["octo-ru"])) throw new Error(`Missing input: ${args["octo-ru"]}`);
    if (!args["octo-ru"] && !args["previous-coverage"]) {
        throw new Error("Pass --octo-ru for a full audit or --previous-coverage for conservative override exclusion");
    }
    if (args["previous-coverage"] && !fs.existsSync(args["previous-coverage"])) {
        throw new Error(`Missing input: ${args["previous-coverage"]}`);
    }
    const pack = catquestRecords(args.catquest);
    const sounds = path.join(args.catquest, "Sounds", "q");
    const actualFiles = new Set(fs.readdirSync(sounds).filter(file => file.endsWith(".ogg")));
    const expectedFiles = new Set(pack.records.flatMap(record => record.files));
    const missing = sortedFiles(Array.from(expectedFiles).filter(file => !actualFiles.has(file)));
    const unreferenced = sortedFiles(Array.from(actualFiles).filter(file => !expectedFiles.has(file)));
    if (missing.length || unreferenced.length) {
        throw new Error(`CatQuest audio/index mismatch: ${missing.length} missing, ${unreferenced.length} unreferenced`);
    }

    const manifestFiles = [];
    const profiles = { channels: {}, sampleRates: {}, nominalBitrates: {} };
    let totalBytes = 0;
    for (const file of sortedFiles(expectedFiles)) {
        const buffer = fs.readFileSync(path.join(sounds, file));
        const metadata = oggMetadata(buffer);
        totalBytes += buffer.length;
        profiles.channels[metadata.channels] = (profiles.channels[metadata.channels] || 0) + 1;
        profiles.sampleRates[metadata.sampleRate] = (profiles.sampleRates[metadata.sampleRate] || 0) + 1;
        profiles.nominalBitrates[metadata.nominalBitrate] = (profiles.nominalBitrates[metadata.nominalBitrate] || 0) + 1;
        manifestFiles.push({ file, bytes: buffer.length, duration: metadata.duration, sha256: sha256(buffer) });
    }
    const manifest = {
        source: "CatQuest_Voices",
        author: "Cathey (daniilcathey)",
        authorUrl: "https://t.me/catheyco",
        version: pack.version,
        selection: "Complete validated Index.lua; audio filenames are derived from quest, stage and gender",
        jsonOnlyTurnIns: [],
        quests: pack.questCount,
        sections: {
            a: pack.records.filter(record => record.stage === "accept").length,
            c: pack.records.filter(record => record.stage === "complete").length,
        },
        files: manifestFiles,
    };
    const reference = compareReference(manifest, args["reference-manifest"]);

    const octoQuests = JSON.parse(fs.readFileSync(path.join(args.octo, "source", "quests.json"), "utf8"));
    const octoIDs = new Set(Object.keys(octoQuests).map(Number));
    const octoRu = args["octo-ru"] ? dataTable(args["octo-ru"]) : null;
    const previousCoverage = readPreviousCoverage(args["previous-coverage"]);
    const classicRu = parseClassicRussianQuests(args["classic-ru"]);
    const en = parseLengthManifest(path.join(args.vanilla, "generated", "sound_length_table.lua"));
    const ru = parseLengthManifest(path.join(args.vanilla, "generated", "sound_length_table_ru.lua"));
    const text = compareTexts(pack.records, octoIDs, classicRu, octoRu, previousCoverage);
    const selected = pack.records.filter(record => text.statuses.get(`${record.id}:${record.stage}`)?.status === "same"
        && octoIDs.has(record.id));
    const selectedFiles = new Set(selected.flatMap(record => record.files));
    const selectedQuestIDs = new Set(selected.map(record => record.id));
    const selectedBytes = manifestFiles.filter(file => selectedFiles.has(file.file))
        .reduce((total, file) => total + file.bytes, 0);

    fs.mkdirSync(args.output, { recursive: true });
    const manifestFile = path.join(args.output, "forever-audio-manifest.json");
    fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + "\n");
    const rows = [[
        "quest_id", "stage", "gender_variants", "files", "bytes", "in_octo", "in_current_en",
        "in_current_ru", "text_status", "text_score", "text_source", "json_only_recovered",
    ]];
    const bytesByFile = new Map(manifestFiles.map(file => [file.file, file.bytes]));
    for (const record of pack.records) {
        const status = text.statuses.get(`${record.id}:${record.stage}`);
        rows.push([
            record.id, record.stage, record.variants.join("|"), record.files.join("|"),
            record.files.reduce((total, file) => total + bytesByFile.get(file), 0),
            octoIDs.has(record.id), en.has(`${record.id}:${record.stage}`), ru.has(`${record.id}:${record.stage}`),
            status && status.status, status && status.score != null ? status.score.toFixed(6) : "",
            status && status.textSource, false,
        ]);
    }
    const coverageFile = path.join(args.output, "catquest-sections.csv");
    fs.writeFileSync(coverageFile, csv(rows));
    fs.writeFileSync(path.join(args.output, "text-mismatches.csv"), csv([
        ["quest_id", "stage", "variant", "score", "octo_text", "catquest_text"],
        ...text.mismatches.map(item => Object.values(item)),
    ]));
    const report = {
        generatedAt: new Date().toISOString(),
        sources: {
            catquestVersion: pack.version,
            octoRevision: gitRevision(args.octo),
            octoRuSha256: args["octo-ru"] ? fileSha256(args["octo-ru"]) : null,
            previousCoverageSha256: args["previous-coverage"] ? fileSha256(args["previous-coverage"]) : null,
            previousCoverageSections: previousCoverage ? previousCoverage.sections.size : null,
            conservativelyBlockedOctoOverrideSections: octoRu ? 0 : previousCoverage.overrides.size,
            classicRuRevision: gitRevision(path.dirname(args["classic-ru"])),
            classicRuSha256: fileSha256(args["classic-ru"]),
            referenceManifest: reference,
        },
        upstream: {
            quests: pack.questCount,
            sections: pack.records.length,
            files: manifestFiles.length,
            bytes: totalBytes,
            codecProfiles: profiles,
        },
        textComparison: text.summary,
        selected: {
            questIds: selectedQuestIDs.size,
            sections: selected.length,
            files: selectedFiles.size,
            bytes: selectedBytes,
            mebibytes: Number((selectedBytes / 1024 / 1024).toFixed(1)),
        },
        artifacts: {
            coverageSha256: fileSha256(coverageFile),
            audioManifestSha256: fileSha256(manifestFile),
        },
        limitations: octoRu ? [] : [
            "RU Octo source was unavailable. Sections known to use Octo overrides in the previous audit were excluded instead of falling back to classicdb_ruRU.",
            "CatQuest sections absent from the previous audit were excluded even when their transcript matched the standard Vanilla baseline.",
        ],
    };
    fs.writeFileSync(path.join(args.output, "report.json"), JSON.stringify(report, null, 2) + "\n");
    fs.writeFileSync(path.join(args.output, "report.md"), `# CatQuest ${pack.version} audit\n\n`
        + `Generated: ${report.generatedAt}\n\n`
        + `- Upstream: ${pack.questCount} quests, ${pack.records.length} sections, ${manifestFiles.length} OGG files.\n`
        + `- Audio validation: PASS; ${totalBytes} bytes checked.\n`
        + `- Text-compatible selection: ${selectedQuestIDs.size} quests, ${selected.length} sections, `
        + `${selectedFiles.size} OGG files (${report.selected.mebibytes} MiB).\n`
        + `- Same: ${text.summary.same}; close: ${text.summary.close}; different: ${text.summary.different}; `
        + `conditional: ${text.summary.conditional}; missing: ${text.summary.missing}.\n`
        + `- Requires unavailable Octo override text: ${text.summary.requiresOctoOverride}.\n`
        + `- Not present in the previous audit: ${text.summary.notPreviouslyAudited}.\n`
        + `- Coverage SHA-256: \`${report.artifacts.coverageSha256}\`.\n`
        + `- Audio manifest SHA-256: \`${report.artifacts.audioManifestSha256}\`.\n`);
    console.log(JSON.stringify(report, null, 2));
}

if (require.main === module) {
    try {
        main();
    } catch (error) {
        console.error(error.stack || error.message || error);
        process.exitCode = 1;
    }
}

module.exports = { compareTexts, expandGameText, jaccard, parseClassicRussianQuests, readPreviousCoverage };
