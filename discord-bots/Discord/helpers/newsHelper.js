const {api,rows}=require('../../api.cjs');
const {message}=require('../../messages.cjs');
async function sendNewsList(interaction){await interaction.deferReply();const list=rows(await api.get('/api/news?page=1&perpage=25',30000),'news');if(!list.length)return interaction.editReply('Belum ada pengumuman baru.');return interaction.editReply({content:'**NEWSROOM / JKT48**\nPilih kabar yang ingin kamu baca.',components:[{type:1,components:[{type:3,custom_id:'select-news',placeholder:'Pilih pengumuman',options:list.slice(0,25).map(r=>({label:String(r.title).slice(0,100),value:String(r.id)}))}]}]})}
async function sendNewsDetail(interaction,id){await interaction.deferUpdate();const row=await api.get('/api/news/'+encodeURIComponent(id),60000);return interaction.editReply({content:null,...message('news',row)})}
module.exports={sendNewsList,sendNewsDetail};
