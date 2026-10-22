#!/bin/sh
set -e
rm -rf dist && mkdir dist
npx esbuild src/app.js --bundle --minify --outfile=dist/app.js --target=es2020 >/dev/null
npx esbuild src/style.css --minify --outfile=dist/app.css >/dev/null
V=$(date +%s); sed "s|app.css|app.css?v=$V|; s|app.js|app.js?v=$V|" index.html > dist/index.html
printf '/*  /index.html  200\n' > dist/_redirects
printf '/*\n  X-Frame-Options: DENY\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n' > dist/_headers
