import {newsImages} from '../../../collector/news-cards.js';
import {env} from '../../../runtime/env.js';
import JKT48NewNews from '@/database/showroomDB/jkt48/JKT48NewNews';
import { pagination } from '@/runtime/jkt48-source';
export async function getNews(c) {
    const total = await JKT48NewNews.countDocuments({});
    const {page,perpage}=pagination(c.req.query('page'),c.req.query('perpage'),total);
    const news = await JKT48NewNews.find({}).limit(perpage).skip((page - 1) * perpage).sort('-valid_date_from').select('title label news_id category link valid_date_from valid_date_to').lean();
    const images=await newsImages(env.DB,news.map(i=>String(i.news_id)),new URL(c.req.url).origin);
    return {
        news: news.map((i)=>{
            return {
                news_image: images.get(String(i.news_id)),
                date: new Date(i.valid_date_from ?? i.valid_date_to ?? 0),
                title: i.title,
                category: i.category,
                id: String(i.news_id),
                link: i.link,
                url: `https://jkt48.com/news/${i.link}`
            };
        }),
        page,
        perpage,
        total_count: total
    };
}
