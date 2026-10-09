if not VoiceOver or not VoiceOver.DataModules then return end

local DataModules = VoiceOver.DataModules
local MIN_TEXT_SIMILARITY = 0.45

local function replaceDoubleQuotes(text)
    return string.gsub(text or "", '"', "'")
end

local function compactText(text)
    local words = {}
    for word in string.gmatch(text or "", "%S+") do
        table.insert(words, word)
    end
    local count = table.getn(words)
    local first = table.concat(words, " ", 1, math.min(15, count))
    local last = table.concat(words, " ", math.max(1, count - 14), count)
    return replaceDoubleQuotes(first .. " " .. last)
end

local function addText(entries, text, id)
    if type(text) ~= "string" or type(id) ~= "number" then return end
    local existing = entries[text]
    if existing == nil then
        entries[text] = id
    elseif existing ~= id then
        entries[text] = 0
    end
end

local function addTextTable(entries, source)
    if type(source) ~= "table" then return end
    for text, id in pairs(source) do
        addText(entries, text, id)
    end
end

local function textTokens(text)
    local tokens = {}
    for token in string.gmatch(text or "", "%S+") do tokens[token] = true end
    return tokens
end

local function jaccardSimilarity(left, right)
    local a, b = textTokens(left), textTokens(right)
    local intersection, union = 0, 0
    for token in pairs(a) do
        union = union + 1
        if b[token] then intersection = intersection + 1 end
    end
    for token in pairs(b) do if not a[token] then union = union + 1 end end
    return union > 0 and intersection / union or 0
end

local function bestTextID(query, entries)
    local similarityByID = {}
    for candidate, id in pairs(entries) do
        local similarity = jaccardSimilarity(query, candidate)
        if similarityByID[id] == nil or similarity > similarityByID[id] then
            similarityByID[id] = similarity
        end
    end

    local bestID, bestSimilarity, secondSimilarity = nil, -1, -1
    local tied = false
    for id, similarity in pairs(similarityByID) do
        if similarity > bestSimilarity then
            secondSimilarity = bestSimilarity
            bestID, bestSimilarity, tied = id, similarity, false
        elseif similarity == bestSimilarity then
            tied = true
        elseif similarity > secondSimilarity then
            secondSimilarity = similarity
        end
    end
    if bestSimilarity < MIN_TEXT_SIMILARITY then return nil end
    if tied then return 0 end
    if bestSimilarity < 1 and secondSimilarity >= 0 and bestSimilarity - secondSimilarity < 0.10 then return 0 end
    return bestID
end

DataModules.QuestIDResolverVersion = "1.0.0"

function DataModules:GetQuestID(source, title, npcName, text)
    local cleanedTitle = replaceDoubleQuotes(title)
    local cleanedNPCName = replaceDoubleQuotes(npcName)
    local cleanedText = compactText(text)
    for _, module in self:GetModules() do
        local data = module.QuestIDLookup
        local sourceLookup = data and data[source]
        local titleLookup = sourceLookup and sourceLookup[cleanedTitle]
        if type(titleLookup) == "number" then
            return titleLookup
        elseif type(titleLookup) == "table" then
            local exactNPCText = {}
            local octoText = {}
            local globalText = {}
            local npcLookup = titleLookup[cleanedNPCName]
            if type(npcLookup) == "number" then
                return npcLookup
            elseif type(npcLookup) == "table" then
                addTextTable(exactNPCText, npcLookup)
            end

            addTextTable(globalText, titleLookup["Modo4"])
            for key, value in pairs(titleLookup) do
                if key ~= "Modo4" and type(value) == "table" then
                    addTextTable(globalText, value)
                end
            end

            if source == "accept" then
                local octo = module.OctoQuestTextLookup
                local routes = octo and octo.Routes and octo.Routes[cleanedTitle]
                addTextTable(octoText, routes)
            end

            local id = bestTextID(cleanedText, exactNPCText)
            if id ~= nil then return id end
            id = bestTextID(cleanedText, octoText)
            if id ~= nil then return id end
            id = bestTextID(cleanedText, globalText)
            if id ~= nil then return id end
        end
    end
    return nil
end
