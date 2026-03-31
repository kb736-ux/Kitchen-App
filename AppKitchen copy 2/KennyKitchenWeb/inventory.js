// Inventory Page — clean rebuild
// Shows ALL recipes (active and inactive). Inactive recipes are visually marked.
// Uses recipe yield_unit for display; syncs inventory_items to Supabase.

function norm(s) {
    return String(s || '').trim().replace(/\s+/g, ' ');
}
function normKey(s) {
    return norm(s).toLowerCase().replace(/\bvanila\b/g, 'vanilla');
}

let recipes = [];
let dishes = [];
let inventoryByKey = {}; // normalized item_name -> { id, kitted, quantity_on_hand, unit, ... }

// ── Load from Supabase ───────────────────────────────────────────────────────
async function loadRecipesForInventory() {
    if (!window.supabaseClient || !window.ORG_ID) return [];
    const { data, error } = await window.supabaseClient
        .from('recipes')
        .select('id, name, yield_amount, yield_unit')
        .eq('org_id', window.ORG_ID);
    if (error) {
        console.warn('[Inventory] Recipes load failed:', error.message);
        return [];
    }
    return (data || []).map(r => ({
        id: r.id,
        name: norm(r.name),
        yieldAmount: r.yield_amount,
        yieldUnit: r.yield_unit || '',
    }));
}

async function loadDishesForInventory() {
    if (!window.supabaseClient || !window.ORG_ID) return [];
    const client = window.supabaseClient;
    const org = String(window.ORG_ID).trim();
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
        console.warn('[Inventory] Dishes load failed:', error.message);
        return [];
    }
    const rawRecipes = (d) => d.recipes ?? d.recipe_list ?? d.linked_recipes ?? [];
    return (data || []).map(d => ({
        id: d.id,
        name: norm(d.name),
        recipes: (rawRecipes(d) || []).map(r => typeof r === 'string' ? norm(r) : norm(r?.name || '')),
    }));
}

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

async function loadInventoryItems() {
    if (!window.supabaseClient || !window.ORG_ID) return {};
    const { data, error } = await window.supabaseClient
        .from('inventory_items')
        .select('id, item_name, kitted, quantity_on_hand, unit, yield_unit, threshold_kitted')
        .eq('org_id', window.ORG_ID);
    if (error) {
        console.warn('[Inventory] Inventory load failed:', error.message);
        return {};
    }
    const map = {};
    (data || []).forEach(row => {
        const key = normKey(row.item_name);
        if (key) map[key] = { ...row, item_name: norm(row.item_name) };
    });
    return map;
}

// ── Render ───────────────────────────────────────────────────────────────────
function esc(s) {
    const d = document.createElement('div');
    d.textContent = String(s ?? '');
    return d.innerHTML;
}

function getUnitForRecipe(recipe, inv) {
    const fromRecipe = (recipe?.yieldUnit || '').trim();
    const fromInv = (inv?.unit || inv?.yield_unit || '').trim();
    // If the recipe has a yield unit, that is the single source of truth
    if (fromRecipe) return fromRecipe;
    // Otherwise fall back to whatever is stored on the inventory row
    return fromInv || 'portions';
}

function getStepForUnit(unit) {
    const u = unit.toLowerCase();
    if (u === 'qt' || u === 'qts' || u === 'pt' || u === 'pts' || u === 'liter' || u === 'liters') return 0.5;
    return 1;
}

function renderInventory() {
    const list = document.getElementById('inventory-list');
    const empty = document.getElementById('inventory-empty');
    const noMatch = document.getElementById('inventory-no-match');
    if (!list || !empty) return;

    const search = norm(document.getElementById('inventory-search')?.value || '').toLowerCase();
    const inDishes = getRecipeKeysInDishes();

    let filtered = recipes.filter(r => {
        if (!r.name) return false;
        return !search || normKey(r.name).includes(search) || normKey(r.yieldUnit || '').includes(search);
    });
    filtered.sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' }));

    if (recipes.length === 0) {
        list.innerHTML = '';
        list.style.display = 'none';
        empty.style.display = 'flex';
        noMatch.style.display = 'none';
        return;
    }

    empty.style.display = 'none';
    if (filtered.length === 0) {
        list.innerHTML = '';
        list.style.display = 'none';
        noMatch.style.display = 'flex';
        return;
    }

    list.style.display = 'flex';
    noMatch.style.display = 'none';

    list.innerHTML = filtered.map(r => {
        const key = normKey(r.name);
        const inv = inventoryByKey[key];
        const active = inDishes.has(key);
        const qty = inv?.quantity_on_hand ?? 0;
        const kitted = inv?.kitted ?? 0;
        const unit = getUnitForRecipe(r, inv);
        const step = getStepForUnit(unit);
        const displayQty = Number.isFinite(qty) ? qty : 0;

        return `
        <div class="inventory-row ${active ? '' : 'inventory-row-inactive'}" data-recipe-name="${esc(r.name)}">
            <div class="inventory-row-name">
                <span class="inventory-name">${esc(r.name)}</span>
                ${!active ? '<span class="inventory-inactive-badge">inactive</span>' : ''}
            </div>
            <div class="inventory-row-stats">
                <div class="inventory-stat">
                    <span class="inventory-stat-label">Kitted</span>
                    <div class="inventory-adj-group">
                        <button type="button" class="inventory-adj-btn" data-type="kitted" data-delta="-1" data-recipe="${esc(r.name)}" aria-label="Decrease kitted">−</button>
                        <span class="inventory-kitted">${kitted}</span>
                        <button type="button" class="inventory-adj-btn" data-type="kitted" data-delta="1" data-recipe="${esc(r.name)}" aria-label="Increase kitted">+</button>
                    </div>
                </div>
                <div class="inventory-stat">
                    <span class="inventory-stat-label">In stock</span>
                    <div class="inventory-adj-group">
                        <button type="button" class="inventory-adj-btn" data-type="instock" data-delta="-${step}" data-recipe="${esc(r.name)}" aria-label="Decrease">−</button>
                        <span class="inventory-qty">${displayQty}</span>
                        <button type="button" class="inventory-adj-btn" data-type="instock" data-delta="${step}" data-recipe="${esc(r.name)}" aria-label="Increase">+</button>
                        <span class="inventory-qty-unit">${esc(unit)}</span>
                    </div>
                </div>
            </div>
        </div>`;
    }).join('');

    document.querySelectorAll('.inventory-adj-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const delta = parseFloat(btn.dataset.delta);
            const recipeName = btn.dataset.recipe;
            const type = btn.dataset.type;
            if (!recipeName) return;
            if (type === 'kitted') quickAdjustKitted(recipeName, delta);
            else quickAdjust(recipeName, delta);
        });
    });
}

async function quickAdjust(recipeName, delta) {
    if (!window.supabaseClient || !window.ORG_ID) return;
    const key = normKey(recipeName);
    const inv = inventoryByKey[key];
    const recipe = recipes.find(r => normKey(r.name) === key);
    const unit = getUnitForRecipe(recipe, inv);
    const step = getStepForUnit(unit);
    const roundedDelta = Math.round(delta / step) * step;

    let newQty;
    let invId;

    if (inv) {
        const current = inv.quantity_on_hand ?? 0;
        newQty = Math.max(0, current + roundedDelta);
        invId = inv.id;
    } else {
        newQty = Math.max(0, roundedDelta);
    }

    const payload = {
        quantity_on_hand: newQty,
        unit: unit,
        yield_unit: unit,
    };

    if (invId) {
        const { error } = await window.supabaseClient
            .from('inventory_items')
            .update(payload)
            .eq('id', invId);
        if (error) {
            console.warn('[Inventory] Update failed:', error.message);
            return;
        }
    } else {
        const { data: inserted, error } = await window.supabaseClient
            .from('inventory_items')
            .insert({
                org_id: window.ORG_ID,
                item_name: recipeName,
                kitted: 0,
                quantity_on_hand: newQty,
                unit: unit,
                yield_unit: unit,
            })
            .select('id')
            .single();
        if (error) {
            console.warn('[Inventory] Insert failed:', error.message);
            return;
        }
        inventoryByKey[key] = { ...payload, id: inserted?.id, item_name: recipeName, kitted: 0 };
    }

    if (inv) {
        inv.quantity_on_hand = newQty;
        inv.unit = unit;
    }
    renderInventory();
}

async function quickAdjustKitted(recipeName, delta) {
    if (!window.supabaseClient || !window.ORG_ID) return;
    const key = normKey(recipeName);
    const inv = inventoryByKey[key];
    const current = inv?.kitted ?? 0;
    const newKitted = Math.max(0, Math.round(current + delta));

    if (inv?.id) {
        const { error } = await window.supabaseClient
            .from('inventory_items')
            .update({ kitted: newKitted })
            .eq('id', inv.id);
        if (error) {
            console.warn('[Inventory] Kitted update failed:', error.message);
            return;
        }
        inv.kitted = newKitted;
    } else {
        const recipe = recipes.find(r => normKey(r.name) === key);
        const unit = getUnitForRecipe(recipe, null);
        const { data: inserted, error } = await window.supabaseClient
            .from('inventory_items')
            .insert({
                org_id: window.ORG_ID,
                item_name: recipeName,
                kitted: newKitted,
                quantity_on_hand: 0,
                unit: unit,
                yield_unit: unit,
            })
            .select('id')
            .single();
        if (error) {
            console.warn('[Inventory] Kitted insert failed:', error.message);
            return;
        }
        inventoryByKey[key] = { id: inserted?.id, item_name: recipeName, kitted: newKitted, quantity_on_hand: 0 };
    }
    renderInventory();
}

// ── Init ───────────────────────────────────────────────────────────────────────
async function initInventory() {
    if (!document.getElementById('inventory-list')) return;

    recipes = await loadRecipesForInventory();
    dishes = await loadDishesForInventory();
    inventoryByKey = await loadInventoryItems();

    renderInventory();
}

document.addEventListener('DOMContentLoaded', () => {
    const searchEl = document.getElementById('inventory-search');
    const clearBtn = document.getElementById('inventory-search-clear');

    if (searchEl) {
        searchEl.addEventListener('input', () => {
            renderInventory();
            if (clearBtn) clearBtn.classList.toggle('visible', !!searchEl.value.trim());
        });
        searchEl.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                searchEl.value = '';
                searchEl.focus();
                if (clearBtn) clearBtn.classList.remove('visible');
                renderInventory();
            }
        });
    }

    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            if (searchEl) {
                searchEl.value = '';
                searchEl.focus();
                clearBtn.classList.remove('visible');
                renderInventory();
            }
        });
    }

    if (window.supabaseClient && window.ORG_ID) {
        initInventory();
    } else {
        document.addEventListener('supabase-ready', () => initInventory());
    }
});
