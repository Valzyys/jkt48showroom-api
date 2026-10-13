import dayjs from 'dayjs';
import { ofetch } from '@/runtime/http';
import IdolMember from '@/database/schema/48group/IdolMember';
import { convertToMilliseconds } from '@/utils';
const idnUsernames = new Set();
const additionalUsernames = [
    'jkt48-official'
];
export async function getAllIDNUsername() {
    if (idnUsernames.size) return idnUsernames;
    const data = (await IdolMember.find({
        'idn.username': {
            $exists: true
        }
    }).lean()).map((i)=>i.idn?.username) || [];
    if (data.length) {
        const usernames = [
            ...data.filter((i)=>i != null),
            ...additionalUsernames
        ];
        for (const username of usernames){
            idnUsernames.add(username);
        }
        setTimeout(()=>{
            idnUsernames.clear();
        }, 3600_000);
    }
    return idnUsernames;
}
let idnLivesCache = [];
export async function fetchIDN(debug = false) {
    try {
        const data = await newFetch(debug);
        idnLivesCache = data;
        return data;
    } catch (e) {
        if (idnLivesCache?.length) {
            return idnLivesCache;
        }
        if (debug) {
            console.error('fetchIDN debug error, returning empty array:', e);
            return [];
        }
        throw e;
    }
}
let promise = null;
export async function getIDNLives() {
    if (!promise) {
        promise = new Promise((resolve, reject)=>{
            fetchIDN().then((r)=>{
                resolve(r);
                promise = null;
            }).catch((e)=>{
                console.error(e);
                promise = null;
                reject(e);
            });
        });
    }
    return await promise;
}
const chat_room_ids = new Map();
export async function fetchAllIDNLives(page = 1) {
    const res = await ofetch(`https://mobile-api.idntimes.com/v3/livestreams?category=all&page=${page}&_=${new Date().getTime()}`, {
        headers: {
            'Host': 'mobile-api.idntimes.com',
            'x-api-key': '1ccc5bc4-8bb4-414c-b524-92d11a85a818',
            'User-Agent': 'IDN/6.41.1 (com.idntimes.IDNTimes; build:745; iOS 17.2.1) Alamofire/5.1.0',
            'Connection': 'keep-alive',
            'Accept-Language': 'en-ID;q=1.0, id-ID;q=0.9',
            'Accept': '*/*'
        }
    });
    if (res?.data?.length) {
        return [
            ...res.data,
            ...await fetchAllIDNLives(page + 1)
        ];
    } else {
        return [
            ...res.data
        ];
    }
}
export async function newFetch(debug = false) {
    const data = await fetchAllIDNLives();
    if (data?.length) {
        const usernames = await getAllIDNUsername();
        const result = [];
        const filtered = data.filter((i)=>{
            return usernames.has(i.creator?.username || '0');
        });
        if (debug) {
            if (filtered.length) {
                result.push(...filtered);
            } else {
                result.push(...data.slice(0, 5));
            }
        } else {
            result.push(...filtered);
        }
        const res = [];
        for (const live of result){
            let chat_room_id = chat_room_ids.get(live.slug);
            if (!chat_room_id) {
                try {
                    const data = await ofetch(`https://api.idn.app/api/v4/livestream/${live.slug}`, {
                        headers: {
                            'User-Agent': 'Android/14/SM-A528B/6.47.4',
                            'x-api-key': '123f4c4e-6ce1-404d-8786-d17e46d65b5c'
                        }
                    });
                    chat_room_id = data.data.chat_room_id;
                    chat_room_ids.set(live.slug, chat_room_id);
                } catch (e) {
                    console.error(`Failed to fetch detail for ${live.slug}:`, e);
                }
            }
            res.push({
                user: {
                    id: live.creator?.uuid,
                    name: live.creator?.name,
                    username: live.creator?.username,
                    avatar: live.creator?.image_url
                },
                chat_room_id,
                image: live.image_url,
                stream_url: live.playback_url,
                title: live.title,
                slug: live.slug,
                view_count: live.view_count,
                live_at: dayjs(convertToMilliseconds(live.live_at)).toISOString()
            });
        }
        return res;
    }
    return [];
}
export async function fetch(debug = false) {
    const res = await ofetch(`https://api.idn.app/graphql`, {
        headers: {
            'Content-Type': 'application/json'
        },
        method: 'POST',
        body: JSON.stringify({
            query: 'query SearchLivestream { searchLivestream(query: "", limit: 1000) { next_cursor result { slug title image_url view_count playback_url room_identifier status live_at end_at scheduled_at gift_icon_url category { name slug } creator { uuid username name avatar bio_description following_count follower_count is_follow } } }}'
        })
    });
    const data = res?.data?.searchLivestream?.result;
    if (data?.length) {
        const usernames = await getAllIDNUsername();
        const result = [];
        const filtered = data.filter((i)=>{
            return usernames.has(i.creator?.username || '0');
        });
        if (debug) {
            if (filtered.length) {
                result.push(...filtered);
            } else {
                result.push(...data.slice(0, 5));
            }
        } else {
            result.push(...filtered);
        }
        return result.map((i)=>{
            return {
                user: {
                    id: i.creator?.uuid,
                    name: i.creator?.name,
                    username: i.creator?.username,
                    avatar: i.creator?.avatar
                },
                image: i.image_url,
                stream_url: i.playback_url,
                title: i.title,
                slug: i.slug,
                view_count: i.view_count,
                live_at: new Date(i.live_at).toISOString()
            };
        });
    }
    return [];
}
