const {monitor} = require("./runtime.cjs");
/**
 * ============================================================
 *  CAVALLERY BOT — REST API Sender + Voice Commands
 *  Bot khusus untuk menerima request REST API dan mengirim
 *  pesan embed ke channel Discord Cavallery System.
 *  Dilengkapi slash command /erine-join dan /erine-leave
 *  dengan fitur auto-sync command dan audio playback.
 * ============================================================
 */
process.env.FFMPEG_PATH = process.env.FFMPEG_PATH || "/usr/bin/ffmpeg";
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  AttachmentBuilder,
  REST,
  Routes,
  SlashCommandBuilder,
} = require("discord.js");
const {
  joinVoiceChannel,
  getVoiceConnection,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  entersState,
} = require("@discordjs/voice");
const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const axios = require("axios");

// ─── CONFIG ──────────────────────────────────────────────────
const CAVALLERY_TOKEN = process.env.DISCORD_TOKEN;
const CAVALLERY_CHANNEL_ID = process.env.CAVALLERY_CHANNEL_ID;
const API_PORT = Number(process.env.CAVALLERY_PORT || 25613);
const API_SECRET = process.env.CAVALLERY_API_SECRET;
if (!CAVALLERY_TOKEN || !API_SECRET || !CAVALLERY_CHANNEL_ID) throw Error("Cavallery configuration missing");

// ─── AUDIO CONFIG ─────────────────────────────────────────────
// Ganti path di bawah sesuai letak file audio kamu.
// Format yang didukung: .mp3, .ogg, .wav, .flac
const AUDIO_JOIN  = path.join(__dirname, "audio", "join.mp3");   // ← Audio saat bot join
const AUDIO_LEAVE = path.join(__dirname, "audio", "leave.mp3");  // ← Audio saat bot leave

// ─── SLASH COMMANDS DEFINITION ────────────────────────────────
// Hanya command yang terdaftar di sini yang akan aktif.
// Command lama yang tidak ada di sini akan otomatis dihapus.
const ACTIVE_COMMANDS = [
  new SlashCommandBuilder()
    .setName("erine-join")
    .setDescription("Erine masuk ke voice channel kamu dan memutar audio")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("erine-leave")
    .setDescription("Erine memutar audio lalu keluar dari voice channel")
    .toJSON(),
];

// ─── DISCORD CLIENT ──────────────────────────────────────────
const cavalleryClient = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

monitor(cavalleryClient, "cavallery");

// ─── EXPRESS APP ─────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// Multer storage — simpan file sementara
const uploadDir = path.join(process.env.BOT_DATA_DIR, "temp_uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) =>
    cb(null, `${Date.now()}-${path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g,"_")}`),
});
const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
});

// ─── MIDDLEWARE: Auth ─────────────────────────────────────────
const authenticate = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const key = authHeader && authHeader.replace("Bearer ", "").trim();

  if (!key || !require("./runtime.cjs").safeEqual(key, API_SECRET)) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized. Sertakan header: Authorization: Bearer <API_SECRET>",
    });
  }
  next();
};

// ─── HELPER: Build color dari string ─────────────────────────
const parseColor = (color) => {
  if (!color) return 0x2b2d31;
  if (color.startsWith("#")) return parseInt(color.replace("#", ""), 16);
  const colorMap = {
    red: 0xe74c3c,
    green: 0x2ecc71,
    blue: 0x3498db,
    yellow: 0xf1c40f,
    orange: 0xe67e22,
    purple: 0x9b59b6,
    white: 0xffffff,
    black: 0x000000,
    pink: 0xff69b4,
    cyan: 0x00bcd4,
    gold: 0xffd700,
    cavallery: 0x5865f2,
  };
  return colorMap[color.toLowerCase()] ?? 0x2b2d31;
};

// ─── HELPER: Cleanup temp file ────────────────────────────────
const cleanupFile = (filePath) => {
  if (filePath && fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
};

// ─── HELPER: Download image dari URL ─────────────────────────
const downloadToTemp = async () => { throw Error("Use direct image embed"); };

// ─── HELPER: Build embed untuk voice response ─────────────────
const buildVoiceEmbed = (color, title, description) => {
  return new EmbedBuilder()
    .setColor(parseColor(color))
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: "Cavallery System • Erine" })
    .setTimestamp();
};

// ─── HELPER: Putar audio di voice connection ──────────────────
/**
 * Memutar file audio di voice connection yang sudah ada.
 * @param {VoiceConnection} connection - Koneksi voice aktif
 * @param {string} audioPath - Path absolut ke file audio
 * @returns {Promise<void>} Resolve setelah audio selesai diputar atau error
 */
const playAudio = (connection, audioPath) => {
  return new Promise((resolve, reject) => {
    // Cek apakah file audio ada
    if (!fs.existsSync(audioPath)) {
      console.warn(`[Audio] File tidak ditemukan: ${audioPath}`);
      return resolve(); // Lanjut meski audio tidak ada
    }

    const player = createAudioPlayer();
    const resource = createAudioResource(audioPath);

    // Subscribe player ke connection
    connection.subscribe(player);
    player.play(resource);

    player.once(AudioPlayerStatus.Idle, () => {
      // Audio selesai diputar
      console.log(`[Audio] Selesai diputar: ${path.basename(audioPath)}`);
      resolve();
    });

    player.once("error", (err) => {
      console.error(`[Audio] Error saat memutar: ${err.message}`);
      resolve(); // Tetap resolve agar flow tidak terhenti
    });
  });
};

// ═══════════════════════════════════════════════════════════════
//  SLASH COMMAND HANDLER
// ═══════════════════════════════════════════════════════════════
cavalleryClient.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  // ── /erine-join ────────────────────────────────────────────
  if (interaction.commandName === "erine-join") {
    const voiceChannel = interaction.member?.voice?.channel;

    if (!voiceChannel) {
      return interaction.reply({
        embeds: [
          buildVoiceEmbed(
            "red",
            "❌ Gagal Join",
            "Kamu harus berada di **voice channel** terlebih dahulu agar Erine bisa bergabung."
          ),
        ],
        ephemeral: true,
      });
    }

    // Cek apakah bot sudah ada di voice channel yang sama
    const existingConnection = getVoiceConnection(interaction.guild.id);
    if (existingConnection) {
      const currentChannelId = existingConnection.joinConfig?.channelId;

      if (currentChannelId === voiceChannel.id) {
        return interaction.reply({
          embeds: [
            buildVoiceEmbed(
              "yellow",
              "⚠️ Sudah di Channel",
              `Erine sudah berada di **${voiceChannel.name}**.`
            ),
          ],
          ephemeral: true,
        });
      }

      // Jika bot di channel lain, hapus koneksi lama
      existingConnection.destroy();
    }

    // Cek permission bot
    const permissions = voiceChannel.permissionsFor(interaction.guild.members.me);
    if (!permissions.has("Connect")) {
      return interaction.reply({
        embeds: [
          buildVoiceEmbed(
            "red",
            "❌ Akses Ditolak",
            `Erine tidak memiliki izin **Connect** untuk masuk ke **${voiceChannel.name}**.`
          ),
        ],
        ephemeral: true,
      });
    }

    // Defer reply karena proses audio butuh waktu
    await interaction.deferReply();

    try {
      // Join dengan selfDeaf: false dan selfMute: false dulu supaya bisa play audio
      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: interaction.guild.id,
        adapterCreator: interaction.guild.voiceAdapterCreator,
        selfDeaf: false,
        selfMute: false,
      });

      // Tunggu connection siap
      await entersState(connection, VoiceConnectionStatus.Ready, 10_000);

      // Putar audio join
      console.log(`[Audio] Memutar audio join di: ${voiceChannel.name}`);
      await playAudio(connection, AUDIO_JOIN);

      // Setelah audio selesai: set deaf + mute via GuildMember
      try {
        await interaction.guild.members.me.voice.setDeaf(true);
        await interaction.guild.members.me.voice.setMute(true);
        console.log("[Voice] Bot set ke deaf + mute setelah audio join.");
      } catch (voiceStateErr) {
        console.warn("[Voice] Gagal set deaf/mute:", voiceStateErr.message);
      }

      // Handle disconnect tak terduga
      connection.on(VoiceConnectionStatus.Disconnected, async () => {
        try {
          await Promise.race([
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error("Timeout")), 5_000)
            ),
            new Promise((resolve) =>
              connection.once(VoiceConnectionStatus.Ready, resolve)
            ),
          ]);
        } catch {
          connection.destroy();
        }
      });

      await interaction.editReply({
        embeds: [
          buildVoiceEmbed(
            "green",
            "🎙️ Erine Telah Bergabung",
            `Erine berhasil masuk ke voice channel **${voiceChannel.name}**!\n\n` +
              `> 🎵 Audio join telah diputar.\n` +
              `> 🔇 Erine dalam kondisi **mute** dan **deaf**.\n` +
              `> Gunakan \`/erine-leave\` untuk mengeluarkan Erine.`
          ),
        ],
      });

      console.log(
        `[Voice] Erine join → ${voiceChannel.name} (${voiceChannel.id}) di guild ${interaction.guild.name}`
      );
    } catch (error) {
      console.error("[Voice Join] Error:", error);
      return interaction.editReply({
        embeds: [
          buildVoiceEmbed(
            "red",
            "❌ Terjadi Kesalahan",
            `Gagal masuk ke voice channel.\n\`\`\`${error.message}\`\`\``
          ),
        ],
      });
    }
  }

  // ── /erine-leave ───────────────────────────────────────────
  if (interaction.commandName === "erine-leave") {
    const connection = getVoiceConnection(interaction.guild.id);

    if (!connection) {
      return interaction.reply({
        embeds: [
          buildVoiceEmbed(
            "yellow",
            "⚠️ Tidak Ada Koneksi",
            "Erine saat ini **tidak berada** di voice channel manapun."
          ),
        ],
        ephemeral: true,
      });
    }

    const channelId = connection.joinConfig?.channelId;
    const voiceChannel = channelId
      ? interaction.guild.channels.cache.get(channelId)
      : null;
    const channelName = voiceChannel?.name ?? "Voice Channel";

    // Defer reply karena proses audio butuh waktu
    await interaction.deferReply();

    try {
      // Unmute + undeaf dulu agar bisa play audio
      try {
        await interaction.guild.members.me.voice.setDeaf(false);
        await interaction.guild.members.me.voice.setMute(false);
        console.log("[Voice] Bot undeaf + unmute sebelum audio leave.");
      } catch (voiceStateErr) {
        console.warn("[Voice] Gagal undeaf/unmute:", voiceStateErr.message);
      }

      // Putar audio leave
      console.log(`[Audio] Memutar audio leave di: ${channelName}`);
      await playAudio(connection, AUDIO_LEAVE);

      // Setelah audio selesai: disconnect
      connection.destroy();

      await interaction.editReply({
        embeds: [
          buildVoiceEmbed(
            "cavallery",
            "👋 Erine Telah Keluar",
            `Erine telah keluar dari voice channel **${channelName}**.\n\n` +
              `> 🎵 Audio leave telah diputar.\n` +
              `> Gunakan \`/erine-join\` untuk bergabung kembali.`
          ),
        ],
      });

      console.log(
        `[Voice] Erine leave → ${channelName} (${channelId}) di guild ${interaction.guild.name}`
      );
    } catch (error) {
      console.error("[Voice Leave] Error:", error);
      // Paksa disconnect jika terjadi error
      try { connection.destroy(); } catch {}
      return interaction.editReply({
        embeds: [
          buildVoiceEmbed(
            "red",
            "❌ Terjadi Kesalahan",
            `Gagal keluar dari voice channel.\n\`\`\`${error.message}\`\`\``
          ),
        ],
      });
    }
  }
});

// ═══════════════════════════════════════════════════════════════
//  POST /api/send
// ═══════════════════════════════════════════════════════════════
app.post(
  "/api/send",
  authenticate,
  upload.fields([
    { name: "image", maxCount: 1 },
    { name: "file", maxCount: 5 },
  ]),
  async (req, res) => {
    const uploadedFiles = Object.values(req.files || {}).flat().map(file => file.path);
    res.once("finish", () => uploadedFiles.forEach(cleanupFile));

    try {
      const {
        title,
        description,
        url,
        color,
        footer,
        author,
        author_icon,
        thumbnail,
        image_url,
        mention,
        timestamp = true,
        content,
        fields,
      } = req.body;

      if (!title || !description) {
        return res.status(400).json({
          success: false,
          message: "Field 'title' dan 'description' wajib diisi.",
        });
      }

      const channel = await cavalleryClient.channels.fetch(CAVALLERY_CHANNEL_ID);
      if (!channel) {
        return res.status(500).json({
          success: false,
          message: "Channel Cavallery tidak ditemukan.",
        });
      }

      const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(parseColor(color));

      if (url) embed.setURL(url);
      if (timestamp === true || timestamp === "true") embed.setTimestamp();
      if (footer) {
        embed.setFooter({ text: footer });
      } else {
        embed.setFooter({ text: "Cavallery System" });
      }
      if (author) {
        embed.setAuthor({ name: author, iconURL: author_icon || undefined });
      }
      if (thumbnail) embed.setThumbnail(thumbnail);

      if (fields) {
        try {
          const parsedFields =
            typeof fields === "string" ? JSON.parse(fields) : fields;
          if (Array.isArray(parsedFields)) embed.addFields(parsedFields);
        } catch {
          console.warn("Fields tidak valid, dilewati.");
        }
      }

      const attachments = [];
      let imageTempPath = null;

      if (req.files?.image?.[0]) {
        const imgFile = req.files.image[0];
        uploadedFiles.push(imgFile.path);
        const attachment = new AttachmentBuilder(imgFile.path, {
          name: imgFile.originalname,
        });
        attachments.push(attachment);
        embed.setImage(`attachment://${imgFile.originalname}`);
      } else if (image_url) {
        try {
          imageTempPath = await downloadToTemp(image_url);
          uploadedFiles.push(imageTempPath);
          const imgName = `image-${Date.now()}.jpg`;
          const attachment = new AttachmentBuilder(imageTempPath, {
            name: imgName,
          });
          attachments.push(attachment);
          embed.setImage(`attachment://${imgName}`);
        } catch {
          embed.setImage(image_url);
        }
      }

      if (req.files?.file) {
        for (const f of req.files.file) {
          uploadedFiles.push(f.path);
          attachments.push(
            new AttachmentBuilder(f.path, { name: f.originalname })
          );
        }
      }

      let messageContent = "";
      if (mention) messageContent += `${mention} `;
      if (content) messageContent += content;

      const sentMessage = await channel.send({
        content: messageContent.trim() || undefined,
        embeds: [embed],
        files: attachments,
      });

      uploadedFiles.forEach(cleanupFile);

      return res.status(200).json({
        success: true,
        message: "Pesan berhasil dikirim ke channel Cavallery.",
        message_id: sentMessage.id,
        channel_id: CAVALLERY_CHANNEL_ID,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      uploadedFiles.forEach(cleanupFile);
      console.error("[Cavallery API] Error:", error);
      return res.status(500).json({
        success: false,
        message: "Terjadi kesalahan internal.",
        error: error.message,
      });
    }
  }
);

// ═══════════════════════════════════════════════════════════════
//  POST /api/send-plain
// ═══════════════════════════════════════════════════════════════
app.post("/api/send-plain", authenticate, async (req, res) => {
  try {
    const { content, mention } = req.body;

    if (!content) {
      return res.status(400).json({
        success: false,
        message: "Field 'content' wajib diisi.",
      });
    }

    const channel = await cavalleryClient.channels.fetch(CAVALLERY_CHANNEL_ID);
    if (!channel) {
      return res.status(500).json({
        success: false,
        message: "Channel tidak ditemukan.",
      });
    }

    let messageContent = "";
    if (mention) messageContent += `${mention} `;
    messageContent += content;

    const sentMessage = await channel.send({ content: messageContent.trim() });

    return res.status(200).json({
      success: true,
      message: "Pesan plain text berhasil dikirim.",
      message_id: sentMessage.id,
    });
  } catch (error) {
    console.error("[Cavallery API Plain] Error:", error);
    return res.status(500).json({
      success: false,
      message: "Terjadi kesalahan.",
      error: error.message,
    });
  }
});

// ═══════════════════════════════════════════════════════════════
//  GET /api/status
// ═══════════════════════════════════════════════════════════════
app.get("/api/status", authenticate, (req, res) => {
  const voiceConnections = [];
  cavalleryClient.guilds.cache.forEach((guild) => {
    const conn = getVoiceConnection(guild.id);
    if (conn) {
      const ch = guild.channels.cache.get(conn.joinConfig?.channelId);
      voiceConnections.push({
        guild_id: guild.id,
        guild_name: guild.name,
        channel_id: conn.joinConfig?.channelId,
        channel_name: ch?.name ?? "Unknown",
        status: conn.state.status,
      });
    }
  });

  res.json({
    success: true,
    bot: {
      username: cavalleryClient.user?.tag ?? "Belum login",
      ready: cavalleryClient.isReady(),
    },
    api: {
      port: API_PORT,
      channel_id: CAVALLERY_CHANNEL_ID,
    },
    audio: {
      join_audio: AUDIO_JOIN,
      join_audio_exists: fs.existsSync(AUDIO_JOIN),
      leave_audio: AUDIO_LEAVE,
      leave_audio_exists: fs.existsSync(AUDIO_LEAVE),
    },
    voice: {
      active_connections: voiceConnections.length,
      connections: voiceConnections,
    },
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// ═══════════════════════════════════════════════════════════════
//  GET /api/docs
// ═══════════════════════════════════════════════════════════════
app.get("/api/docs", authenticate, (req, res) => {
  res.json({
    name: "Cavallery Discord REST API",
    version: "2.0.0",
    base_url: `http://localhost:${API_PORT}`,
    auth: "Header: Authorization: Bearer <API_SECRET>",
    slash_commands: {
      "/erine-join":
        "Erine masuk ke voice channel user, putar audio join, lalu deaf+mute",
      "/erine-leave":
        "Erine undeaf+unmute, putar audio leave, lalu keluar dari voice channel",
    },
    audio_config: {
      join_audio: AUDIO_JOIN,
      leave_audio: AUDIO_LEAVE,
      note: "Ganti path AUDIO_JOIN dan AUDIO_LEAVE di bagian atas file bot.",
    },
    endpoints: {
      "POST /api/send": {
        description: "Kirim pesan embed ke channel Cavallery",
        content_type: "application/json ATAU multipart/form-data",
        body: {
          title: "string (wajib)",
          description: "string (wajib)",
          url: "string (opsional)",
          color: "string (opsional) — Hex atau nama warna",
          footer: "string (opsional)",
          author: "string (opsional)",
          author_icon: "string (opsional)",
          thumbnail: "string (opsional)",
          image_url: "string (opsional)",
          mention: "string (opsional) — @everyone | @here | <@USER_ID>",
          timestamp: "boolean (opsional, default: true)",
          content: "string (opsional)",
          fields: 'JSON string (opsional) — [{"name":"...","value":"...","inline":true}]',
          "image (file)": "Upload gambar (multipart)",
          "file (file)": "Upload file/video (multipart)",
        },
      },
      "POST /api/send-plain": {
        description: "Kirim pesan plain text tanpa embed",
        body: {
          content: "string (wajib)",
          mention: "string (opsional)",
        },
      },
      "GET /api/status": "Cek status bot, audio files, dan voice connections",
      "GET /api/docs": "Dokumentasi ini",
    },
  });
});

// ─── 404 Handler ─────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Endpoint tidak ditemukan: ${req.method} ${req.path}`,
    docs: `http://localhost:${API_PORT}/api/docs`,
  });
});

// ─── Auto-Sync Slash Commands ke Discord ─────────────────────
/**
 * Membandingkan command yang terdaftar di Discord dengan ACTIVE_COMMANDS.
 * Command lama yang tidak ada di ACTIVE_COMMANDS akan dihapus.
 * Command baru akan didaftarkan.
 * Menggunakan PUT (replace all) untuk memastikan sinkronisasi penuh.
 */
const syncCommands = async () => {
  try {
    const rest = new REST({ version: "10" }).setToken(CAVALLERY_TOKEN);
    const appId = cavalleryClient.user.id;

    // Ambil command yang saat ini terdaftar di Discord
    const existingCommands = await rest.get(
      Routes.applicationCommands(appId)
    );

    const existingNames = existingCommands.map((c) => c.name);
    const activeNames = ACTIVE_COMMANDS.map((c) => c.name);

    // Log command yang akan dihapus
    const toDelete = existingNames.filter((n) => !activeNames.includes(n));
    const toAdd    = activeNames.filter((n) => !existingNames.includes(n));
    const toKeep   = activeNames.filter((n) => existingNames.includes(n));

    if (toDelete.length > 0) {
      console.log(`🗑️  Command akan dihapus: ${toDelete.join(", ")}`);
    }
    if (toAdd.length > 0) {
      console.log(`➕ Command akan ditambahkan: ${toAdd.join(", ")}`);
    }
    if (toKeep.length > 0) {
      console.log(`✅ Command tetap: ${toKeep.join(", ")}`);
    }

    // PUT akan menimpa SEMUA command yang ada dengan daftar ACTIVE_COMMANDS
    // Ini otomatis menghapus command lama dan mendaftarkan yang baru
    await rest.put(
      Routes.applicationCommands(appId),
      { body: ACTIVE_COMMANDS }
    );

    console.log(
      `✅ Slash commands berhasil disinkronkan! Aktif: ${activeNames.join(", ")}`
    );
  } catch (error) {
    console.error("❌ Gagal sync slash commands:", error);
  }
};

// ─── Cek file audio saat startup ─────────────────────────────
const checkAudioFiles = () => {
  const joinExists  = fs.existsSync(AUDIO_JOIN);
  const leaveExists = fs.existsSync(AUDIO_LEAVE);

  console.log("\n🎵 Audio File Check:");
  console.log(
    `   Join  : ${AUDIO_JOIN} — ${joinExists  ? "✅ Ditemukan" : "⚠️  TIDAK DITEMUKAN"}`
  );
  console.log(
    `   Leave : ${AUDIO_LEAVE} — ${leaveExists ? "✅ Ditemukan" : "⚠️  TIDAK DITEMUKAN"}`
  );

  if (!joinExists || !leaveExists) {
    console.warn(
      "\n⚠️  Beberapa file audio tidak ditemukan. Bot tetap berjalan,\n" +
      "   namun audio akan dilewati jika file tidak ada.\n" +
      "   Konfigurasi path di bagian AUDIO CONFIG di atas file.\n"
    );
  } else {
    console.log("   Semua file audio siap.\n");
  }
};

// ─── Start Bot & API ──────────────────────────────────────────
cavalleryClient.once("ready", async () => {
  console.log(
    `\n✅ [Cavallery Bot] Login sebagai: ${cavalleryClient.user.tag}`
  );
  console.log(`📡 [Cavallery API] Berjalan di port ${API_PORT}`);

  console.log(`📣 Channel Target: ${CAVALLERY_CHANNEL_ID}`);
  console.log(`🎙️  Voice Commands: /erine-join, /erine-leave`);

  // Cek file audio
  checkAudioFiles();

  // Sinkronisasi slash commands (hapus lama, daftar baru)
  await syncCommands();
});

// Start Express
app.listen(API_PORT, "127.0.0.1", () => {
  console.log(
    `\n🚀 [Cavallery REST API] Server aktif → http://localhost:${API_PORT}`
  );
  console.log(`📖 Dokumentasi   → http://localhost:${API_PORT}/api/docs`);
  console.log(`❤️  Status        → http://localhost:${API_PORT}/api/status\n`);
});

// Login bot
cavalleryClient.login(CAVALLERY_TOKEN).catch(error => { console.error("Discord login failed", {code:error.code}); process.exitCode=1; setTimeout(()=>process.exit(1),1000); });

module.exports = { cavalleryClient, app };