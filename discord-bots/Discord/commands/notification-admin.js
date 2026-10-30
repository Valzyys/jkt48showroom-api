const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  AttachmentBuilder,
} = require("discord.js");
const fs = require("fs").promises;
const path = require("path");

module.exports = {
  name: "notification",
  description:
    "Kirim notifikasi ke channel yang telah dikonfigurasi (Admin Only)",
  async execute(interaction) {
    // Check if user is admin
    const ADMIN_ID = "1003187408751308851";
    if (interaction.user.id !== ADMIN_ID) {
      return interaction.reply({
        content: "❌ Anda tidak memiliki izin untuk menggunakan perintah ini.",
        ephemeral: true,
      });
    }

    // Channel configuration files
    const channelFiles = {
      birthday: "../../Discord/channel/birthday-notif.json",
      idn: "../../Discord/channel/idn-notif.json",
      news: "../../Discord/channel/news-notif.json",
      jadwal: "../../Discord/channel/jadwal-notif.json",
    };

    // Create select menu for notification type
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId("notification_type")
      .setPlaceholder("Pilih jenis notifikasi")
      .addOptions([
        {
          label: "Ulang tahun",
          description: "Kirim notifikasi ulang tahun",
          value: "birthday",
          emoji: "🎂",
        },
        {
          label: "Live & rekap",
          description: "Kirim notifikasi IDN",
          value: "idn",
          emoji: "📺",
        },
        {
          label: "Berita",
          description: "Kirim notifikasi berita",
          value: "news",
          emoji: "📰",
        },
        {
          label: "Theater",
          description: "Kirim notifikasi jadwal",
          value: "jadwal",
          emoji: "📅",
        },
        {
          label: "Semua channel",
          description: "Kirim ke semua channel",
          value: "all",
          emoji: "📢",
        },
      ]);

    const row = new ActionRowBuilder().addComponents(selectMenu);

    const embed = new EmbedBuilder()
      .setColor("#ec0034")
      .setTitle("OWNER DESK / Kirim pengumuman")
      .setDescription("Pilih ruang kabar untuk pengumumanmu. Pengiriman ini hanya tersedia untuk Valzyy sebagai pemilik bot.")
      .addFields([
        {
          name: "🎂 Birthday",
          value: "Notifikasi ulang tahun member",
          inline: true,
        },
        { name: "📺 IDN", value: "Notifikasi streaming IDN", inline: true },
        { name: "📰 News", value: "Notifikasi berita terbaru", inline: true },
        { name: "📅 Jadwal", value: "Notifikasi jadwal event", inline: true },
        {
          name: "📢 Semua channel",
          value: "Kirim ke semua channel sekaligus",
          inline: true,
        },
      ])
      .setFooter({
        text: `JKT48Connect Admin Panel • ${new Date().toLocaleString("id-ID", {
          timeZone: "Asia/Jakarta",
        })} WIB`,
        iconURL: "https://files.catbox.moe/bcjk2g.jpg",
      });

    const message = await interaction.reply({
      embeds: [embed],
      components: [row],
      ephemeral: true,
    });

    // Collector for select menu
    const collector = message.createMessageComponentCollector({ time: 300000 });

    collector.on("collect", async (selectInteraction) => {
      if (selectInteraction.user.id !== interaction.user.id) return;

      const selectedType = selectInteraction.values[0];

      // Create modal for notification content
      const modal = new ModalBuilder()
        .setCustomId(`notification_modal_${selectedType}`)
        .setTitle(`Buat Notifikasi ${selectedType.toUpperCase()}`);

      // Title input
      const titleInput = new TextInputBuilder()
        .setCustomId("notification_title")
        .setLabel("Judul Notifikasi")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("Masukkan judul notifikasi...")
        .setRequired(false);

      // Description input
      const descriptionInput = new TextInputBuilder()
        .setCustomId("notification_description")
        .setLabel("Deskripsi (Mendukung Markdown)")
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder(
          "Masukkan deskripsi notifikasi... (gunakan **bold**, *italic*, dll)"
        )
        .setRequired(true);

      // Color input
      const colorInput = new TextInputBuilder()
        .setCustomId("notification_color")
        .setLabel("Warna Embed (Hex Code)")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("#ec0034")
        .setRequired(false);

      // Image URL input
      const imageInput = new TextInputBuilder()
        .setCustomId("notification_image")
        .setLabel("URL Gambar/Video (Opsional)")
        .setStyle(TextInputStyle.Short)
        .setPlaceholder("https://example.com/image.jpg")
        .setRequired(false);

      // Additional message input
      const messageInput = new TextInputBuilder()
        .setCustomId("notification_message")
        .setLabel("Pesan Tambahan (Di luar embed)")
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder(
          "Pesan tambahan yang akan dikirim bersamaan dengan embed..."
        )
        .setRequired(false);

      const firstActionRow = new ActionRowBuilder().addComponents(titleInput);
      const secondActionRow = new ActionRowBuilder().addComponents(
        descriptionInput
      );
      const thirdActionRow = new ActionRowBuilder().addComponents(colorInput);
      const fourthActionRow = new ActionRowBuilder().addComponents(imageInput);
      const fifthActionRow = new ActionRowBuilder().addComponents(messageInput);

      modal.addComponents(
        firstActionRow,
        secondActionRow,
        thirdActionRow,
        fourthActionRow,
        fifthActionRow
      );

      await selectInteraction.showModal(modal);
    });

    // Create a unique identifier for this session to prevent duplicate listeners
    const sessionId = Date.now().toString();

    // Handle modal submission with session-specific listener
    const modalHandler = async (modalInteraction) => {
      if (!modalInteraction.isModalSubmit()) return;
      if (!modalInteraction.customId.startsWith("notification_modal_")) return;
      if (modalInteraction.user.id !== ADMIN_ID) return;

      const notificationType = modalInteraction.customId.split("_")[2];
      const title =
        modalInteraction.fields.getTextInputValue("notification_title") || null;
      const description = modalInteraction.fields.getTextInputValue(
        "notification_description"
      );
      const color =
        modalInteraction.fields.getTextInputValue("notification_color") ||
        "#ec0034";
      const imageUrl =
        modalInteraction.fields.getTextInputValue("notification_image") || null;
      const additionalMessage =
        modalInteraction.fields.getTextInputValue("notification_message") ||
        null;

      try {
        // Create embed
        const notificationEmbed = new EmbedBuilder()
          .setColor(color)
          .setDescription(description)
          .setTimestamp()
          .setFooter({
            text: "JKT48Connect Notification",
            iconURL: "https://files.catbox.moe/bcjk2g.jpg",
          });

        if (title) notificationEmbed.setTitle(title);
        if (imageUrl) {
          // Check if it's a video or image
          if (
            imageUrl.includes(".mp4") ||
            imageUrl.includes(".mov") ||
            imageUrl.includes(".avi")
          ) {
            // For videos, we'll include the URL in the description
            notificationEmbed.addFields([
              {
                name: "🎥 Video",
                value: `[Klik untuk melihat video](${imageUrl})`,
              },
            ]);
          } else {
            notificationEmbed.setImage(imageUrl);
          }
        }

        // Use Map to store unique channels with their role_id
        const channelMap = new Map();

        if (notificationType === "all") {
          // Send to all channels - collect all unique channel IDs
          for (const [type, filePath] of Object.entries(channelFiles)) {
            try {
              const fullPath = path.resolve(__dirname, filePath);
              const fileContent = await fs.readFile(fullPath, "utf8");
              const channelData = JSON.parse(fileContent);

              if (Array.isArray(channelData)) {
                channelData.forEach((item) => {
                  // Handle both old format (string) and new format (object)
                  if (typeof item === "string") {
                    channelMap.set(item.trim(), null);
                  } else if (item && item.channel_id) {
                    channelMap.set(item.channel_id.trim(), item.role_id || null);
                  }
                });
              }
            } catch (error) {
              console.log(
                `Warning: Could not read ${filePath} - ${error.message}`
              );
            }
          }
        } else {
          // Send to specific notification type
          try {
            const fullPath = path.resolve(
              __dirname,
              channelFiles[notificationType]
            );
            const fileContent = await fs.readFile(fullPath, "utf8");
            const channelData = JSON.parse(fileContent);

            if (Array.isArray(channelData)) {
              channelData.forEach((item) => {
                // Handle both old format (string) and new format (object)
                if (typeof item === "string") {
                  channelMap.set(item.trim(), null);
                } else if (item && item.channel_id) {
                  channelMap.set(item.channel_id.trim(), item.role_id || null);
                }
              });
            }
          } catch (error) {
            // Remove the event listener before returning
            interaction.client.removeListener(
              "interactionCreate",
              modalHandler
            );
            return modalInteraction.reply({
              content: `❌ Error membaca file konfigurasi untuk ${notificationType}: ${error.message}`,
              ephemeral: true,
            });
          }
        }

        if (channelMap.size === 0) {
          // Remove the event listener before returning
          interaction.client.removeListener("interactionCreate", modalHandler);
          return modalInteraction.reply({
            content:
              "❌ Tidak ada channel yang dikonfigurasi untuk jenis notifikasi ini.",
            ephemeral: true,
          });
        }

        // Track sent channels to prevent duplicates during sending process
        const sentChannels = new Set();
        let successCount = 0;
        let skippedChannels = [];

        for (const [channelId, roleId] of channelMap.entries()) {
          // Skip if already sent to this channel in this session
          if (sentChannels.has(channelId)) {
            skippedChannels.push({
              id: channelId,
              reason: "Channel duplikat (sudah terkirim)",
            });
            continue;
          }

          try {
            const channel = await modalInteraction.client.channels.fetch(
              channelId
            );

            if (!channel) {
              skippedChannels.push({
                id: channelId,
                reason: "Channel tidak ditemukan",
              });
              continue;
            }

            // Check if bot has necessary permissions
            if (channel.guild) {
              const botMember = channel.guild.members.cache.get(
                modalInteraction.client.user.id
              );
              const permissions = channel.permissionsFor(botMember);

              if (!permissions.has("SendMessages")) {
                skippedChannels.push({
                  id: channelId,
                  reason: "Tidak ada izin SendMessages",
                });
                continue;
              }

              if (!permissions.has("EmbedLinks")) {
                skippedChannels.push({
                  id: channelId,
                  reason: "Tidak ada izin EmbedLinks",
                });
                continue;
              }
            }

            const messageOptions = { embeds: [notificationEmbed] };

            // Build content with role mention if role_id exists
            let content = additionalMessage || "";
            if (roleId) {
              content = `<@&${roleId}>${content ? "\n" + content : ""}`;
            }

            if (content) {
              messageOptions.content = content;
            }

            await channel.send(messageOptions);
            sentChannels.add(channelId); // Mark as sent
            successCount++;
          } catch (error) {
            let errorReason = "Unknown error";

            if (error.code === 10003) {
              errorReason = "Channel tidak ditemukan";
            } else if (error.code === 50001) {
              errorReason = "Missing Access";
            } else if (error.code === 50013) {
              errorReason = "Missing Permissions";
            } else if (error.code === 40005) {
              errorReason = "Request entity too large";
            } else if (error.code === 50035) {
              errorReason = "Invalid form body";
            } else {
              errorReason = error.message;
            }

            skippedChannels.push({
              id: channelId,
              reason: errorReason,
            });

            console.error(`Skipped channel ${channelId}: ${errorReason}`);
          }
        }

        // Create detailed confirmation embed
        const confirmationEmbed = new EmbedBuilder()
          .setColor(successCount > 0 ? "#00ff00" : "#ff9900")
          .setTitle(
            successCount > 0
              ? "✅ Notifikasi Selesai Dikirim"
              : "⚠️ Notifikasi Selesai dengan Peringatan"
          )
          .addFields([
            {
              name: "📊 Statistik Pengiriman",
              value: `**✅ Berhasil:** ${successCount}\n**⚠️ Dilewati:** ${skippedChannels.length}\n**📝 Total Channel Unik:** ${channelMap.size}`,
            },
            {
              name: "📝 Jenis Notifikasi",
              value:
                notificationType === "all"
                  ? "Semua Channel"
                  : notificationType.toUpperCase(),
              inline: true,
            },
            {
              name: "👤 Dikirim oleh",
              value: `<@${modalInteraction.user.id}>`,
              inline: true,
            },
          ])
          .setTimestamp();

        // Add skipped channels details if any
        if (skippedChannels.length > 0) {
          const skippedList = skippedChannels
            .slice(0, 10) // Limit to first 10 to avoid embed limit
            .map((ch) => `\`${ch.id}\` - ${ch.reason}`)
            .join("\n");

          confirmationEmbed.addFields([
            {
              name: "⚠️ Channel yang Dilewati",
              value:
                skippedList +
                (skippedChannels.length > 10
                  ? `\n... dan ${skippedChannels.length - 10} lainnya`
                  : ""),
              inline: false,
            },
          ]);
        }

        // Add success percentage
        const successPercentage =
          channelMap.size > 0
            ? Math.round((successCount / channelMap.size) * 100)
            : 0;
        confirmationEmbed.addFields([
          {
            name: "📈 Tingkat Keberhasilan",
            value: `${successPercentage}%`,
            inline: true,
          },
        ]);

        // Remove the event listener after successful completion
        interaction.client.removeListener("interactionCreate", modalHandler);

        await modalInteraction.reply({
          embeds: [confirmationEmbed],
          ephemeral: true,
        });
      } catch (error) {
        console.error("Error sending notification:", error);
        // Remove the event listener on error
        interaction.client.removeListener("interactionCreate", modalHandler);
        await modalInteraction.reply({
          content: `❌ Terjadi kesalahan saat mengirim notifikasi: ${error.message}`,
          ephemeral: true,
        });
      }
    };

    // Add the event listener
    interaction.client.on("interactionCreate", modalHandler);

    collector.on("end", async () => {
      try {
        const disabledRow = new ActionRowBuilder().addComponents(
          selectMenu.setDisabled(true)
        );

        await message.edit({ components: [disabledRow] });

        // Clean up event listener when collector ends
        interaction.client.removeListener("interactionCreate", modalHandler);
      } catch (error) {
        // Message might be deleted or expired
        console.log("Could not disable components:", error.message);
        // Still clean up event listener
        interaction.client.removeListener("interactionCreate", modalHandler);
      }
    });
  },
};
