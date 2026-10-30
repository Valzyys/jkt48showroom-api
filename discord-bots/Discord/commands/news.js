const { sendNewsList, sendNewsDetail } = require('../helpers/newsHelper');

module.exports = {
    name: 'news',
    description: 'Lihat daftar berita dan pilih detailnya',
    async execute(interaction) {
        await sendNewsList(interaction); // Kirim daftar berita
    },
};
