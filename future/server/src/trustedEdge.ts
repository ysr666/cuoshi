/**
 * v0.5 future trusted reverse-proxy boundary. The backend is loopback-only;
 * the local TLS-terminating proxy MUST delete untrusted client-supplied
 * X-Cuoshi-* headers and replace them with authenticated metadata.
 *
 * This is a private-host adapter, not proof that public TLS, rate limits,
 * reverse proxy, real WeChat credentials, or compliance exist.
 */
import {createHash,timingSafeEqual} from 'node:crypto'
import {isIP} from 'node:net'
import type {IncomingMessage,ServerResponse} from 'node:http'
import {answer} from './backupHttp'

export type CloudRequestHandler=(req:IncomingMessage,res:ServerResponse)=>Promise<void>
const loopbacks=new Set(['127.0.0.1','::1','::ffff:127.0.0.1'])
const secretHeader='x-cuoshi-edge-proof'
const peerHeader='x-cuoshi-client-ip'

/** Signed request metadata can only be trusted after a loopback socket check. */
export function createTrustedEdgeBoundary(args:{
  sharedSecret:Uint8Array
}){
  if(!(args?.sharedSecret instanceof Uint8Array)||args.sharedSecret.byteLength<32)throw Error('trusted_edge_not_configured')
  const expected=createHash('sha256').update(args.sharedSecret).digest()
  const peers=new WeakMap<IncomingMessage,string>()
  const clientIp=(req:IncomingMessage):string|null=>peers.get(req)??null
  function protect(next:CloudRequestHandler):CloudRequestHandler{
   if(typeof next!=='function')throw Error('trusted_edge_route_required')
   return async(req:IncomingMessage,res:ServerResponse):Promise<void>=>{
    const socket=req?.socket?.remoteAddress
    const proof=req?.headers?.[secretHeader]
    const forwarded=req?.headers?.[peerHeader]
    // A passcode alone is never sufficient if the HTTP server was mistakenly
    // bound to a public interface. Array/multiple headers are not accepted.
    let authorized=typeof socket==='string'&&loopbacks.has(socket)&&
      typeof proof==='string'&&/^[a-f0-9]{64}$/i.test(proof)&&
      typeof forwarded==='string'&&isIP(forwarded)!==0
    if(authorized){
      const actual=createHash('sha256').update(Buffer.from(proof as string,'hex')).digest()
      authorized=timingSafeEqual(expected,actual)
    }
    if(!authorized){answer(res,403,{error:'access_denied'});return}
    peers.set(req,(forwarded as string).toLowerCase())
    try{await next(req,res)}finally{peers.delete(req)}
   }
  }
  return {protect,clientIp}
}
