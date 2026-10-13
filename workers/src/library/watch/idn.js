import IdolMember from '@/database/schema/48group/IdolMember';
import cache from '@/utils/cache';
import { createError } from '@/utils/errorResponse';
import singleflight from '@/utils/singleflight';
import { getIDNLives } from '../idn/lives';
export async function getIDNLive(c) {
    return await fetch(c);
}
export async function fetch(c) {
    const username = c.req.param('id');
    if (username === 'undefined') throw createError({
        status: 400,
        message: 'Bad request!'
    });
    const lives = await singleflight.do('idn-lives', async ()=>await cache.fetch('idnlivess', ()=>getIDNLives(), 7000));
    const roomData = await IdolMember.findOne({
        'idn.username': username
    }).populate('showroom').catch(()=>null);
    const data = lives.find((i)=>i.user.username === username);
    if (!roomData && !data) throw createError({
        status: 404,
        message: 'Room not found!'
    });
    return {
        ...data,
        is_live: data != null,
        member_info: {
            name: roomData?.info?.nicknames?.[0] || roomData?.name,
            img: roomData?.info?.img || roomData?.showroom?.img,
            key: roomData?.showroom?.url,
            room_id: roomData?.showroom_id || roomData?.showroom?.room_id
        }
    };
}
