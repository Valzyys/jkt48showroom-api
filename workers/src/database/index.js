import { connection } from '../runtime/database.js';
import { binding } from '../runtime/env.js';
export const dcDB = connection('dcDB');
export const jkt48DB = connection('jkt48DB');
export const liveDB = connection('liveDB');
export const userDB = connection('userDB');
export const db = { dc: dcDB, jkt48: jkt48DB, live: liveDB, user: userDB };
export async function dbConnect() { binding('DB'); }
