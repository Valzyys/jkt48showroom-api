/** One shared API cursor; no direct Instagram requests or source credentials. */
const {escapeMarkdown}=require('discord.js');
const ID=/^\d{15,22}$/,CURSOR=/^\d{1,19}$/,HANDLE=/^[A-Za-z0-9._]{1,30}$/,CODE=/^[A-Za-z0-9_-]{5,24}$/;
const key=s=>String(s||'').trim().replace(/^@/,'').toLowerCase();
function postKeys(p){return [...new Set([p.member?.member,p.member?.id,p.member?.username,p.author?.username].filter(Boolean).map(key))]}
function roleIds(p,mapping,guild){return [...new Set(postKeys(p).flatMap(k=>mapping?.[k]||[]))].filter(id=>ID.test(id)&&id!==guild.id&&guild.roles.cache.has(id)&&!guild.roles.cache.get(id).managed)}
function validPost(p){return p&&typeof p.id==='string'&&ID.test(p.id)&&typeof p.shortcode==='string'&&CODE.test(p.shortcode)&&HANDLE.test(p.author?.username||'')&&typeof p.text==='string'&&(!p.member?.username||key(p.member.username)===key(p.author.username))}
function mediaUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&u.hostname==='api.jkt48connect.app'&&!u.username&&!u.password&&!u.port&&!u.search&&!u.hash&&/^\/media\/instagram\/[a-z0-9-]{1,100}\/\d{15,22}\/(?:thumbnail|video|(?:image|video)-\d{1,2})$/.test(u.pathname)?u.href:null}catch{return null}}
function assetUrl(asset){return asset?.status==='ready'?mediaUrl(asset.url):null}
function images(post){return Array.isArray(post.media?.images)?post.media.images:[]}
function videoUrl(post){return [assetUrl(post.media?.video),...(post.media?.items||[]).map(x=>assetUrl(x.video))].find(value=>value&&new RegExp('/'+post.id+'/video(?:-\\d{1,2})?$').test(new URL(value).pathname))||null}
function postMessage(post,{show_media=true,footer='JKT48Connect · kabar dari oshi.'}={}){
 if(!validPost(post))throw Error('invalid_member_instagram_post');
 const username=post.author.username,photo=post.media?.type==='carousel',reel=post.url==='https://www.instagram.com/reel/'+post.shortcode+'/',url='https://www.instagram.com/'+(reel?'reel':'p')+'/'+post.shortcode+'/',name=String(post.member?.name||post.author.name||username).slice(0,180);
 const main={color:0xec0034,author:{name:name+' · @'+username,url:'https://www.instagram.com/'+username+'/'},title:(reel?'Reel baru':photo?'Album Instagram baru':'Posting Instagram baru')+' dari '+name,url,description:escapeMarkdown(post.text).slice(0,3600)||'Ada cerita baru dari '+escapeMarkdown(name)+'.',footer:{text:footer}};
 const stamp=new Date(post.created_at);if(post.created_at&&Number.isFinite(stamp.getTime()))main.timestamp=stamp.toISOString();
 const pictures=[...new Set([...(photo?images(post).map(assetUrl):[]),assetUrl(post.media?.thumbnail)].filter(Boolean))].slice(0,4),embeds=[main],buttons=[{type:2,style:5,label:'Buka di Instagram',url}];
 if(show_media){if(pictures.length){main.image={url:pictures[0]};for(const picture of pictures.slice(1))embeds.push({url,image:{url:picture}})}const video=videoUrl(post);if(video)buttons.push({type:2,style:5,label:'Putar video',url:video})}
 return {embeds,components:[{type:1,components:buttons}],allowedMentions:{parse:[]}};
}
async function consumeUpdates({api,store,enqueue}){
 const cursor=store.get('instagram:cursor',null),data=await api.get('/api/instagram/updates?after='+encodeURIComponent(cursor??'0')+'&limit=100',0);
 if(!data||!Array.isArray(data.updates)||!CURSOR.test(String(data.latest_cursor))||!CURSOR.test(String(data.next_cursor)))throw Error('invalid_instagram_update_feed');
 if(cursor===null){store.set('instagram:cursor',String(data.latest_cursor));return {baseline:true,count:0,cursor:String(data.latest_cursor),has_more:false}}
 if(!CURSOR.test(String(cursor))||BigInt(data.latest_cursor)<BigInt(cursor)||BigInt(data.next_cursor)<BigInt(cursor))throw Error('instagram_feed_cursor_regressed');
 if(BigInt(data.next_cursor)>BigInt(data.latest_cursor))throw Error('invalid_instagram_update_cursor');
 let count=0,skipped=0,previous=BigInt(cursor);
 store.db.exec('BEGIN IMMEDIATE');try{
  for(const item of data.updates){if(!CURSOR.test(String(item.cursor))||BigInt(item.cursor)<=previous||BigInt(item.cursor)>BigInt(data.next_cursor))throw Error('invalid_instagram_event_order');previous=BigInt(item.cursor);if(item.type==='new_instagram_post'&&validPost(item.post)){enqueue(item.post);count++}else skipped++}
  if(data.has_more&&BigInt(data.next_cursor)<=BigInt(cursor))throw Error('instagram_cursor_not_advancing');
  store.set('instagram:cursor',String(data.next_cursor));store.db.exec('COMMIT');
 }catch(error){store.db.exec('ROLLBACK');throw error}
 return {baseline:false,count,skipped,cursor:String(data.next_cursor),has_more:Boolean(data.has_more),retention_gap:Boolean(data.retention_gap)};
}
class PostMedia{
 constructor(api,fetcher=fetch){this.assets=new(require('./social-media.cjs').MediaAssets)(api,{fetcher})}
 async get(post){const result=await this.assets.get('instagram',post);return {...result,video:result.files.find(f=>f.name.endsWith('.mp4'))?.attachment||null}}
}
module.exports={postKeys,roleIds,validPost,mediaUrl,videoUrl,postMessage,consumeUpdates,PostMedia};
