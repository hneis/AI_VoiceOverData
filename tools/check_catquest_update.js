#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const PROJECT_ID = 1715207;

function versionParts(version) {
    const match = String(version || "").match(/^(\d+)\.(\d+)\.(\d+)$/);
    return match ? match.slice(1).map(Number) : null;
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
    const current = /^## X-CatQuest-Voices-Version:\s*(\S+)/m.exec(toc)?.[1];
    if (!current) throw new Error("Missing X-CatQuest-Voices-Version in TOC");
    const currentFileId = Number(/^## X-CatQuest-Curse-File-ID:\s*(\d+)/m.exec(toc)?.[1]);
    if (!currentFileId) throw new Error("Missing X-CatQuest-Curse-File-ID in TOC");

    const response = await fetch(`https://api.cfwidget.com/${PROJECT_ID}`, {
        headers: { "User-Agent": "AI-VoiceOverData-Vanilla-update-check" },
    });
    if (!response.ok) throw new Error(`CatQuest metadata request failed: HTTP ${response.status}`);
    const project = await response.json();
    const latest = project.download;
    if (!latest || !latest.id || !latest.name) throw new Error("CatQuest metadata has no latest download");
    const version = /^CatQuest_Voices-(\d+\.\d+\.\d+)\.zip$/.exec(latest.name)?.[1]
        || /^\d+\.\d+\.\d+$/.test(latest.display || "") && latest.display;
    if (!version) throw new Error(`Cannot determine CatQuest version from ${latest.name}`);

    const result = {
        current,
        currentFileId,
        latest: version,
        fileId: latest.id,
        fileName: latest.name,
        fileSize: latest.filesize,
        filePage: latest.url,
        update: isNewer(version, current) || Number(latest.id) !== currentFileId,
    };
    console.log(JSON.stringify(result, null, 2));
    if (process.env.GITHUB_OUTPUT) {
        const lines = Object.entries(result).map(([key, value]) => `${key}=${value}`).join("\n") + "\n";
        fs.appendFileSync(process.env.GITHUB_OUTPUT, lines);
    }
}

main().catch(error => {
    console.error(error.stack || error.message || error);
    process.exitCode = 1;
});
