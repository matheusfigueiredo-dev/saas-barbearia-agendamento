// Copies notify-pwa static assets to dist/notify so Netlify serves them
const fs = require('fs')
const path = require('path')

const srcDir = path.resolve(__dirname, '..', 'notify-pwa')
const dstDir = path.resolve(__dirname, '..', 'dist', 'notify')

function copyDir(src, dst) {
  if (!fs.existsSync(src)) return
  fs.mkdirSync(dst, { recursive: true })
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name)
    const d = path.join(dst, name)
    const st = fs.statSync(s)
    if (st.isDirectory()) copyDir(s, d)
    else fs.copyFileSync(s, d)
  }
}

copyDir(srcDir, dstDir)
console.log(`[postbuild] Copied notify-pwa to ${dstDir}`)
