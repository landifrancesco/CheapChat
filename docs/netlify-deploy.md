# Netlify Deployment

## Build settings

- Build command: `npm run build`
- Publish directory: `.next`
- Node version: `22`

## Required environment variables

- `DATABASE_URL`
- `SESSION_SECRET`
- `APP_CONFIG_MASTER_KEY`
- `APP_PASSWORD`

## Recommended Netlify environment variable

- `NETLIFY_NEXT_SKEW_PROTECTION=true`

## Notes

- UploadThing, provider API keys, and similar secrets saved through the app UI are stored in the database, not as Netlify environment variables.
- `postinstall` runs `prisma generate`, so the Prisma client is generated automatically during the Netlify install step.
- If you change the Prisma schema in the future, run the appropriate migration flow against Neon before or during deployment.
