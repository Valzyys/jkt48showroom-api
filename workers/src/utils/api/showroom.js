import { env } from '@/runtime/env';
import { ofetch as fetchCustom } from '@/runtime/http';
const cookies = `sr_id=${env.SR_ID};`;
let randomSRId = '';
const ofetch = fetchCustom.create({
    query: {
        _: new Date().getTime()
    },
    headers: {
        'Cookie': `sr_id=${randomSRId}`,
        'Referer': 'https://www.showroom-live.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36'
    },
    onResponse (context) {
        randomSRId = context.response.headers.getSetCookie().find((i)=>i.startsWith('sr_id='))?.split(' ')?.[0] ?? '';
    }
});
export async function generateShowroomId() {
    await ofetch('https://www.showroom-live.com/', {
        headers: {
            Cookie: ''
        }
    });
}
export function liveURL(key) {
    return `https://www.showroom-live.com/r${key?.startsWith('/') ? '' : '/'}${key}`;
}
export function avatarURL(id) {
    return `https://image.showroom-cdn.com/showroom-prod/image/avatar/${id}.png`;
}
export function giftUrl(id, type = 'small') {
    return `https://image.showroom-cdn.com/showroom-prod/assets/img/gift/${id}_${type === 'small' ? 's' : 'm'}.png`;
}
export function profileURL(roomId) {
    return `https://www.showroom-live.com/room/profile?room_id=${roomId}`;
}
export function getProfile(roomId) {
    return ofetch(`https://www.showroom-live.com/api/room/profile?room_id=${roomId}`);
}
export function getNextLive(roomId) {
    return ofetch(`https://www.showroom-live.com/api/room/next_live?room_id=${roomId}`);
}
export function getIsLive(roomId) {
    return ofetch(`https://www.showroom-live.com/room/is_live?room_id=${roomId}&_=${new Date().getTime()}`);
}
export function getGiftLog(roomId, cookies = null) {
    return ofetch(`https://www.showroom-live.com/api/live/gift_log?room_id=${roomId}&_=${new Date().getTime()}`, {
        headers: {
            cookie: cookies || ''
        }
    });
}
export function getOnlives(query, cookies = null) {
    return ofetch('https://www.showroom-live.com/api/live/onlives', {
        query,
        headers: {
            Cookie: cookies || ''
        }
    });
}
export function getRoomStatus(query, cookies = null) {
    return ofetch('https://www.showroom-live.com/api/room/status', {
        query,
        headers: {
            cookie: cookies || ''
        }
    });
}
export function getLiveInfo(query, cookies = null) {
    return ofetch('https://www.showroom-live.com/api/live/live_info', {
        query,
        headers: {
            cookie: cookies || ''
        }
    });
}
export function getGiftList(roomId, cookies = null) {
    return ofetch(`https://www.showroom-live.com/api/live/gift_list?room_id=${roomId}&_=${new Date().getTime()}`, {
        headers: {
            cookie: cookies || ''
        }
    });
}
export function getStreamingURL(query, cookies = null) {
    return ofetch('https://www.showroom-live.com/api/live/streaming_url', {
        query: {
            ...query
        },
        headers: {
            cookie: cookies || ''
        }
    });
}
export function getCommentLog(roomId, cookies = null) {
    return ofetch(`https://www.showroom-live.com/api/live/comment_log?room_id=${roomId}&_=${new Date().getTime()}`, {
        headers: {
            cookie: cookies || ''
        }
    });
}
export function getPolling(roomId, cookies = null) {
    return ofetch(`https://www.showroom-live.com/api/live/polling?room_id=${roomId}&_=${new Date().getTime()}`, {
        headers: {
            cookie: cookies || ''
        }
    });
}
export function getTelops(roomId, cookies = null) {
    return ofetch(`https://www.showroom-live.com/api/live/telop?room_id=${roomId}`, {
        headers: {
            cookie: cookies || ''
        }
    });
}
export function getUserProfile(userId) {
    return ofetch(`https://www.showroom-live.com/api/user/profile?user_id=${userId}`);
}
export function getSummaryRanking(roomId) {
    return ofetch(`https://www.showroom-live.com/api/live/summary_ranking?room_id=${roomId}`);
}
export function getStageUserList(roomId, cookies = null) {
    return ofetch('https://www.showroom-live.com/api/live/stage_user_list', {
        query: {
            room_id: roomId
        },
        headers: {
            cookie: cookies || ''
        }
    });
}
export function sendComment(opts) {
    return ofetch('https://www.showroom-live.com/api/live/post_live_comment', {
        ...opts,
        method: 'POST'
    });
}
export function greeting(opts) {
    return ofetch('https://www.showroom-live.com/api/room/greeting', {
        ...opts
    });
}
export function getShowroomCsrf(opts) {
    return ofetch('https://www.showroom-live.com/api/csrf_token', {
        ...opts
    });
}
export function getCurrentUser(opts) {
    return ofetch('https://www.showroom-live.com/api/live/current_user', {
        ...opts
    });
}
export function logout(opts) {
    return ofetch('https://www.showroom-live.com/user/logout_api', {
        ...opts,
        method: 'POST'
    });
}
export async function getFollows(page = 1) {
    const count = 150;
    const url = `https://www.showroom-live.com/api/follow/rooms?page=${page}&count=${count}&_=${new Date().getTime()}`;
    const data = await ofetch(url, {
        headers: {
            cookie: cookies
        }
    });
    if (!('rooms' in data && 'next_page' in data && 'total_entries' in data && 'last_page' in data)) console.warn('Follow Api changes in some fields');
    if (!Array.isArray(data.rooms)) console.warn('Follow Api changes in some fields');
    return data;
}
export async function getAllFollows(result = [], page = 1) {
    const data = await getFollows(page);
    result.push(...data.rooms);
    if (data.current_page !== page) return result;
    if (data.next_page !== null) {
        return await getAllFollows(result, data.next_page);
    } else {
        return result;
    }
}
