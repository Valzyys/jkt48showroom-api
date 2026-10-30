"""Strict parser for TikTok's anonymous public creator embed. Never evaluates JS."""
import html,json,re
from urllib.parse import urlsplit

HANDLE=re.compile(r'[A-Za-z0-9._]{2,30}\Z')
class SourceError(Exception):pass

def media_url(value):
 if not isinstance(value,str):return None
 try:
  u=urlsplit(value);host=(u.hostname or '').lower()
  if u.scheme=='https' and not u.username and not u.password and not u.port and (host=='tiktokcdn.com' or host.endswith('.tiktokcdn.com')):return value
 except ValueError:pass
 return None

def parse_embed(document,username):
 if not HANDLE.fullmatch(username):raise SourceError('invalid_username')
 if len(document)>3*1024*1024:raise SourceError('oversized_document')
 match=re.search(r'<script\b(?=[^>]*\bid=[\"\x27]__FRONTITY_CONNECT_STATE__[\"\x27])[^>]*>([\s\S]*?)</script>',document,re.I)
 if not match:raise SourceError('embed_state_missing')
 try:state=json.loads(match.group(1))
 except ValueError as e:raise SourceError('invalid_embed_json')from e
 try:data=state['source']['data']['/embed/@'+username]
 except (KeyError,TypeError)as e:raise SourceError('embed_route_missing')from e
 if not isinstance(data,dict):raise SourceError('invalid_embed_data')
 user=data.get('userInfo')
 if not isinstance(user,dict) or str(user.get('uniqueId','')).casefold()!=username.casefold():raise SourceError('author_mismatch')
 if user.get('privateAccount'):raise SourceError('private_account')
 if user.get('code')not in(None,0,200)or user.get('customErrorCode')not in(None,0):raise SourceError('source_user_error')
 videos=data.get('videoList')
 if not isinstance(videos,list):raise SourceError('post_list_missing')
 result={}
 for v in videos:
  if not isinstance(v,dict)or v.get('privateItem'):continue
  ident=str(v.get('id',''))
  if not re.fullmatch(r'\d{15,22}',ident):continue
  if str(v.get('authorUniqueId')or username).casefold()!=username.casefold():continue
  cover=media_url(v.get('originCoverUrl'))or media_url(v.get('coverUrl'));play=media_url(v.get('playAddr'))
  views=v.get('playCount');exact=not isinstance(views,bool)and(isinstance(views,int)or isinstance(views,str)and views.isdigit())
  result[ident]={'id':ident,'url':'https://www.tiktok.com/@'+username+'/video/'+ident,'text':html.unescape(str(v.get('desc')or'')),'created_at':None,'created_at_source':'not_supplied_by_creator_embed','author':{'id':str(user.get('id')or''),'username':str(user['uniqueId']),'name':user.get('nickname')or username,'avatar':media_url(user.get('avatarThumbUrl'))},'media':{'type':'video'if play else'post','thumbnail':cover,'play_url':play,'width':v.get('width'),'height':v.get('height'),'images':None,'images_status':'not_supplied_by_creator_embed'},'metrics':{'views':int(views)if exact else None,'views_display':str(views)if views is not None else None,'views_precision':'source_display'},'source':'tiktok-public-creator-embed'}
 return {'username':username,'profile':{'id':str(user.get('id')or''),'name':user.get('nickname'),'bio':user.get('signature'),'verified':bool(user.get('verified'))},'posts':sorted(result.values(),key=lambda v:int(v['id']),reverse=True),'coverage':'limited-public-embed-window','history_complete':False}


def parse_detail(document,username,post_id):
 """Read exact creation time, video metadata or a photo gallery from public embed v2."""
 import datetime
 if not HANDLE.fullmatch(username)or not re.fullmatch(r'\d{15,22}',str(post_id)):raise SourceError('invalid_post_identity')
 if len(document)>3*1024*1024:raise SourceError('oversized_document')
 match=re.search(r'<script\b(?=[^>]*\bid=[\"\x27]__FRONTITY_CONNECT_STATE__[\"\x27])[^>]*>([\s\S]*?)</script>',document,re.I)
 if not match:raise SourceError('embed_state_missing')
 try:node=json.loads(match.group(1))['source']['data']['/embed/v2/'+str(post_id)]['videoData']
 except (ValueError,KeyError,TypeError)as e:raise SourceError('post_detail_missing')from e
 infos=node.get('itemInfos')or{};author=node.get('authorInfos')or{}
 if str(infos.get('id',''))!=str(post_id)or str(author.get('uniqueId','')).casefold()!=username.casefold():raise SourceError('post_author_mismatch')
 if infos.get('privateItem')or infos.get('secret')or infos.get('forFriend'):raise SourceError('private_post')
 images=[]
 for item in (node.get('imagePostInfo')or{}).get('displayImages')or[]:
  urls=[media_url(v)for v in item.get('urlList',[])if media_url(v)]if isinstance(item,dict)else[]
  if urls:images.append(urls[0])
 video=infos.get('video')or{};urls=[media_url(v)for v in video.get('urls',[])if media_url(v)];covers=[media_url(v)for v in infos.get('covers',[])if media_url(v)]
 created=None
 try:
  n=int(infos['createTime'])
  if n>0:created=datetime.datetime.fromtimestamp(n,datetime.timezone.utc).isoformat().replace('+00:00','Z')
 except (ValueError,KeyError,TypeError,OverflowError,OSError):pass
 return {'id':str(post_id),'author_username':author['uniqueId'],'created_at':created,'created_at_source':'tiktok-public-post-embed'if created else'not_supplied','media':{'type':'photo'if images else'video'if urls else'post','images':images or None,'images_status':'ready'if images else'not_present','play_url':urls[0]if urls else None,'thumbnail':covers[0]if covers else None,'reported_duration_seconds':(video.get('videoMeta')or{}).get('duration')},'source':'tiktok-public-post-embed'}
