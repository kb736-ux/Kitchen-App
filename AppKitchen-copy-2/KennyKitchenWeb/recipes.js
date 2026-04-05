// Recipes Page — clean rebuild
// Active = used in at least one dish. Inactive = not linked to any dish.
// New recipes start inactive; adding to a dish makes them active.

window.recipesData = window.recipesData || {};
let dishes = [];
const expandedDishIds = new Set();
let dishPendingImageFile = null;

function norm(s) {
    return String(s || '').trim().replace(/\s+/g, ' ');
}
function normKey(s) {
    return norm(s).toLowerCase().replace(/\bvanila\b/g, 'vanilla');
}

/** Main recipe search: if user pastes an email, don't filter (emails never match dish/recipe names). */
function getRecipeSearchQuery() {
    const raw = norm(document.getElementById('recipe-search')?.value || '').toLowerCase();
    if (!raw) return '';
    if (raw.includes('@')) return '';
    return raw;
}

function getCanonicalRecipeName(rawName) {
    const key = normKey(rawName);
    if (!key) return '';
    const match = Object.values(window.recipesData || {}).find(r => normKey(r?.name) === key);
    return match?.name || norm(rawName);
}

function parseAllergens(raw) {
    if (Array.isArray(raw)) return raw.map(v => norm(v)).filter(Boolean);
    return String(raw || '')
        .split(',')
        .map(v => norm(v))
        .filter(Boolean);
}

function supabaseErrText(err) {
    if (!err) return '';
    return [err.message, err.details, err.hint].filter(Boolean).join(' ');
}

function parseBulletLines(raw) {
    if (Array.isArray(raw)) {
        return raw.map(v => norm(v)).filter(Boolean);
    }
    return String(raw || '')
        .split('\n')
        .map(line => line.replace(/^\s*[-*•\d.)]+\s*/, ''))
        .map(v => norm(v))
        .filter(Boolean);
}

function bulletLinesToText(lines) {
    return (lines || []).map(v => norm(v)).filter(Boolean).join('\n');
}

function recipeSummaryText(recipe) {
    const ing = (recipe?.ingredients || []).filter(Boolean);
    const stp = (recipe?.steps || []).filter(Boolean);
    if (ing.length || stp.length) {
        const parts = [];
        if (ing.length) parts.push(`${ing.length} ingredient${ing.length === 1 ? '' : 's'}`);
        if (stp.length) parts.push(`${stp.length} step${stp.length === 1 ? '' : 's'}`);
        return parts.join(' • ');
    }
    const yieldStr = recipe?.yieldAmount != null && recipe?.yieldUnit ? `Makes ${recipe.yieldAmount} ${recipe.yieldUnit}` : '';
    return yieldStr || '';
}

function allergensToInputValue(list) {
    return (list || []).map(v => norm(v)).filter(Boolean).join(', ');
}

function allergenChipsHtml(allergens = []) {
    const clean = (allergens || []).map(a => norm(a)).filter(Boolean).slice(0, 5);
    if (!clean.length) return '';
    return `<div class="dish-allergens">${clean.map(a => `<span class="allergen-chip">${esc(a)}</span>`).join('')}</div>`;
}

function recipeAllergenChipsHtml(allergens = []) {
    const clean = (allergens || []).map(a => norm(a)).filter(Boolean).slice(0, 5);
    if (!clean.length) return '';
    return `<div class="recipe-allergens">${clean.map(a => `<span class="allergen-chip">${esc(a)}</span>`).join('')}</div>`;
}

function setDishImagePreview(url) {
    const wrap = document.getElementById('dish-image-preview-wrap');
    const img = document.getElementById('dish-image-preview');
    if (!wrap || !img) return;
    const src = norm(url);
    if (!src) {
        img.src = '';
        wrap.style.display = 'none';
        return;
    }
    img.src = src;
    wrap.style.display = 'block';
    img.onerror = () => {
        img.src = '';
        wrap.style.display = 'none';
    };
}

async function uploadDishImage(file, dishName) {
    if (!window.supabaseClient || !window.ORG_ID || !file) return null;
    const safeBase = (norm(dishName) || 'dish')
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'dish';
    const ext = (file.name || '').split('.').pop()?.toLowerCase() || 'jpg';
    const path = `${window.ORG_ID}/dishes/${safeBase}-${Date.now()}.${ext}`;
    const { error: upErr } = await window.supabaseClient.storage
        .from('avatars')
        .upload(path, file, { upsert: true, contentType: file.type || 'image/jpeg' });
    if (upErr) throw upErr;
    const { data } = window.supabaseClient.storage.from('avatars').getPublicUrl(path);
    return data?.publicUrl ? `${data.publicUrl}?t=${Date.now()}` : null;
}



async function canonicalizeDishesAndMaybePersist() {
    if (!Array.isArray(dishes) || dishes.length === 0) return;
    const changed = [];
    dishes.forEach(d => {
        const before = (d.recipes || []).map(r => norm(r)).filter(Boolean);
        const after = before.map(r => getCanonicalRecipeName(r)).filter(Boolean);
        const same = before.length === after.length && before.every((v, i) => v === after[i]);
        if (!same) {
            d.recipes = after;
            changed.push(d);
        }
    });

    if (changed.length && window.supabaseClient && window.ORG_ID) {
        for (const d of changed) {
            if (d.id && String(d.id).match(/^[0-9a-f-]{36}$/i)) {
                await window.supabaseClient.from('dishes')
                    .update({ recipes: d.recipes })
                    .eq('id', d.id);
            }
        }
    }
}

// ── Load from Supabase ───────────────────────────────────────────────────────
async function loadRecipesFromSupabase() {
    if (!window.supabaseClient || !window.ORG_ID) return;
    const { data, error } = await window.supabaseClient
        .from('recipes')
        .select('*')
        .eq('org_id', window.ORG_ID);
    if (error) {
        console.warn('[Recipes] Load failed:', error.message);
        window.recipesData = {};
        return;
    }
    window.recipesData = {};
    (data || []).forEach(r => {
        const name = norm(r.name || r.recipe_name || '');
        if (!name) return;
        const ingredients = parseBulletLines(r.ingredients || r.recipe_ingredients || []);
        const steps = parseBulletLines(r.steps || r.recipe_steps || []);
        const desc = norm(r.desc || r.description || '');
        window.recipesData[name] = {
            name,
            desc,
            ingredients,
            steps,
            yieldAmount: r.yield_amount,
            yieldUnit: r.yield_unit || '',
            allergens: parseAllergens(r.allergens),
            id: r.id,
        };
    });
}

/** Single-flight so supabase-ready + navigation don't double-fetch dishes (duplicate 400s in Network). */
let __loadDishesInFlight = null;

function isLikelyUuid(s) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(s || '').trim());
}

async function loadDishesFromSupabase() {
    if (!window.supabaseClient || !window.ORG_ID) return [];
    const org = String(window.ORG_ID).trim();
    if (!isLikelyUuid(org)) {
        console.warn('[Recipes] ORG_ID is not a valid UUID; cannot load dishes:', org);
        return [];
    }
    if (__loadDishesInFlight) return __loadDishesInFlight;

    __loadDishesInFlight = (async () => {
        const client = window.supabaseClient;
        const errTxt = (e) => [e?.message, e?.details, e?.hint].filter(Boolean).join(' ');
        // Order matters: avoid requesting `recipes` before `id,name` when column is missing (extra 400).
        // Put `id, name, recipes` first (one round-trip when schema matches); then narrower selects; `*` last (odd types).
        const attempts = [
            () => client.from('dishes').select('id, name, recipes').eq('org_id', org),
            () => client.from('dishes').select('id, name').eq('org_id', org),
            () => client.from('dishes').select('id').eq('org_id', org),
            () => client.from('dishes').select('*').eq('org_id', org),
        ];
        let data = null;
        let error = null;
        for (const run of attempts) {
            const res = await run();
            if (!res.error) {
                data = res.data;
                error = null;
                break;
            }
            error = res.error;
        }
        if (error) {
            console.warn('[Recipes] Dishes load failed:', errTxt(error));
            return [];
        }
        const rawRecipes = (d) => d.recipes ?? d.recipe_list ?? d.linked_recipes ?? [];
        return (data || []).map(d => ({
            id: d.id,
            name: norm(d.name),
            recipes: (rawRecipes(d) || []).map(r => typeof r === 'string' ? norm(r) : norm(r?.name || '')),
            image_url: norm(d.image_url || ''),
            allergens: parseAllergens(d.allergens),
        }));
    })();

    try {
        return await __loadDishesInFlight;
    } finally {
        __loadDishesInFlight = null;
    }
}

// Compute which recipes are used in dishes; sync status to Supabase
function getRecipeKeysInDishes() {
    const set = new Set();
    dishes.forEach(d => {
        (d.recipes || []).forEach(r => {
            const k = normKey(r);
            if (k) set.add(k);
        });
    });
    return set;
}

async function syncRecipeStatusToSupabase(recipeName, isActive) {
    if (!window.supabaseClient || !window.ORG_ID) return;
    const status = isActive ? 'active' : 'archived';
    const { error } = await window.supabaseClient
        .from('recipes')
        .update({ status })
        .eq('org_id', window.ORG_ID)
        .ilike('name', recipeName);
    if (error) console.warn('[Recipes] Status sync failed:', recipeName, error.message);
}

async function syncAllRecipeStatuses() {
    const inDishes = getRecipeKeysInDishes();
    for (const name of Object.keys(window.recipesData)) {
        const active = inDishes.has(normKey(name));
        window.recipesData[name].active = active;
        await syncRecipeStatusToSupabase(name, active);
    }
}

// ── Render ───────────────────────────────────────────────────────────────────
function renderRecipeLists() {
    const inDishes = getRecipeKeysInDishes();
    Object.keys(window.recipesData).forEach(name => {
        window.recipesData[name].active = inDishes.has(normKey(name));
    });
    if (!document.getElementById('inactive-recipes-list')) return; // Only render DOM on recipes page

    const search = getRecipeSearchQuery();
    const activeList = document.getElementById('active-recipes-list');
    const inactiveList = document.getElementById('inactive-recipes-list');
    const activeEmpty = document.getElementById('active-empty');
    const inactiveEmpty = document.getElementById('inactive-empty');

    const active = [];
    const inactive = [];
    Object.values(window.recipesData).forEach(r => {
        if (!r.name) return;
        const ingText = (r.ingredients || []).join(' ');
        const stepText = (r.steps || []).join(' ');
        const match = !search
            || normKey(r.name).includes(search)
            || normKey(ingText).includes(search)
            || normKey(stepText).includes(search);
        if (!match) return;
        if (r.active) active.push(r);
        else inactive.push(r);
    });

    active.sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }));
    inactive.sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }));

    activeList.innerHTML = active.map(r => recipeCardHtml(r, true)).join('');
    inactiveList.innerHTML = inactive.map(r => recipeCardHtml(r, false)).join('');
    activeEmpty.style.display = active.length ? 'none' : 'flex';
    inactiveEmpty.style.display = inactive.length ? 'none' : 'flex';

    document.querySelectorAll('.recipe-card').forEach(card => {
        card.addEventListener('click', () => {
            const name = card.dataset.recipeName;
            if (name) openRecipeDetail(name);
        });
    });
}

function recipeCardHtml(r, isActive) {
    const subtitle = recipeSummaryText(r) || (isActive ? 'Used in a dish' : 'Not linked to a dish yet');
    const allergens = recipeAllergenChipsHtml(r.allergens || []);
    return `
    <div class="recipe-card ${isActive ? 'recipe-card-active' : ''}" data-recipe-name="${esc(r.name)}">
        <h3 class="recipe-name">${esc(r.name)}</h3>
        ${subtitle ? `<p class="recipe-desc">${esc(subtitle)}</p>` : ''}
        ${allergens}
    </div>`;
}

function esc(s) {
    const d = document.createElement('div');
    d.textContent = String(s ?? '');
    return d.innerHTML;
}

function renderDishes() {
    const list = document.getElementById('dishes-list');
    const empty = document.getElementById('dishes-empty');
    if (!list || !empty) return; // Only on recipes page

    const search = getRecipeSearchQuery();
    const componentNames = new Set(dishes.flatMap(d => d.recipes || []));
    let topLevel = dishes.filter(d => !componentNames.has(d.name));
    const hasAnyDishes = topLevel.length > 0;
    if (search) {
        topLevel = topLevel.filter(d =>
            normKey(d.name).includes(search) ||
            (d.recipes || []).some(r => normKey(r).includes(search))
        );
    }

    if (topLevel.length === 0) {
        list.innerHTML = '';
        list.style.display = 'none';
        empty.style.display = 'flex';
        const p = empty.querySelector('p');
        const span = empty.querySelector('span');
        if (p) p.textContent = search && hasAnyDishes ? 'No dishes match your search' : 'No dishes yet';
        if (span) span.textContent = search && hasAnyDishes ? 'Try a different search term' : 'Create a dish to link menu items to recipes';
        return;
    }
    list.style.display = 'flex';
    empty.style.display = 'none';
    list.innerHTML = topLevel.map(d => {
        const n = (d.recipes || []).length;
        const meta = `${n} recipe${n === 1 ? '' : 's'} required`;
        const isExpanded = expandedDishIds.has(d.id);
        const recipeItems = (d.recipes || []).map(r => `<span class="dish-recipe-chip">${esc(r)}</span>`).join('');
        return `
        <div class="dish-card" data-dish-id="${d.id}">
            ${d.image_url ? `<img class="dish-image-thumb" src="${esc(d.image_url)}" alt="${esc(d.name)}">` : '<i class="dish-card-icon fas fa-utensils"></i>'}
            <div class="dish-card-body">
                <h3 class="dish-name">${esc(d.name)}</h3>
                <p class="dish-meta">${meta}</p>
                ${allergenChipsHtml(d.allergens || [])}
                <div class="dish-actions">
                    <button class="btn-icon btn-edit" onclick="editDish('${d.id}')" title="Edit"><i class="fas fa-pen"></i></button>
                    <button class="btn-icon btn-danger" onclick="deleteDish('${d.id}')" title="Delete"><i class="fas fa-trash"></i></button>
                    <button class="btn-icon btn-dropdown ${isExpanded ? 'open' : ''}" onclick="toggleDishDropdown('${d.id}')" title="Show recipes">
                      <i class="fas fa-chevron-down"></i>
                    </button>
                </div>
                <div class="dish-recipes-panel" style="display:${isExpanded ? 'flex' : 'none'};">
                    ${recipeItems || '<span class="dish-recipe-empty">No linked recipes</span>'}
                </div>
            </div>
        </div>`;
    }).join('');
}

function toggleDishDropdown(id) {
    if (!id) return;
    if (expandedDishIds.has(id)) expandedDishIds.delete(id);
    else expandedDishIds.add(id);
    renderDishes();
}
window.toggleDishDropdown = toggleDishDropdown;

// ── Recipe modal ──────────────────────────────────────────────────────────────
let recipeEditingName = null;

function openRecipeModal(editName = null) {
    recipeEditingName = editName;
    const modal = document.getElementById('recipe-modal');
    const title = document.getElementById('recipe-modal-title');
    const nameInput = document.getElementById('recipe-name');
    const ingredientsInput = document.getElementById('recipe-ingredients');
    const stepsInput = document.getElementById('recipe-steps');
    const yieldInput = document.getElementById('recipe-yield');
    const allergensInput = document.getElementById('recipe-allergens');

    title.innerHTML = editName ? '<i class="fas fa-edit"></i> Edit Recipe' : '<i class="fas fa-book"></i> Create Recipe';
    if (editName && window.recipesData[editName]) {
        const r = window.recipesData[editName];
        nameInput.value = r.name || '';
        ingredientsInput.value = bulletLinesToText(r.ingredients || []);
        stepsInput.value = bulletLinesToText(r.steps || []);
        yieldInput.value = (r.yieldAmount != null && r.yieldUnit) ? `${r.yieldAmount} ${r.yieldUnit}` : '';
        allergensInput.value = allergensToInputValue(r.allergens);
    } else {
        nameInput.value = '';
        ingredientsInput.value = '';
        stepsInput.value = '';
        yieldInput.value = '';
        allergensInput.value = '';
    }
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    setTimeout(() => nameInput.focus(), 50);
}

function closeRecipeModal() {
    document.getElementById('recipe-modal').classList.remove('active');
    document.body.style.overflow = '';
    recipeEditingName = null;
}

async function saveRecipe() {
    const name = norm(document.getElementById('recipe-name').value);
    const ingredients = parseBulletLines(document.getElementById('recipe-ingredients')?.value || '');
    const steps = parseBulletLines(document.getElementById('recipe-steps')?.value || '');
    const yieldVal = norm(document.getElementById('recipe-yield').value);
    const allergens = parseAllergens(document.getElementById('recipe-allergens')?.value || '');
    if (!name) {
        document.getElementById('recipe-name').focus();
        return;
    }

    const match = yieldVal.match(/^(\d+(?:\.\d+)?)\s*(.*)$/);
    const yieldAmount = match ? parseFloat(match[1]) : null;
    const yieldUnit = match ? norm(match[2]) : yieldVal || null;

    const desc = recipeSummaryText({ ingredients, steps, yieldAmount, yieldUnit }) || '';
    const payload = {
        name,
        desc,
        ingredients,
        steps,
        yield_amount: yieldAmount,
        yield_unit: yieldUnit,
        allergens,
    };
    const payloadNoAllergens = {
        name,
        desc,
        ingredients,
        steps,
        yield_amount: yieldAmount,
        yield_unit: yieldUnit,
    };

    if (!window.supabaseClient || !window.ORG_ID) {
        window.recipesData[name] = { ...payload, active: false };
        closeRecipeModal();
        renderRecipeLists();
        return;
    }

    const inDishes = getRecipeKeysInDishes();
    const isActive = inDishes.has(normKey(name));
    const status = isActive ? 'active' : 'archived';
    const payloadMinimal = { name, status };

    if (recipeEditingName && recipeEditingName !== name) {
        const old = window.recipesData[recipeEditingName];
        if (old?.id) {
            let upRes = await window.supabaseClient.from('recipes').update({
                ...payload,
                status,
            }).eq('id', old.id);
            if (upRes.error && /allergens/i.test(upRes.error.message || '')) {
                upRes = await window.supabaseClient.from('recipes').update({
                    ...payloadNoAllergens,
                    status,
                }).eq('id', old.id);
            }
            if (upRes.error && /(ingredients|steps|desc|yield_amount|yield_unit)/i.test(upRes.error.message || '')) {
                upRes = await window.supabaseClient.from('recipes').update(payloadMinimal).eq('id', old.id);
            }
            if (upRes.error) {
                alert(`Could not save recipe: ${upRes.error.message}`);
                return;
            }
            delete window.recipesData[recipeEditingName];
            // Update dishes that reference the old name
            for (const d of dishes) {
                const idx = (d.recipes || []).findIndex(r => normKey(r) === normKey(recipeEditingName));
                if (idx >= 0) {
                    d.recipes[idx] = name;
                    await window.supabaseClient.from('dishes').update({ recipes: d.recipes }).eq('id', d.id);
                }
            }
        }
    } else {
        const { data: existing } = await window.supabaseClient
            .from('recipes')
            .select('id')
            .eq('org_id', window.ORG_ID)
            .ilike('name', name)
            .maybeSingle();
        if (existing?.id) {
            let updateRes = await window.supabaseClient.from('recipes').update({
                ...payload,
                status,
            }).eq('id', existing.id);
            if (updateRes.error && /allergens/i.test(updateRes.error.message || '')) {
                updateRes = await window.supabaseClient.from('recipes').update({
                    ...payloadNoAllergens,
                    status,
                }).eq('id', existing.id);
            }
            if (updateRes.error && /(ingredients|steps|desc|yield_amount|yield_unit)/i.test(updateRes.error.message || '')) {
                updateRes = await window.supabaseClient.from('recipes').update(payloadMinimal).eq('id', existing.id);
            }
            if (updateRes.error) {
                alert(`Could not save recipe: ${updateRes.error.message}`);
                return;
            }
        } else {
            let insRes = await window.supabaseClient.from('recipes').insert({
                org_id: window.ORG_ID,
                ...payload,
                status: 'archived',
            });
            if (insRes.error && /allergens/i.test(insRes.error.message || '')) {
                insRes = await window.supabaseClient.from('recipes').insert({
                    org_id: window.ORG_ID,
                    ...payloadNoAllergens,
                    status: 'archived',
                });
            }
            if (insRes.error && /(ingredients|steps|desc|yield_amount|yield_unit)/i.test(insRes.error.message || '')) {
                insRes = await window.supabaseClient.from('recipes').insert({
                    org_id: window.ORG_ID,
                    ...payloadMinimal,
                });
            }
            if (insRes.error) {
                alert(`Could not save recipe: ${insRes.error.message}`);
                return;
            }
        }
    }

    window.recipesData[name] = {
        name, desc, ingredients, steps,
        yieldAmount, yieldUnit, active: isActive, allergens,
    };
    closeRecipeModal();
    await loadRecipesFromSupabase();
    await syncAllRecipeStatuses();
    renderRecipeLists();
}

function openRecipeDetail(name) {
    openRecipeModal(name);
}

// ── Dish modal ───────────────────────────────────────────────────────────────
let dishEditingId = null;

async function openDishModal(editId = null) {
    dishEditingId = editId;
    const modal = document.getElementById('dish-modal');
    const title = document.getElementById('dish-modal-title');
    const nameInput = document.getElementById('dish-name');
    const checkboxes = document.getElementById('dish-recipe-checkboxes');
    const searchInput = document.getElementById('dish-recipe-search');
    const imageUrlInput = document.getElementById('dish-image-url');
    const imageFileInput = document.getElementById('dish-image-file');
    const allergensInput = document.getElementById('dish-allergens');

    title.innerHTML = editId ? '<i class="fas fa-edit"></i> Edit Dish' : '<i class="fas fa-utensils"></i> Create Dish';
    const existing = editId ? dishes.find(d => d.id === editId) : null;
    nameInput.value = existing ? existing.name : '';
    imageUrlInput.value = existing?.image_url || '';
    allergensInput.value = allergensToInputValue(existing?.allergens || []);
    dishPendingImageFile = null;
    if (imageFileInput) imageFileInput.value = '';
    setDishImagePreview(existing?.image_url || '');

    const allRecipes = Object.values(window.recipesData)
        .filter(r => r.name)
        .sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }));
    const selected = new Set((existing?.recipes || []).map(n => normKey(n)));

    checkboxes.innerHTML = allRecipes.length === 0
        ? '<p class="dish-no-recipes">No recipes. Create recipes first.</p>'
        : allRecipes.map(r => `
            <label class="dish-recipe-option">
                <input type="checkbox" value="${esc(r.name)}" ${selected.has(normKey(r.name)) ? 'checked' : ''}>
                <span>${esc(r.name)}</span>
            </label>
        `).join('');

    searchInput.value = '';
    filterDishRecipes();
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    setTimeout(() => nameInput.focus(), 50);
}

function filterDishRecipes() {
    const q = (document.getElementById('dish-recipe-search')?.value || '').trim().toLowerCase();
    document.querySelectorAll('#dish-recipe-checkboxes .dish-recipe-option').forEach(lab => {
        const text = (lab.textContent || '').toLowerCase();
        lab.style.display = !q || text.includes(q) ? '' : 'none';
    });
}

function closeDishModal() {
    document.getElementById('dish-modal').classList.remove('active');
    document.body.style.overflow = '';
    dishEditingId = null;
    dishPendingImageFile = null;
    setDishImagePreview('');
}

async function saveDish() {
    const name = norm(document.getElementById('dish-name').value);
    const imageUrlInput = norm(document.getElementById('dish-image-url')?.value || '');
    const allergens = parseAllergens(document.getElementById('dish-allergens')?.value || '');
    if (!name) {
        document.getElementById('dish-name').focus();
        return;
    }
    const checked = Array.from(document.querySelectorAll('#dish-recipe-checkboxes input:checked'))
        .map(cb => getCanonicalRecipeName(cb.value))
        .filter(Boolean);

    if (dishEditingId) {
        const d = dishes.find(x => x.id === dishEditingId);
        if (d) {
            d.name = name;
            d.recipes = checked;
            d.image_url = imageUrlInput || d.image_url || '';
            d.allergens = allergens;
        }
    } else {
        dishes.push({
            id: 'temp-' + Date.now(),
            name,
            recipes: checked,
            image_url: imageUrlInput || '',
            allergens,
        });
    }

    if (window.supabaseClient && window.ORG_ID) {
        let uploadedImageUrl = imageUrlInput || '';
        if (dishPendingImageFile) {
            try {
                const maybeUrl = await uploadDishImage(dishPendingImageFile, name);
                if (maybeUrl) uploadedImageUrl = maybeUrl;
            } catch (e) {
                alert(`Dish image upload failed: ${e.message || 'Unknown error'}`);
            }
        }
        const targetDish = dishes.find((d) => d.id === dishEditingId) || dishes.find((d) => !dishEditingId && String(d.id).startsWith('temp-')) || null;
        if (targetDish) {
            targetDish.image_url = uploadedImageUrl || targetDish.image_url || '';
            targetDish.allergens = allergens;

            const payload = {
                org_id: window.ORG_ID,
                name: targetDish.name,
                recipes: targetDish.recipes,
                image_url: targetDish.image_url || null,
                allergens: targetDish.allergens || [],
            };
            if (targetDish.id && String(targetDish.id).match(/^[0-9a-f-]{36}$/i)) {
                let upRes = await window.supabaseClient.from('dishes').update(payload).eq('id', targetDish.id);
                if (upRes.error && /(image_url|allergens)/i.test(upRes.error.message || '')) {
                    upRes = await window.supabaseClient.from('dishes').update({
                        org_id: payload.org_id,
                        name: payload.name,
                        recipes: payload.recipes,
                    }).eq('id', targetDish.id);
                }
            } else {
                let insRes = await window.supabaseClient.from('dishes').insert(payload).select('id').maybeSingle();
                const errTxt = supabaseErrText(insRes.error);
                if (insRes.error && /(image_url|allergens|column|does not exist)/i.test(errTxt)) {
                    insRes = await window.supabaseClient.from('dishes').insert({
                        org_id: payload.org_id,
                        name: payload.name,
                        recipes: payload.recipes,
                    }).select('id').maybeSingle();
                }
                const { data, error: insErr } = insRes;
                if (data?.id) targetDish.id = data.id;
                else if (insErr) {
                    const perm = /403|42501|forbidden|permission|policy|row-level|RLS/i.test(errTxt);
                    console.warn('[Recipes] Dish insert failed:', errTxt);
                    if (perm && typeof showNotificationToast === 'function') {
                        showNotificationToast(
                            'Permission denied saving dish. In Supabase SQL Editor, run fix-dishes-rls-admin-profiles.sql (same folder as migrations), then refresh.',
                            'error'
                        );
                    } else if (typeof showNotificationToast === 'function') {
                        showNotificationToast(`Could not save dish: ${insErr.message || 'Unknown error'}`, 'error');
                    }
                }
            }
        }
        await canonicalizeDishesAndMaybePersist();
        await syncAllRecipeStatuses();
    }

    closeDishModal();
    renderDishes();
    renderRecipeLists();
}

function editDish(id) {
    openDishModal(id);
}

async function deleteDish(id) {
    if (!confirm('Delete this dish?')) return;
    const d = dishes.find(x => x.id === id);
    if (!d) return;
    dishes = dishes.filter(x => x.id !== id);
    if (window.supabaseClient && d.id) {
        await window.supabaseClient.from('dishes').delete().eq('id', d.id);
        await syncAllRecipeStatuses();
    }
    renderDishes();
    renderRecipeLists();
}

// ── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    // Avoid loading here: supabase-config dispatches `supabase-ready` after org resolution;
    // loading in both places caused duplicate requests (and noisy 400s when fallbacks run).
    renderDishes();
    renderRecipeLists();

    document.getElementById('create-recipe-btn')?.addEventListener('click', () => openRecipeModal());
    document.getElementById('create-dish-btn')?.addEventListener('click', () => openDishModal());
    document.getElementById('recipe-modal-close')?.addEventListener('click', closeRecipeModal);
    document.getElementById('recipe-modal-cancel')?.addEventListener('click', closeRecipeModal);
    document.getElementById('recipe-modal-save')?.addEventListener('click', saveRecipe);
    document.getElementById('dish-modal-close')?.addEventListener('click', closeDishModal);
    document.getElementById('dish-modal-cancel')?.addEventListener('click', closeDishModal);
    document.getElementById('dish-modal-save')?.addEventListener('click', saveDish);
    document.getElementById('recipe-search')?.addEventListener('input', () => {
        renderDishes();
        renderRecipeLists();
    });
    document.getElementById('dish-recipe-search')?.addEventListener('input', filterDishRecipes);
    document.getElementById('dish-image-url')?.addEventListener('input', (e) => {
        setDishImagePreview(e.target.value || '');
    });
    document.getElementById('dish-image-file')?.addEventListener('change', (e) => {
        const file = e.target?.files?.[0];
        dishPendingImageFile = file || null;
        if (!file) return;
        const localUrl = URL.createObjectURL(file);
        setDishImagePreview(localUrl);
    });

    document.getElementById('recipe-modal')?.addEventListener('click', e => {
        if (e.target.id === 'recipe-modal') closeRecipeModal();
    });
    document.getElementById('dish-modal')?.addEventListener('click', e => {
        if (e.target.id === 'dish-modal') closeDishModal();
    });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') { closeRecipeModal(); closeDishModal(); }
    });
});

window.addEventListener('supabase-ready', async () => {
    if (!window.supabaseClient || !window.ORG_ID) return;
    await loadRecipesFromSupabase();
    dishes = await loadDishesFromSupabase();
    await canonicalizeDishesAndMaybePersist();
    await syncAllRecipeStatuses();
    renderDishes();
    renderRecipeLists();
});

// scheduling.js defines loadActiveRecipes and reads from window.recipesData.
// We just ensure window.recipesData has { name, active } where active = used in a dish.
