"""Maintainer-provided public handles, retained across directory refreshes."""
USERNAMES = {'heidi-suyangga': 'heidi.jkt48', 'fatimah-azzahra': 'rara.jkt48'}

def apply_member_overrides(rows):
 result=[]
 for row in rows:
  handle=USERNAMES.get(row.get('member'))
  if handle and not row.get('is_graduate'):
   row={**row,'username':handle,'username_source':'maintainer-provided-profile'}
   row.update(status='configured_handle',source='maintainer-provided-profile')
  result.append(row)
 return result
