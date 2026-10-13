import IdolMember from '@/database/schema/48group/IdolMember';
import { createError } from '@/utils/errorResponse';
import { uploadImageBuffer } from '@/utils/imageUpload';
export async function editMemberData(c) {
    const query = await c.req.parseBody({all:true});
    if(!query._id||!query.name)throw createError({status:400,message:'Member ID and name are required'});
    const banner = query.banner instanceof File ? await uploadImageBuffer(await query.banner.arrayBuffer()) : query.banner;
    const img = query.img instanceof File ? await uploadImageBuffer(await query.img.arrayBuffer()) : query.img;
    const infoData = {
        img: img?.secure_url ?? (typeof img==='string'?img:undefined),
        banner: banner?.secure_url ?? (typeof banner==='string'?banner:undefined),
        profile_video: query.profile_video?.toString(),
        jikosokai: query.jikosokai?.toString(),
        generation: query.generation?.toString(),
        nicknames: query['nicknames[]'],
        birthdate: query.birthdate ? new Date(query.birthdate.toString()) : undefined
    };
    const data = {
        name: query.name.toString(),
        stage48: query.stage48?.toString(),
        group: query.group?.toString(),
        jkt48id: query['jkt48id[]'],
        ...(query.idn_username!==undefined?{idn:{username:query.idn_username.toString()}}:{}),
        slug: query.slug?.toString()
    };
    const missingSR = query['live_data.missing.showroom'];
    const missingIDN = query['live_data.missing.idn'];
    if (missingSR || missingIDN) {
        data.live_data = {
            missing: {
                showroom: Number(missingSR) || 0,
                idn: Number(missingIDN) || 0
            }
        };
    }
    const rawSocials = query['socials[]'];
    if (rawSocials) {
        const socials = [];
        for (const s of rawSocials){
            try {
                socials.push(JSON.parse(s));
            } catch (_e) {
                console.error(_e);
                throw createError({
                    status: 400,
                    message: 'Data parse error!'
                });
            }
        }
        if (socials[0] && (!('url' in socials[0]) || !('title' in socials[0]))) throw createError({
            status: 400,
            message: 'Data is wrong!'
        });
        data['info.socials'] = socials;
    }
    for (const key of Object.keys(infoData)){
        data[`info.${key}`] = infoData[key];
    }
    const member = await IdolMember.findOneAndUpdate({
        _id: query._id
    }, {
        $set: data
    }, {
        runValidators: true
    });
    const newMember = await IdolMember.findOne({
        _id: query._id
    });
    if (member == null) throw createError({
        statusCode: 400,
        message: 'Bad request!'
    });
    return newMember;
}
