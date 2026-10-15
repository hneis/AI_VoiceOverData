#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { dataTable } = require("./lib/catquest");

const LOOKUP_NAME = "AI_VoiceOverData_Vanilla.QuestIDLookup";

function compactText(text) {
    const words = String(text || "").trim().split(/\s+/).filter(Boolean);
    return words.slice(0, 15).join(" ") + " " + words.slice(-15).join(" ");
}

function normalizeTitle(title) {
    return String(title || "").replace(/"/g, "'");
}

function compareStrings(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}

function luaString(value) {
    return '"' + value.replace(/[\\"\x00-\x1f\x7f]/g, character => {
        if (character === "\\" || character === '"') return "\\" + character;
        return "\\" + character.charCodeAt(0).toString().padStart(3, "0");
    }) + '"';
}

function collectIDs(value, result = new Set()) {
    if (typeof value === "number") result.add(value);
    else if (value && typeof value === "object") {
        for (const nested of Object.values(value)) collectIDs(nested, result);
    }
    return result;
}

function selectedAcceptIDs(file) {
    const source = fs.readFileSync(file, "utf8");
    const result = new Set();
    for (const match of source.matchAll(/\["(?:[mf]-)?(\d+)-accept"\]\s*=\s*\{/g)) {
        result.add(Number(match[1]));
    }
    if (!result.size) throw new Error(`No CatQuest accept routes found in ${file}`);
    return result;
}

function buildLookupData(localesFile, baseLookupFile, catquestDataFile, sourceRevision) {
    const quests = JSON.parse(fs.readFileSync(localesFile, "utf8")).quests;
    const base = dataTable(baseLookupFile, LOOKUP_NAME);
    if (!base.accept || typeof base.accept !== "object") throw new Error("Missing base accept lookup");
    const selectedIDs = selectedAcceptIDs(catquestDataFile);
    const recordsByTitle = new Map();
    for (const [rawID, quest] of Object.entries(quests)) {
        const id = Number(rawID);
        if (!Number.isInteger(id) || id <= 0 || !quest || typeof quest.T !== "string" || !quest.T) continue;
        const title = normalizeTitle(quest.T);
        if (!recordsByTitle.has(title)) recordsByTitle.set(title, []);
        recordsByTitle.get(title).push({ id, text: quest.D });
    }

    const selectedTitles = new Map();
    const overrides = new Map();
    const ambiguousTitles = new Set();
    for (const [title, value] of Object.entries(base.accept)) {
        if (value && typeof value === "object") ambiguousTitles.add(normalizeTitle(title));
    }
    for (const id of Array.from(selectedIDs).sort((left, right) => left - right)) {
        const quest = quests[id];
        if (!quest || typeof quest.T !== "string" || !quest.T) {
            throw new Error(`Missing Octo title for selected CatQuest quest ${id}`);
        }
        const title = normalizeTitle(quest.T);
        selectedTitles.set(id, title);
        const records = recordsByTitle.get(title) || [];
        const globalIDs = new Set(records.map(record => record.id));
        const existing = base.accept[title];
        const existingIDs = collectIDs(existing);
        if (globalIDs.size > 1) {
            ambiguousTitles.add(title);
            // Replace legacy NPC routes: Octo may use different quest givers for the
            // same title, so only the current text database may disambiguate it.
            overrides.set(title, {});
        } else if (!existingIDs.has(id)) {
            overrides.set(title, id);
        }
    }

    const textTitles = [];
    let textRouteCount = 0;
    let blockedCount = 0;
    for (const title of ambiguousTitles) {
        const records = (recordsByTitle.get(title) || [])
            .filter(record => typeof record.text === "string" && record.text.trim());
        if (!records.length) continue;
        const byText = new Map();
        for (const record of records) {
            const text = compactText(record.text).replace(/"/g, "'");
            if (!byText.has(text)) byText.set(text, []);
            byText.get(text).push(record.id);
        }
        const routes = [];
        for (const [text, ids] of byText) {
            const uniqueIDs = Array.from(new Set(ids));
            const id = uniqueIDs.length === 1 ? uniqueIDs[0] : 0;
            routes.push({ text, id });
            if (id) textRouteCount++;
            else blockedCount++;
        }
        routes.sort((left, right) => compareStrings(left.text, right.text));
        textTitles.push({ title, routes });
    }
    textTitles.sort((left, right) => compareStrings(left.title, right.title));

    const reachableIDs = new Set();
    const blockedSelectedIDs = new Set();
    for (const [id, title] of selectedTitles) {
        const route = overrides.has(title) ? overrides.get(title) : base.accept[title];
        if (typeof route === "number") {
            if (route !== id) throw new Error(`Selected title resolves to another quest: ${title} -> ${route}/${id}`);
            reachableIDs.add(id);
        } else if (route && typeof route === "object") {
            const textTitle = textTitles.find(entry => entry.title === title);
            const routeIDs = new Set(textTitle && textTitle.routes.map(entry => entry.id));
            if (routeIDs.has(id)) reachableIDs.add(id);
            else blockedSelectedIDs.add(id);
        } else {
            throw new Error(`Selected quest is unreachable: ${id} / ${title}`);
        }
    }

    return {
        sourceRevision,
        selectedIDs,
        selectedTitles,
        reachableIDs,
        blockedSelectedIDs,
        overrides,
        textTitles,
        textRouteCount,
        blockedCount,
    };
}

function renderCatQuestLookup(data) {
    const overrideEntries = Array.from(data.overrides).sort(([left], [right]) => compareStrings(left, right));
    const directCount = overrideEntries.filter(([, route]) => typeof route === "number").length;
    const ambiguousCount = overrideEntries.length - directCount;
    const lines = [
        "-- Generated by tools/build_octowow_quest_text_lookup.js; do not edit manually.",
        "AI_VoiceOverData_Vanilla.CatQuestQuestLookup = {",
        "    SchemaVersion = 1,",
        `    SourceRevision = ${luaString(data.sourceRevision)},`,
        `    SelectedAcceptCount = ${data.selectedIDs.size},`,
        `    ReachableAcceptCount = ${data.reachableIDs.size},`,
        `    BlockedAcceptCount = ${data.blockedSelectedIDs.size},`,
        `    AddedTitleCount = ${overrideEntries.length},`,
        `    AddedDirectCount = ${directCount},`,
        `    AddedAmbiguousCount = ${ambiguousCount},`,
        "    SelectedTitles = {",
    ];
    for (const [id, title] of data.selectedTitles) lines.push(`        [${id}] = ${luaString(title)},`);
    lines.push("    },", "    ReachableIDs = {");
    for (const id of data.reachableIDs) lines.push(`        [${id}] = true,`);
    lines.push("    },", "    BlockedIDs = {");
    for (const id of data.blockedSelectedIDs) lines.push(`        [${id}] = true,`);
    lines.push("    },", "    Routes = {");
    for (const [title, route] of overrideEntries) {
        lines.push(`        [${luaString(title)}] = ${typeof route === "number" ? route : "{}"},`);
    }
    lines.push(
        "    },",
        "}",
        "local questLookup = AI_VoiceOverData_Vanilla.QuestIDLookup",
        "local acceptLookup = questLookup and questLookup[\"accept\"]",
        "if acceptLookup then",
        "    for title, route in pairs(AI_VoiceOverData_Vanilla.CatQuestQuestLookup.Routes) do",
        "        acceptLookup[title] = route",
        "    end",
        "end",
        "",
    );
    return lines.join("\n");
}

function renderTextLookup(data) {
    const lines = [
        "-- Generated by tools/build_octowow_quest_text_lookup.js; do not edit manually.",
        "-- ID 0 marks text that is not unique and must not fall back to another quest stage.",
        "AI_VoiceOverData_Vanilla.OctoQuestTextLookup = {",
        "    SchemaVersion = 1,",
        `    SourceRevision = ${luaString(data.sourceRevision)},`,
        `    TitleCount = ${data.textTitles.length},`,
        `    RouteCount = ${data.textRouteCount},`,
        `    BlockedCount = ${data.blockedCount},`,
        "    Routes = {",
    ];
    for (const entry of data.textTitles) {
        lines.push(`        [${luaString(entry.title)}] = {`);
        for (const route of entry.routes) lines.push(`            [${luaString(route.text)}] = ${route.id},`);
        lines.push("        },");
    }
    lines.push("    },", "}", "");
    return lines.join("\n");
}

function main() {
    const localesFile = process.argv[2];
    const baseLookupFile = process.argv[3];
    const catquestDataFile = process.argv[4];
    const textOutputFile = process.argv[5] || path.resolve(__dirname, "..", "generated", "octo_quest_text_lookups.lua");
    const catquestOutputFile = process.argv[6] || path.resolve(__dirname, "..", "generated", "catquest_quest_id_lookups.lua");
    const sourceRevision = process.argv[7] || "unknown";
    if (!localesFile || !baseLookupFile || !catquestDataFile) {
        throw new Error("Usage: node tools/build_octowow_quest_text_lookup.js <locales.json> <quest_id_lookups.lua> <catquest_audio.lua> [text-output.lua] [catquest-output.lua] [source-revision]");
    }
    const data = buildLookupData(localesFile, baseLookupFile, catquestDataFile, sourceRevision);
    fs.writeFileSync(textOutputFile, renderTextLookup(data));
    fs.writeFileSync(catquestOutputFile, renderCatQuestLookup(data));
    console.log(`Wrote ${textOutputFile}: ${data.textTitles.length} titles, ${data.textRouteCount} unique routes, ${data.blockedCount} blocked texts`);
    console.log(`Wrote ${catquestOutputFile}: ${data.selectedIDs.size} selected accepts, ${data.reachableIDs.size} reachable, ${data.blockedSelectedIDs.size} safely blocked, ${data.overrides.size} added title routes`);
}

if (require.main === module) main();

module.exports = {
    buildLookupData,
    collectIDs,
    compactText,
    compareStrings,
    normalizeTitle,
    renderCatQuestLookup,
    renderTextLookup,
    selectedAcceptIDs,
};
