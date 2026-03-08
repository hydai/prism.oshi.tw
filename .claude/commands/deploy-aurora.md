Deploy Aurora to Cloudflare Pages:
1. Run `cd tools/aurora && npm install && npm run build` (from the project root)
2. Run `cd tools/aurora && npx wrangler pages deploy dist --project-name oshi-prism-aurora --branch main` (from the project root)
3. Report the deployed URL
