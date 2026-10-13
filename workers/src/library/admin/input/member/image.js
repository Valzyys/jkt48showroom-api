import IdolMember from '@/database/schema/48group/IdolMember';
import { createError } from '@/utils/errorResponse';
import { uploadImageBuffer } from '@/utils/imageUpload';
export async function setImage(c) {
    const body = await c.req.parseBody();
    if (!body.id) throw createError({
        statusCode: 400,
        statusMessage: 'Bad request!'
    });
    if (!body.image) throw createError({
        statusCode: 400,
        statusMessage: 'Image not included!'
    });
    const member = await IdolMember.findOne({
        _id: body.id
    });
    if (!member) throw createError({
        statusCode: 400,
        statusMessage: 'Bad request!'
    });
    const img = await uploadImageBuffer(await body.image.arrayBuffer());
    member.info.img = img.secure_url;
    await member.save();
    return {
        url: img.secure_url,
        status: 200
    };
}
