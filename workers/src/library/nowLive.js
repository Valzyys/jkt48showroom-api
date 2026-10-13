import { env } from '@/runtime/env';
import dayjs from 'dayjs';
import { getAllFollows, getIsLive, getOnlives, getProfile, getStreamingURL } from '@/utils/api/showroom';
import { getMembers } from './member';
export async function getNowLive(c) {
    return new Promise((resolve, reject)=>{
        const group = c.req.query('group') || undefined;
        getNowLiveCookies(null, group).then((r)=>{
            resolve(r);
        }).catch(()=>{
            console.error(new Error('ERROR CHANGE TO BACKUP'));
            console.log('ERROR change to backup');
            return getNowLiveIndirect(null, group).then((r)=>{
                resolve(r);
                console.log('now live indirect', r);
            }).catch((e)=>{
                console.error(e);
                reject(e);
            });
        });
    });
}
export async function getNowLiveDirect(membersData = null, group = 'jkt48') {
    const members = membersData ?? await getMembers(group);
    const promises = [];
    for (const member of members){
        if (!member.room_id) continue;
        const room_id = member.room_id;
        promises.push((async ()=>{
            try {
                const data = await getIsLive(room_id);
                if (!data.ok) return null;
                const profile = await getProfile(member.room_id ?? 0);
                const streamURLS = await getStreamingURL({
                    room_id: member.room_id
                }).catch(()=>null);
                return {
                    name: member.name,
                    img: member.img,
                    img_alt: member.img_alt,
                    group: member?.group === 'hinatazaka46' ? 'hinatazaka46' : 'jkt48',
                    url_key: member.url,
                    room_id,
                    is_graduate: member.is_graduate,
                    is_group: member.group === 'official',
                    started_at: dayjs((profile.current_live_started_at ?? 0) * 1000).toISOString(),
                    type: 'showroom',
                    streaming_url_list: (streamURLS?.streaming_url_list ?? []).filter((i)=>i.type === 'hls').map((i)=>{
                        return {
                            label: i.label,
                            quality: i.quality,
                            url: i.url
                        };
                    })
                };
            } catch (e) {
                console.error(e);
                return null;
            }
        })());
    }
    const data = await Promise.all(promises);
    return data.filter((i)=>i);
}
async function newOnlivesCookies() {}
export async function getNowLiveCookies(membersData = null, group = 'jkt48') {
    const members = membersData ?? await getMembers(group);
    const rooms = await getAllFollows().catch(()=>[]);
    const roomMap = new Map();
    const result = [];
    const missing = [];
    for (const room of rooms){
        roomMap.set(room.room_id, room);
    }
    for (const member of members){
        if (!member.room_id) continue;
        const room = roomMap.get(String(member.room_id));
        if (room) {
            if (room.is_online) {
                let isPremium = false;
                result.push((async ()=>{
                    const streamURLS = await getStreamingURL({
                        room_id: room.room_id
                    }, env.SR_ID || '').catch((e)=>{
                        console.error(e);
                        return {
                            streaming_url_list: []
                        };
                    });
                    const profile = await getProfile(room.room_id).catch((e)=>{
                        if (e.data?.errors && e.data?.errors[0]?.redirect_url) {
                            isPremium = true;
                        }
                    });
                    return {
                        name: room.room_name,
                        img: room.image_l,
                        img_alt: member.img_alt,
                        url_key: room.room_url_key,
                        room_id: Number(room.room_id),
                        group: member?.group === 'hinatazaka46' ? 'hinatazaka46' : 'jkt48',
                        started_at: dayjs((profile?.current_live_started_at ?? 0) * 1000).toISOString(),
                        is_graduate: member.is_graduate,
                        is_group: member.group === 'official',
                        type: 'showroom',
                        streaming_url_list: (streamURLS.streaming_url_list ?? []).filter((i)=>i.type === 'hls').map((i)=>{
                            return {
                                label: i.label,
                                quality: i.quality,
                                url: i.url
                            };
                        }),
                        is_premium: isPremium
                    };
                })());
            }
        } else if (member.sr_exists) {
            missing.push(member);
        }
    }
    const lives = [];
    lives.push(...await Promise.all(result));
    if (missing.length) {
        lives.push(...await getNowLiveDirect(missing, group));
    }
    return lives;
}
export async function getNowLiveIndirect(membersData = null, group = 'jkt48') {
    const members = membersData ?? await getMembers(group);
    console.log(members);
    const memberMap = new Map();
    for (const member of members){
        if (!member.room_id) continue;
        memberMap.set(member.room_id, member);
    }
    const res = await getOnlives();
    const all = res.onlives.reduce((a, b)=>{
        a.push(...b.lives);
        return a;
    }, []);
    const result = [];
    for (const room of all){
        const member = memberMap.get(room.room_id);
        if (member) {
            result.push({
                name: room.main_name,
                img: room.image,
                img_alt: member.img_alt,
                url_key: room.room_url_key,
                group: member?.group === 'hinatazaka46' ? 'hinatazaka46' : 'jkt48',
                room_id: room.room_id,
                started_at: dayjs((room.started_at ?? 0) * 1000).toISOString(),
                is_graduate: member.is_graduate,
                is_group: member.group === 'official',
                type: 'showroom',
                streaming_url_list: (room.streaming_url_list ?? []).filter((i)=>i.type === 'hls').map((i)=>{
                    return {
                        label: i.label,
                        quality: i.quality,
                        url: i.url
                    };
                })
            });
        }
    }
    return result;
}
