import test from 'node:test';
import assert from 'node:assert/strict';
import {ShowroomComments, IdnComments} from '../src/legacy-comment-objects.js';

for (const Class of [ShowroomComments, IdnComments]) {
  test(`${Class.name} preserves existing state and explicitly refuses disabled requests`, async () => {
    const ctx = new Proxy({}, {get() {throw new Error('Archived namespace storage must not be accessed');}});
    const object = new Class(ctx, {});
    const result = await object.fetch(new Request('https://comments.internal/publish', {method:'POST'}));
    assert.equal(result.status,503);
    assert.equal(result.headers.get('Cache-Control'),'private, no-store');
    assert.match((await result.json()).message,/not enabled/);
    await object.alarm();
  });
}
