#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

function versionParts(version) {
    const match = String(version || "").match(/^(\d+)\.(\d+)\.(\d+)$/);
    return match ? match.slice(1).map(Number) : null;
}

function compareVersions(left, right) {
    const a = versionParts(left);
    const b = versionParts(right);
    if (!a || !b) return String(left).localeCompare(String(right));
    for (let index = 0; index < a.length; index++) {
        if (a[index] !== b[index]) return a[index] - b[index];
    }
    return 0;
}

function fileVersion(file) {
    return /^CatQuest_Voices-(\d+\.\d+\.\d+)\.zip$/.exec(file && file.name || "")?.[1]
        || /^\d+\.\d+\.\d+$/.test(file && file.display || "") && file.display;
}

function latestFile(files) {
    const candidates = (files || []).map(file => ({ file, version: fileVersion(file) }))
        .filter(item => item.version && Number(item.file.id) > 0 && Number(item.file.filesize) > 0);
    candidates.sort((left, right) => compareVersions(right.version, left.version)
        || Number(right.file.id) - Number(left.file.id));
    if (!candidates.length) throw new Error("CatQuest metadata has no valid releases");
    return candidates[0];
}

function isNewer(candidate, current) {
    const left = versionParts(candidate);
    const right = versionParts(current);
    if (!left || !right) return candidate !== current;
    for (let i = 0; i < left.length; i++) {
        if (left[i] !== right[i]) return left[i] > right[i];
    }
    return false;
}

async function main() {
    const addonRoot = path.resolve(__dirname, "..");
    const toc = fs.readFileSync(path.join(addonRoot, "AI_VoiceOverData.toc"), "utf8");
    const legacyToc = fs.readFileSync(path.join(addonRoot, "AI_VoiceOverData_Vanilla.toc"), "utf8");
    if (legacyToc !== toc) throw new Error("CatQuest metadata TOCs are not synchronized");
    const lock = JSON.parse(fs.readFileSync(path.join(addonRoot, "sources.lock.json"), "utf8"));
    const projectID = Number(lock.catquest && lock.catquest.curseForgeProjectId);
    if (!projectID) throw new Error("Missing CatQuest project ID in sources.lock.json");
    const current = /^## X-CatQuest-Voices-Version:\s*(\S+)/m.exec(toc)?.[1];
    if (!current) throw new Error("Missing X-CatQuest-Voices-Version in TOC");
    const currentFileId = Number(/^## X-CatQuest-Curse-File-ID:\s*(\d+)/m.exec(toc)?.[1]);
    if (!currentFileId) throw new Error("Missing X-CatQuest-Curse-File-ID in TOC");
    if (lock.catquest.version !== current || Number(lock.catquest.curseForgeFileId) !== currentFileId) {
        throw new Error("CatQuest TOC metadata does not match sources.lock.json");
    }

    const response = await fetch(`https://api.cfwidget.com/${projectID}`, {
        headers: { "User-Agent": "AI-VoiceOverData-Vanilla-update-check" },
    });
    if (!response.ok) throw new Error(`CatQuest metadata request failed: HTTP ${response.status}`);
    const project = await response.json();
    const candidate = latestFile(project.files);
    const latest = candidate.file;
    const version = candidate.version;

    const result = {
        projectId: projectID,
        current,
        currentFileId,
        latest: version,
        fileId: latest.id,
        fileName: latest.name,
        fileSize: latest.filesize,
        filePage: latest.url,
        uploadedAt: latest.uploaded_at,
        update: isNewer(version, current) || Number(latest.id) !== currentFileId,
    };
    console.log(JSON.stringify(result, null, 2));
    if (process.env.GITHUB_OUTPUT) {
        const lines = Object.entries(result).map(([key, value]) => {
            const output = String(value);
            if (/[\r\n]/.test(output)) throw new Error(`Unsafe GitHub output: ${key}`);
            return `${key}=${output}`;
        }).join("\n") + "\n";
        fs.appendFileSync(process.env.GITHUB_OUTPUT, lines);
    }
}

if (require.main === module) {
    main().catch(error => {
        console.error(error.stack || error.message || error);
        process.exitCode = 1;
    });
}

module.exports = { compareVersions, fileVersion, isNewer, latestFile, versionParts };
