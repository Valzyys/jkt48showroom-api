const fs = require("fs");
const path = require("path");

const BLACKLIST_PATH = path.join(__dirname, "../../Discord/channel/blacklist.json");
const NOTIF_PATH = path.join(__dirname, "../../Discord/channel/idn-notif.json");

// Helper: read JSON file safely
function readJSON(filePath, defaultValue = []) {
  if (!fs.existsSync(filePath)) return defaultValue;
  try {
    const data = fs.readFileSync(filePath, "utf8");
    return JSON.parse(data);
  } catch {
    return defaultValue;
  }
}

// Helper: write JSON file safely
function writeJSON(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

module.exports = {
  name: "blacklist",
  description: "Manage server blacklist for live notifications",
  dm_permission: true, // ✅ Izinkan penggunaan di DM
  options: [
    {
      name: "add",
      type: 1, // SUB_COMMAND
      description: "Blacklist a server so the bot won't send notifications",
      options: [
        {
          name: "server_id",
          type: 3, // STRING
          description: "The Server ID to blacklist (leave empty to blacklist current server)",
          required: false,
        },
      ],
    },
    {
      name: "remove",
      type: 1, // SUB_COMMAND
      description: "Remove a server from the blacklist",
      options: [
        {
          name: "server_id",
          type: 3, // STRING
          description: "The Server ID to remove from blacklist",
          required: false,
        },
      ],
    },
    {
      name: "list",
      type: 1, // SUB_COMMAND
      description: "Show all blacklisted servers and servers the bot has joined",
    },
  ],

  execute: async (interaction) => {
    const OWNER_ID = "1003187408751308851";

    // ⚠️ Only the bot owner can use this command
    if (interaction.user.id !== OWNER_ID) {
      return await interaction.reply({
        content: "❌ Only the bot owner can use this command.",
        flags: 64,
      });
    }

    // Cek apakah dari DM — flags: 64 (ephemeral) tidak bisa dipakai di DM, kirim biasa
    const isDM = !interaction.guild;

    await interaction.deferReply(isDM ? {} : { flags: 64 });

    const subcommand = interaction.options.getSubcommand();
    const blacklist = readJSON(BLACKLIST_PATH, []);

    // Jika subcommand "add" atau "remove" tanpa server_id dan dipanggil dari DM,
    // wajib isi server_id karena tidak ada guildId
    if (isDM && !interaction.options.getString("server_id") && subcommand !== "list") {
      return await interaction.editReply({
        content: "❌ When using this command from DM, you must provide a `server_id`.",
      });
    }

    // ─────────────────────────────────────────────
    // SUB: ADD
    // ─────────────────────────────────────────────
    if (subcommand === "add") {
      const inputId = interaction.options.getString("server_id");
      const targetGuildId = inputId || interaction.guildId;

      // Try to fetch guild name from client
      let guildName = targetGuildId;
      try {
        const guild = await interaction.client.guilds.fetch(targetGuildId);
        guildName = guild.name;
      } catch {
        if (inputId) {
          return await interaction.editReply({
            content: `❌ Server with ID \`${inputId}\` not found or bot is not in that server.`,
          });
        }
      }

      // Check if already blacklisted
      const alreadyBlacklisted = blacklist.find((entry) => entry.guild_id === targetGuildId);
      if (alreadyBlacklisted) {
        return await interaction.editReply({
          content: `⚠️ Server **${guildName}** (\`${targetGuildId}\`) is already blacklisted.`,
        });
      }

      // Add to blacklist
      blacklist.push({
        guild_id: targetGuildId,
        guild_name: guildName,
        blacklisted_at: new Date().toISOString(),
        blacklisted_by: interaction.user.tag,
      });
      writeJSON(BLACKLIST_PATH, blacklist);

      // Send notification to all notification channels in the blacklisted server
      try {
        const notifData = readJSON(NOTIF_PATH, []);
        const guild = await interaction.client.guilds.fetch(targetGuildId);

        const serverChannels = notifData.filter((entry) => {
          if (typeof entry === "string") return false; // skip old format
          // Check if channel belongs to this guild
          const ch = guild.channels.cache.get(entry.channel_id);
          return !!ch;
        });

        for (const entry of serverChannels) {
          try {
            const ch = guild.channels.cache.get(entry.channel_id);
            if (ch && ch.isTextBased()) {
              await ch.send({
                content: "@everyone",
                allowedMentions: { parse: ["everyone"] },
                embeds: [
                  {
                    color: 0xff0000,
                    title: "🚫 Server Blacklisted",
                    description:
                      "This server has been **blacklisted**.\n\nThe bot will **no longer send live notifications** to this server.\n\nIf you believe this is a mistake, please contact the bot owner.",
                    footer: { text: `Server ID: ${targetGuildId}` },
                    timestamp: new Date().toISOString(),
                  },
                ],
              });
            }
          } catch (err) {
            console.error(`Failed to send blacklist notice to channel ${entry.channel_id}:`, err);
          }
        }
      } catch (err) {
        console.error("Failed to notify blacklisted server channels:", err);
      }

      return await interaction.editReply({
        content: `✅ Server **${guildName}** (\`${targetGuildId}\`) has been **blacklisted**.\nThe bot will no longer send notifications to this server.`,
      });
    }

    // ─────────────────────────────────────────────
    // SUB: REMOVE
    // ─────────────────────────────────────────────
    if (subcommand === "remove") {
      const inputId = interaction.options.getString("server_id");
      const targetGuildId = inputId || interaction.guildId;

      const index = blacklist.findIndex((entry) => entry.guild_id === targetGuildId);
      if (index === -1) {
        return await interaction.editReply({
          content: `⚠️ Server \`${targetGuildId}\` is **not** in the blacklist.`,
        });
      }

      const removed = blacklist.splice(index, 1)[0];
      writeJSON(BLACKLIST_PATH, blacklist);

      // Notify channels in the server that it has been unblacklisted
      try {
        const notifData = readJSON(NOTIF_PATH, []);
        const guild = await interaction.client.guilds.fetch(targetGuildId);

        const serverChannels = notifData.filter((entry) => {
          if (typeof entry === "string") return false;
          const ch = guild.channels.cache.get(entry.channel_id);
          return !!ch;
        });

        for (const entry of serverChannels) {
          try {
            const ch = guild.channels.cache.get(entry.channel_id);
            if (ch && ch.isTextBased()) {
              await ch.send({
                content: "@everyone",
                allowedMentions: { parse: ["everyone"] },
                embeds: [
                  {
                    color: 0x00c851,
                    title: "✅ Server Unblacklisted",
                    description:
                      "This server has been **removed from the blacklist**.\n\nThe bot will **resume sending live notifications** to this server.",
                    footer: { text: `Server ID: ${targetGuildId}` },
                    timestamp: new Date().toISOString(),
                  },
                ],
              });
            }
          } catch (err) {
            console.error(`Failed to send unblacklist notice to channel ${entry.channel_id}:`, err);
          }
        }
      } catch (err) {
        console.error("Failed to notify unblacklisted server:", err);
      }

      return await interaction.editReply({
        content: `✅ Server **${removed.guild_name || targetGuildId}** (\`${targetGuildId}\`) has been **removed** from the blacklist.`,
      });
    }

    // ─────────────────────────────────────────────
    // SUB: LIST
    // ─────────────────────────────────────────────
    if (subcommand === "list") {
      // Fetch all guilds the bot is in
      const allGuilds = interaction.client.guilds.cache;

      const blacklistedIds = new Set(blacklist.map((e) => e.guild_id));

      // Build embed fields
      const joinedServers = [];
      const blacklistedServers = [];

      for (const [guildId, guild] of allGuilds) {
        if (blacklistedIds.has(guildId)) {
          const entry = blacklist.find((e) => e.guild_id === guildId);
          blacklistedServers.push(
            `🚫 **${guild.name}** (\`${guildId}\`)\n> Blacklisted on: ${
              entry?.blacklisted_at
                ? new Date(entry.blacklisted_at).toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })
                : "Unknown"
            } by ${entry?.blacklisted_by || "Unknown"}`
          );
        } else {
          joinedServers.push(`✅ **${guild.name}** (\`${guildId}\`)`);
        }
      }

      // Also include blacklisted servers the bot is NO LONGER in
      for (const entry of blacklist) {
        if (!allGuilds.has(entry.guild_id)) {
          blacklistedServers.push(
            `🚫 **${entry.guild_name || "Unknown Server"}** (\`${entry.guild_id}\`) *(bot not in server)*`
          );
        }
      }

      const embed = {
        color: 0x5865f2,
        title: "📋 Server Blacklist Overview",
        fields: [
          {
            name: `✅ Active Servers (${joinedServers.length})`,
            value: joinedServers.length > 0 ? joinedServers.join("\n") : "*No active servers*",
          },
          {
            name: `🚫 Blacklisted Servers (${blacklistedServers.length})`,
            value:
              blacklistedServers.length > 0
                ? blacklistedServers.join("\n\n")
                : "*No servers blacklisted*",
          },
        ],
        footer: {
          text: `Total servers joined: ${allGuilds.size} | Blacklisted: ${blacklist.length}`,
        },
        timestamp: new Date().toISOString(),
      };

      return await interaction.editReply({ embeds: [embed] });
    }
  },
};