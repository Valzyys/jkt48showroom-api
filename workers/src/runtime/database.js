import 'mingo/init/system';
import { Query as Predicate, Aggregator } from 'mingo';
import { update } from 'mingo/updater';
import pluralize from 'mongoose-legacy-pluralize';
import { randomBytes } from 'node:crypto';
import { binding, env } from './env.js';
import { compileFilter, jsonPath } from './filters.js';

const registry = new Map();
function at(object, path) { return path.split('.').reduce((value, part) => value?.[part], object); }
function put(object, path, value) {
  const parts = path.split('.');
  if (parts.some(part => ['__proto__', 'prototype', 'constructor'].includes(part))) throw new Error('Invalid field path');
  const last = parts.pop();
  const parent = parts.reduce((value, part) => value[part] ??= {}, object);
  parent[last] = value;
}
function copy(value) { return structuredClone(value); }
function fail(message, status = 400) { return Object.assign(new Error(message), { status }); }
export class ObjectId {
  constructor(value = randomBytes(12).toString('hex')) {
    if (!/^[a-f0-9]{24}$/i.test(String(value))) throw fail('Invalid ObjectId');
    this.value = String(value).toLowerCase();
  }
  toString() { return this.value; }
  toJSON() { return this.value; }
  equals(value) { return this.value === String(value); }
}
export const Types = { ObjectId };
export class Schema {
  static Types = { ObjectId, Mixed: Symbol('Mixed') };
  constructor(definition = {}, options = {}) { this.definition = definition; this.options = options; this.statics = {}; this.virtuals = new Map(); this.indexes = []; }
  virtual(path, config) { this.virtuals.set(path, config); return this; }
  index(fields, options = {}) { this.indexes.push({ fields, options }); return this; }
}
function descriptor(definition) { return definition?.type !== undefined ? definition : { type: definition }; }
function pathDefinition(schema, path) {
  let current = schema.definition;
  let arrayAncestor = false;
  let definition;
  for (const key of path.split('.')) {
    if (current instanceof Schema) current = current.definition;
    if (Array.isArray(current)) { arrayAncestor = true; current = descriptor(current[0]).type; }
    if (current instanceof Schema) current = current.definition;
    current = current?.[key];
    if (current === undefined) return undefined;
    const config = descriptor(current);
    definition = config;
    current = config.type;
  }
  return { ...definition, arrayAncestor:arrayAncestor||Array.isArray(current) };
}
function castValue(value, definition, defaults = false, validate = false) {
  const config = descriptor(definition), type = config.type;
  if (value === undefined && defaults && config.default !== undefined) value = typeof config.default === 'function' ? config.default() : copy(config.default);
  if (value === undefined && defaults && Array.isArray(type)) value = [];
  if (value == null) { if (validate && config.required) throw fail('Required field is missing'); return value; }
  let result = value;
  if (type === Date) { result = new Date(value?.valueOf?.() ?? value); if (Number.isNaN(result.getTime())) throw fail('Invalid date'); }
  else if (type === String || type === ObjectId) result = String(value);
  else if (type === Number) { result = Number(value); if (!Number.isFinite(result)) throw fail('Invalid number'); }
  else if (type === Boolean) result = value === 'false' || value === '0' ? false : Boolean(value);
  else if (Array.isArray(type)) result = (Array.isArray(value) ? value : [value]).map(item => castValue(item, type[0], defaults, validate));
  else if (type instanceof Schema) result = castObject(value, type, defaults, validate);
  else if (type && typeof type === 'object') result = castObject(value, new Schema(type), defaults, validate);
  if (config.trim && typeof result === 'string') result = result.trim();
  if (validate) {
    if (config.enum && !config.enum.includes(result)) throw fail('Invalid enum value');
    if (config.min != null && result < config.min) throw fail('Value below minimum');
    if (config.max != null && result > config.max) throw fail('Value above maximum');
    if (config.maxlength != null && result.length > config.maxlength) throw fail('Value is too long');
  }
  return result;
}
function castObject(value, schema, defaults, validate) {
  const result = copy(value || {});
  for (const [key, definition] of Object.entries(schema.definition)) {
    if (key === '_id' && definition === false) continue;
    const config = descriptor(definition);
    if (result[key] === undefined && typeof config.type === 'object' && !Array.isArray(config.type) && !(config.type instanceof Schema)) result[key] = {};
    const field = castValue(result[key], definition, defaults, validate);
    if (field !== undefined) result[key] = field;
  }
  if (schema.options.timestamps) for (const key of ['createdAt', 'updatedAt']) if (result[key]) result[key] = new Date(result[key]);
  return result;
}
function castFilter(filter, schema) {
  const result = {};
  for (const [path, value] of Object.entries(filter || {})) {
    if (['$or', '$and', '$nor'].includes(path)) { result[path] = value.map(item => castFilter(item, schema)); continue; }
    const definition = path === '_id' ? { type: String } : pathDefinition(schema, path);
    if (!definition || value instanceof RegExp || value == null) { result[path] = value; continue; }
    const cast = item => item instanceof RegExp ? item : castValue(item, Array.isArray(definition.type) ? definition.type[0] : definition);
    if (Array.isArray(value)) result[path] = { $in: value.map(cast) };
    else if (typeof value === 'object' && !(value instanceof Date) && !value?.toDate && !(value instanceof ObjectId)) {
      result[path] = Object.fromEntries(Object.entries(value).map(([operator, operand]) => {
        if (['$exists', '$size', '$regex', '$options', '$elemMatch', '$type'].includes(operator)) return [operator, operand];
        if (operator === '$not') return [operator, castFilter({ [path]: operand }, schema)[path]];
        return [operator, Array.isArray(operand) ? operand.map(cast) : cast(operand)];
      }));
    } else result[path] = cast(value);
  }
  return result;
}
function fields(value, sort = false) {
  if (typeof value !== 'string') {
    if (sort || !value) return value;
    const flattened = {};
    const visit = (object,prefix='') => { for (const [key,field] of Object.entries(object)) { const path=prefix?prefix+'.'+key:key; if (field && typeof field==='object') visit(field,path); else flattened[path]=field; } };
    visit(value);
    return flattened;
  }
  return Object.fromEntries(value.split(/\s+/).filter(Boolean).map(key => key.startsWith('-') ? [key.slice(1), sort ? -1 : 0] : [key, 1]));
}
function scalarField(model,path) {
  const definition = path === '_id' ? { type:String } : pathDefinition(model.schema,path);
  return definition && !definition.arrayAncestor && [String,Number,Boolean,Date,ObjectId].includes(definition.type);
}
async function readCollection(model, filter = {}, options = {}) {
  const converted = castFilter(filter, model.schema);
  const compiled = compileFilter(converted, path => scalarField(model,path));
  const cap = Math.max(1, Math.min(Number(env.MAX_QUERY_DOCUMENTS || 10000), 50000));
  const where=`database_name=? AND collection_name=?${compiled.sql ? ' AND '+compiled.sql : ''}`;
  if(options.count && compiled.complete) {
    const row=await binding('DB').prepare('SELECT count(*) AS total FROM documents WHERE '+where).bind(model.databaseName,model.collection.name,...compiled.values).first();
    return row.total;
  }
  const pushdown=compiled.complete && (!options.order || Object.keys(options.order).every(path=>jsonPath(path)&&scalarField(model,path))) && options.amount>0;
  const order=pushdown&&options.order?' ORDER BY '+Object.entries(options.order).map(([path,direction])=>`json_extract(document,'${jsonPath(path)}') ${direction<0?'DESC':'ASC'}`).join(','):'';
  const limit=pushdown?Math.min(options.amount,cap+1):cap+1;
  const { results } = await binding('DB').prepare(`SELECT document,version FROM documents WHERE ${where}${order} LIMIT ?${pushdown?' OFFSET ?':''}`).bind(model.databaseName, model.collection.name, ...compiled.values,limit,...(pushdown?[options.offset||0]:[])).all();
  if (results.length > cap) throw fail('Query exceeds document budget; narrow filters or precompute this dataset', 503);
  const predicate = new Predicate(converted);
  const rows=results.map(row => {
    const data = castObject(JSON.parse(row.document), model.schema, false, false);
    Object.defineProperty(data, '_version', { value: row.version, configurable: true });
    return data;
  }).filter(data => predicate.test(data));
  Object.defineProperty(rows,'pushedDown',{value:pushdown});
  return rows;
}
async function populate(model, document, config) {
  const specification = typeof config === 'string' ? { path: config } : { ...config.options, ...config };
  const virtual = model.schema.virtuals.get(specification.path);
  const definition = pathDefinition(model.schema, specification.path);
  const ref = specification.model || virtual?.ref || definition?.ref || descriptor(Array.isArray(definition?.type) ? definition.type[0] : undefined).ref;
  const target = typeof ref === 'function' ? ref : registry.get(`${model.databaseName}:${ref}`);
  if (!target) throw fail(`Unknown populate model: ${String(ref)}`, 500);
  const value = at(document, virtual?.localField || specification.path);
  const justOne = virtual ? Boolean(virtual.justOne) : !Array.isArray(value);
  if (value == null) { put(document, specification.path, justOne ? null : []); return; }
  let request = target.find({ [virtual?.foreignField || '_id']: { $in: Array.isArray(value) ? value : [value] }, ...(specification.match || {}) });
  if (specification.select) request = request.select(specification.select);
  if (specification.populate) for (const nested of Array.isArray(specification.populate) ? specification.populate : [specification.populate]) request.populate(nested);
  const related = await request.lean();
  if (!virtual && Array.isArray(value)) related.sort((a,b) => value.map(String).indexOf(String(a._id)) - value.map(String).indexOf(String(b._id)));
  put(document, specification.path, justOne ? related[0] || null : related);
}
class RequestQuery {
  constructor(model, filter = {}, one = false, count = false) { Object.assign(this, { model, filter, one, count, populations: [], offset: 0, amount: 0 }); }
  lean() { this.isLean = true; return this; }
  select(value) { this.fields = fields(value); return this; }
  sort(value) { this.order = fields(value, true); return this; }
  skip(value) { this.offset = Math.max(0, Number(value) || 0); return this; }
  limit(value) { this.amount = Math.max(0, Number(value) || 0); return this; }
  populate(value) { this.populations.push(...(Array.isArray(value) ? value : typeof value === 'string' ? value.split(/\s+/).filter(Boolean) : [value])); return this; }
  async exec() {
    let rows = await readCollection(this.model, this.filter,{count:this.count,order:this.order,offset:this.offset,amount:this.one?1:this.amount});
    if (this.count) return typeof rows==='number'?rows:rows.length;
    const pushedDown=rows.pushedDown;
    if (!pushedDown && this.order) rows = new Aggregator([{ $sort: this.order }]).run(rows);
    if(!pushedDown) rows = rows.slice(this.offset, this.one ? this.offset + 1 : this.amount ? this.offset + this.amount : undefined);
    for (const row of rows) for (const config of this.populations) await populate(this.model, row, config);
    if (this.fields) {
      const projection = { ...this.fields }, inclusion = Object.entries(projection).some(([key,v]) => key !== '_id' && v === 1);
      if (inclusion) for (const p of this.populations) projection[typeof p === 'string' ? p : p.path] = 1;
      for (const [key,v] of Object.entries(projection)) if (v === -1) projection[key] = 0;
      if (inclusion) for (const [key,v] of Object.entries(projection)) if (key !== '_id' && v === 0) delete projection[key];
      const versions = rows.map(row => row._version);
      rows = new Aggregator([{ $project: projection }]).run(rows);
      rows.forEach((row,i) => Object.defineProperty(row, '_version', { value: versions[i] }));
    }
    if (!this.isLean) rows = rows.map(row => new this.model(row));
    return this.one ? rows[0] || null : rows;
  }
  then(resolve, reject) { return this.exec().then(resolve, reject); }
  catch(reject) { return this.exec().catch(reject); }
  async *cursor() { for (const row of await this.lean().exec()) yield row; }
}
class AggregateQuery {
  constructor(model, pipeline) { this.model = model; this.pipeline = pipeline; }
  async exec() {
    const rows = await readCollection(this.model, this.pipeline[0]?.$match || {}), collections = new Map();
    const scan = async steps => {
      for (const step of steps) {
        const lookup = step.$lookup;
        if (lookup?.from && !collections.has(lookup.from)) {
          const related = [...registry.values()].find(model => model.databaseName === this.model.databaseName && model.collection.name === lookup.from);
          if (!related) throw fail(`Unknown lookup collection: ${lookup.from}`, 500);
          collections.set(lookup.from, await readCollection(related));
        }
        if (lookup?.pipeline) await scan(lookup.pipeline);
        if (step.$facet) for (const sub of Object.values(step.$facet)) await scan(sub);
      }
    };
    await scan(this.pipeline);
    return new Aggregator(this.pipeline, { collectionResolver: name => collections.get(name) || [], scriptEnabled: false }).run(rows);
  }
  then(resolve, reject) { return this.exec().then(resolve, reject); }
  catch(reject) { return this.exec().catch(reject); }
}
async function persist(model, document, expectedVersion) {
  const data = castObject(document, model.schema, true, true);
  data._id = String(data._id || new ObjectId());
  if (model.schema.options.timestamps) { data.createdAt ||= new Date(); data.updatedAt = new Date(); }
  if (data.__v === undefined) data.__v = 0;
  const json = JSON.stringify(data);
  if (json.length > 1800000) throw fail('Document exceeds D1 storage limit', 413);
  if (expectedVersion != null) {
    const result = await binding('DB').prepare('UPDATE documents SET document=?,version=version+1 WHERE database_name=? AND collection_name=? AND id=? AND version=?').bind(json, model.databaseName, model.collection.name, data._id, expectedVersion).run();
    if (!result.meta.changes) throw fail('Document changed concurrently; retry the request', 409);
  } else await binding('DB').prepare('INSERT INTO documents(database_name,collection_name,id,document) VALUES(?,?,?,?)').bind(model.databaseName, model.collection.name, data._id, json).run();
  Object.defineProperty(data, '_version', { value: (expectedVersion || 0) + 1 });
  return data;
}
class Document {
  constructor(data = {}) { Object.assign(this, data); Object.defineProperty(this, '_version', { value: data._version, writable: true }); }
  async save() { const saved = await persist(this.constructor, this, this._version); Object.assign(this, saved); this._version = saved._version; return this; }
  toObject() { return Object.fromEntries(Object.entries(this)); }
  toJSON() { return this.toObject(); }
}
export function model(name, schema, collection, databaseName = 'dcDB') {
  const key = `${databaseName}:${name}`;
  if (registry.has(key)) return registry.get(key);
  class Model extends Document {}
  Object.assign(Model, { modelName: name, databaseName, schema, collection: { name: collection || schema.options.collection || pluralize(name) } });
  Model.find = (filter = {}) => new RequestQuery(Model, filter);
  Model.findOne = (filter = {}) => new RequestQuery(Model, filter, true);
  Model.findById = id => Model.findOne({ _id: id });
  Model.countDocuments = (filter = {}) => new RequestQuery(Model, filter, false, true);
  Model.exists = async filter => { const doc = await Model.findOne(filter).select('_id').lean(); return doc ? { _id: doc._id } : null; };
  Model.aggregate = pipeline => new AggregateQuery(Model, pipeline);
  Model.create = async data => Array.isArray(data) ? Promise.all(data.map(row => Model.create(row))) : new Model(await persist(Model, data));
  Model.updateOne = async (filter, changes, options = {}) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const old = await Model.findOne(filter).lean();
      if (!old && !options.upsert) return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
      const data = copy(old || Object.fromEntries(Object.entries(castFilter(filter, schema)).filter(([k,v]) => !k.startsWith('$') && (v == null || typeof v !== 'object' || v instanceof Date))));
      const operations = copy(changes);
      if (operations.$setOnInsert) { if (!old) for (const [field,value] of Object.entries(operations.$setOnInsert)) put(data, field, value); delete operations.$setOnInsert; }
      if (Object.keys(operations).some(key => key.startsWith('$'))) {
        for(const [operator,values]of Object.entries(operations)) update(data,{[operator]:values});
      }
      else Object.assign(data, operations);
      try {
        const result = await persist(Model, data, old?._version);
        return { matchedCount: old ? 1 : 0, modifiedCount: old ? 1 : 0, upsertedCount: old ? 0 : 1, upsertedId: old ? null : result._id };
      } catch (error) { if (error.status !== 409 || attempt === 2) throw error; }
    }
  };
  Model.findOneAndUpdate = (filter, changes, options = {}) => {
    const query = new RequestQuery(Model, filter, true);
    query.exec = async () => { const old = await Model.findOne(filter).lean(); await Model.updateOne(filter, changes, options); return options.new || options.returnDocument === 'after' ? Model.findOne(old ? { _id: old._id } : filter) : old ? new Model(old) : null; };
    return query;
  };
  const remove = async (filter, one) => {
    const rows = await (one ? Model.findOne(filter).lean().then(row => row ? [row] : []) : Model.find(filter).lean());
    let deletedCount = 0;
    for (const row of rows) {
      const result = await binding('DB').prepare('DELETE FROM documents WHERE database_name=? AND collection_name=? AND id=? AND version=?').bind(databaseName, Model.collection.name, row._id, row._version).run();
      deletedCount += result.meta.changes;
    }
    return { deletedCount };
  };
  Model.deleteOne = filter => remove(filter, true);
  Model.deleteMany = filter => remove(filter, false);
  for (const [name, implementation] of Object.entries(schema.statics)) Model[name] = implementation.bind(Model);
  registry.set(key, Model);
  return Model;
}
export function connection(databaseName) { return { model: (name, schema, collection) => model(name, schema, collection, databaseName) }; }
export function registeredModels() { return [...registry.values()]; }
export default { model, Schema, Types };
