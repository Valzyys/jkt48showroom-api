import { env } from '@/runtime/env';
import { scrapeTarget } from '@/runtime/scrape-target';
let index=0;
export default async function scrapeRequest(url) {
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  try {
    const response=await fetch(scrapeTarget(url,env,index++),{signal:controller.signal,headers:{'User-Agent':'JKT48ShowroomAPI/0.14.2'}});
    if(!response.ok)throw Object.assign(new Error(`JKT48 scrape returned HTTP ${response.status}`),{status:502});
    return await response.text();
  } finally {clearTimeout(timer);}
}
