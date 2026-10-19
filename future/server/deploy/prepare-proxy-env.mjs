/** On-operator-host only. Never commit the output file.
 * Transforms the server's raw 32-byte edge secret into Caddy's derived proof.
 * The proof is a privileged bearer; do not print it to stdout or logs.
 */
import {createHash} from 'node:crypto'
import {openSync,writeSync,closeSync,unlinkSync} from 'node:fs'
import {isAbsolute,resolve} from 'node:path'
import {fileURLToPath} from 'node:url'

export function deriveProxyProof(hex){
 if(typeof hex!=='string'||!/^[0-9a-f]{64}$/i.test(hex))
  throw Error('proxy_secret_must_be_32_bytes')
 return createHash('sha256').update(Buffer.from(hex,'hex')).digest('hex')
}
export function configLines(env){
 const domain=env.CUOSHI_PUBLIC_DOMAIN
 const port=env.CUOSHI_PRIVATE_PORT
 if(typeof domain!=='string'||!/^([a-z0-9-]+\.)+[a-z]{2,24}$/i.test(domain)||
  /(?:^|\.)(?:localhost|local|test|example|invalid)$/i.test(domain))
  throw Error('proxy_requires_public_domain')
 if(typeof port!=='string'||!/^\d{4,5}$/.test(port)||
  Number(port)<1024||Number(port)>65535)
  throw Error('proxy_requires_valid_private_port')
 return `CUOSHI_PUBLIC_DOMAIN=${domain}\nCUOSHI_PRIVATE_PORT=${port}\n`+
  `CUOSHI_EDGE_PROOF_HEX=${deriveProxyProof(env.CUOSHI_EDGE_SHARED_SECRET_HEX)}\n`
}
export function createProxyEnvironmentFile(dest,env){
 if(typeof dest!=='string'||!isAbsolute(dest))
  throw Error('proxy_env_file_must_be_absolute')
 const target=resolve(dest)
 // This artifact is a privileged proxy credential. Never place it anywhere
 // under the checked-out source tree or a world-readable web directory.
 const repo=resolve(fileURLToPath(new URL('../../../',import.meta.url)))
 if(target===repo||target.startsWith(repo+'/'))
  throw Error('proxy_env_cannot_be_in_repository')
 const value=configLines(env)
 // Exclusive creation prevents symlink following or silent overwrites.
 const fd=openSync(target,'wx',0o600)
 try{writeSync(fd,value,null,'utf8')}catch(error){
  closeSync(fd)
  unlinkSync(target)
  throw error
 }
 closeSync(fd)
 return target
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  createProxyEnvironmentFile(process.argv[2],process.env)
  process.stdout.write('PASS proxy environment created with owner-only permissions; no credential displayed\n')
 }catch(error){
  const msg=error instanceof Error?error.message:''
  const safe=/^proxy_[a-z_]+$/.test(msg)?msg:'proxy_env_creation_failed'
  process.stderr.write(safe+'\n');process.exitCode=1
 }
}
