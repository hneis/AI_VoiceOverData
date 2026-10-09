if not VoiceOver or not VoiceOver.DataModules then return end
local module = AI_VoiceOverData_Vanilla
if not module then return end

local en = module.SoundLengthLookupByFileName or {}
local ru = module.RU_SoundLengthLookupByFileName or {}
local catquest = module.CatQuestData or {}
local catquestEntries = catquest.Entries or {}
local inventory = module.HybridInstalledFiles
local lengths, paths, sources, sourceKeys = {}, {}, {}, {}
local stats = { en = 0, ru = 0, catquest = 0, missing = 0, aliases = 0,
    inventoryChecked = inventory ~= nil }
local allKeys = {}
for key in pairs(en) do allKeys[key] = true end
for key in pairs(ru) do allKeys[key] = true end
for key in pairs(catquestEntries) do allKeys[key] = true end

local function audioPath(language, key)
    local ext
    if inventory ~= nil then
        local languageFiles = inventory[language]
        ext = languageFiles and languageFiles[key]
        -- A checked inventory is authoritative: never invent a missing file.
        if ext ~= "mp3" and ext ~= "ogg" then return nil end
    else
        ext = language == "ru" and "ogg" or "mp3"
    end
    local folder = "gossip"
    if string.find(key, "^%d+%-%a+$") or
        string.find(key, "^[mf]%-%d+%-%a+$") then
        folder = "quests"
    end
    return string.format([[generated\sounds\%s\%s\%s.%s]], language, folder, key, ext)
end

local function selectFile(requestedKey, language, sourceKey, manifest)
    local duration = manifest[sourceKey]
    if type(duration) ~= "number" or duration <= 0 then return false end
    local path = audioPath(language, sourceKey)
    if not path then return false end
    lengths[requestedKey] = duration
    paths[requestedKey] = path
    sources[requestedKey] = language
    sourceKeys[requestedKey] = sourceKey
    stats[language] = stats[language] + 1
    if sourceKey ~= requestedKey then stats.aliases = stats.aliases + 1 end
    return true
end

local function selectCatQuest(requestedKey, sourceKey)
    local entry = catquestEntries[sourceKey]
    if type(entry) ~= "table" or type(entry[1]) ~= "number" or entry[1] <= 0 or
        type(entry[2]) ~= "string" or entry[2] == "" then return false end
    lengths[requestedKey] = entry[1]
    paths[requestedKey] = [[generated\sounds\catquest\quests\]] .. entry[2]
    sources[requestedKey] = "catquest"
    sourceKeys[requestedKey] = sourceKey
    stats.catquest = stats.catquest + 1
    if sourceKey ~= requestedKey then stats.aliases = stats.aliases + 1 end
    return true
end

for key in pairs(allKeys) do
    local neutral
    if string.find(key, "^[mf]%-") then neutral = string.sub(key, 3) end
    -- Prefer an audited CatQuest recording, then the same RU variant.
    -- A neutral recording is acceptable for a player-gender key.
    -- Never substitute the opposite player's gender or a different quest stage.
    local found = selectCatQuest(key, key)
    if not found and neutral then found = selectCatQuest(key, neutral) end
    if not found then found = selectFile(key, "ru", key, ru) end
    if not found and neutral then found = selectFile(key, "ru", neutral, ru) end
    if not found then found = selectFile(key, "en", key, en) end
    if not found and neutral then found = selectFile(key, "en", neutral, en) end
    if not found then stats.missing = stats.missing + 1 end
end

module.EN_SoundLengthLookupByFileName = en
module.SoundLengthLookupByFileName = lengths
module.SoundPathLookupByFileName = paths
module.HybridSourceByFileName = sources
module.HybridSourceKeyByFileName = sourceKeys
module.HybridStats = stats

-- Optional diagnostics. These commands do not play or probe sounds.
local function output(text)
    if DEFAULT_CHAT_FRAME and DEFAULT_CHAT_FRAME.AddMessage then
        DEFAULT_CHAT_FRAME:AddMessage("VoiceOver CatQuest/RU/EN: " .. text)
    end
end

if SlashCmdList then
    SLASH_VOICEOVERHYBRID1 = "/voru"
    SlashCmdList["VOICEOVERHYBRID"] = function(message)
        local _, _, key = string.find(message or "", "^%s*(.-)%s*$")
        if not key or key == "" or key == "info" then
            output(string.format("%s | CatQuest=%d | RU=%d | EN=%d | unavailable=%d | inventory=%s",
                module.HybridBuild, stats.catquest, stats.ru, stats.en, stats.missing,
                stats.inventoryChecked and "checked" or "manifest only"))
            output("/voru 33-accept : key, language, duration and actual path")
            return
        end
        -- Match the player's filename selection when a gendered route exists.
        if not string.find(key, "^[mf]%-") and
            VoiceOver.DataModules.AddPlayerGenderToFilename then
            local gendered = VoiceOver.DataModules:AddPlayerGenderToFilename(key)
            if lengths[gendered] then key = gendered end
        end
        if not lengths[key] then
            output(key .. " | no available recording in this module")
            return
        end
        output(string.format("%s | %s | %.3fs", key, string.upper(sources[key]), lengths[key]))
        output("Interface\\AddOns\\AI_VoiceOverData_Vanilla\\" .. paths[key])
    end
end
