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

**Marketing** folder includes a small `netlify.toml` (`publish = "."`) so it pairs with **Base** in the UI (see below). **Manager** (`KennyKitchenWeb`) can be deployed via **GitHub Actions** instead if the Netlify UI keeps autofilling broken paths (see “If Netlify won’t let you clear autofill”).

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
**Base directory:** `AppKitchen-copy-2/SheekWebsite`

**Manager (`app.sheekapp.com`):**  
**Base directory:** `AppKitchen-copy-2/KennyKitchenWeb`

After you save, Netlify may show **Base** as `/` on the summary screen when it means “no extra prefix”; what matters is the **Configure** screen shows the **full path** above and **Publish** = `.`.

If you instead leave **Base** empty and only set **Publish** to a long path, Netlify can treat `publish = "."` in `netlify.toml` as the **repo root** and you get a **404** — so use **Base + Publish `.`** together.

### If Netlify won’t let you clear autofill (Package / Publish / Functions)

Some browsers or Netlify UI versions **refill** fields and won’t save empty values. Use **GitHub Actions** to deploy the manager app and **ignore** the broken UI for that site.

1. **Netlify** → **User settings** → **Applications** → create a **personal access token** (or use a team token with deploy access).
2. **Netlify** → your **manager** site → **Site configuration** → **General** → copy **Site ID** (API ID).
3. **GitHub** → repo **Settings** → **Secrets and variables** → **Actions** → add:
   - `NETLIFY_AUTH_TOKEN` — the token from step 1  
   - `NETLIFY_SITE_ID_MANAGER` — the Site ID from step 2  
4. Push to `main` (or merge a PR). Workflow **`.github/workflows/netlify-manager.yml`** runs `netlify deploy --prod --dir="AppKitchen-copy-2/KennyKitchenWeb"` — no base/publish UI needed for that deploy.

**Avoid two deploys fighting:** for the **manager** site only, either **unlink** the Git repo in Netlify (**Build & deploy → Continuous deployment → Manage repository → Unlink**), or set a **Stop builds** / ignore pattern if you use it — otherwise Git-triggered Netlify builds may still run with bad UI settings alongside the good Action deploy.

**DNS** (registrar or Netlify DNS):  
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
