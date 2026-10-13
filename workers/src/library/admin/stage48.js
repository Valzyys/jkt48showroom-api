import IdolMember from '@/database/schema/48group/IdolMember';
export async function getStage48(group = null) {
    try {
        if (group === 'all') group = null;
        const members = await IdolMember.find(group ? {
            group
        } : {}).lean();
        return members.sort((a, b)=>a.name.localeCompare(b.name));
    } catch (e) {
        console.error(e);
        return [];
    }
}
