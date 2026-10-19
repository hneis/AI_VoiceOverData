if not VoiceOver or not VoiceOver.DataModules then return end

AI_VoiceOverData_Vanilla = {}
local module = AI_VoiceOverData_Vanilla
module.HybridBuild = "en-ui-catquest-ru-en-1.1.2"
module.Version = "1.1.2"

-- The player still resolves the EN quest/gossip key and player-gender variant.
-- Hybrid.lua gives each key its own CatQuest/RU/EN audio path and matching duration.
-- No changes to GetLocale(), the client language or the VoiceOver player.
function module:GetSoundPath(fileName, event)
    return self.SoundPathLookupByFileName and self.SoundPathLookupByFileName[fileName]
end

local moduleName = VoiceOver.DataModules:GetPresentModule("AI_VoiceOverData") and
    "AI_VoiceOverData" or "AI_VoiceOverData_Vanilla"
VoiceOver.DataModules:Register(moduleName, module)
