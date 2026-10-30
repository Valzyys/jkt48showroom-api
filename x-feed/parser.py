"""Parse public X server-rendered JSON as data; never evaluate remote JavaScript."""
import datetime as dt,html,json,re
from email.utils import parsedate_to_datetime

class PublicSourceError(Exception):pass

def iso(value):
 try:
  if isinstance(value,(int,float)):return dt.datetime.fromtimestamp(value/1000 if value>100000000000 else value,dt.timezone.utc).isoformat().replace('+00:00','Z')
  return parsedate_to_datetime(value).astimezone(dt.timezone.utc).isoformat().replace('+00:00','Z')
 except (ValueError,TypeError,OverflowError):return None

def safe_url(value):
 return value if isinstance(value,str) and value.startswith('https://') else None

def normalize(node,handle):
 while isinstance(node,dict) and node.get('__typename') in ('TweetWithVisibilityResults','TweetWithVisibilityResult'):node=node.get('tweet') or {}
 if not isinstance(node,dict) or not str(node.get('rest_id') or '').isdigit():return None
 user=(node.get('core') or {}).get('user_results',{}).get('result') or {}
 core=user.get('core') or {};legacy_user=user.get('legacy') or {}
 username=core.get('screen_name') or legacy_user.get('screen_name')
 if not username or username.casefold()!=handle.casefold() or user.get('privacy',{}).get('protected') or legacy_user.get('protected'):return None
 legacy=node.get('legacy') or {};details=node.get('details') or {};ident=str(node['rest_id'])
 text=details.get('full_text') or legacy.get('full_text') or (node.get('note_tweet') or {}).get('note_tweet_results',{}).get('result',{}).get('text')
 if not isinstance(text,str):return None
 published=iso(details.get('created_at_ms') or legacy.get('created_at'))
 if not published:published=iso(((int(ident)>>22)+1288834974657))
 counts=node.get('counts') or legacy
 entities=legacy.get('entities') or {};urls=node.get('url_entities') or entities.get('urls') or []
 links=[{'url':item.get('url'),'expanded_url':safe_url(item.get('expanded_url')),'display_url':item.get('display_url')} for item in urls if isinstance(item,dict)]
 for item in links:
  if item.get('url') and item.get('expanded_url'):text=text.replace(item['url'],item['expanded_url'])
 media=[]
 for item in node.get('media_entities2') or (legacy.get('extended_entities') or {}).get('media') or entities.get('media') or []:
  if not isinstance(item,dict):continue
  source=item.get('media_info') or item
  kind=source.get('type') or item.get('type') or source.get('__typename','').lower().replace('tweet','').replace('media','')
  kind='animated_gif' if 'gif' in str(kind).lower() else 'video' if 'video' in str(kind).lower() else 'photo' if 'photo' in str(kind).lower() or 'image' in str(kind).lower() else kind
  variants=(source.get('video_info') or item.get('video_info') or {}).get('variants') or []
  media.append({'id':str(item.get('id_str') or item.get('media_key') or item.get('rest_id') or ''),'type':kind,'url':safe_url(source.get('media_url_https') or item.get('media_url_https') or source.get('original_img_url') or source.get('url')),'alt':item.get('ext_alt_text') or source.get('ext_alt_text'),'variants':[{'url':v.get('url'),'content_type':v.get('content_type'),'bitrate':v.get('bitrate')} for v in variants if safe_url(v.get('url'))]})
 reply_id=legacy.get('in_reply_to_status_id_str') or details.get('in_reply_to_status_id')
 quoted=legacy.get('quoted_status_id_str') or (node.get('quoted_status_result') or {}).get('result',{}).get('rest_id')
 return {'id':ident,'url':'https://x.com/'+username+'/status/'+ident,'text':html.unescape(text),'created_at':published,'author':{'id':str(user.get('rest_id') or ''),'username':username,'name':core.get('name') or legacy_user.get('name') or username,'avatar':safe_url(user.get('avatar',{}).get('image_url') or legacy_user.get('profile_image_url_https')),'verified':bool(user.get('verification',{}).get('is_blue_verified') or legacy_user.get('verified'))},'metrics':{'likes':counts.get('favorite_count'),'reposts':counts.get('retweet_count'),'replies':counts.get('reply_count'),'quotes':counts.get('quote_count'),'bookmarks':counts.get('bookmark_count'),'views':(node.get('views') or {}).get('count')},'media':media,'urls':links,'hashtags':[item.get('text') for item in details.get('hashtag_entities') or entities.get('hashtags') or []],'is_reply':bool(reply_id),'reply_to_tweet_id':str(reply_id) if reply_id else None,'is_quote':bool(quoted),'quoted_tweet_id':str(quoted) if quoted else None,'is_repost':bool(legacy.get('retweeted_status_result')),'language':legacy.get('lang'),'possibly_sensitive':bool(legacy.get('possibly_sensitive')),'source':'x-public-profile'}

def parse_profile(document,handle):
 if len(document)>3*1024*1024:raise PublicSourceError('Public profile exceeds size limit')
 payloads=[]
 for script in re.findall(r'<script\b[^>]*>([\s\S]*?)</script>',document,re.I):
  if 'tweet_results' not in script and '"Tweet"' not in script:continue
  try:
   direct=json.loads(script)
   if isinstance(direct,(dict,list)):payloads.append(direct)
  except ValueError:pass
  for match in re.finditer(r'"(?:[^"\\]|\\.)*"',script):
   try:
    value=json.loads(match.group())
    if isinstance(value,str) and value.startswith(('{','[')) and ('tweet_results' in value or '"Tweet"' in value):payloads.append(json.loads(value))
   except (ValueError,TypeError):continue
  if len(payloads)>20:break
 found={}
 def walk(value,depth=0):
  if depth>60:return
  if isinstance(value,dict):
   if 'tweet_results' in value and isinstance(value['tweet_results'],dict):
    row=normalize(value['tweet_results'].get('result') or {},handle)
    if row:
     row['is_pinned']=(value.get('social_context') or {}).get('context_type')=='Pin'
     found[row['id']]=row
    return
   if value.get('__typename') in ('Tweet','TweetWithVisibilityResults','TweetWithVisibilityResult'):
    row=normalize(value,handle)
    if row:found[row['id']]=row
    return
   for item in value.values():walk(item,depth+1)
  elif isinstance(value,list):
   for item in value:walk(item,depth+1)
 for payload in payloads:walk(payload)
 if not found:raise PublicSourceError('Public profile contains no readable timeline; unavailable, restricted, or empty')
 return sorted(found.values(),key=lambda row:int(row['id']),reverse=True)
