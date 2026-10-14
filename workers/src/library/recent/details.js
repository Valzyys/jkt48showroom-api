import {recordingSession} from '../../collector/recording-session';
import {leaderboardImages} from '../../collector/leaderboards';
import {ensureIdnGifts} from '../../idn/catalog';
import {giftImageUrl} from '../../runtime/gift-media';
import { giftCounts } from './gift-counts';
import { env } from '@/runtime/env';
import ShowroomGift from '@schema/showroom/ShowroomGift';
import dayjs from 'dayjs';
import config from '@/config';
import { IDNGift } from '@/database/live/schema/idn/Gift';
import LiveLog from '@/database/live/schema/LiveLog';
import { StageList } from '@/database/showroomDB/StageList';
import UserLog from '@/database/userDB/UserLog';
import { createError } from '@/utils/errorResponse';
import { calculateFansPoints } from '../fansPoints';
export async function parseBase(data) {
    const leaderboard_images=(await leaderboardImages(env.DB,[data.data_id],env.REQUEST_ORIGIN||'https://api.jkt48connect.app')).get(data.data_id);
    return {
        leaderboard_image: leaderboard_images?.portrait,
        leaderboard_images,
        recording_session:recordingSession(data,env.REQUEST_ORIGIN||'https://api.jkt48connect.app'),
        point_unit: data.type==='idn'?'idn_gold':'showroom_points',
        recordings: (data.recordings||[]).map(r=>({...r,stream_url:r.index_available===false?null:r.stream_url||r.url?.replace(/\.mp4(?:\?.*)?$/,'.m3u8'),player_url:r.player_url||r.url?.replace(/\/media\/live\/([^/]+)\/video-(\d+)\.mp4(?:\?.*)?$/,'/replay/$1/$2')})),
        capture: data.capture,
        data_id: data.data_id,
        live_id: data.live_id,
        room_id: data.room_id,
        room_info: {
            name: data.room_info?.name ?? 'Member not found!',
            nickname: data.custom?.title ?? data.custom?.theater?.title ?? data.room_info?.member_data?.info?.nicknames?.[0],
            fullname: data.room_info?.member_data?.name,
            img: data.custom?.img ?? data.room_info?.img ?? config.errorPicture,
            img_alt: data.custom?.img ?? data.room_info?.member_data?.info?.img ?? data.room_info?.img_square,
            url: data.room_info?.member_data?.slug ?? data.room_info?.url ?? '',
            is_graduate: data.room_info?.member_data?.info?.is_graduate ?? data.room_info?.is_group ?? false,
            is_group: data.room_info?.is_group ?? false,
            banner: data.room_info?.member_data?.info?.banner ?? '',
            jikosokai: data.room_info?.member_data?.info?.jikosokai ?? '',
            generation: data.room_info?.generation ?? '',
            group: data.room_info?.group ?? ''
        },
        total_gifts: data.total_gifts,
        gift_rate: data.gift_rate,
        created_at: dayjs(data.created_at).toISOString()
    };
}
export function getGiftPagination(data) {
    const giftLog = data.gift_data.gift_log.slice(0, config.giftPerpage);
    const userIds = giftLog.map((i)=>String(i.user_id));
    const users = data.users?.filter((i)=>userIds.includes(String(i.user_id))) || [];
    return {
        users: users,
        gifts: giftLog,
        next_page: config.giftPerpage < data.gift_data.gift_log.length
    };
}
export async function parseShowroom(data) {
    const giftPagination = getGiftPagination(data);
    const users = giftPagination.users.map((i)=>{
        return {
            id: i.user_id,
            name: i.name,
            avatar_id: i.avatar_id || 1,
            comments: i.comments
        };
    });
    const stageListData = await StageList.findOne({
        data_id: data.data_id
    }).lean();
    const fansRank = calculateFansPoints(data?.users ?? [], stageListData?.stage_list ?? [], data?.gift_data?.gift_log ?? []);
    const giftList = await ShowroomGift.find({
        gift_id: data.gift_data.gift_id_list
    }).lean();
    const giftMap = new Map();
    const userMap = new Map();
    const stageList = (stageListData?.stage_list ?? []).pop();
    if (stageList) {
        for (const userId of stageList.list){
            const u = data?.users?.find((i)=>i.user_id === userId);
            if (u) {
                userMap.set(userId, {
                    id: u.user_id,
                    comments: u.comments,
                    name: u.name,
                    avatar_id: u.avatar_id || 1
                });
            }
        }
    }
    for (const user of users){
        userMap.set(user.id, {
            ...user
        });
    }
    for (const gift of giftList){
        giftMap.set(gift.gift_id, {
            name: gift.gift_name,
            point: gift.point,
            id: gift.gift_id,
            free: gift.free,
            img: giftImageUrl('showroom',gift.gift_id),
            is_delete_from_stage: gift.is_delete_from_stage,
            user_count: 0,
            num: 0
        });
    }
    for (const giftLog of data.gift_data.gift_log ?? []){
        for (const gift of giftLog.gifts){
            const g = giftMap.get(gift.gift_id);
            if (g) {
                g.num += gift.num;
                g.user_count += 1;
            }
        }
    }
    for (const gift of giftMap.values()){
        gift.user_count = data.gift_data.gift_log.filter((i)=>i.gifts.some((g)=>String(g.gift_id) === String(gift.id))).length;
    }
    for (const freeGift of data.gift_data.free_gifts ?? []){
        const g = giftMap.get(freeGift.gift_id);
        if (g) {
            g.num += freeGift.num;
            g.user_count += freeGift.users;
        }
    }
    const gifts = (giftList ?? []).map((g)=>{
        const gift = giftMap.get(g.gift_id);
        if (gift) {
            return {
                ...gift,
                ...giftCounts(data.gift_data.gift_log,gift.id),
                ...(data.type==='showroom'?{num:gift.num,user_count:gift.user_count}:{}),
                count_source:'observed_events'
            };
        } else {
            return {
                name: g.gift_name,
                point: 0,
                id: g.gift_id,
                user_count: 0,
                free: false,
                img: giftImageUrl('showroom',g.gift_id),
                is_delete_from_stage: true,
                num: 0
            };
        }
    });
    let screenshot;
    if (env.DISABLE_SCREENSHOTS !== 'true' && data.live_info?.screenshots) {
        screenshot = {
            ...data.live_info.screenshots,
            list: (env.HALF_SCREENSHOTS === 'true' ? data.live_info?.screenshots?.list?.filter((_, idx)=>idx % 2 === 0) : data.live_info?.screenshots?.list) || []
        };
    }
    return {
        ...await parseBase(data),
        fans: fansRank,
        users: [
            ...userMap.values()
        ],
        live_info: {
            stage_list: stageList ? [
                stageList
            ] : [],
            gift: {
                log: giftPagination.gifts.map((i)=>{
                    return {
                        gifts: i.gifts.map((g)=>{
                            return {
                                id: g.gift_id,
                                num: g.num,
                                send_count: g.send_count ?? null,
                                date: g.date.toISOString()
                            };
                        }),
                        total: i.total,
                        user_id: i.user_id
                    };
                }),
                next_page: giftPagination.next_page,
                list: gifts.sort((a, b)=>{
                    if (a.point === b.point) {
                        return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
                    } else {
                        return b.point - a.point;
                    }
                })
            },
            viewers: {
                num: data.live_info.viewers.peak,
                active: data.live_info.viewers.active,
                is_excitement: data.live_info.viewers.is_excitement
            },
            comments: data.live_info.comments,
            background_image: data.live_info.background_image,
            screenshot,
            duration: data.live_info.duration,
            date: {
                start: data.live_info.date.start.toISOString(),
                end: data.live_info.date.end.toISOString()
            }
        },
        type: 'showroom'
    };
}
export async function parseIDN(data) {
    await ensureIdnGifts(env);
    const giftPagination = getGiftPagination(data);
    const giftList = await IDNGift.find({
        slug: data.gift_data.gift_id_list
    }).lean();
    const giftMap = new Map();
    const users = giftPagination.users.map((i)=>{
        return {
            id: i.user_id,
            name: i.name,
            avatar_url: i.avatar_url || '',
            comments: i.comments
        };
    });
    for (const gift of giftList){
        giftMap.set(gift.slug, {
            name: gift.name,
            point: gift.gold,
            id: gift.slug,
            free: false,
            img: gift.image_url ? giftImageUrl('idn',gift.slug) : '',
            image_available: Boolean(gift.image_url),
            user_count: 0,
            num: 0
        });
    }
    for (const giftLog of data.gift_data.gift_log ?? []){
        for (const gift of giftLog.gifts){
            const g = giftMap.get(String(gift.gift_id));
            if (g) {
                g.num += gift.num || 1;
                g.user_count += 1;
            }
        }
    }
    for (const gift of giftMap.values()){
        gift.user_count = data.gift_data.gift_log.filter((i)=>i.gifts.some((g)=>String(g.gift_id) === String(gift.id))).length;
    }
    const gifts = (giftList ?? []).map((g)=>{
        const gift = giftMap.get(g.slug);
        if (gift) {
            return {
                ...gift,
                ...giftCounts(data.gift_data.gift_log,gift.id),
                ...(data.type==='showroom'?{num:gift.num,user_count:gift.user_count}:{}),
                count_source:'observed_events'
            };
        } else {
            return {
                name: g.name,
                point: 0,
                id: g.slug,
                user_count: 0,
                free: false,
                img: g.image_url ? giftImageUrl('idn',g.slug) : '',
                image_available: Boolean(g.image_url),
                num: 0
            };
        }
    });
    let screenshot;
    if (env.DISABLE_SCREENSHOTS !== 'true' && data.live_info?.screenshots) {
        screenshot = {
            ...data.live_info.screenshots,
            list: (env.HALF_SCREENSHOTS === 'true' ? data.live_info?.screenshots?.list?.filter((_, idx)=>idx % 2 === 0) : data.live_info?.screenshots?.list) || []
        };
    }
    return {
        ...await parseBase(data),
        idn: data.idn,
        fans: [...(data.gift_data?.gift_log||[])].sort((a,b)=>(b.total||0)-(a.total||0)).slice(0,50).map((entry,index)=>{const person=data.users?.find(u=>String(u.user_id)===String(entry.user_id));return {rank:index+1,id:String(entry.user_id),name:person?.name||'Viewer',avatar_url:person?.avatar_url||'',gold:entry.total||0,source:'observed_chat'};}),
        live_info: {
            duration: data.live_info.duration,
            gift: {
                log: giftPagination.gifts.map((i)=>{
                    return {
                        gifts: i.gifts.map((g)=>{
                            return {
                                id: g.gift_id,
                                num: g.num || 1,
                                send_count: g.send_count ?? null,
                                date: g.date.toISOString()
                            };
                        }),
                        total: i.total,
                        user_id: i.user_id
                    };
                }),
                next_page: giftPagination.next_page,
                list: gifts.sort((a, b)=>{
                    if (a.point === b.point) {
                        return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
                    } else {
                        return b.point - a.point;
                    }
                })
            },
            viewers: {
                num: data.live_info.viewers.peak,
                active: data.live_info.viewers.active,
                is_excitement: false
            },
            comments: data.live_info.comments,
            screenshot,
            date: {
                start: data.live_info.date.start.toISOString(),
                end: data.live_info.date.end.toISOString()
            }
        },
        users,
        type: 'idn'
    };
}
export async function getRecentDetails(c) {
    const id = c.req.param('id');
    const data = await LiveLog.findOne({
        $or: [
            {
                data_id: id
            },
            {
                live_id: id
            },
            {
                live_id: Number(id)
            }
        ]
    }).select('-users').populate({
        path: 'room_info',
        options: {
            select: '-_id name img url -room_id member_data is_group generation group img_square',
            populate: {
                path: 'member_data',
                select: 'info name slug jkt48id'
            }
        }
    }).lean();
    if (!data) throw createError({
        statusMessage: 'Data not found!',
        statusCode: 404
    });
    const userData = await UserLog.findOne({
        data_id: data.data_id
    });
    data.users = userData?.users ?? [];
    if (data.type === 'showroom') {
        return {
            ...await parseShowroom(data)
        };
    } else {
        return {
            ...await parseIDN(data)
        };
    }
}
