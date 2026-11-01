import {test,after} from 'node:test';import assert from 'node:assert/strict';import {Miniflare} from 'miniflare';import {newsCardOperation,newsImages,serveNewsCard} from '../src/collector/news-cards.js';
const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',d1Databases:['DB'],r2Buckets:['R2'],compatibilityDate:'2026-07-01'});after(()=>mf.dispose());const DB=await mf.getD1Database('DB'),IMAGES_BUCKET=await mf.getR2Bucket('R2'),env={DB,IMAGES_BUCKET};await DB.prepare('CREATE TABLE documents(database_name TEXT,collection_name TEXT,id TEXT,document TEXT,version INTEGER DEFAULT 1)').run();await DB.prepare('CREATE TABLE cache_entries(key TEXT)').run();
await DB.prepare('INSERT INTO documents(database_name,collection_name,id,document)VALUES(?,?,?,?)').bind('jkt48DB','jkt48newnews','news1',JSON.stringify({news_id:1900,title:'Official news',category:'Event',link:'official-news',valid_date_from:'2026-10-27T12:00:00Z',content_body:'<p>Full article</p><img src="media/news/a.jpg">'})).run();
const request=(path,method='GET',body,headers={})=>new Request('https://api.test/internal/collector/news-cards/'+path,{method,headers,...(body?{body}: {})});
test('news cards remain pending until every page is uploaded and serve immutable R2 images',async()=>{
 assert.equal((await newsCardOperation(request('refresh','POST'),env)).status,200);const {job}=await(await newsCardOperation(request('jobs'),env)).json();assert.equal(job.snapshot.content,'<p>Full article</p><img src="media/news/a.jpg">');assert.equal(job.theme,'jkt48connect');assert.equal((await newsImages(DB,['1900'],'https://api.test')).get('1900').status,'pending');
 const png=new Uint8Array(24);png.set([137,80,78,71,13,10,26,10]);new DataView(png.buffer).setUint32(16,1600);new DataView(png.buffer).setUint32(20,400);
 const path=job.data_id+'/'+job.source_version+'/',headers={'X-Render-Token':job.render_token,'X-Page-Count':'2'};
 assert.equal((await newsCardOperation(request(path+'1','PUT',png,headers),env)).status,200);assert.equal((await newsImages(DB,['1900'])).get('1900').status,'pending');
 assert.equal((await newsCardOperation(request(path+'2','PUT',png,headers),env)).status,200);const card=(await newsImages(DB,['1900'],'https://api.test')).get('1900');assert.equal(card.status,'ready');assert.equal(card.images.length,2);assert.equal(card.images[0].height,400);
 const r=await serveNewsCard(new Request(card.url),env);assert.equal(r.status,200);assert.equal(r.headers.get('X-Media-Storage'),'r2');assert.match(r.headers.get('Cache-Control'),/immutable/);
 assert.equal((await newsCardOperation(request(path+'1','PUT',png,headers),env)).status,409);
 assert.equal((await(await newsCardOperation(request('jobs'),env)).json()).job,null);
});
test('news image routes reject path injection and invalid formats',async()=>{
 assert.equal((await serveNewsCard(new Request('https://api.test/media/news/not-valid'),env)).status,400);
 assert.equal((await serveNewsCard(new Request('https://api.test/media/news/jkt48connect/v1/1900/'+'a'.repeat(24)+'/1.png?x=1'),env)).status,400);
});
