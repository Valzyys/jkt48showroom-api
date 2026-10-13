import IdolMember from '@/database/schema/48group/IdolMember';
import { getCommentLog, getGiftList, getGiftLog, getLiveInfo, getProfile, getRoomStatus, getStreamingURL } from '@/utils/api/showroom';
import { createError } from '@/utils/errorResponse';
import singleflight from '@/utils/singleflight';
export const cache = new Map();
const expirations = new Map();
function setClearCache(room_url_key) {
    expirations.set(room_url_key,Date.now()+9000);
}
export async function getWatchData(c) {
    const room_url_key = c.req.param('id');
    if (!room_url_key) throw createError({
        status: 400,
        message: 'Bad request!'
    });
    const cacheData = expirations.get(room_url_key)>Date.now()?cache.get(room_url_key):null;
    const data = cacheData || await singleflight.do(room_url_key, async ()=>getData(room_url_key));
    if (!cacheData) {
        setClearCache(room_url_key);
        cache.set(room_url_key, data);
    }
    if (!data.is_error) {
        if (data.data.premium_room_type !== 0) throw createError({
            status: 404,
            message: 'Live is premium!'
        });
        return data.data;
    } else {
        throw data.error;
    }
}
async function getData(room_key) {
    const room_url_key = room_key;
    try {
        const cookies = ``;
        const data = await getRoomStatus({
            room_url_key
        }, cookies);
        const profile = await getProfile(data.room_id ?? 0);
        const liveInfo = data.is_live ? await getLiveInfo({
            room_id: data.room_id
        }, cookies) : null;
        const streamUrl = data.is_live ? (await getStreamingURL({
            room_id: data.room_id
        }, cookies)).streaming_url_list : [];
        const comments = (data.is_live ? (await getCommentLog(data.room_id, cookies)).comment_log : []).filter((i)=>!(!Number.isNaN(i.comment) && Number.parseInt(i.comment) <= 50));
        const giftLog = data.is_live ? (await getGiftLog(data.room_id, cookies)).gift_log : [];
        const giftList = data.is_live ? (await getGiftList(data.room_id, cookies)).normal : [];
        const watchData = {
            name: data.room_name,
            started_at: profile.current_live_started_at ?? 0,
            can_comment: true,
            live_id: profile.live_id,
            room_id: data.room_id,
            streaming_url_list: streamUrl,
            socket_host: data.broadcast_host,
            socket_key: data.broadcast_key,
            socket_port: data.broadcast_port,
            room_url_key: data.room_url_key,
            image: data.image_s,
            is_live: data.is_live,
            gift_log: giftLog,
            gift_list: giftList,
            premium_room_type: liveInfo?.premium_room_type ?? 0,
            comments: comments.map((i)=>{
                return {
                    id: i.user_id.toString() + i.created_at.toString(),
                    user_id: i.user_id,
                    name: i.name,
                    comment: i.comment,
                    created_at: i.created_at,
                    avatar_id: i.avatar_id
                };
            })
        };
        const res = {
            data: watchData,
            is_error: false
        };
        return res;
    } catch (e) {
        const is_premium = e?.data?.errors?.[0]?.redirect_url != null;
        const data = {
            error: is_premium ? createError({
                status: 404,
                message: 'Live is premium!'
            }) : e,
            is_error: true,
            is_premium
        };
        return data;
    }
}
