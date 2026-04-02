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

**No `netlify.toml` at the repository root** (a root `base = …` forces every site to the same app).

Each app folder has its **own** `netlify.toml` with only `publish = "."` — that **`.`** means “this folder,” and it is only correct when Netlify’s **Base directory** is already set to that folder (see below).

### Netlify UI (both sites)

Use the **same pattern** for marketing and manager:

| Field | Value |
|--------|--------|
| **Base directory** | Full path to **that** app (see below) |
| **Publish directory** | `.` (one dot) |
| **Build command** | (empty) |
| **Package directory** | (empty) |
| **Functions directory** | (empty) — clear `netlify/functions` if it was set |

**Marketing (`sheekapp.com`):**  
**Base directory:** `AppKitchen copy 2/SheekWebsite`

**Manager (`app.sheekapp.com`):**  
**Base directory:** `AppKitchen copy 2/KennyKitchenWeb`

After you save, Netlify may show **Base** as `/` on the summary screen when it means “no extra prefix”; what matters is the **Configure** screen shows the **full path** above and **Publish** = `.`.

If you instead leave **Base** empty and only set **Publish** to a long path, Netlify can treat `publish = "."` in `netlify.toml` as the **repo root** and you get a **404** — so use **Base + Publish `.`** together.

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
