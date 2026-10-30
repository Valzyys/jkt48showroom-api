"""Maintainer-provided public handles, retained across directory refreshes."""
USERNAMES = {'heidi-suyangga': 'jkt48.heidi__', 'fatimah-azzahra': 'jkt48.rara_'}

def apply_member_overrides(rows):
 result=[]
 for row in rows:
  handle=USERNAMES.get(row.get('member'))
  if handle and not row.get('is_graduate'):
   row={**row,'username':handle,'username_source':'maintainer-provided-profile'}
   row.update(status='configured_handle',source='maintainer-provided-profile')
  result.append(row)
 return result
