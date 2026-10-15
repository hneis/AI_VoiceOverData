table.getn = table.getn or function(t)
    local count = 0
    for _ in ipairs(t) do count = count + 1 end
    return count
end

VoiceOver = {}
local modules = {}
VoiceOver.DataModules = {
    GetPresentModule = function(self, name)
        return name == "AI_VoiceOverData"
    end,
    Register = function(self, name, module)
        module.METADATA = { AddonName = name }
        table.insert(modules, module)
    end,
    GetModules = function(self)
        return ipairs(modules)
    end,
}

dofile("Module.lua")
dofile("generated/quest_id_lookups.lua")
dofile("generated/catquest_quest_id_lookups.lua")
dofile("generated/octo_quest_text_lookups.lua")
dofile("QuestIDResolver.lua")

local module = AI_VoiceOverData_Vanilla
local resolver = VoiceOver.DataModules
local routes = module.OctoQuestTextLookup.Routes
local catquestLookup = module.CatQuestQuestLookup

assert(resolver:GetQuestID("accept", "Ledger from Tanaris", "", "") == 4450,
    "Ledger from Tanaris is not reachable from the quest log")
assert(resolver:GetQuestID("accept", "Trinkets...", "", "") == 3481,
    "Trinkets is not reachable from the quest log")

local function textFor(title, id)
    for text, value in pairs(routes[title]) do
        if value == id then return text end
    end
    error("Missing generated route for " .. title .. " / " .. tostring(id))
end

local selectedAccepts, reachableAccepts, blockedAccepts = 0, 0, 0
for id, title in pairs(catquestLookup.SelectedTitles) do
    selectedAccepts = selectedAccepts + 1
    if catquestLookup.ReachableIDs[id] then
        reachableAccepts = reachableAccepts + 1
        local titleLookup = module.QuestIDLookup.accept[title]
        if type(titleLookup) == "number" then
            assert(titleLookup == id, "Direct CatQuest title route points to another ID")
            assert(resolver:GetQuestID("accept", title, "", "") == id,
                "Direct CatQuest runtime route failed for " .. title .. " / " .. tostring(id))
        else
            assert(type(titleLookup) == "table", "Missing CatQuest title route for " .. tostring(id))
            local text = textFor(title, id)
            assert(resolver:GetQuestID("accept", title, "", text) == id,
                "CatQuest text route failed for " .. title .. " / " .. tostring(id))
        end
    elseif catquestLookup.BlockedIDs[id] then
        blockedAccepts = blockedAccepts + 1
        local titleLookup = module.QuestIDLookup.accept[title]
        assert(type(titleLookup) == "table" and next(titleLookup) == nil,
            "Blocked CatQuest title retained unsafe legacy NPC routes: " .. title)
        local blockedText = nil
        for text, routeID in pairs(routes[title] or {}) do
            if routeID == 0 then blockedText = text break end
        end
        assert(blockedText ~= nil, "Blocked CatQuest title has no blocked text: " .. title)
        assert(resolver:GetQuestID("accept", title, "Any NPC", blockedText) == 0,
            "Blocked CatQuest route selected another quest: " .. title)
    else
        error("Selected CatQuest accept has no reachability state: " .. tostring(id))
    end
end
assert(selectedAccepts == catquestLookup.SelectedAcceptCount, tostring(selectedAccepts))
assert(reachableAccepts == catquestLookup.ReachableAcceptCount, tostring(reachableAccepts))
assert(blockedAccepts == catquestLookup.BlockedAcceptCount, tostring(blockedAccepts))
assert(resolver:GetQuestID("accept", "Wanted:  \"Hogger\"", "", "") == 176,
    "Quoted quest title normalization regressed")

local reported = {
    { "Farren's Proof", 559, "Lieutenant Farren Orinelle",
        "Would you believe it, $N? Redpath wasn't satisfied with all the murlocs we killed--oh now, don't be modest, you had some hand in it. Now he wants me to bring proof of the dead, hacking off cold, slimy murloc heads to submit for his approval." },
    { "Hints of a New Plague?", 659, "Phin Odelic",
        "Hail, and well met, $N. I lead a group of adventurers investigating odd happenings in this area.$B$BMy cousin in Hillsbrad recently put down his dog Stanley because the animal mystically grew to an immense size and savagely attacked anyone who came near him.$B$BI believe the undead are involved, and we're looking for signs to prove as much.$B$BTwo of my companions, Quae and Kinelory, headed to the Go'Shek Farm in the Arathi Highlands, and haven't checked in for days. Find them for me? I grow concerned." },
    { "The Missing Diplomat", 1264, "Mikhail",
        "The beginning of every month the Kul Tiras Marines all get paid and usually leave Theramore for somewhere else. A lot of them come here to womanize, carouse, and just have a good time. One of those groups I'd consider regulars here at the tavern, and I believe this Hendel is among them.$B$BCommander Samaul in Theramore would be able to help you find him if Hendel's still stationed there. He's completely loyal to Proudmoore, but if you drop Elling's name, he should help you out... discretely." },
}
for _, test in ipairs(reported) do
    local title, id, npc, text = test[1], test[2], test[3], test[4]
    assert(resolver:GetQuestID("accept", title, "Локализованное имя NPC", text) == id,
        "Text fallback failed for " .. title .. " / " .. tostring(id))
    assert(resolver:GetQuestID("accept", title, npc, text) == id,
        "Exact NPC failed for " .. title .. " / " .. tostring(id))
end

local unique, blocked = 0, 0
for title, titleRoutes in pairs(routes) do
    for text, id in pairs(titleRoutes) do
        local resolved = resolver:GetQuestID("accept", title, "Локализованное имя NPC", text)
        if id > 0 then
            unique = unique + 1
            assert(resolved == id,
                string.format("Generated route failed: %s expected %d got %s", title, id, tostring(resolved)))
        else
            blocked = blocked + 1
            assert(resolved == 0,
                string.format("Ambiguous text was not blocked: %s got %s", title, tostring(resolved)))
        end
    end
end

assert(unique == module.OctoQuestTextLookup.RouteCount, tostring(unique))
assert(blocked == module.OctoQuestTextLookup.BlockedCount, tostring(blocked))
assert(unique == 937, tostring(unique))
assert(blocked == 92, tostring(blocked))

modules = {
    {
        QuestIDLookup = { accept = { ["Priority Test"] = { ["NPC"] = { ["alpha beta gamma"] = 101 } } } },
    },
    {
        QuestIDLookup = { accept = { ["Priority Test"] = 202 } },
    },
}
assert(resolver:GetQuestID("accept", "Priority Test", "NPC", "alpha beta gamma") == 101,
    "Higher-priority text route lost to lower-priority numeric route")

modules = {
    {
        QuestIDLookup = { accept = { ["Tie Test"] = {
            ["One"] = { ["alpha beta gamma"] = 301 },
            ["Two"] = { ["alpha beta delta"] = 302 },
        } } },
    },
}
assert(resolver:GetQuestID("accept", "Tie Test", "Unknown", "alpha beta theta") == 0,
    "Equal fuzzy candidates were not blocked")
assert(resolver:GetQuestID("accept", "Tie Test", "Unknown", "alpha beta gamma") == 301,
    "Exact text lost to a similar candidate")
assert(resolver:GetQuestID("accept", "Tie Test", "Unknown", "unrelated words") == nil,
    "Below-threshold text selected a quest")

modules = {
    {
        QuestIDLookup = { accept = { ["Same ID Test"] = {
            ["One"] = { ["alpha beta gamma"] = 401 },
            ["Two"] = { ["alpha beta delta"] = 401 },
        } } },
    },
}
assert(resolver:GetQuestID("accept", "Same ID Test", "Unknown", "alpha beta theta") == 401,
    "Same-ID fuzzy alternatives were treated as ambiguity")

modules = { module }
assert(resolver:GetQuestID("complete", "Farren's Proof", "Marshal Redpath", "irrelevant") == 560,
    "Complete-stage exact NPC route regressed")

print(string.format("quest resolver passed: %d unique text routes, %d blocked texts, %d/%d reachable CatQuest accepts",
    unique, blocked, reachableAccepts, selectedAccepts))
