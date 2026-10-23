import { auditArchive, release } from '../dist/scripts/release-helpers.js';
if (process.argv.length !== 3) throw new Error('Supply the exact npm archive path');
console.log(JSON.stringify({ name: release.name, version: release.version, ...await auditArchive(process.argv[2]) }, null, 2));
