import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Schema,model,connection,ObjectId } from '../src/runtime/database.js';
import { runWithEnv } from '../src/runtime/env.js';
import { database } from './helpers.js';

test('D1 models cast nested dates, paginate, populate references, and save',async()=>{
  const DB=database();
  await runWithEnv({DB},null,async()=>{
    const Rooms=model('TestRoom',new Schema({room_id:Number,name:String}));
    const schema=new Schema({name:String,type:String,room_id:Number,info:{birthdate:Date},tags:[String]});
    schema.virtual('room',{ref:Rooms,localField:'room_id',foreignField:'room_id',justOne:true});
    const Members=model('TestMember',schema);
    await Rooms.create({room_id:1,name:'Room'});
    await Members.create([{name:'B',type:'showroom',room_id:1,info:{birthdate:'2000-01-01'},tags:['jkt48']},{name:'A',room_id:2}]);
    const rows=await Members.find({type:'showroom'}).populate('room').lean();
    assert.equal(rows.length,1);assert.equal(rows[0].room.name,'Room');assert.ok(rows[0].info.birthdate instanceof Date);
    assert.equal((await Members.find().sort('name').skip(1).limit(1).lean())[0].name,'B');
    const doc=await Members.findOne({name:'B'});doc.name='C';await doc.save();assert.equal(await Members.countDocuments({name:'C'}),1);
    assert.equal((await Members.find({tags:['jkt48']}).lean()).length,1);
  });DB.sqlite.close();
});
test('nested arrays are filtered without unsafe SQL pushdown',async()=>{
  const DB=database();await runWithEnv({DB},null,async()=>{
    const Logs=model('TestArrayLog',new Schema({users:[{user_id:Number}],room_id:Number}));
    await Logs.create({room_id:1,users:[{user_id:12}]});
    assert.equal(await Logs.countDocuments({'users.user_id':'12'}),1);
  });DB.sqlite.close();
});
test('update/upsert and optimistic save prevent lost updates',async()=>{
  const DB=database();await runWithEnv({DB},null,async()=>{
    const Model=model('TestWrites',new Schema({key:String,count:{type:Number,default:0}}));
    await Model.updateOne({key:'one'},{$inc:{count:1}},{upsert:true});
    const [a,b]=await Promise.all([Model.findOne({key:'one'}),Model.findOne({key:'one'})]);
    a.count=2;await a.save();b.count=9;await assert.rejects(b.save(),error=>error.status===409);
    await Model.updateOne({key:'one'},{$set:{note:'updated'},$inc:{count:1}});assert.equal((await Model.findOne({key:'one'}).lean()).count,3);
    assert.equal((await Model.findOne({key:'one'}).lean()).note,'updated');
    assert.equal((await Model.deleteOne({key:'one'})).deletedCount,1);
  });DB.sqlite.close();
});
test('aggregation supports match, group, lookup, facet, and dates',async()=>{
  const DB=database();await runWithEnv({DB},null,async()=>{
    const Keys=model('TestAggKey',new Schema({room_id:Number,name:String}));
    const Logs=model('TestAggLog',new Schema({room_id:Number,value:Number,date:Date}));
    await Keys.create({room_id:1,name:'Member'});await Logs.create([{room_id:1,value:3,date:'2026-01-01'},{room_id:1,value:4,date:'2026-01-02'}]);
    const rows=await Logs.aggregate([{$match:{room_id:1}},{$group:{_id:'$room_id',total:{$sum:'$value'}}},{$lookup:{from:Keys.collection.name,localField:'_id',foreignField:'room_id',as:'member'}},{$facet:{count:[{$count:'total'}],data:[{$project:{total:1,member:1}}]}}]);
    assert.equal(rows[0].data[0].total,7);assert.equal(rows[0].data[0].member[0].name,'Member');
  });DB.sqlite.close();
});
test('separate logical databases and source ObjectIds remain distinct',async()=>{
  const DB=database();await runWithEnv({DB},null,async()=>{
    const id=String(new ObjectId());const A=connection('a').model('Thing',new Schema({name:String})),B=connection('b').model('Thing',new Schema({name:String}));
    await A.create({_id:id,name:'A'});await B.create({_id:id,name:'B'});
    assert.equal((await A.findById(id).lean()).name,'A');assert.equal((await B.findById(id).lean()).name,'B');
  });DB.sqlite.close();
});
test('document budget fails explicitly instead of returning truncated results',async()=>{
  const DB=database();await runWithEnv({DB,MAX_QUERY_DOCUMENTS:'1'},null,async()=>{
    const Model=model('TestBudget',new Schema({name:String}));await Model.create([{name:'a'},{name:'b'}]);
    await assert.rejects(Model.find().lean(),error=>error.status===503);
    assert.equal((await Model.find({name:'a'}).lean()).length,1);
  });DB.sqlite.close();
});
