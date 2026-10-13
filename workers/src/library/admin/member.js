import Showroom from '@/database/schema/showroom/Showroom';
export async function getMembers(c) {
    try {
        const group = c.req.query('group');
        const members = await Showroom.find(group ? {
            group
        } : {}).populate({
            path: 'member_data'
        }).lean();
        return members.map((i)=>{
            if (!i.member_data) i.member_data = null;
            return i;
        }).sort((a, b)=>a.name.localeCompare(b.name));
    } catch (e) {
        console.error(e);
        return [];
    }
}
