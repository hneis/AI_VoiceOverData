#!/usr/bin/env node

const childProcess = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");
const { fileSha256 } = require("./lib/catquest");

const PROJECT_ID = 1715207;

function parseArguments(argv) {
    const result = {};
    for (let index = 2; index < argv.length; index++) {
        const key = argv[index];
        if (!key.startsWith("--")) throw new Error(`Unexpected argument: ${key}`);
        const name = key.slice(2);
        if (argv[index + 1] && !argv[index + 1].startsWith("--")) result[name] = argv[++index];
        else result[name] = true;
    }
    return result;
}

function run(command, args, options = {}) {
    return childProcess.execFileSync(command, args, { stdio: "inherit", ...options });
}

function output(command, args, options = {}) {
    return childProcess.execFileSync(command, args, { encoding: "utf8", ...options }).trim();
}

function requireInside(root, target, label) {
    const relative = path.relative(root, target);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error(`${label} must be inside ${root}`);
    }
}

function safeArchiveEntries(source, detailedSource) {
    const entries = source.split(/\r?\n/).filter(Boolean);
    const seen = new Set();
    let oggFiles = 0;
    for (const entry of entries) {
        if (!/^[\x20-\x7e]+$/.test(entry) || entry.includes("\\") || entry.startsWith("/")
            || entry.split("/").some(part => part === "" || part === "." || part === "..")) {
            throw new Error(`Unsafe ZIP path: ${JSON.stringify(entry)}`);
        }
        if (seen.has(entry)) throw new Error(`Duplicate ZIP path: ${entry}`);
        seen.add(entry);
        if (/^CatQuest_Voices\/Sounds\/q\/[a-z0-9_]+\.ogg$/.test(entry)) oggFiles++;
        else if (!["CatQuest_Voices/CatQuest_Voices.toc", "CatQuest_Voices/Index.lua", "CatQuest_Voices/index.json"].includes(entry)) {
            throw new Error(`Unexpected ZIP entry: ${entry}`);
        }
    }
    for (const required of [
        "CatQuest_Voices/CatQuest_Voices.toc",
        "CatQuest_Voices/Index.lua",
        "CatQuest_Voices/index.json",
    ]) {
        if (!seen.has(required)) throw new Error(`Missing ZIP entry: ${required}`);
    }
    if (!oggFiles) throw new Error("Archive contains no CatQuest OGG files");
    let expandedBytes = null;
    if (detailedSource) {
        const details = detailedSource.split(/\r?\n/).filter(line => line.includes("CatQuest_Voices/"));
        if (details.length !== entries.length) throw new Error("ZIP detail listing count mismatch");
        expandedBytes = 0;
        for (const line of details) {
            const fields = line.trim().split(/\s+/);
            const name = fields[fields.length - 1];
            const bytes = Number(fields[3]);
            if (!fields[0].startsWith("-") || !seen.has(name) || !Number.isSafeInteger(bytes) || bytes < 0) {
                throw new Error(`Unsafe ZIP entry type: ${line}`);
            }
            if (bytes > 64 * 1024 * 1024) throw new Error(`Oversized ZIP entry: ${name}`);
            expandedBytes += bytes;
        }
        if (expandedBytes > 3 * 1024 * 1024 * 1024) throw new Error("Expanded ZIP is too large");
    }
    return { entries: entries.length, oggFiles, expandedBytes };
}

async function metadata(fileID) {
    const response = await fetch(`https://api.cfwidget.com/${PROJECT_ID}`, {
        headers: { "User-Agent": "AI-VoiceOverData-CatQuest-audit" },
    });
    if (!response.ok) throw new Error(`CatQuest metadata request failed: HTTP ${response.status}`);
    const project = await response.json();
    const candidate = fileID
        ? project.files.find(file => Number(file.id) === Number(fileID))
        : project.files.filter(file => /^CatQuest_Voices-\d+\.\d+\.\d+\.zip$/.test(file.name))
            .sort((left, right) => Number(right.id) - Number(left.id))[0];
    if (!candidate) throw new Error(`CatQuest file not found: ${fileID || "latest"}`);
    const version = /^CatQuest_Voices-(\d+\.\d+\.\d+)\.zip$/.exec(candidate.name)?.[1];
    if (!version) throw new Error(`Unexpected CatQuest filename: ${candidate.name}`);
    return { ...candidate, version };
}

async function download(candidate, destination) {
    if (fs.existsSync(destination) && fs.statSync(destination).size === Number(candidate.filesize)) {
        console.log(`Using existing archive: ${destination}`);
        return;
    }
    const first = Math.floor(Number(candidate.id) / 1000);
    const second = String(Number(candidate.id) % 1000).padStart(3, "0");
    const url = `https://edge.forgecdn.net/files/${first}/${second}/${encodeURIComponent(candidate.name)}`;
    const temporary = `${destination}.part`;
    let existing = fs.existsSync(temporary) ? fs.statSync(temporary).size : 0;
    if (existing > Number(candidate.filesize)) {
        fs.rmSync(temporary, { force: true });
        existing = 0;
    }
    console.log(`${existing ? `Resuming at ${existing} bytes` : "Downloading"} ${url}`);
    const headers = { "User-Agent": "AI-VoiceOverData-CatQuest-audit" };
    if (existing) headers.Range = `bytes=${existing}-`;
    let response = await fetch(url, { headers });
    if (existing && response.status !== 206) {
        fs.rmSync(temporary, { force: true });
        existing = 0;
        response = await fetch(url, { headers: { "User-Agent": headers["User-Agent"] } });
    }
    if (!response.ok || !response.body) throw new Error(`CatQuest download failed: HTTP ${response.status}`);
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(temporary, { flags: existing ? "a" : "wx" }));
    const bytes = fs.statSync(temporary).size;
    if (bytes !== Number(candidate.filesize)) throw new Error(`Archive size mismatch: ${bytes}/${candidate.filesize}`);
    fs.renameSync(temporary, destination);
}

function ensureRepository(url, directory, revision) {
    if (!fs.existsSync(path.join(directory, ".git"))) {
        run("git", ["clone", "--filter=blob:none", url, directory]);
    }
    if (revision) {
        try {
            output("git", ["rev-parse", "--verify", `${revision}^{commit}`], { cwd: directory });
        } catch (_) {
            run("git", ["fetch", "--depth", "1", "origin", revision], { cwd: directory });
        }
        run("git", ["checkout", "--detach", revision], { cwd: directory });
    } else {
        const remoteDefault = output("git", ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], { cwd: directory });
        run("git", ["checkout", remoteDefault.replace(/^origin\//, "")], { cwd: directory });
        run("git", ["pull", "--ff-only"], { cwd: directory });
    }
}

function validateRepository(directory, expectedRevision, label) {
    if (!fs.existsSync(path.join(directory, ".git"))) throw new Error(`${label} is not a Git repository: ${directory}`);
    const revision = output("git", ["rev-parse", "HEAD"], { cwd: directory });
    if (expectedRevision && revision !== expectedRevision) {
        throw new Error(`${label} revision mismatch: ${revision}/${expectedRevision}`);
    }
    const status = output("git", ["status", "--porcelain"], { cwd: directory });
    if (status) throw new Error(`${label} worktree is dirty: ${directory}`);
    return revision;
}

async function main() {
    const args = parseArguments(process.argv);
    const addonRoot = path.resolve(__dirname, "..");
    const work = path.resolve(args["work-dir"] || process.env.CATQUEST_WORK_DIR
        || path.join(os.tmpdir(), "ai-voiceover-catquest"));
    const downloads = path.join(work, "downloads");
    const extracted = path.join(work, "extracted");
    const artifacts = path.resolve(args.output || path.join(work, "artifacts"));
    const sources = path.join(work, "sources");
    for (const target of [downloads, extracted, artifacts, sources]) {
        requireInside(work, target, "Work path");
        fs.mkdirSync(target, { recursive: true });
    }

    const candidate = await metadata(args["file-id"]);
    const archive = path.resolve(args.archive || path.join(downloads, candidate.name));
    if (!args.archive) await download(candidate, archive);
    if (!fs.existsSync(archive)) throw new Error(`Missing archive: ${archive}`);
    if (fs.statSync(archive).size !== Number(candidate.filesize)) {
        throw new Error(`Archive size mismatch: ${fs.statSync(archive).size}/${candidate.filesize}`);
    }
    const listing = output("unzip", ["-Z1", archive], { maxBuffer: 16 * 1024 * 1024 });
    const detailedListing = output("zipinfo", ["-l", archive], { maxBuffer: 32 * 1024 * 1024 });
    const archiveContents = safeArchiveEntries(listing, detailedListing);
    run("unzip", ["-tqq", archive]);
    const extraction = path.join(extracted, `catquest-${candidate.id}`);
    requireInside(work, extraction, "Extraction path");
    fs.rmSync(extraction, { recursive: true, force: true });
    fs.mkdirSync(extraction, { recursive: true });
    run("unzip", ["-q", archive, "-d", extraction]);
    const catquest = path.join(extraction, "CatQuest_Voices");

    const octo = path.resolve(args.octo || path.join(sources, "OctoQuestDatabase"));
    const classicRepository = path.resolve(args["classic-repository"] || path.join(sources, "classicdb_ruRU"));
    if (!args.octo) ensureRepository("https://github.com/FrancisEgan/OctoQuestDatabase.git", octo, args["octo-revision"]);
    if (!args["classic-repository"]) {
        ensureRepository("https://github.com/WoWruRU/classicdb_ruRU.git", classicRepository, args["classic-revision"]);
    }
    const octoRevision = validateRepository(octo, args["octo-revision"], "OctoQuestDatabase");
    validateRepository(classicRepository, args["classic-revision"], "classicdb_ruRU");
    const classicRu = path.resolve(args["classic-ru"]
        || path.join(classicRepository, "Full_DB", "ClassicDB_ruRU_1_0_2.sql"));
    const octoRuValue = args["octo-ru"] || process.env.CATQUEST_OCTO_RU;
    const octoRu = octoRuValue && path.resolve(octoRuValue);
    if (octoRu && !fs.existsSync(octoRu)) throw new Error(`Missing RU Octo source: ${octoRu}`);
    const previousCoverageValue = args["previous-coverage"] || process.env.CATQUEST_PREVIOUS_COVERAGE;
    const previousCoverage = previousCoverageValue && path.resolve(previousCoverageValue);
    if (!octoRu && !previousCoverage) {
        throw new Error("Pass --octo-ru for a full audit or --previous-coverage for conservative override exclusion.");
    }
    if (previousCoverage && !fs.existsSync(previousCoverage)) {
        throw new Error(`Missing previous coverage: ${previousCoverage}`);
    }

    const auditArgs = [
        path.join(addonRoot, "tools", "audit_catquest_coverage.js"),
        "--catquest", catquest,
        "--octo", octo,
        "--classic-ru", classicRu,
        "--vanilla", addonRoot,
        "--output", artifacts,
    ];
    if (octoRu) auditArgs.push("--octo-ru", octoRu);
    if (previousCoverage) auditArgs.push("--previous-coverage", previousCoverage);
    if (args["reference-manifest"]) auditArgs.push("--reference-manifest", path.resolve(args["reference-manifest"]));
    run(process.execPath, auditArgs);
    if (args.install) {
        run(process.execPath, [
            path.join(addonRoot, "tools", "build_catquest_overlay.js"),
            path.join(artifacts, "catquest-sections.csv"),
            path.join(artifacts, "forever-audio-manifest.json"),
            path.join(catquest, "Sounds", "q"),
        ]);
        run(process.execPath, [
            path.join(addonRoot, "tools", "build_octowow_quest_text_lookup.js"),
            path.join(octo, "source", "locales.json"),
            path.join(addonRoot, "generated", "quest_id_lookups.lua"),
            path.join(addonRoot, "generated", "catquest_audio.lua"),
            path.join(addonRoot, "generated", "octo_quest_text_lookups.lua"),
            path.join(addonRoot, "generated", "catquest_quest_id_lookups.lua"),
            octoRevision,
        ]);
    }
    const result = {
        version: candidate.version,
        fileId: Number(candidate.id),
        fileName: candidate.name,
        fileSize: Number(candidate.filesize),
        archiveSha256: fileSha256(archive),
        archiveContents,
        archive,
        catquest,
        artifacts,
        installed: Boolean(args.install),
    };
    fs.writeFileSync(path.join(artifacts, "candidate.json"), JSON.stringify(result, null, 2) + "\n");
    console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
    main().catch(error => {
        console.error(error.stack || error.message || error);
        process.exitCode = 1;
    });
}

module.exports = { safeArchiveEntries };
