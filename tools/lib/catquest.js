const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const lua = require("luaparse");

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

function variableName(node) {
    if (!node) return null;
    if (node.type === "Identifier") return node.name;
    if (node.type === "MemberExpression") {
        const base = variableName(node.base);
        const member = node.identifier && node.identifier.name;
        return base && member ? `${base}.${member}` : null;
    }
    if (node.type === "IndexExpression" && node.index && typeof node.index.value === "string") {
        const base = variableName(node.base);
        return base ? `${base}.${node.index.value}` : null;
    }
    return null;
}

function decodeTable(node, file) {
    if (node.type === "TableConstructorExpression") {
        const result = {};
        let arrayIndex = 0;
        for (const field of node.fields) {
            const key = field.key && (field.key.name !== undefined ? field.key.name : field.key.value);
            const resolved = key === undefined || key === null ? ++arrayIndex : key;
            if (Object.prototype.hasOwnProperty.call(result, resolved)) {
                throw new Error(`Duplicate Lua table key ${resolved} in ${file}`);
            }
            result[resolved] = decodeTable(field.value, file);
        }
        return result;
    }
    if (typeof node.value === "string") return Buffer.from(node.value, "latin1").toString("utf8");
    if (["NumericLiteral", "BooleanLiteral", "NilLiteral"].includes(node.type)) return node.value;
    if (node.type === "UnaryExpression" && node.operator === "-" && node.argument.type === "NumericLiteral") {
        return -node.argument.value;
    }
    throw new Error(`Unsupported Lua data expression ${node.type} in ${file}`);
}

function dataTable(file, expectedName) {
    const ast = lua.parse(fs.readFileSync(file, "latin1"), { encodingMode: "pseudo-latin1" });
    const tables = ast.body.filter(node => node.type === "AssignmentStatement"
        && node.init.length === 1 && node.init[0].type === "TableConstructorExpression")
        .map(node => ({ name: variableName(node.variables[0]), value: node.init[0] }));
    const matches = expectedName ? tables.filter(item => item.name === expectedName) : tables;
    if (expectedName && matches.length !== 1) {
        throw new Error(`Expected one ${expectedName} table in ${file}, found ${matches.length}`);
    }
    if (!matches.length) throw new Error(`Missing data table in ${file}`);
    return decodeTable(matches[matches.length - 1].value, file);
}

function sha256(buffer) {
    return crypto.createHash("sha256").update(buffer).digest("hex");
}

function fileSha256(file) {
    return sha256(fs.readFileSync(file));
}

function oggMetadata(buffer) {
    let offset = 0;
    let rate;
    let channels;
    let nominalBitrate;
    let serial;
    let granule = 0n;
    let ended = false;
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
            if (size < 24 || buffer[packet] !== 1
                || buffer.toString("ascii", packet + 1, packet + 7) !== "vorbis") {
                throw new Error("Expected Vorbis identification packet");
            }
            channels = buffer[packet + 11];
            rate = buffer.readUInt32LE(packet + 12);
            nominalBitrate = buffer.readInt32LE(packet + 20);
        } else if (serial !== currentSerial) {
            throw new Error("Chained OGG stream");
        }
        const position = buffer.readBigUInt64LE(offset + 6);
        if (position !== 0xffffffffffffffffn) granule = position;
        ended = (buffer[offset + 5] & 4) !== 0;
        offset = packet + size;
    }
    if (!ended || !rate || granule <= 0n) throw new Error("Incomplete OGG stream");
    return {
        duration: Number((Number(granule) / rate).toFixed(6)),
        channels,
        sampleRate: rate,
        nominalBitrate,
    };
}

function assertAllowedKeys(value, allowed, label) {
    for (const key of Object.keys(value || {})) {
        if (!allowed.has(key)) throw new Error(`Unexpected ${label} field: ${key}`);
    }
}

function cueText(entry, variant) {
    const cues = entry && entry.c && entry.c[variant];
    if (!cues || typeof cues !== "object") return null;
    const text = Object.keys(cues).sort((a, b) => Number(a) - Number(b)).map(key => {
        const cue = cues[key];
        return cue && (cue[2] || cue[1]);
    });
    if (!text.length || text.some(value => typeof value !== "string" || !value.trim())) return null;
    return text.map(value => value.trim()).join(" ");
}

function catquestRecords(packDirectory) {
    const toc = fs.readFileSync(path.join(packDirectory, "CatQuest_Voices.toc"), "utf8");
    const version = /^##\s*Version:\s*(\S+)/m.exec(toc)?.[1];
    if (!/^\d+\.\d+\.\d+$/.test(version || "")) throw new Error("Invalid CatQuest version");
    const pack = dataTable(path.join(packDirectory, "Index.lua"), "CatQuestVoicePack.quests");
    const json = JSON.parse(fs.readFileSync(path.join(packDirectory, "index.json"), "utf8"));
    const allowedQuest = new Set(["d", "g", "v", "n", "c", "m", "t"]);
    const allowedSection = new Set(["d", "g", "v", "n", "c", "m"]);
    const records = [];
    const questIDs = Object.keys(pack);
    for (const rawID of questIDs) {
        if (!/^\d+$/.test(rawID) || Number(rawID) <= 0) throw new Error(`Invalid CatQuest quest ID: ${rawID}`);
        const quest = pack[rawID];
        if (!quest || typeof quest !== "object") throw new Error(`Invalid CatQuest quest record: ${rawID}`);
        assertAllowedKeys(quest, allowedQuest, `quest ${rawID}`);
        for (const [stage, entry, stem] of [
            ["accept", quest.d == null ? null : quest, rawID],
            ["complete", quest.t, `${rawID}_t`],
        ]) {
            if (!entry) continue;
            assertAllowedKeys(entry, stage === "accept" ? allowedQuest : allowedSection, `${rawID}-${stage}`);
            if (!Number.isFinite(entry.d) || entry.d <= 0) throw new Error(`Invalid indexed duration: ${rawID}-${stage}`);
            if (entry.g !== undefined && entry.g !== 1 && entry.g !== true) {
                throw new Error(`Unsupported gender marker: ${rawID}-${stage}`);
            }
            if (entry.v !== undefined && typeof entry.v !== "string") throw new Error(`Invalid voice: ${rawID}-${stage}`);
            if (entry.m !== undefined && typeof entry.m !== "string") throw new Error(`Invalid model: ${rawID}-${stage}`);
            const variants = entry.g ? ["m", "f"] : ["x"];
            for (const variant of variants) {
                if (!cueText(entry, variant)) throw new Error(`Missing transcript: ${rawID}-${stage}-${variant}`);
            }
            records.push({
                id: Number(rawID), stage, entry, variants,
                files: variants.map(variant => `${stem}${variant === "x" ? "" : `_${variant}`}.ogg`),
            });
        }
    }
    const jsonIDs = Object.keys(json).filter(key => /^\d+$/.test(key));
    if (jsonIDs.length !== questIDs.length || jsonIDs.some(id => !pack[id])) {
        throw new Error(`Index.lua/index.json quest mismatch: ${questIDs.length}/${jsonIDs.length}`);
    }
    records.sort((left, right) => left.id - right.id || left.stage.localeCompare(right.stage));
    return { version, records, questCount: questIDs.length, json };
}

module.exports = {
    catquestRecords,
    cueText,
    dataTable,
    fileSha256,
    oggMetadata,
    sha256,
};
