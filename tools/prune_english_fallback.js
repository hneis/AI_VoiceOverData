#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");

const addonRoot = path.resolve(__dirname, "..");
const apply = process.argv.includes("--apply");
const questKey = /^(?:[mf]-)?\d+-(?:accept|progress|complete)$/;

function manifest(file) {
    const source = fs.readFileSync(file, "utf8");
    const result = new Set();
    for (const match of source.matchAll(/\["([a-z0-9-]+)"\]\s*=\s*([0-9]+(?:\.[0-9]+)?)/g)) {
        if (Number(match[2]) > 0) result.add(match[1]);
    }
    return result;
}

function inventory(language) {
    const result = new Map();
    for (const folder of ["quests", "gossip"]) {
        const directory = path.join(addonRoot, "generated", "sounds", language, folder);
        for (const file of fs.readdirSync(directory)) {
            const match = /^([a-z0-9-]+)\.(mp3|ogg)$/i.exec(file);
            if (!match) continue;
            const key = match[1].toLowerCase();
            if (fs.statSync(path.join(directory, file)).size > 0) {
                result.set(key, { file, folder, path: path.join(directory, file) });
            }
        }
    }
    return result;
}

function select(key, manifests, installed) {
    const neutral = /^[mf]-/.test(key) ? key.slice(2) : null;
    const candidates = [["ru", key]];
    if (neutral) candidates.push(["ru", neutral]);
    candidates.push(["en", key]);
    if (neutral) candidates.push(["en", neutral]);
    for (const [language, source] of candidates) {
        if (manifests[language].has(source) && installed[language].has(source)) return { language, source };
    }
    return null;
}

function main() {
    const manifests = {
        en: manifest(path.join(addonRoot, "generated", "sound_length_table.lua")),
        ru: manifest(path.join(addonRoot, "generated", "sound_length_table_ru.lua")),
    };
    const installed = { en: inventory("en"), ru: inventory("ru") };
    const keys = new Set([...manifests.en, ...manifests.ru]);
    const keep = new Set();
    let enRoutes = 0, ruRoutes = 0, aliases = 0;
    const missing = [];
    for (const key of keys) {
        const selected = select(key, manifests, installed);
        if (!selected) {
            missing.push(key);
            continue;
        }
        if (selected.language === "en") {
            enRoutes++;
            keep.add(installed.en.get(selected.source).path);
        } else {
            ruRoutes++;
        }
        if (selected.source !== key) aliases++;
    }
    if (missing.length) throw new Error(`Refusing to prune: ${missing.length} routes are already unavailable`);

    const remove = [];
    let keptBytes = 0, removedBytes = 0;
    for (const entry of installed.en.values()) {
        const bytes = fs.statSync(entry.path).size;
        if (keep.has(entry.path)) keptBytes += bytes;
        else {
            remove.push(entry.path);
            removedBytes += bytes;
        }
    }
    if (apply) {
        for (const file of remove) fs.rmSync(file);
        childProcess.execFileSync(process.env.PYTHON || "python", ["CheckAudio.py"], {
            cwd: addonRoot,
            stdio: "inherit",
        });
    }
    const result = {
        mode: apply ? "applied" : "dry-run",
        policy: "preserve the complete RU-to-EN base fallback independently of CatQuest",
        routes: { ru: ruRoutes, en: enRoutes, aliases, missing: 0 },
        englishFiles: { before: installed.en.size, kept: keep.size, removed: remove.length },
        mebibytes: {
            kept: Number((keptBytes / 1024 / 1024).toFixed(1)),
            removed: Number((removedBytes / 1024 / 1024).toFixed(1)),
        },
    };
    console.log(JSON.stringify(result, null, 2));
}

main();
