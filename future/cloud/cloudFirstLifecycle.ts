/**
 * Future mini-program event bridge. The host registers uni.onNetworkStatusChange
 * and App.onShow, plus an event emitted ONLY after a local record is durably
 * stored. Disposing subscriptions prevents duplicate network requests.
 */
import type {CloudState} from './cloudFirst'
export type CloudFirstEventSource={
 onRecordSaved(listener:()=>void):()=>void
 onForeground(listener:()=>void):()=>void
 onNetworkStatusChange(listener:(connected:boolean)=>void):()=>void
}
export type CloudFirstRunner={
 onLocalSaved():Promise<CloudState>
 onForeground():Promise<CloudState>
 onNetworkRestored():Promise<CloudState>
}
export function bindCloudFirstLifecycle(
 source:CloudFirstEventSource,
 runner:CloudFirstRunner,
 onError?:(error:unknown)=>void
):()=>void{
 if(typeof source?.onRecordSaved!=='function'||
    typeof source.onForeground!=='function'||
    typeof source.onNetworkStatusChange!=='function'||
    typeof runner?.onLocalSaved!=='function'||
    typeof runner.onForeground!=='function'||
    typeof runner.onNetworkRestored!=='function')
   throw Error('cloud_first_event_hooks_required')
 let disposed=false
 const deliver=(task:()=>Promise<CloudState>)=>{
   if(disposed)return
   try{void task().catch(error=>{if(!disposed)onError?.(error)})}
   catch(error){onError?.(error)}
 }
 const off1=source.onRecordSaved(()=>deliver(()=>runner.onLocalSaved()))
 const off2=source.onForeground(()=>deliver(()=>runner.onForeground()))
 const off3=source.onNetworkStatusChange(connected=>{
   if(connected)deliver(()=>runner.onNetworkRestored())
 })
 return ()=>{
   if(disposed)return
   disposed=true
   off1();off2();off3()
 }
}
