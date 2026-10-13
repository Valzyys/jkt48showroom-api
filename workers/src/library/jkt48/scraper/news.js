import { createJKT48Client,detailData,listData } from '@/runtime/jkt48-source';
import { env } from '@/runtime/env';
const client=headers=>createJKT48Client({base:env.JKT48_API_BASE||'https://jkt48.com/api/v1/',headers,timeout:env.UPSTREAM_TIMEOUT_MS});
const legacy=row=>({...row,id:String(row.news_id),url:`https://jkt48.com/news/${row.link}`,date:new Date(row.valid_date_from||row.valid_date_to||0),content:row.content_body||''});
export async function getNewsPage(page=1,news=[],headers) {
  const payload=await client(headers)('news',{page});
  return [...news,...listData(payload).map(legacy)];
}
export async function getAllNews(page=1,news=[],headers) {
  // Bounded batches: fetching the full archive in one Worker exceeds limits.
  const request=client(headers),limit=Math.min(10,Number(env.JKT48_NEWS_PAGES)||3);
  for(let index=0;index<limit;index++,page++) {
    const payload=await request('news',{page}),rows=listData(payload);
    news.push(...rows.map(legacy));
    if(!rows.length||page>=Number(payload._meta?.total_page||page))break;
  }
  return news;
}
export async function getNews(id,headers) {
  const raw=detailData(await client(headers)(`news/${encodeURIComponent(id)}`,{preview:false}));
  return legacy({...raw,news_id:raw.news_id||id});
}
