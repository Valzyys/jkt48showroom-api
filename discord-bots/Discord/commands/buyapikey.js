const { buyApiKeyHelper } = require('../helpers/buyApiKeyHelper');

module.exports = {
    name: 'buyapikey',
    description: 'Beli APIKey dengan berbagai pilihan plan',
    async execute(interaction) {
        await buyApiKeyHelper(interaction);
    },
};