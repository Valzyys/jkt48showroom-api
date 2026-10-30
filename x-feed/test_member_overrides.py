import unittest,tempfile,pathlib
from store import Store
from member_overrides import USERNAMES

class MemberOverridesTest(unittest.TestCase):
 def test_refresh_keeps_configured_handles_without_resetting_history(self):
  with tempfile.TemporaryDirectory() as tmp:
   store=Store(pathlib.Path(tmp)/'feed.sqlite')
   rows=[{'id':ident,'name':ident,'username':'outdated_'+str(i)} for i,ident in enumerate(USERNAMES)]
   store.sync_members(rows)
   with store.connect() as db:db.execute("UPDATE members SET initialized=1,watermark='123'")
   store.sync_members(rows)
   saved={r['id']:r for r in store.members()}
   for ident,handle in USERNAMES.items():
    self.assertEqual(saved[ident]['username'],handle)
   self.assertTrue(all(r['baseline_complete']for r in saved.values()))

 def test_new_handle_clears_discovery_pause_but_keeps_watermark(self):
  with tempfile.TemporaryDirectory() as tmp:
   store=Store(pathlib.Path(tmp)/'feed.sqlite')
   with store.connect() as db:
    db.execute("INSERT INTO members(id,name,handle,profile,enabled,next_check,error,watermark,initialized)VALUES('heidi-suyangga','Heidi','',?,1,99999999999,'No public X username','123',1)",('{"id":"heidi-suyangga","name":"Heidi","username":null}',))
   store.sync_members([{'id':'heidi-suyangga','name':'Heidi','username':None}])
   with store.connect() as db:
    row=db.execute("SELECT * FROM members").fetchone()
   self.assertEqual(row['handle'],'Heidi_JKT48');self.assertEqual(row['next_check'],0);self.assertIsNone(row['error']);self.assertEqual(row['watermark'],'123');self.assertEqual(row['initialized'],1)
   with store.connect() as db:db.execute("UPDATE members SET next_check=123456,error='http_429'")
   store.sync_members([{'id':'heidi-suyangga','name':'Heidi','username':None}])
   with store.connect() as db:row=db.execute('SELECT * FROM members').fetchone()
   self.assertEqual(row['next_check'],123456);self.assertEqual(row['error'],'http_429')

if __name__=='__main__':unittest.main()
