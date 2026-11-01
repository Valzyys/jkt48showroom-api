import { DatabaseSync } from 'node:sqlite';
import { readFileSync,readdirSync } from 'node:fs';
export function database() {
  const sqlite=new DatabaseSync(':memory:');
  for(const file of readdirSync(new URL('../migrations/',import.meta.url)).filter(file=>file.endsWith('.sql')).sort()) sqlite.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
  return {
    sqlite,
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {const results=[];for(const statement of statements)results.push(await statement.run());sqlite.exec('COMMIT');return results;}
      catch(error){sqlite.exec('ROLLBACK');throw error;}
    },
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
