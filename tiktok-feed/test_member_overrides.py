import unittest,tempfile,pathlib
from archive import Archive
from member_overrides import USERNAMES

class MemberOverridesTest(unittest.TestCase):
 def test_refresh_keeps_configured_handles_without_resetting_history(self):
  with tempfile.TemporaryDirectory() as tmp:
   store=Archive(pathlib.Path(tmp)/'feed.sqlite')
   rows=[{'member':ident,'name':ident,'username':'outdated_'+str(i)} for i,ident in enumerate(USERNAMES)]
   store.directory(rows)
   store.db.execute("INSERT INTO profiles(username,watermark,success)VALUES(?, '123', 123)",(next(iter(USERNAMES.values())),));store.db.commit()
   store.directory(rows)
   saved={r['member']:r for r in store.members()['members']}
   for ident,handle in USERNAMES.items():
    self.assertEqual(saved[ident]['username'],handle)
   self.assertEqual(store.db.execute('SELECT watermark FROM profiles').fetchone()[0],'123');store.close()

if __name__=='__main__':unittest.main()
