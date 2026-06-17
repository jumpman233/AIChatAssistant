export default defineNuxtConfig({
  compatibilityDate: '2026-06-17',
  components: [
    {
      path: '~/components',
      pathPrefix: false,
    },
  ],
  css: ['~/assets/css/main.css'],
  devtools: {
    enabled: true,
  },
  future: {
    compatibilityVersion: 4,
  },
  modules: [],
  srcDir: 'app',
  typescript: {
    strict: true,
    typeCheck: false,
  },
})
