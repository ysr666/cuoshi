import { defineConfig, type Plugin } from 'vite'
import uni from '@dcloudio/vite-plugin-uni'

/**
 * Only the MP-Weixin production build: opt out of DCloud's implicit
 * third-party shadow image prefetch. The app does not use this image.
 *
 * Do NOT overwrite wx.preloadAssets globally or patch minified output.
 * This source-level guard fails closed if DCloud changes the implementation.
 */
function disableImplicitDcloudPreload(): Plugin {
  let patched = false
  return {
    name: 'cuoshi-disable-implicit-dcloud-preload',
    enforce: 'pre',
    apply: 'build',
    transform(source, identifier) {
      if (process.env.UNI_PLATFORM !== 'mp-weixin') return
      const normalized = identifier.split('\\').join('/')
      if (!normalized.endsWith('/@dcloudio/uni-mp-weixin/dist/uni.mp.esm.js')) return
      const marker = /^([ \t]*)preloadAsset\(\);[ \t]*$/gm
      const matches = [...source.matchAll(marker)]
      if (matches.length !== 1
          || !source.includes('wx.preloadAssets')
          || !source.includes('__UNI_PRELOAD_SHADOW_IMAGE__')) {
        throw Error('DCloud shadow preload changed; review network behavior before building')
      }
      patched = true
      console.log('Cuoshi: skipped optional DCloud CDN shadow image preload')
      return source.replace(marker, '$1/* Cuoshi: intentionally no implicit network prefetch. */')
    },
    generateBundle() {
      if (process.env.UNI_PLATFORM === 'mp-weixin' && !patched) {
        throw Error('DCloud preload source was not audited; refusing unverified WeChat build')
      }
    }
  }
}

export default defineConfig({ plugins: [disableImplicitDcloudPreload(), uni()] })
