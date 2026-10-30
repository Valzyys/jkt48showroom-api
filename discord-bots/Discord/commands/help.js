const help = require('../../help.cjs');
module.exports = {
  name: 'help',
  description: 'Panduan interaktif: notifikasi, setup server, role oshi, games, dan bantuan',
  async execute(interaction) {
    return interaction.reply(help.payload(interaction, 'home', {initial:true}));
  },
};
