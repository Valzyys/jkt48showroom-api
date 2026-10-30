const fs = require("fs");
const path = require("path");

const BLACKLIST_PATH = path.join(__dirname, "../Discord/channel/blacklist.json");

/**
 * Check if a guild is blacklisted
 * @param {string} guildId - The guild ID to check
 * @returns {boolean} true if blacklisted
 */
function isBlacklisted(guildId) {
  if (!fs.existsSync(BLACKLIST_PATH)) return false;
  try {
    const data = JSON.parse(fs.readFileSync(BLACKLIST_PATH, "utf8"));
    if (!Array.isArray(data)) return false;
    return data.some((entry) => entry.guild_id === guildId);
  } catch {
    return false;
  }
}

/**
 * Get blacklist entry detail for a guild
 * @param {string} guildId
 * @returns {object|null}
 */
function getBlacklistEntry(guildId) {
  if (!fs.existsSync(BLACKLIST_PATH)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(BLACKLIST_PATH, "utf8"));
    return data.find((entry) => entry.guild_id === guildId) || null;
  } catch {
    return null;
  }
}

module.exports = { isBlacklisted, getBlacklistEntry };