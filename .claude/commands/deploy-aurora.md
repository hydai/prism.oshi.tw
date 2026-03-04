Deploy Aurora to Cloudflare Pages:
1. Run `cd tools/aurora && npm install && npm run build`
2. Run `cd tools/aurora && npx wrangler pages deploy dist --project-name oshi-prism-aurora --branch main`
3. Report the deployed URL
