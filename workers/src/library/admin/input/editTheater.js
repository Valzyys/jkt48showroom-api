import JKT48NewSchedule from '@/database/showroomDB/jkt48/JKT48NewSchedule';
import Member from '@/database/showroomDB/jkt48/Member';
import { streamToString } from '@/utils';
import { notFound } from '@/utils/errorResponse';
export async function editTheater(c) {
    const body = JSON.parse(await streamToString(c.req.raw.body));
    const theaterData = await JKT48NewSchedule.findOne({
        code: body._id
    });
    if (!theaterData) throw notFound();
    const seitansaiIds = Array.isArray(body?.seitansaiIds) ? body.seitansaiIds.map((i)=>String(i).trim()).filter(Boolean) : undefined;
    const graduationIds = Array.isArray(body?.graduationIds) ? body.graduationIds.map((i)=>String(i).trim()).filter(Boolean) : undefined;
    const memberIds = Array.isArray(body?.memberIds) ? body.memberIds.map((i)=>String(i).trim()).filter(Boolean) : undefined;
    const allIds = new Set([
        ...seitansaiIds ?? [],
        ...graduationIds ?? [],
        ...memberIds ?? []
    ]);
    const members = allIds.size > 0 ? await Member.find({
        id: {
            $in: [
                ...allIds
            ]
        }
    }).lean() : [];
    const memberMap = new Map();
    for (const member of members){
        memberMap.set(String(member.id), member);
    }
    const mapData = (ids, current)=>{
        if (!ids) return current ?? [];
        return ids.map((id)=>{
            const member = memberMap.get(id);
            if (!member) return null;
            const member_id = Number(member.id);
            if (!Number.isFinite(member_id)) return null;
            return {
                name: member.name,
                type: '',
                member_id
            };
        }).filter((i)=>i != null);
    };
    const birthdayMember = mapData(seitansaiIds, theaterData.birthday_member);
    const graduationMember = mapData(graduationIds, theaterData.graduation_member ?? undefined);
    const jkt48Member = mapData(memberIds, theaterData.jkt48_member);
    const newData = {
        birthday_member: birthdayMember,
        graduation_member: graduationMember,
        jkt48_member: jkt48Member,
        is_birthday: (birthdayMember?.length ?? 0) > 0
    };
    await JKT48NewSchedule.updateOne({
        code: body._id
    }, {
        $set: newData
    });
    return newData;
}
