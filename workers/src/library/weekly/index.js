import { env } from '@/runtime/env';
import { ApiError } from '@/utils/errorResponse';
import weeklyDuration from './type/duration';
import weeklyFollower from './type/follower';
import weeklyGifts from './type/gifts';
import weeklyNolive from './type/nolive';
import totalTheater from './type/theater';
import totalLive from './type/totalLive';
import weeklyViewers from './type/viewers';
const weeklyType = [
    'theater',
    'gift',
    'live',
    'duration',
    'viewers',
    'nolive',
    'follower'
];
const formats = [
    'raw',
    'normal',
    'extended'
];
export default async function getWeekly(ctx) {
    const apiKey = ctx.req.query('api_key');
    if (apiKey !== env.API_KEY) throw new ApiError({
        status: 401,
        message: 'Unauthorized!'
    });
    let format = ctx.req.query('format');
    if (!formats.includes(format) || !format) {
        format = 'normal';
    }
    const queryPlatform = ctx.req.query('platform');
    const queryType = ctx.req.query('type');
    const platform = queryPlatform !== 'showroom' && queryPlatform !== 'idn' ? 'all' : queryPlatform;
    const type = weeklyType.includes(queryType ?? '') ? queryType : 'live';
    function get() {
        if (type === 'live') {
            return totalLive(platform, format);
        } else if (type === 'gift') {
            return weeklyGifts(platform, format);
        } else if (type === 'theater') {
            return totalTheater(format);
        } else if (type === 'duration') {
            return weeklyDuration(platform, format);
        } else if (type === 'viewers') {
            return weeklyViewers(platform, format);
        } else if (type === 'nolive') {
            return weeklyNolive(format);
        } else if (type === 'follower') {
            return weeklyFollower(platform, format);
        }
        throw new ApiError({
            message: 'not implemented yet',
            status: 500
        });
    }
    const res = await get();
    return {
        ...res,
        type,
        data: res.data
    };
}
