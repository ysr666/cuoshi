/** Build only. Compiles future private entry to a gitignored CommonJS island. */
import {execFileSync} from 'node:child_process'
import {mkdirSync,writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
const root=fileURLToPath(new URL('../../',import.meta.url))
const output=resolve(root,'future/server/.private-build')
mkdirSync(output,{recursive:true})
execFileSync(resolve(root,'node_modules/.bin/tsc'),[
 '--strict','--target','ES2022','--module','CommonJS','--moduleResolution','node',
 '--skipLibCheck','--rootDir',root,'--outDir',output,
 'future/server/src/privateMain.ts','future/server/src/privateMaintenance.ts',
 'future/server/src/staffHttpHost.ts',
 'future/server/src/privateStaffMain.ts',
 'future/server/src/ownerAuthHttp.ts'
],{cwd:root,stdio:'inherit'})
writeFileSync(resolve(output,'package.json'),'{"type":"commonjs","private":true}\n')
console.log('PASS private backend entry compiled; no process started')
