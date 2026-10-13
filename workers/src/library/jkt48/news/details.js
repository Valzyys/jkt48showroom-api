import JKT48NewNews from '@/database/showroomDB/jkt48/JKT48NewNews';
import News from '@/database/showroomDB/jkt48/News';
import { notFound } from '@/utils/errorResponse';
import { env } from '@/runtime/env';
import { fetchNewsDetail } from '../scraper/sync';
export async function getNewsDetail(id) {
    let data = await JKT48NewNews.findOne({
        $or: [
            {
                link: id
            },
            {
                news_id: Number.parseInt(id) || -1
            }
        ]
    }).lean();
    if(env.JKT48_AUTO_SYNC!=='false'&&(!data||!data.content_body)) {
        try {data=await fetchNewsDetail(id);}
        catch(error){if(!data&&!(await News.exists({id})))throw error;}
    }
    if (!data) {
        const news = await News.findOne({
            id
        }).lean();
        if (!news) throw notFound();
        delete news._id;
        delete news.__v;
        return news;
    }
    return {
        date: new Date(data.valid_date_from ?? 0),
        id: String(data.news_id),
        title: data.title,
        category: data.category,
        url: `https://jkt48.com/news/${data.link}`,
        content: data.content_body ?? '',
        slug: data.link
    };
}
