/** Track the local calendar day while a tab remains open.
 * OnShow also catches a paused background tab or a device timezone change.
 */
import {ref,onUnmounted} from 'vue'
import {onShow,onHide} from '@dcloudio/uni-app'
import {localDate} from './model'

export function useLiveDay(){
  const today=ref(localDate())
  let timer:ReturnType<typeof setTimeout>|undefined

  function stop(){
    if(timer!==undefined){clearTimeout(timer);timer=undefined}
  }
  function schedule(){
    stop()
    const now=new Date()
    const midnight=new Date(now.getFullYear(),now.getMonth(),now.getDate()+1)
    const remaining=Math.max(20,midnight.getTime()-now.getTime()+80)
    timer=setTimeout(refresh,remaining)
  }
  function refresh(){
    const current=localDate()
    if(today.value!==current)today.value=current
    schedule()
  }

  onShow(refresh)
  onHide(stop)
  onUnmounted(stop)
  return {today,refresh}
}
