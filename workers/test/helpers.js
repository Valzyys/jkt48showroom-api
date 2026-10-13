import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
export function database() {
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0001_documents.sql',import.meta.url),'utf8'));
  return {
    sqlite,
    prepare(sql) {
      let values=[];
      const statement=()=>sqlite.prepare(sql);
      return {
        bind(...args) { values=args;return this; },
        async first() { return statement().get(...values) || null; },
        async all() { return {results:statement().all(...values)}; },
        async run() { return {meta:{changes:Number(statement().run(...values).changes)}}; }
      };
    }
  };
}
