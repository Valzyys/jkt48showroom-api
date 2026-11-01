import { createYoutubeFeedClient } from '@/runtime/youtube-feed';
import { env } from '@/runtime/env';
import {createYoutubeFeedStore} from '@/runtime/youtube-feed-store';
import { playback } from '@/runtime/youtube-public';
// Official public feeds need no Google key. The private VPS relay avoids feed blocks on shared edge IPs.
const loadVideos=createYoutubeFeedClient({store:createYoutubeFeedStore(()=>env.DB),fetcher:async(url,init)=>{
    const base=String(env.JKT48_SCRAPER_URL||'');
    if(!base)return fetch(url,init);
    const relay=new URL('youtube-feed',base.endsWith('/')?base:base+'/');
    if(relay.protocol!=='https:'||relay.username||relay.password||!env.JKT48_SCRAPER_TOKEN)throw Error('Invalid private feed relay');
    relay.searchParams.set('channel_id',new URL(url).searchParams.get('channel_id'));
    return fetch(relay,{...init,headers:{Accept:'application/atom+xml','User-Agent':'JKT48Connect-Sync/1.0 (+https://api.jkt48connect.app)',Authorization:'Bearer '+env.JKT48_SCRAPER_TOKEN}});
}});
export async function getJKT48YoutubeVideo(){return (await loadVideos()).map(video=>({...video,playback:playback(video.id,env.JKT48_SCRAPER_TOKEN),comments_url:'https://api.jkt48connect.app/api/jkt48_youtube/'+video.id+'/comments'}));}
