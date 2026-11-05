import { makeDataSource } from './database/db';
async function main() { const db = await makeDataSource().initialize(); await db.runMigrations(); await db.destroy(); }
main().catch(e => { console.error(e); process.exit(1); });
