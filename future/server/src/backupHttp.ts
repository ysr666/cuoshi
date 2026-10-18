/**
 * v0.5 cloud-backup HTTP transport boundary.
 *
 * This exports an isolated request handler ONLY. It deliberately creates no
 * HTTP listener, does not issue tokens, and cannot deploy anything. A future
 * trusted host must terminate TLS, verify host/routing, impose rate limits,
 * and inject a database-backed AuthenticatedCloudService.
 */
import type {IncomingMessage,ServerResponse} from 'node:http'
import {TextDecoder} from 'node:util'
import type {AuthenticatedCloudService} from './authenticatedService'
import type {UploadRequest,UploadDecision} from '../../cloud/snapshotContract'

const MAX_BODY_BYTES=11*1024*1024 // >10 MiB JSONB document limit + metadata
type Backend=Pick<AuthenticatedCloudService,'readBackup'|'upload'>
type PublicCode='bad_request'|'unauthorized'|'access_denied'|'not_found'|
  'method_not_allowed'|'payload_too_large'|'unsupported_media_type'|
  'cloud_temporarily_unavailable'
class HttpFailure extends Error{
  constructor(readonly status:number,readonly code:PublicCode){super(code)}
}
function answer(res:ServerResponse,status:number,payload?:unknown){
  res.setHeader('Cache-Control','no-store, private')
  res.setHeader('Pragma','no-cache')
  res.setHeader('X-Content-Type-Options','nosniff')
  res.setHeader('Referrer-Policy','no-referrer')
  res.setHeader('X-Frame-Options','DENY')
  // Deliberately never emit Access-Control-Allow-Origin: * or reflect Origin.
  if(payload===undefined){
    res.writeHead(status)
    res.end()
    return
  }
  const json=JSON.stringify(payload)
  res.setHeader('Content-Type','application/json; charset=utf-8')
  res.writeHead(status)
  res.end(json)
}
function bearer(req:IncomingMessage):string{
  const value=req.headers.authorization
  if(typeof value!=='string'||value.length>2000||
     !/^Bearer [A-Za-z0-9_.-]{90,1800}$/.test(value))
    throw new HttpFailure(401,'unauthorized')
  return value.slice(7)
}
async function collectJson(req:IncomingMessage):Promise<unknown>{
  const media=req.headers['content-type']
  if(typeof media!=='string'||
     !/^application\/json(?:\s*;\s*charset\s*=\s*utf-8)?$/i.test(media))
    throw new HttpFailure(415,'unsupported_media_type')
  const declared=req.headers['content-length']
  if(declared!==undefined&&(!/^\d+$/.test(declared)||
     !Number.isSafeInteger(Number(declared))))
    throw new HttpFailure(400,'bad_request')
  if(declared!==undefined&&Number(declared)>MAX_BODY_BYTES){
    req.resume()
    throw new HttpFailure(413,'payload_too_large')
  }
  let used=0
  const parts:Buffer[]=[]
  try{
    for await(const part of req){
      const bytes=Buffer.isBuffer(part)?part:Buffer.from(part)
      used+=bytes.byteLength
      if(used>MAX_BODY_BYTES)throw new HttpFailure(413,'payload_too_large')
      parts.push(bytes)
    }
  }catch(e){
    if(e instanceof HttpFailure)throw e
    throw new HttpFailure(400,'bad_request')
  }
  if(!used)throw new HttpFailure(400,'bad_request')
  let parsed:unknown
  try{parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts)))}
  catch{throw new HttpFailure(400,'bad_request')}
  return parsed
}
function requestShape(raw:unknown):UploadRequest{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new HttpFailure(400,'bad_request')
  const data=raw as Record<string,unknown>
  // The URL and body never select owner or device; the verified server JWT
  // supplies both. Forbid ownerId, token, userId and unexpected fields.
  const fields=Object.keys(data).sort()
  const exact=['baseDigest','baseRevision','idempotencyKey','records']
  if(fields.length!==exact.length||fields.some((x,i)=>x!==exact[i]))
    throw new HttpFailure(400,'bad_request')
  if(!Number.isSafeInteger(data.baseRevision)||Number(data.baseRevision)<0||
     !(data.baseDigest===null||(typeof data.baseDigest==='string'&&/^[a-f0-9]{64}$/.test(data.baseDigest)))||
     typeof data.idempotencyKey!=='string'||!/^[a-zA-Z0-9_-]{8,128}$/.test(data.idempotencyKey)||
     !data.records||typeof data.records!=='object'||Array.isArray(data.records))
    throw new HttpFailure(400,'bad_request')
  return data as unknown as UploadRequest
}
function errorResponse(error:unknown):HttpFailure{
  if(error instanceof HttpFailure)return error
  // Do not expose stack traces, SQL/table names, tokens or private notes.
  if(error instanceof Error){
    if(['unauthorized','session_revoked'].includes(error.message))
      return new HttpFailure(401,'unauthorized')
    if(error.message==='account_closed')return new HttpFailure(403,'access_denied')
  }
  return new HttpFailure(503,'cloud_temporarily_unavailable')
}
function decisionResponse(res:ServerResponse,decision:UploadDecision){
  if(decision.kind==='conflict')return answer(res,409,decision)
  if(decision.kind==='accepted'||decision.kind==='replayed')return answer(res,200,decision)
  switch(decision.reason){
    case 'authentication':return answer(res,401,decision)
    case 'consent_required':return answer(res,403,decision)
    case 'invalid_request':return answer(res,400,decision)
    case 'validation':
    case 'history_rewrite':
    case 'idempotency_mismatch':return answer(res,422,decision)
    default:return answer(res,422,{kind:'rejected',reason:'validation'})
  }
}
/** Call this handler from a future *private* TLS hosting entrypoint. */
export function createBackupHttpHandler(service:Backend){
  if(typeof service?.readBackup!=='function'||typeof service?.upload!=='function')
    throw Error('backup_http_backend_required')
  return async (req:IncomingMessage,res:ServerResponse):Promise<void>=>{
    try{
      const uri=req.url??''
      if(uri!=='/v1/backup/snapshot')throw new HttpFailure(404,'not_found')
      if(req.method!=='GET'&&req.method!=='PUT'){
        res.setHeader('Allow','GET, PUT')
        throw new HttpFailure(405,'method_not_allowed')
      }
      const token=bearer(req)
      if(req.method==='GET'){
        // Unlike the body, the account is NEVER accepted via request URL.
        const cloud=await service.readBackup(token)
        if(cloud===null)return answer(res,204)
        return answer(res,200,cloud)
      }
      const payload=requestShape(await collectJson(req))
      const decision=await service.upload(token,payload)
      return decisionResponse(res,decision)
    }catch(error){
      const safe=errorResponse(error)
      if(!res.headersSent)answer(res,safe.status,{error:safe.code})
      else res.end()
    }
  }
}
