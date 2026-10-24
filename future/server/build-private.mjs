/** Build only. Compiles future private entry to a gitignored CommonJS island. */
import {execFileSync} from 'node:child_process'
import {mkdtempSync,renameSync,rmSync,writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
const root=fileURLToPath(new URL('../../',import.meta.url))
const output=resolve(root,'future/server/.private-build')
// Compile into a new directory, never an old output tree: tsc does not remove
// obsolete files and release packaging must not accidentally ship them.
const stage=mkdtempSync(resolve(root,'future/server/.private-build-stage-'))
try {
 execFileSync(resolve(root,'node_modules/.bin/tsc'),[
  '--strict','--target','ES2022','--module','CommonJS','--moduleResolution','node',
  '--skipLibCheck','--rootDir',root,'--outDir',stage,
  'future/server/src/privateMain.ts','future/server/src/privateMaintenance.ts',
  'future/server/src/staffHttpHost.ts',
  'future/server/src/privateStaffMain.ts',
  'future/server/src/ownerAuthHttp.ts'
 ],{cwd:root,stdio:'inherit'})
 writeFileSync(resolve(stage,'package.json'),'{"type":"commonjs","private":true}\n')
 // Do not touch the previous build unless the new TypeScript compilation
 // completed; a failed build is never considered a releasable artifact.
 rmSync(output,{recursive:true,force:true})
 renameSync(stage,output)
 console.log('PASS fresh private backend entry compiled; no process started')
} finally {
 rmSync(stage,{recursive:true,force:true})
}
