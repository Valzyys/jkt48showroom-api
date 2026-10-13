import { randomUUID } from 'crypto';
import dayjs from 'dayjs';
import tz from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { ofetch } from '@/runtime/http';
import IdolMember from '@/database/schema/48group/IdolMember';
import { sleep } from '@/utils';
dayjs.extend(utc);
dayjs.extend(tz);
function getShowroomFollower(room_id) {
    return ofetch('https://www.showroom-live.com/api/room/profile', {
        headers: {
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0'
        },
        query: {
            room_id
        }
    });
}
function getIDNFollower(uuid) {
    return ofetch('https://mobile-api.idn.app/v3.1/profile/follow', {
        headers: {
            'x-api-key': '1ccc5bc4-8bb4-414c-b524-92d11a85a818',
            'x-request-id': randomUUID(),
            'User-Agent': 'Android/9/SM-S9260'
        },
        query: {
            uuid
        }
    });
}
async function scrapeAll(member, showroomData = null, idnData = null, retry = 0) {
    const res = await Promise.allSettled([
        async ()=>{
            return {
                type: 'showroom',
                data: showroomData || await getShowroomFollower(member.showroom_id ?? 0)
            };
        },
        async ()=>{
            return {
                type: 'idn',
                data: idnData || await getIDNFollower(String(member.idn?.id))
            };
        }
    ].map((i)=>i()));
    let sr = null;
    let idn = null;
    for (const r of res){
        if (r.status === 'fulfilled') {
            if (r.value.type === 'showroom') {
                sr = r.value.data;
            } else {
                idn = r.value.data;
            }
        }
    }
    if (!sr || !idn) {
        if (retry < 5) {
            await sleep(500);
            return await scrapeAll(member, sr, idn, retry + 1);
        }
        throw new Error('Failed to fetch data!');
    }
    return {
        member,
        showroom: sr,
        idn
    };
}
export default async function scrapeFollower() {
    const members = await IdolMember.find({
        'info.is_graduate': false,
        'group': 'jkt48'
    });
    const promises = members.map(async (i)=>{
        if (!i.idn?.id) {
            console.error(`${i.name} is missing idn live id!`);
        }
        if (!i.showroom_id || !i.idn?.id) return null;
        const data = await scrapeAll(i);
        return {
            memberData: i,
            showroom: data.showroom,
            idn_follower: data.idn
        };
    });
    const res = (await Promise.all(promises)).filter((i)=>i != null);
    return res.map((i)=>{
        const date = dayjs().tz('Asia/Jakarta').startOf('day');
        return {
            name: i.memberData.name,
            fetchId: `${i.memberData.showroom_id}${date.format('DDMMYY')}`,
            date: date.toDate(),
            showroom: {
                id: i.memberData.showroom_id,
                level: i.showroom.room_level,
                follower: i.showroom.follower_num
            },
            idn: {
                id: i.memberData.idn.id,
                follower: i.idn_follower.data.follower_count
            }
        };
    });
}
