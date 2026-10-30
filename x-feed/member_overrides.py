"""Maintainer-provided public handles, retained across directory refreshes."""
USERNAMES = {'heidi-suyangga': 'Heidi_JKT48', 'fatimah-azzahra': 'FA_RaraJKT48'}

def apply_member_overrides(rows):
 result=[]
 for row in rows:
  handle=USERNAMES.get(row.get('id'))
  if handle and not row.get('is_graduate'):
   row={**row,'username':handle,'username_source':'maintainer-provided-profile'}
   row['url']='https://x.com/'+handle
  result.append(row)
 return result
