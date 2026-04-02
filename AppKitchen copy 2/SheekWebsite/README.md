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

### Netlify (recommended): two sites, same repo

**Do not commit `netlify.toml` for these sites** (no root file, no file under `SheekWebsite` / `KennyKitchenWeb`). A `publish = "."` in `netlify.toml` is resolved from the **repo root**, so Netlify publishes the wrong folder and you’ll see **“Overridden by netlify.toml”** plus a **404**. Configure everything in the Netlify UI.

For **each** site, use paths from the **repository root** (leave **Base directory** empty):

1. **Marketing (`sheekapp.com`):**  
   **Publish directory:** `AppKitchen copy 2/SheekWebsite`  
   **Build command:** (empty) · **Functions:** (empty)  
   **Domain:** `sheekapp.com` (and `www` if you want).

2. **Manager (`app.sheekapp.com`):**  
   **Publish directory:** `AppKitchen copy 2/KennyKitchenWeb`  
   **Build command:** (empty) · **Functions:** (empty)  
   **Domain:** `app.sheekapp.com`

3. **DNS** (registrar or Netlify DNS):  
   - Apex / `www` → marketing Netlify site  
   - Host **`app`** → CNAME to the **dashboard** site’s Netlify hostname (e.g. `sheek-app.netlify.app`), not the marketing site.

### Other hosts

1. **Marketing:** Deploy `SheekWebsite` and attach `sheekapp.com`.  
2. **App:** Deploy `KennyKitchenWeb` as a **separate** deployment and attach **`app.sheekapp.com`**.  
3. Same DNS split: apex/www → marketing, `app` → manager host.

## Supabase Auth (when you use magic links / redirects)

In Supabase → **Authentication → URL configuration**, add:

- Site URL: `https://sheekapp.com` (or your preferred entry URL)  
- Redirect URLs: `https://app.sheekapp.com/**`, `http://localhost:*` for dev
