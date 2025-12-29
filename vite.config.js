import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    proxy: {
      '/api': {
        target: 'https://opendart.fss.or.kr',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '/api')
      },
      '/stock-api': {
        target: 'http://apis.data.go.kr/1160100/service/GetStockSecuritiesInfoService',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/stock-api/, '').replace(/\/(\?|$)/, '$1')
      }
    }
  }
})
