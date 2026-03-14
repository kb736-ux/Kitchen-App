// Recipes Page — clean rebuild
// Active = used in at least one dish. Inactive = not linked to any dish.
// New recipes start inactive; adding to a dish makes them active.

window.recipesData = window.recipesData || {};
let dishes = [];

function norm(s) {
    return String(s || '').trim().replace(/\s+/g, ' ');
}
function normKey(s) {
    return norm(s).toLowerCase().replace(/\bvanila\b/g, 'vanilla');
}

function getCanonicalRecipeName(rawName) {
    const key = normKey(rawName);
    if (!key) return '';
    const match = Object.values(window.recipesData || {}).find(r => normKey(r?.name) === key);
    return match?.name || norm(rawName);
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
        .select('id, name, desc, ingredients, steps, yield_amount, yield_unit')
        .eq('org_id', window.ORG_ID);
    if (error) {
        console.warn('[Recipes] Load failed:', error.message);
        window.recipesData = {};
        return;
    }
    window.recipesData = {};
    (data || []).forEach(r => {
        const name = norm(r.name);
        if (!name) return;
        window.recipesData[name] = {
            name,
            desc: r.desc || '',
            ingredients: r.ingredients || [],
            steps: r.steps || [],
            yieldAmount: r.yield_amount,
            yieldUnit: r.yield_unit || '',
            id: r.id,
        };
    });
}

async function loadDishesFromSupabase() {
    if (!window.supabaseClient || !window.ORG_ID) return [];
    const { data, error } = await window.supabaseClient
        .from('dishes')
        .select('id, name, recipes')
        .eq('org_id', window.ORG_ID);
    if (error) {
        console.warn('[Recipes] Dishes load failed:', error.message);
        return [];
    }
    return (data || []).map(d => ({
        id: d.id,
        name: norm(d.name),
        recipes: (d.recipes || []).map(r => typeof r === 'string' ? norm(r) : norm(r?.name || '')),
    }));
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

    const search = norm(document.getElementById('recipe-search')?.value || '').toLowerCase();
    const activeList = document.getElementById('active-recipes-list');
    const inactiveList = document.getElementById('inactive-recipes-list');
    const activeEmpty = document.getElementById('active-empty');
    const inactiveEmpty = document.getElementById('inactive-empty');

    const active = [];
    const inactive = [];
    Object.values(window.recipesData).forEach(r => {
        if (!r.name) return;
        const match = !search || normKey(r.name).includes(search) || normKey(r.desc || '').includes(search);
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
    const desc = (r.desc || '').slice(0, 80) + ((r.desc || '').length > 80 ? '…' : '');
    const yieldStr = r.yieldAmount != null && r.yieldUnit ? `Makes ${r.yieldAmount} ${r.yieldUnit}` : '';
    const subtitle = desc || yieldStr || (isActive ? 'Used in a dish — add recipe details' : '');
    return `
    <div class="recipe-card ${isActive ? 'recipe-card-active' : ''}" data-recipe-name="${esc(r.name)}">
        <h3 class="recipe-name">${esc(r.name)}</h3>
        ${subtitle ? `<p class="recipe-desc">${esc(subtitle)}</p>` : ''}
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

    const search = norm(document.getElementById('recipe-search')?.value || '').toLowerCase();
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
        return `
        <div class="dish-card" data-dish-id="${d.id}">
            <i class="dish-card-icon fas fa-utensils"></i>
            <div class="dish-card-body">
                <h3 class="dish-name">${esc(d.name)}</h3>
                <p class="dish-meta">${meta}</p>
                <div class="dish-actions">
                    <button class="btn-icon btn-edit" onclick="editDish('${d.id}')" title="Edit"><i class="fas fa-pen"></i></button>
                    <button class="btn-icon btn-danger" onclick="deleteDish('${d.id}')" title="Delete"><i class="fas fa-trash"></i></button>
                    <button class="btn-icon btn-dropdown" title="More"><i class="fas fa-chevron-down"></i></button>
                </div>
            </div>
        </div>`;
    }).join('');
}

// ── Recipe modal ──────────────────────────────────────────────────────────────
let recipeEditingName = null;

function openRecipeModal(editName = null) {
    recipeEditingName = editName;
    const modal = document.getElementById('recipe-modal');
    const title = document.getElementById('recipe-modal-title');
    const nameInput = document.getElementById('recipe-name');
    const descInput = document.getElementById('recipe-desc');
    const yieldInput = document.getElementById('recipe-yield');

    title.innerHTML = editName ? '<i class="fas fa-edit"></i> Edit Recipe' : '<i class="fas fa-book"></i> Create Recipe';
    if (editName && window.recipesData[editName]) {
        const r = window.recipesData[editName];
        nameInput.value = r.name || '';
        descInput.value = r.desc || '';
        yieldInput.value = (r.yieldAmount != null && r.yieldUnit) ? `${r.yieldAmount} ${r.yieldUnit}` : '';
    } else {
        nameInput.value = '';
        descInput.value = '';
        yieldInput.value = '';
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
    const desc = norm(document.getElementById('recipe-desc').value);
    const yieldVal = norm(document.getElementById('recipe-yield').value);
    if (!name) {
        document.getElementById('recipe-name').focus();
        return;
    }

    const match = yieldVal.match(/^(\d+(?:\.\d+)?)\s*(.*)$/);
    const yieldAmount = match ? parseFloat(match[1]) : null;
    const yieldUnit = match ? norm(match[2]) : yieldVal || null;

    const payload = {
        name,
        desc,
        ingredients: [],
        steps: [],
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

    if (recipeEditingName && recipeEditingName !== name) {
        const old = window.recipesData[recipeEditingName];
        if (old?.id) {
            await window.supabaseClient.from('recipes').update({
                name, desc, ingredients: [], steps: [],
                yield_amount: yieldAmount, yield_unit: yieldUnit, status,
            }).eq('id', old.id);
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
            await window.supabaseClient.from('recipes').update({
                name, desc, ingredients: [], steps: [],
                yield_amount: yieldAmount, yield_unit: yieldUnit, status,
            }).eq('id', existing.id);
        } else {
            await window.supabaseClient.from('recipes').insert({
                org_id: window.ORG_ID,
                name, desc, ingredients: [], steps: [],
                yield_amount: yieldAmount, yield_unit: yieldUnit,
                status: 'archived',
            });
        }
    }

    window.recipesData[name] = {
        name, desc, ingredients: [], steps: [],
        yieldAmount, yieldUnit, active: isActive,
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

    title.innerHTML = editId ? '<i class="fas fa-edit"></i> Edit Dish' : '<i class="fas fa-utensils"></i> Create Dish';
    const existing = editId ? dishes.find(d => d.id === editId) : null;
    nameInput.value = existing ? existing.name : '';

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
}

async function saveDish() {
    const name = norm(document.getElementById('dish-name').value);
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
        }
    } else {
        dishes.push({
            id: 'temp-' + Date.now(),
            name,
            recipes: checked,
        });
    }

    if (window.supabaseClient && window.ORG_ID) {
        for (const d of dishes) {
            const payload = { org_id: window.ORG_ID, name: d.name, recipes: d.recipes };
            if (d.id && String(d.id).match(/^[0-9a-f-]{36}$/i)) {
                await window.supabaseClient.from('dishes').update(payload).eq('id', d.id);
            } else {
                const { data } = await window.supabaseClient.from('dishes').insert(payload).select('id').single();
                if (data) d.id = data.id;
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
    if (window.supabaseClient && window.ORG_ID) {
        await loadRecipesFromSupabase();
        dishes = await loadDishesFromSupabase();
        await canonicalizeDishesAndMaybePersist();
        await syncAllRecipeStatuses();
    }
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
