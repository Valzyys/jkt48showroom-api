export function jsonPath(path) {
  if (!/^[A-Za-z_][\w]*(\.[A-Za-z_][\w]*)*$/.test(path)) return null;
  return '$.' + path.split('.').map(part => `"${part}"`).join('.');
}
function scalar(value) {
  if (value instanceof Date || value?.toDate) return new Date(value.valueOf()).toISOString();
  if (value === true) return 1;
  if (value === false) return 0;
  return value;
}
// Only push comparisons proven equivalent for scalar schema fields into SQL.
// Mingo evaluates the complete predicate after hydration, including arrays/regex.
export function compileFilter(filter, isScalar = () => false) {
  const clauses = [], values = [];
  for (const [key, value] of Object.entries(filter || {})) {
    if (key === '$and') {
      for (const item of value) { const part = compileFilter(item, isScalar); if (part.sql) { clauses.push(`(${part.sql})`); values.push(...part.values); } }
      continue;
    }
    if (key === '$or') {
      const parts = value.map(item => compileFilter(item, isScalar));
      if (parts.every(part => part.complete && part.sql)) { clauses.push(`(${parts.map(part => part.sql).join(' OR ')})`); values.push(...parts.flatMap(part => part.values)); }
      continue;
    }
    const path = jsonPath(key);
    if (!path || !isScalar(key) || value == null || value instanceof RegExp || Array.isArray(value)) continue;
    const expression = `json_extract(document, '${path}')`;
    const operators = value instanceof Date || value?.toDate || typeof value !== 'object' ? { $eq: value } : value;
    for (const [operator, operand] of Object.entries(operators)) {
      const compare = { $eq: '=', $gt: '>', $gte: '>=', $lt: '<', $lte: '<=' }[operator];
      if (compare && operand != null && (typeof operand !== 'object' || operand instanceof Date || operand?.toDate)) { clauses.push(`${expression} ${compare} ?`); values.push(scalar(operand)); }
      if (operator === '$in' && Array.isArray(operand) && operand.length && operand.every(x => x != null && ['string', 'number', 'boolean'].includes(typeof x))) { clauses.push(`${expression} IN (${operand.map(() => '?').join(',')})`); values.push(...operand.map(scalar)); }
    }
  }
  const keys = Object.keys(filter || {});
  const complete = keys.every(key => {
    if (key === '$and' || key === '$or') return filter[key].every(item => compileFilter(item, isScalar).complete);
    const value = filter[key];
    if (!jsonPath(key) || !isScalar(key) || value == null || value instanceof RegExp || Array.isArray(value)) return false;
    if (typeof value !== 'object' || value instanceof Date) return true;
    return Object.keys(value).every(op => op==='$in' ? Array.isArray(value[op]) && value[op].length>0 && value[op].every(x=>x!=null&&['string','number','boolean'].includes(typeof x)) : ['$eq', '$gt', '$gte', '$lt', '$lte'].includes(op) && value[op] != null && (typeof value[op] !== 'object' || value[op] instanceof Date));
  });
  return { sql: clauses.join(' AND '), values, complete };
}
