import { ensureJKT48 } from './sync';
export { getJKT48Headers } from './headers';
export function fetchNewsJKT48() {return ensureJKT48('news',{force:true});}
export function fetchScheduleJKT48() {return ensureJKT48('schedules',{force:true});}
