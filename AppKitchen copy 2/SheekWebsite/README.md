# Sheek marketing site

Static landing page for **Sheek** at **https://sheekapp.com** (features, pricing, CTAs to the app).

## URLs

| Site | Domain |
|------|--------|
| Marketing (this folder) | **https://sheekapp.com** |
| Manager dashboard (`KennyKitchenWeb`) | **https://app.sheekapp.com** |

`site-config.js` sets dashboard buttons to `https://app.sheekapp.com/` in production, and to `../KennyKitchenWeb/index.html` on localhost / when opened as a file.

## View locally

```bash
cd "SheekWebsite"
npx --yes serve .
```

## Deploy

1. **Marketing:** Deploy this folder to your host and attach the **apex** domain `sheekapp.com` (and `www` if you want — redirect one to the other).
2. **App:** Deploy `KennyKitchenWeb/` as a **second** site on the same host (second Netlify/Vercel project) and set hostname **`app.sheekapp.com`**.
3. **DNS** (at your registrar):  
   - `A` / `CNAME` for `@` (and `www`) → marketing host  
   - `CNAME` **`app`** → app project (e.g. `your-app.netlify.app`)

## Supabase Auth (when you use magic links / redirects)

In Supabase → **Authentication → URL configuration**, add:

- Site URL: `https://sheekapp.com` (or your preferred entry URL)  
- Redirect URLs: `https://app.sheekapp.com/**`, `http://localhost:*` for dev
