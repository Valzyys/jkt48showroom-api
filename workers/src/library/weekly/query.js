import dayjs from 'dayjs';
import LiveLog from '@/database/live/schema/LiveLog';
import IdolMember from '@/database/schema/48group/IdolMember';
export async function getMember() {
    return await IdolMember.find({
        'info.is_graduate': false,
        'group': 'jkt48'
    });
}
export async function getOneWeekLives(members, type) {
    const liveType = type !== 'idn' && type !== 'showroom' ? undefined : type;
    const query = {
        'room_id': members.map((i)=>i.showroom_id),
        'live_info.date.end': {
            $gte: dayjs().subtract(7, 'day').startOf('day')
        }
    };
    if (liveType) {
        query.type = liveType;
    }
    return await LiveLog.find(query);
}
