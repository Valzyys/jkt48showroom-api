import IdolMember from '@/database/schema/48group/IdolMember';
import Showroom from '@/database/schema/showroom/Showroom';
import JKT48Member from '@/database/showroomDB/jkt48/Member';
import { createError } from '@/utils/errorResponse';
export async function getMemberDataForEdits(c) {
    const room_id = c.req.query('room_id');
    const member = await Showroom.findOne({
        room_id
    }).populate({
        path: 'member_data'
    }).lean();
    if (!member) throw createError({
        status: 404,
        message: 'Member not found!'
    });
    const stage48members = await IdolMember.find({}).lean();
    const jkt48members = await JKT48Member.find({}).lean();
    return {
        member,
        stage48members,
        jkt48members
    };
}
