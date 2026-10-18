import tempfile, unittest
from pathlib import Path
from media_storage import cleanup_video, archive_screenshots, confirmed_thumbnails

class StorageTests(unittest.IsolatedAsyncioTestCase):
 def setUp(self):confirmed_thumbnails.clear()
 def setup_files(self, root):
  row={'id':'a'*32,'status':'uploaded','youtube_id':'testVideo01','youtube_privacy':'unlisted','screenshots':[1792320000000,1792320060000],'thumbnail_status':'pending'}
  folder=root/row['id'];folder.mkdir();(folder/'run-1').mkdir()
  for name in ['run-1/000000.ts','recording.mp4','finalizing.mp4','concat.txt']:(folder/name).write_bytes(b'video')
  for frame in row['screenshots']:(folder/(str(frame)+'.jpg')).write_bytes(b'\xff\xd8\xff\x00')
  return row,folder
 async def test_only_confirmed_unlisted_uploads_are_cleaned_and_screenshots_survive(self):
  with tempfile.TemporaryDirectory() as tmp:
   row,folder=self.setup_files(Path(tmp))
   for field,value in [('status','upload_failed'),('youtube_id',None),('youtube_privacy','public')]:
    bad={**row,field:value};self.assertEqual(cleanup_video(folder,bad),0);self.assertTrue((folder/'recording.mp4').exists())
   self.assertEqual(cleanup_video(folder,row),20)
   self.assertEqual(sorted(p.name for p in folder.iterdir()),['1792320000000.jpg','1792320060000.jpg'])
   self.assertEqual(cleanup_video(folder,row),0)
 async def test_failed_r2_upload_keeps_all_jpegs_and_success_keeps_thumbnail_until_used(self):
  class Response:
   status_code=503
   def json(self):return {'ok':True,'bytes':4,'storage':'r2'}
  class Client:
   async def put(self,*args,**kwargs):return response
  response=Response()
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);row,folder=self.setup_files(root)
   self.assertEqual(await archive_screenshots(Client(),root,row,'https://example.test','synthetic'),0)
   self.assertTrue((folder/'1792320060000.jpg').exists())
   response.status_code=200
   self.assertEqual(await archive_screenshots(Client(),root,row,'https://example.test','synthetic'),1)
   self.assertTrue((folder/'1792320000000.jpg').exists())
   row['thumbnail_status']='uploaded'
   self.assertEqual(await archive_screenshots(Client(),root,row,'https://example.test','synthetic'),1)
   self.assertFalse(list(folder.glob('*.jpg')))
 async def test_bad_acknowledgment_does_not_delete_local_screenshot(self):
  class Response:
   status_code=200
   def json(self):return {'ok':True,'bytes':999,'storage':'r2'}
  class Client:
   async def put(self,*args,**kwargs):return Response()
  with tempfile.TemporaryDirectory() as tmp:
   root=Path(tmp);row,folder=self.setup_files(root)
   self.assertEqual(await archive_screenshots(Client(),root,row,'https://example.test','synthetic'),0)
   self.assertEqual(len(list(folder.glob('*.jpg'))),2)
