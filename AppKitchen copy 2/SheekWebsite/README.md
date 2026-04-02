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

**Important:** There is **no** `netlify.toml` at the **repository root**. A root file with `base = …` makes **every** Netlify site publish the same folder (you’d see a red “Overridden by netlify.toml” warning). Each site sets **Base directory** in the Netlify UI only.

1. **Marketing site:** New site from Git → branch `main` →  
   **Base directory:** `AppKitchen copy 2/SheekWebsite`  
   **Publish directory:** `.` (**only** a dot — paths are relative to base; do **not** repeat `AppKitchen copy 2/…` here or you get a Netlify 404.)  
   Leave **Package directory** and **Functions directory** empty unless you use them.  
   **Domain:** `sheekapp.com` (and `www` → optional redirect to apex).

2. **Manager dashboard:** **Add another site** → same repository and branch →  
   **Base directory:** `AppKitchen copy 2/KennyKitchenWeb`  
   **Publish directory:** `.` (same rule — relative to base only)  
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
