/** Shared cursor feed: one API poll per bot, durable per-channel tweet receipts. */
const {escapeMarkdown}=require('discord.js');
const ID=/^\d{15,22}$/,CURSOR=/^\d{1,24}$/;
const key=value=>String(value||'').trim().toLowerCase().replace(/^@/,'');
function tweetKeys(tweet){return [...new Set([tweet.member?.id,tweet.member?.username,tweet.author?.username].filter(Boolean).map(key))]}
function roleIds(tweet,mapping,guild){return [...new Set(tweetKeys(tweet).flatMap(k=>mapping?.[k]||[]))].filter(id=>ID.test(id)&&id!==guild.id&&guild.roles.cache.has(id)&&!guild.roles.cache.get(id).managed)}
function validTweet(t){return t&&/^\d{8,22}$/.test(String(t.id))&&/^[A-Za-z0-9_]{1,15}$/.test(t.author?.username||'')&&typeof t.text==='string'&&!t.is_repost&&(!t.member?.username||key(t.member.username)===key(t.author.username))}
function safeUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null}catch{return null}}
function videoUrl(value){const s=safeUrl(value);if(!s)return null;const u=new URL(s);return u.hostname==='video.twimg.com'&&!u.port&&u.pathname.endsWith('.mp4')?s:null}
function videoOf(t){for(const m of t.media||[]){if(!['video','animated_gif'].includes(m.type))continue;const options=(m.variants||[]).filter(v=>v.content_type==='video/mp4'&&videoUrl(v.url)).sort((a,b)=>(Number(a.bitrate)||0)-(Number(b.bitrate)||0));if(options.length)return options.find(v=>Number(v.bitrate)>=256000)||options[0]}return null}
function tweetMessage(tweet,{show_media=true,footer='JKT48Connect · kabar dari oshi.'}={}){
 if(!validTweet(tweet))throw Error('invalid_member_tweet');
 const url='https://x.com/'+tweet.author.username+'/status/'+tweet.id,name=String(tweet.member?.name||tweet.author.name||tweet.author.username).slice(0,180);
 const media=Array.isArray(tweet.media)?tweet.media:[],pictures=media.filter(m=>safeUrl(m.url)).slice(0,4),stamp=new Date(tweet.created_at);
 const main={color:0xec0034,author:{name:name+' · @'+tweet.author.username,url:'https://x.com/'+tweet.author.username,...(safeUrl(tweet.author.avatar)?{icon_url:safeUrl(tweet.author.avatar)}:{})},title:(tweet.is_reply?'Balasan baru':'Tweet baru')+' dari '+name,url,description:escapeMarkdown(tweet.text).slice(0,3600)||'Member membagikan media baru.',footer:{text:footer}};
 if(Number.isFinite(stamp.getTime()))main.timestamp=stamp.toISOString();
 const video=videoOf(tweet),buttons=[{type:2,style:5,label:'Buka di X',url}];
 if(show_media&&video)buttons.push({type:2,style:5,label:'Buka video',url:video.url});
 const embeds=[main];if(show_media&&pictures.length){main.image={url:safeUrl(pictures[0].url)};for(const m of pictures.slice(1))embeds.push({url,image:{url:safeUrl(m.url)}})}
 return {embeds,components:[{type:1,components:buttons}],allowedMentions:{parse:[]}};
}
async function consumeUpdates({api,store,enqueue}){
 const cursor=store.get('x:cursor',null);
 const data=await api.get('/api/x/updates?after='+encodeURIComponent(cursor??'0')+'&limit=100',0);
 if(!data||!Array.isArray(data.updates)||!CURSOR.test(String(data.latest_cursor))||!CURSOR.test(String(data.next_cursor)))throw Error('invalid_x_update_feed');
 if(cursor===null){store.set('x:cursor',String(data.latest_cursor));return {baseline:true,count:0,cursor:String(data.latest_cursor),has_more:false,source:data.status}}
 if(!CURSOR.test(String(cursor))||BigInt(data.latest_cursor)<BigInt(cursor)||BigInt(data.next_cursor)<BigInt(cursor))throw Error('x_feed_cursor_regressed');
 if(BigInt(data.next_cursor)>BigInt(data.latest_cursor))throw Error('invalid_x_update_cursor');
 let count=0,skipped=0,previous=BigInt(cursor);
 // Commit outgoing jobs and cursor together. A failure leaves the page replayable.
 store.db.exec('BEGIN IMMEDIATE');try{
  for(const item of data.updates){if(!CURSOR.test(String(item.cursor))||BigInt(item.cursor)<=previous||BigInt(item.cursor)>BigInt(data.next_cursor))throw Error('invalid_x_event_order');previous=BigInt(item.cursor);if(item.type==='new_tweet'&&validTweet(item.tweet)){enqueue(item.tweet);count++}else skipped++}
  if(data.has_more&&BigInt(data.next_cursor)<=BigInt(cursor))throw Error('x_cursor_not_advancing');
  store.set('x:cursor',String(data.next_cursor));store.db.exec('COMMIT');
 }catch(e){store.db.exec('ROLLBACK');throw e}
 return {baseline:false,count,skipped,cursor:String(data.next_cursor),has_more:Boolean(data.has_more),retention_gap:Boolean(data.retention_gap),source:data.status};
}
// Compatibility adapter for older preview tooling; notification delivery uses all files.
class VideoMedia{
 constructor(fetcher=fetch){this.assets=new(require('./social-media.cjs').MediaAssets)(null,{fetcher})}
 async get(tweet){const result=await this.assets.get('x',tweet);return result.files.find(f=>f.name.endsWith('.mp4'))?.attachment||null}
}
module.exports={tweetKeys,roleIds,validTweet,tweetMessage,consumeUpdates,videoOf,videoUrl,VideoMedia};
