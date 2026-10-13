import { env } from '@/runtime/env';
import { ofetch } from '@/runtime/http';
export async function getProfile(c) {
    const srSess = c.get('showroom_session');
    const body = c.req.query();
    const data = await ofetch(`${env.SHOWROOM_API}/api/room/profile`, {
        query: {
            room_id: body.room_id
        },
        headers: {
            Cookie: `sr_id=${srSess?.sr_id}`
        }
    });
    return {
        follower: data.follower_num,
        is_follow: data.is_follow,
        visit_count: data.visit_count,
        room_level: data.room_level
    };
}
