import { getNextLive as fetchNextLive, getAllFollows } from '@/utils/api/showroom';
import { getMembers } from './member';
export async function getNextLive(c) {
    return (await getFromCookies(null, c)).filter((i)=>i.room_id !== 318247);
}
async function getFromCookies(membersData = null, c) {
    const members = membersData ?? await getMembers(c);
    const rooms = await getAllFollows().catch(()=>[]);
    const roomMap = new Map();
    const result = [];
    const missing = [];
    for (const room of rooms){
        roomMap.set(room.room_id, room);
    }
    for (const member of members){
        const room = roomMap.get(String(member.room_id));
        const now = new Date();
        if (room) {
            if (room.has_next_live) {
                const raw = new Date(room.next_live);
                const date = new Date(`${room.next_live} ${now.getFullYear() + (now.getMonth() < raw.getMonth() || now.getDate() <= raw.getDate() ? 0 : 1)}`);
                result.push({
                    name: room.room_name,
                    img: room.image_l,
                    img_alt: member.img_alt,
                    url: room.room_url_key,
                    room_id: Number(room.room_id),
                    is_graduate: member.is_graduate,
                    is_group: member.group !== 'official',
                    room_exists: member.sr_exists,
                    date: date.toISOString()
                });
            }
        } else if (member.sr_exists) {
            missing.push(member);
        }
    }
    const lives = [];
    lives.push(...result);
    if (missing.length) {
        lives.push(...await getDirectNextLive(missing, c));
    }
    return lives;
}
async function getDirectNextLive(membersData = null, c) {
    try {
        const members = (membersData ?? await getMembers(c)).filter((i)=>i.sr_exists);
        const promises = [];
        for (const member of members){
            if (!member.room_id) continue;
            const room_id = member.room_id;
            promises.push((async ()=>{
                try {
                    const data = await fetchNextLive(room_id);
                    if (!data.epoch) return null;
                    return {
                        img: member.img,
                        url: member.url,
                        name: member.name,
                        room_id,
                        is_graduate: member.is_graduate,
                        is_group: member.group !== 'official',
                        room_exists: member.sr_exists,
                        date: new Date(new Date(data.epoch * 1000).toLocaleString('en-US', {
                            timeZone: 'Asia/Tokyo'
                        })).toISOString()
                    };
                } catch  {
                    return null;
                }
            })());
        }
        let data = (await Promise.all(promises)).filter((i)=>i);
        data = data.filter((i)=>new Date(i.date).getTime() - new Date().getTime() > 0);
        return data;
    } catch  {
        return [];
    }
}
