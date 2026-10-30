"""Parse public logged-out Instagram HTML as JSON data; never evaluate scripts."""
import datetime,json,re
from html.parser import HTMLParser
from urllib.parse import urlsplit

HANDLE=re.compile(r'[A-Za-z0-9._]{1,30}\Z');CODE=re.compile(r'[A-Za-z0-9_-]{5,24}\Z');IDENT=re.compile(r'\d{15,22}\Z')
class SourceError(Exception):pass

def media_url(value):
 if not isinstance(value,str):return None
 try:
  u=urlsplit(value);host=(u.hostname or'').lower()
  if u.scheme=='https'and not u.username and not u.password and not u.port and any(host==h or host.endswith('.'+h)for h in ('cdninstagram.com','fbcdn.net')):return value
 except ValueError:pass
 return None

class Scripts(HTMLParser):
 def __init__(self):super().__init__();self.active=False;self.parts=[];self.documents=[]
 def handle_starttag(self,tag,attrs):
  a=dict(attrs)
  if tag=='script'and('data-sjs'in a or a.get('type')=='application/json'):self.active=True;self.parts=[]
 def handle_data(self,data):
  if self.active:self.parts.append(data)
 def handle_endtag(self,tag):
  if tag=='script'and self.active:
   try:self.documents.append(json.loads(''.join(self.parts)))
   except(ValueError,RecursionError):pass
   self.active=False

def documents(html):
 if not isinstance(html,str)or len(html)>8*1024*1024:raise SourceError('oversized_document')
 parser=Scripts()
 try:parser.feed(html)
 except(Exception,RecursionError)as e:raise SourceError('invalid_page_data')from e
 if not parser.documents:raise SourceError('public_page_data_missing')
 return parser.documents

def nodes(value):
 stack=[value];visited=0
 while stack:
  item=stack.pop();visited+=1
  if visited>250000:raise SourceError('page_data_too_complex')
  if isinstance(item,dict):
   yield item
   stack.extend(v for v in item.values()if isinstance(v,(dict,list)))
  elif isinstance(item,list):stack.extend(v for v in item if isinstance(v,(dict,list)))

def count(value):return value if isinstance(value,int)and not isinstance(value,bool)and value>=0 else None
def image(node):
 candidates=(node.get('image_versions2')or{}).get('candidates')or[]
 safe=[v for v in candidates if isinstance(v,dict)and media_url(v.get('url'))]
 if safe:return max(safe,key=lambda v:(v.get('width')or 0)*(v.get('height')or 0))['url']
 return media_url(node.get('display_uri'))or media_url(node.get('display_url'))
def video(node):
 candidates=[v for v in node.get('video_versions')or[] if isinstance(v,dict)and media_url(v.get('url'))]
 if candidates:return max(candidates,key=lambda v:(v.get('width')or 0)*(v.get('height')or 0))['url']
 return media_url(node.get('video_url'))

def post(node,username,detail=False):
 owner=node.get('user')or node.get('owner')or{};author=owner.get('username');ident=str(node.get('pk')or node.get('id')or'').split('_')[0];code=node.get('code')or node.get('shortcode')
 if not IDENT.fullmatch(ident)or not isinstance(code,str)or not CODE.fullmatch(code):raise SourceError('invalid_post_identity')
 if not isinstance(author,str)or author.casefold()!=username.casefold():raise SourceError('post_author_mismatch')
 if owner.get('is_private')or node.get('is_unpublished'):raise SourceError('private_post')
 kind={1:'image',2:'video',8:'carousel'}.get(node.get('media_type'),'post');children=node.get('carousel_media')
 if children is not None and(not isinstance(children,list)or len(children)>35):raise SourceError('invalid_gallery')
 items=[]
 for child in children or[]:
  if not isinstance(child,dict):continue
  items.append({'id':str(child.get('pk')or child.get('id')or'').split('_')[0],'type':'video'if child.get('media_type')==2 else'image','thumbnail':image(child),'play_url':video(child),'width':child.get('original_width'),'height':child.get('original_height')})
 text=node.get('caption');text=text.get('text')if isinstance(text,dict)else text
 if text is None:text=''
 if not isinstance(text,str):raise SourceError('invalid_caption')
 timestamp=node.get('taken_at',node.get('taken_at_timestamp'));created=None
 try:
  if isinstance(timestamp,(int,float))and timestamp>0:created=datetime.datetime.fromtimestamp(timestamp,datetime.timezone.utc).isoformat().replace('+00:00','Z')
 except(ValueError,OverflowError,OSError):pass
 thumb=image(node);play=video(node);gallery=[c['thumbnail']for c in items]
 hidden=node.get('like_and_view_counts_disabled')is True
 return {'id':ident,'shortcode':code,'url':'https://www.instagram.com/'+('reel'if node.get('product_type')=='clips'else'p')+'/'+code+'/','text':text,'created_at':created,'created_at_source':'instagram-public-post-page'if created else'not_supplied_by_profile_page','author':{'id':str(owner.get('pk')or owner.get('id')or''),'username':author,'name':owner.get('full_name')or author},'media':{'type':kind,'thumbnail':thumb or(next((c['thumbnail']for c in items if c['thumbnail']),None)),'play_url':play,'images':gallery or None,'images_status':'ready'if items else'not_supplied'if kind=='carousel'else'not_present','items':items or None,'expected_items':node.get('carousel_media_count',len(items)if items else None),'width':node.get('original_width'),'height':node.get('original_height'),'reported_duration_seconds':node.get('video_duration'),'detail_status':'ready'if detail else'pending'},'metrics':{'likes':None if hidden else count(node.get('like_count')),'comments':count(node.get('comment_count')),'views':None if hidden else count(node.get('play_count',node.get('view_count'))),'counts_hidden':node.get('like_and_view_counts_disabled')if isinstance(node.get('like_and_view_counts_disabled'),bool)else None},'source':'instagram-public-post-page'if detail else'instagram-public-profile-page'}

def parse_profile(html,username,require_public=False):
 if not HANDLE.fullmatch(username):raise SourceError('invalid_username')
 docs=documents(html);profiles=[]
 for n in nodes(docs):
  user=n.get('xig_user_by_username')
  if isinstance(user,dict):profiles.append(user)
 matching=[u for u in profiles if str(u.get('username','')).casefold()==username.casefold()]
 if not matching:raise SourceError('profile_identity_missing')
 user=matching[0]
 if user.get('is_private')or user.get('is_unpublished'):raise SourceError('private_account')
 if require_public and user.get('is_private')is not False:raise SourceError('profile_visibility_unknown')
 ident=str(user.get('pk')or'');connections=[]
 if not re.fullmatch(r'\d{1,24}',ident):raise SourceError('profile_identity_missing')
 for u in profiles:
  if str(u.get('pk')or'')==ident and isinstance(u.get('polaris_ordered_timeline_connection'),dict):connections.append(u['polaris_ordered_timeline_connection'])
 if not connections:raise SourceError('profile_posts_not_exposed')
 result={};excluded=0
 for connection in connections:
  edges=connection.get('edges')
  if not isinstance(edges,list):raise SourceError('post_list_missing')
  for edge in edges:
   node=edge.get('node')if isinstance(edge,dict)else None
   if not isinstance(node,dict):continue
   try:p=post(node,username)
   except SourceError as error:
    if str(error)in('post_author_mismatch','private_post'):excluded+=1;continue
    raise
   result[p['id']]=p
 # A nonempty profile with only gated edges is a source limitation, not an empty success.
 if not result and count(user.get('all_media_count'))!=0:raise SourceError('profile_posts_not_exposed')
 profile={'id':ident,'username':username,'name':user.get('full_name'),'bio':user.get('biography'),'verified':bool(user.get('is_verified')),'followers':count(user.get('follower_count')),'following':count(user.get('following_count')),'post_count':count(user.get('all_media_count'))}
 return {'username':username,'profile':profile,'posts':sorted(result.values(),key=lambda p:int(p['id']),reverse=True),'excluded_other_authors':excluded,'coverage':'limited-public-profile-window','history_complete':False}

def parse_detail(html,username,post_id,shortcode):
 if not HANDLE.fullmatch(username)or not IDENT.fullmatch(str(post_id))or not CODE.fullmatch(shortcode):raise SourceError('invalid_post_identity')
 selected=[];gated=False
 for n in nodes(documents(html)):
  outer=n.get('xig_polaris_media')
  if isinstance(outer,dict)and outer.get('code')==shortcode:
   inner=outer.get('if_not_gated_logged_out')
   if isinstance(inner,dict):selected.append(inner)
   else:gated=True
 for node in selected:
  p=post(node,username,True)
  if p['id']!=str(post_id)or p['shortcode']!=shortcode:raise SourceError('post_identity_mismatch')
  return {'id':p['id'],'author_username':p['author']['username'],'created_at':p['created_at'],'created_at_source':p['created_at_source'],'media':p['media'],'text':p['text'],'metrics':p['metrics']}
 raise SourceError('post_login_required'if gated else'post_detail_not_exposed')

def parse_profile_embed(document,username):
 """Read the official public profile embed's JSON string, without evaluating JS."""
 if not HANDLE.fullmatch(username):raise SourceError('invalid_username')
 if len(document)>8*1024*1024:raise SourceError('oversized_document')
 context=None
 for m in re.finditer(r'"contextJSON"\s*:\s*',document):
  try:
   value,_=json.JSONDecoder().raw_decode(document,m.end())
   if isinstance(value,str):
    obj=json.loads(value);candidate=obj.get('context')if isinstance(obj,dict)else None
    if isinstance(candidate,dict)and str(candidate.get('username','')).casefold()==username.casefold():context=candidate;break
  except(ValueError,TypeError,RecursionError):continue
 if context is None:raise SourceError('profile_embed_not_exposed')
 ident=str(context.get('owner_id')or'')
 if not re.fullmatch(r'\d{1,24}',ident):raise SourceError('profile_identity_missing')
 media=context.get('graphql_media')
 if not isinstance(media,list):raise SourceError('post_list_missing')
 def normalize(n):
  if not isinstance(n,dict):raise SourceError('invalid_embed_media')
  children=(n.get('edge_sidecar_to_children')or{}).get('edges')or[]
  caption=(n.get('edge_media_to_caption')or{}).get('edges')or[]
  dimensions=n.get('dimensions')or{}
  return {**n,'media_type':8 if n.get('__typename')=='GraphSidecar'else 2 if n.get('is_video')else 1,'carousel_media':[normalize(c.get('node'))for c in children]if children else None,'caption':{'text':'\n'.join(str((e.get('node')or{}).get('text')or'')for e in caption)},'original_width':dimensions.get('width'),'original_height':dimensions.get('height'),'like_count':(n.get('edge_liked_by')or{}).get('count'),'comment_count':(n.get('edge_media_to_comment')or{}).get('count')}
 result={};excluded=0
 for item in media:
  n=item.get('shortcode_media')if isinstance(item,dict)else None
  if not isinstance(n,dict):raise SourceError('invalid_embed_media')
  owner=n.get('owner')or{}
  if str(owner.get('id')or'')!=ident:excluded+=1;continue
  try:p=post(normalize(n),username)
  except SourceError as error:
   if str(error)in('post_author_mismatch','private_post'):excluded+=1;continue
   raise
  p['source']='instagram-public-profile-embed'
  if p['created_at']:p['created_at_source']='instagram-public-profile-embed'
  result[p['id']]=p
 if not result and count(context.get('posts_count'))!=0:raise SourceError('profile_posts_not_exposed')
 return {'username':username,'profile':{'id':ident,'username':username,'name':context.get('full_name'),'verified':bool(context.get('is_verified')),'followers':count(context.get('followers_count')),'following':None,'post_count':count(context.get('posts_count'))},'posts':sorted(result.values(),key=lambda p:int(p['id']),reverse=True),'excluded_other_authors':excluded,'coverage':'limited-public-profile-embed-window','history_complete':False}


def parse_session_profile(document,username):
 if not HANDLE.fullmatch(username):raise SourceError('invalid_username')
 try:data=json.loads(document);user=(data.get('data')or{}).get('user')
 except(ValueError,TypeError,AttributeError):raise SourceError('invalid_session_profile')from None
 if not isinstance(user,dict)or str(user.get('username','')).casefold()!=username.casefold():raise SourceError('profile_identity_missing')
 if user.get('is_private')is not False or user.get('is_unpublished'):raise SourceError('private_account')
 ident=str(user.get('id')or user.get('pk')or'')
 connection=user.get('edge_owner_to_timeline_media')
 if not isinstance(connection,dict)or not isinstance(connection.get('edges'),list):raise SourceError('profile_posts_not_exposed')
 context={'username':username,'owner_id':ident,'posts_count':connection.get('count'),'full_name':user.get('full_name'),'followers_count':(user.get('edge_followed_by')or{}).get('count'),'is_verified':bool(user.get('is_verified')),'graphql_media':[{'shortcode_media':e.get('node')}for e in connection['edges']if isinstance(e,dict)]}
 result=parse_profile_embed('<script>{"contextJSON":'+json.dumps(json.dumps({'context':context}))+'}</script>',username)
 for p in result['posts']:
  p['source']='instagram-session-web-profile'
  if p['created_at']:p['created_at_source']='instagram-session-web-profile'
 return result
