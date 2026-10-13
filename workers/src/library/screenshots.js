import { env } from '@/runtime/env';
import LiveLog from '@/database/live/schema/LiveLog';
import { createError } from '@/utils/errorResponse';
export async function getScreenshots(c) {
    return await fetchData(c.req.param('id') || '0');
}
async function fetchData(data_id) {
    if (env.DISABLE_SCREENSHOTS === 'true') {
        throw createError({
            statusCode: 404,
            message: 'Not found!'
        });
    }
    const data = await LiveLog.findOne({
        data_id
    }).select({
        'live_info.screenshots': 1
    }).lean();
    if (!data?.live_info?.screenshots) {
        throw createError({
            statusCode: 404,
            message: 'Not found!'
        });
    }
    return {
        ...data.live_info.screenshots,
        list: env.HALF_SCREENSHOTS ? data.live_info.screenshots.list.filter((_, idx)=>idx % 2 === 0) : data.live_info.screenshots.list
    };
}
