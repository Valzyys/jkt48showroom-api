import {recentGiftCatalog} from './gift-catalog';
import {giftAvailability, presentGiftEvent} from './gift-presentation';
import {idnGoldSummary} from '../../idn/ranking';
import {giftCounts} from './gift-counts';
import Fuse from 'fuse.js';
import config from '@/config';
import LiveLog from '@/database/live/schema/LiveLog';
import UserLog from '@/database/userDB/UserLog';
import { createError } from '@/utils/errorResponse';
function notEmpty(value) {
    return value !== null && value !== undefined;
}
export async function getGifts(c) {
    const data_id = c.req.param('data_id') || '';
    const data = await LiveLog.findOne({
        data_id
    }).select({
        gift_data: 1,
        type: 1,
        users: -1
    }).lean();
    if (!data) throw createError({
        status: 404,
        message: 'Gifts not found!'
    });
    const userData = await UserLog.findOne({
        data_id
    }).select({
        users: 1
    }).lean();
    data.users = userData?.users ?? [];
    if (data.type === 'showroom') {
        return parseGift(c, data);
    } else {
        return parseGift(c, data);
    }
}
function getUserShowroom(data, gifts) {
    const users = [];
    for (const usr of gifts){
        const u = data?.users?.find((i)=>i.user_id === usr.user_id);
        if (u) {
            users.push({
                id: u.user_id,
                name: u.name,
                avatar_id: u.avatar_id || 1,
                comments: u.comments
            });
        }
    }
    return users;
}
function getUserIDN(data, gifts) {
    const users = [];
    for (const usr of gifts){
        const u = data?.users?.find((i)=>i.user_id === usr.user_id);
        if (u) {
            users.push({
                id: u.user_id,
                name: u.name,
                avatar_url: u.avatar_url || '',
                comments: u.comments
            });
        }
    }
    return users;
}
async function parseGift(c, data) {
    const catalog = await recentGiftCatalog(data);
    const gold = data.type === 'idn' ? idnGoldSummary(data.gift_data?.gift_log || [], data.gift_data?.provider_ranking, data.users || []) : null;
    let page = Number(c.req.query('page') || 1);
    const search = c.req.query('s') || '';
    const perpage = Number(c.req.query('perpage') || config.giftPerpage);
    let total_count = data?.gift_data?.gift_log?.length ?? 0;
    const raw = data?.gift_data?.gift_log ?? [];
    const usersData = (data?.users ?? []).map((i)=>{
        return {
            user_id: String(i.user_id),
            name: i.name,
            comments: i.comments,
            avatar_id: i.avatar_id,
            avatar_url: i.avatar_url
        };
    });
    let giftLogs = [];
    if (search !== '') {
        const fuse = new Fuse(usersData, {
            keys: [
                'name'
            ],
            threshold: 0.45
        });
        const searched = fuse.search(search);
        const giftLogsSearch = searched.map((i)=>{
            const giftData = raw.find((g)=>String(g.user_id) === String(i.item.user_id));
            if (!giftData) return null;
            return {
                ...giftData
            };
        }).filter(notEmpty);
        total_count = giftLogsSearch.length;
        giftLogs.push(...giftLogsSearch.slice(perpage * (page - 1), perpage * page));
    } else {
        giftLogs = raw.slice(perpage * (page - 1), perpage * page);
    }
    let users;
    if (data.type === 'showroom') {
        users = getUserShowroom(data, giftLogs);
    } else {
        users = getUserIDN(data, giftLogs);
    }
    if (page < 1) page = 1;
    return {
        gift_summary: giftAvailability(data, gold),
        ...(gold ? {fans: gold.fans, gold_summary: {...gold, fans: undefined}} : {}),
        list: [...catalog.values()].map(gift => ({...gift, ...giftCounts(data.gift_data?.gift_log, gift.id), image_available: Boolean(gift.img), count_source: 'observed_events'})),
        gifts: giftLogs.map((i)=>{
            return {
                ...i,
                gifts: i.gifts.map(g => presentGiftEvent(g, catalog))
            };
        }),
        users,
        perpage,
        search,
        page,
        total_count
    };
}
