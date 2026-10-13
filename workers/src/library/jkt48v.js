import { env } from '@/runtime/env';
import { ofetch } from '@/runtime/http';
import { sleep } from '@/utils';
const jkt48v_ids = (env.JKT48V_YT_IDS ?? '').split(',').map((i)=>i.trim());
export async function getJKT48VLive() {
    try {
        const data = await searchYoutube();
        return data.filter((i)=>jkt48v_ids.includes(i.channelId));
    } catch (e) {
        console.error(e);
        throw new Error('Youtube search failed!');
    }
}
let keyI = 0;
const keys = (env.YOUTUBE_KEY ?? '').split(',').map((i)=>i.trim());
function getYoutubeKey() {
    keyI++;
    return keys[keyI % keys.length];
}
const cache = new Map();
let TO;
export const jkt48v_cache_time = 240000;
export async function cachedJKT48VLive() {
    const c = cache.get('cache');
    if (c) return c;
    const res = await getJKT48VLive();
    cache.set('cache', res);
    clearTimeout(TO);
    TO = setTimeout(()=>{
        cache.clear();
    }, jkt48v_cache_time);
    return res;
}
async function searchYoutube(result = [], nextPageToken = null) {
    if (env.NODE_ENV === 'development') return [];
    const data = await ofetch('https://www.googleapis.com/youtube/v3/search', {
        query: {
            part: 'snippet',
            eventType: 'live',
            type: 'video',
            key: getYoutubeKey(),
            q: '"jkt48v" | "jkt48"',
            pageToken: nextPageToken ?? undefined
        }
    });
    result.push(...data.items.map((i)=>{
        return {
            channelTitle: i.snippet?.channelTitle,
            channelId: i.snippet?.channelId,
            title: i.snippet?.channelTitle,
            description: i.snippet?.description,
            thumbnails: i.snippet?.thumbnails,
            group: 'jkt48',
            url: `https://www.youtube.com/watch?v=${i.id.videoId}`,
            etag: i.etag
        };
    }));
    if (data.nextPageToken != null) {
        await sleep(100);
        return searchYoutube(result, data.nextPageToken);
    }
    return result;
}
