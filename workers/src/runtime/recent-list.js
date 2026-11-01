// List summaries never hydrate gift logs, user logs, or all member relations.
// Keep fuzzy searches on the existing search path; ordinary pages use indexed SQL.
export async function recentPage(db, query = {}, development = false, includeCards = false) {
  if (query.search) return null;
  const page = Math.max(1, Math.floor(Number(query.page) || 1));
  const perpage = Math.max(1, Math.min(30, Math.floor(Number(query.perpage) || 10)));
  const sorts = {date:'live_info.date.end',gift:'c_gift',views:'live_info.viewers.peak',duration:'live_info.duration'};
  const sort = Object.hasOwn(sorts,query.sort) ? query.sort : 'date', direction = Number(query.order)>0?'ASC':'DESC';
  const where = ["l.database_name='liveDB'", "l.collection_name='livelogs'", "COALESCE(json_extract(l.document,'$.capture.status'),'completed')!='live'"];
  const args = [];
  if (!development) where.push("json_extract(l.document,'$.is_dev')=0");
  if (query.type && query.type!=='all') { where.push("json_extract(l.document,'$.type')=?"); args.push(query.type); }
  if (query.room_id) { where.push("json_extract(l.document,'$.room_id')=?"); args.push(Number(query.room_id)); }
  else {
    const group = query.group || 'jkt48', groups = group==='jkt48'?['official','jkt48']:[group];
    const graduate = query.filter==='graduated'?1:query.filter==='active'?0:null;
    const members = "SELECT document FROM documents WHERE database_name='dcDB' AND collection_name='idolmembers' AND json_extract(document,'$.group') IN (SELECT value FROM json_each(?))" + (graduate===null?'':" AND COALESCE(json_extract(document,'$.info.is_graduate'),json_extract(document,'$.group')!='official')="+graduate);
    where.push("json_extract(l.document,'$.room_id') IN (WITH members AS ("+members+") SELECT json_extract(document,'$.showroom_id') FROM members UNION SELECT r.value FROM members,json_each(members.document,'$.collector_room_ids') r)"); args.push(JSON.stringify(groups));
    if(query.date)try{const date=JSON.parse(query.date);where.push("julianday(json_extract(l.document,'$.live_info.date.end'))>=julianday(?) AND julianday(json_extract(l.document,'$.live_info.date.end'))<=julianday(?)");args.push(new Date(Number(date.start)).toISOString(),new Date(Number(date.end)).toISOString())}catch{}
  }
  if(sort==='views')where.push("COALESCE(json_extract(l.document,'$.live_info.viewers.peak'),-1)!=0");
  const condition=where.join(' AND ');
  const projection="json_object('_id',COALESCE(json_extract(l.document,'$._id'),l.id),'data_id',json_extract(l.document,'$.data_id'),'custom',json_extract(l.document,'$.custom'),'idn',json_extract(l.document,'$.idn'),'live_info',json_object('duration',json_extract(l.document,'$.live_info.duration'),'date',json_extract(l.document,'$.live_info.date'),'viewers',json_extract(l.document,'$.live_info.viewers')),'recordings',json_extract(l.document,'$.recordings'),'capture',json_extract(l.document,'$.capture'),'total_gifts',json_extract(l.document,'$.total_gifts'),'created_at',json_extract(l.document,'$.created_at'),'room_id',json_extract(l.document,'$.room_id'),'gift_rate',json_extract(l.document,'$.gift_rate'),'type',json_extract(l.document,'$.type'))";
  const statements=[
    db.prepare(`SELECT ${projection} AS summary,s.document AS room,m.document AS member FROM documents l LEFT JOIN documents s ON s.database_name='dcDB' AND s.collection_name='showrooms' AND json_extract(s.document,'$.room_id')=json_extract(l.document,'$.room_id') LEFT JOIN documents m ON m.database_name='dcDB' AND m.collection_name='idolmembers' AND m.id=json_extract(s.document,'$.member_data') WHERE ${condition} ORDER BY json_extract(l.document,'$.${sorts[sort]}') ${direction} LIMIT ? OFFSET ?`).bind(...args,perpage,(page-1)*perpage),
    db.prepare('SELECT count(*) AS total FROM documents l WHERE '+condition).bind(...args)
  ];
  if(includeCards)statements.push(db.prepare(`WITH wanted AS (SELECT json_extract(l.document,'$.data_id') AS data_id,COALESCE(json_extract(l.document,'$.leaderboard_source_version'),l.version) AS current_version FROM documents l WHERE ${condition} ORDER BY json_extract(l.document,'$.${sorts[sort]}') ${direction} LIMIT ? OFFSET ?) SELECT wanted.data_id,wanted.current_version,layouts.value AS layout,themes.value AS theme,c.state,c.source_version,c.design_version,c.width,c.height,c.updated_at FROM wanted CROSS JOIN json_each('["portrait","banner"]') layouts CROSS JOIN json_each('["photobook","jkt48connect","avonera48"]') themes LEFT JOIN collector_leaderboards c ON c.data_id=wanted.data_id AND c.layout=layouts.value AND c.theme=themes.value`).bind(...args,perpage,(page-1)*perpage));
  const [data,count,cards]=await db.batch(statements);
  const logs=data.results.map(row=>{
    const log=JSON.parse(row.summary),room=row.room?JSON.parse(row.room):null;
    if(room)room.member_data=row.member?JSON.parse(row.member):null;
    log.room_info=room;log.idn ||= {};
    for(const key of ['start','end'])if(log.live_info.date?.[key])log.live_info.date[key]=new Date(log.live_info.date[key]);
    return log;
  });
  return {logs,total:count.results[0].total,page,perpage,cards:cards?.results,sqlMs:[data,count,cards].reduce((n,r)=>n+(r?.meta?.timings?.sql_duration_ms??r?.meta?.duration??0),0)};
}
