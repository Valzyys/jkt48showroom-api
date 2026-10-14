import config from '@/config';
import IdolMember from '@/database/schema/48group/IdolMember';
export async function getMembers(c) {
    const group = c == null ? 'jkt48' : typeof c === 'string' ? c || 'jkt48' : c.req.query('group') || 'jkt48';
    return fetch(group);
}
async function fetch(group = null) {
    try {
        const options = {};
        options.group = [];
        if (group === 'jkt48') options.group.push('official');
        if (group) options.group.push(group);
        const members = await IdolMember.find(options).populate('showroom').lean();
        return members.map((member)=>{
            return {
                _id: member._id,
                jkt48_id: member.jkt48id?.[0] ?? undefined,
                name: member.name,
                nicknames: member?.info?.nicknames || [],
                img: member?.showroom?.img ?? member.info?.img ?? config.errorPicture,
                img_alt: member.info?.img ?? config.errorPicture,
                url: member.slug,
                group: member.group,
                socials: member?.info?.socials,
                room_id: member.showroom_id,
                archive_room_ids: member.collector_room_ids||[],
                sr_exists: member?.showroom?.room_exists ?? false,
                is_graduate: member.info?.is_graduate ?? member.group !== 'official',
                generation: member.info?.generation,
                team: member.team,
                idn_username: member.idn?.username
            };
        }).sort((a, b)=>a.name.localeCompare(b.name));
    } catch (e) {
        console.error(e);
        throw e;
    }
}
