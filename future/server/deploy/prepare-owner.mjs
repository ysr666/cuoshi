/** Offline sole-owner initial provisioning. Generates a private, one-time
 * bootstrap bundle, NEVER connects to PostgreSQL or prints any credentials.
 * An operator must inspect, transfer and securely erase sensitive artifacts.
 */
import {randomBytes,scryptSync,createHash} from 'node:crypto'
import {mkdirSync,openSync,writeSync,closeSync,rmSync,realpathSync,lstatSync} from 'node:fs'
import {resolve,isAbsolute,dirname,basename,sep} from 'node:path'
import {fileURLToPath} from 'node:url'
const root=resolve(fileURLToPath(new URL('../../../',import.meta.url)))
const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
function base32(bytes){
 let value=0,bits=0,result=''
 for(const byte of bytes){
   value=(value<<8)|byte;bits+=8
   while(bits>=5){bits-=5;result+=alphabet[(value>>bits)&31]}
 }
 if(bits)result+=alphabet[(value<<(5-bits))&31]
 return result
}
function writePrivate(path,contents){
 const fd=openSync(path,'wx',0o600)
 try{writeSync(fd,contents,null,'utf8')}
 finally{closeSync(fd)}
}
export function provisionSoleOwnerBundle(dest,schema,random=randomBytes){
 if(typeof schema!=='string'||!/^[a-z][a-z0-9_]{0,62}$/.test(schema)||
   ['public','postgres','root','admin'].includes(schema)||schema.startsWith('pg_'))
   throw Error('owner_bootstrap_schema_invalid')
 if(typeof dest!=='string'||!isAbsolute(dest))throw Error('owner_bootstrap_absolute_path_required')
 const target=resolve(dest)
 if(target===root||target.startsWith(root+sep))
   throw Error('owner_bootstrap_repository_forbidden')
 const base=realpathSync(dirname(target))
 if(lstatSync(dirname(target)).isSymbolicLink()||
   (lstatSync(base).mode&0o022)!==0)
   throw Error('owner_bootstrap_unsafe_parent')
 const actual=resolve(base,basename(target))
 if(actual===root||actual.startsWith(root+sep))
   throw Error('owner_bootstrap_repository_forbidden')
 // Reject existing folders/symlinks by atomic exclusive mkdir; no replacement.
 mkdirSync(actual,{recursive:false,mode:0o700})
 try{
   const ownerId='owner_'+random(12).toString('hex')
   const password=random(36).toString('base64url')
   const salt=random(16)
   const hash=scryptSync(password,salt,32,{N:16384,r:8,p:1,maxmem:64*1024*1024})
   const seed=base32(random(20))
   const signingKey=random(32).toString('hex')
   const edgeKey=random(32).toString('hex')
   const peerKey=random(32).toString('hex')
   const values=[ownerId,password,seed,signingKey,edgeKey,peerKey]
   if(new Set(values).size!==values.length)throw Error('owner_bootstrap_entropy_invalid')
   const env=[
    `CUOSHI_OWNER_ADMIN_ID=${ownerId}`,
    `CUOSHI_OWNER_PASSWORD_SCRYPT=scrypt:16384:${salt.toString('hex')}:${hash.toString('hex')}`,
    `CUOSHI_OWNER_TOTP_SECRET=${seed}`,
    `CUOSHI_OWNER_LOGIN_PEER_KEY_HEX=${peerKey}`,
    `CUOSHI_STAFF_SIGNING_KEY_HEX=${signingKey}`,
    `CUOSHI_STAFF_EDGE_SHARED_SECRET_HEX=${edgeKey}`
   ].join('\n')+'\n'
   const onboarding=`SOLE-OWNER ONE-TIME RECOVERY SHEET — KEEP PRIVATE\n`+
     `Owner ID: ${ownerId}\n`+
     `Initial dashboard password: ${password}\n`+
     `Authenticator TOTP secret (Base32): ${seed}\n`+
     `Authenticator label: Cuoshi (${ownerId})\n`+
     `Manual authenticator setup: time-based, 6 digits, 30 seconds, SHA-1\n`+
     `After enrolling, move password to an approved password manager and`+
     ` securely dispose of this one-time sheet; do not send over chat/email.\n`
   // SQL contains owner ID only. It cannot create runtime roles, reset or
   // silently replace existing owner identities; operator must execute once.
   const sql=`-- Review against an EMPTY target schema, as migration owner only.\n`+
     `-- Prepared offline; no database request was performed.\n`+
     `BEGIN;\nSET LOCAL search_path TO "${schema}",pg_catalog;\n`+
     `DO $cuoshi_owner$\nBEGIN\n`+
     ` IF EXISTS (SELECT 1 FROM cloud_staff) THEN\n`+
     `   RAISE EXCEPTION 'owner_bootstrap_requires_empty_staff_table';\n`+
     ` END IF;\n`+
     ` INSERT INTO cloud_staff(staff_id,role,active)\n`+
     ` VALUES ('${ownerId}','super_admin',TRUE);\n`+
     `END\n$cuoshi_owner$;\nCOMMIT;\n`
   writePrivate(resolve(actual,'owner-auth.env.fragment'),env)
   writePrivate(resolve(actual,'owner-onboarding.txt'),onboarding)
   writePrivate(resolve(actual,'owner-enroll.sql'),sql)
   writePrivate(resolve(actual,'SHA256-MANIFEST.txt'),
     ['owner-auth.env.fragment','owner-enroll.sql'].map(x=>{
       const bytes=x==='owner-enroll.sql'?sql:env
       return `${createHash('sha256').update(bytes).digest('hex')}  ${x}`
     }).join('\n')+'\n')
   return {count:4,directory:actual}
 }catch(error){rmSync(actual,{recursive:true,force:true});throw error}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
   const result=provisionSoleOwnerBundle(process.argv[2],process.env.CUOSHI_PG_SCHEMA)
   process.stdout.write(`PASS ${result.count} owner-only files created offline, no credentials printed or installed\n`)
 }catch(error){
   const msg=error instanceof Error?error.message:''
   process.stderr.write(/^owner_bootstrap_[a-z_]+$/.test(msg)?msg:'owner_bootstrap_failed')
   process.stderr.write('\n');process.exitCode=1
 }
}
