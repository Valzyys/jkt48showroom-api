const { sendNewsDetail } = require('../helpers/newsHelper');

module.exports = {
    name: 'interactionCreate',
    execute: async (interaction) => {
        if (interaction.isStringSelectMenu() && interaction.customId === 'select-news') {
            const selectedNewsId = interaction.values[0]; // ID berita yang dipilih
            await sendNewsDetail(interaction, selectedNewsId); // Menampilkan detail berita
        }
    },
};
