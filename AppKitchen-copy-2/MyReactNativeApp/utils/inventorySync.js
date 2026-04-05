/**
 * Quick adjust kitted portions (+/−). Used by Inventory page.
 */
export async function quickAdjustKitted(supabaseClient, orgId, recipeName, delta) {
  if (!supabaseClient || !orgId || !recipeName) return;
  const { data: existing } = await supabaseClient
    .from('inventory_items')
    .select('id, kitted')
    .eq('org_id', orgId)
    .eq('item_name', recipeName)
    .maybeSingle();
  const current = existing?.kitted ?? 0;
  const next = Math.max(0, Math.round((current + delta) * 100) / 100);
  if (existing?.id) {
    await supabaseClient.from('inventory_items').update({ kitted: next }).eq('id', existing.id);
  } else {
    await supabaseClient.from('inventory_items').insert({
      org_id: orgId,
      item_name: recipeName,
      kitted: next,
      quantity_on_hand: null,
    });
  }
}

/**
 * Quick adjust in-stock quantity (+/−). Used by Inventory page.
 */
export async function quickAdjustAvailable(supabaseClient, orgId, recipeName, delta) {
  if (!supabaseClient || !orgId || !recipeName) return;
  const { data: existing } = await supabaseClient
    .from('inventory_items')
    .select('id, quantity_on_hand, unit, yield_unit')
    .eq('org_id', orgId)
    .eq('item_name', recipeName)
    .maybeSingle();
  const current = existing?.quantity_on_hand ?? 0;
  const next = Math.max(0, Math.round((current + delta) * 100) / 100);
  // Always prefer recipe yield_unit over stored value (fixes portions when recipe yields qts)
  const { data: recipe } = await supabaseClient
    .from('recipes')
    .select('yield_unit')
    .eq('org_id', orgId)
    .ilike('name', recipeName)
    .maybeSingle();
  const unit = recipe?.yield_unit || existing?.unit || existing?.yield_unit || 'portions';
  const payload = { quantity_on_hand: next, unit, yield_unit: recipe?.yield_unit || unit };
  if (existing?.id) {
    await supabaseClient
      .from('inventory_items')
      .update(payload)
      .eq('id', existing.id);
  } else {
    await supabaseClient.from('inventory_items').insert({
      org_id: orgId,
      item_name: recipeName,
      kitted: null,
      quantity_on_hand: next,
      unit,
      yield_unit: recipe?.yield_unit || unit,
    });
  }
}

/**
 * When a kit/make task is completed, update inventory_items in Supabase.
 * Parses: "kit N RecipeName", "kit RecipeName", "make N RecipeName", "make RecipeName", or bare "RecipeName"
 */
export async function applyTaskCompletionToInventory(supabaseClient, orgId, taskText, isCompleted) {
  if (!isCompleted || !taskText || typeof taskText !== 'string') return;
  if (!supabaseClient || !orgId) return;

  const trimmed = taskText.trim();
  if (!trimmed) return;

  let type = null;
  let qty = 1;
  let recipeName = '';

  const kitMatch = trimmed.match(/^kit\s+(?:(\d+)\s+)?(.+)$/i);
  const makeMatch = trimmed.match(/^make\s+(?:(\d+)\s+)?(.+)$/i);

  if (kitMatch) {
    type = 'kit';
    qty = kitMatch[1] ? parseInt(kitMatch[1], 10) : 1;
    recipeName = kitMatch[2].trim();
  } else if (makeMatch) {
    type = 'make';
    qty = makeMatch[1] ? parseInt(makeMatch[1], 10) : 1;
    recipeName = makeMatch[2].trim();
  } else {
    const { data: recipes } = await supabaseClient
      .from('recipes')
      .select('name')
      .eq('org_id', orgId)
      .eq('status', 'active');
    const names = (recipes || []).map((r) => r.name);
    if (names.includes(trimmed)) {
      type = 'make';
      qty = 1;
      recipeName = trimmed;
    }
  }

  if (!type || !recipeName || qty < 1) return;

  const { data: existing } = await supabaseClient
    .from('inventory_items')
    .select('id, kitted, quantity_on_hand, unit, yield_per_portion, yield_unit')
    .eq('org_id', orgId)
    .eq('item_name', recipeName)
    .maybeSingle();

  // Prefer recipe's yield_unit (e.g. qt) so inventory shows "qts" not "portions"
  const { data: recipeRow } = await supabaseClient
    .from('recipes')
    .select('yield_unit')
    .eq('org_id', orgId)
    .ilike('name', recipeName)
    .maybeSingle();
  const recipeYieldUnit = recipeRow?.yield_unit || null;

  if (type === 'kit') {
    const newKitted = (existing?.kitted ?? 0) + qty;
    if (existing?.id) {
      await supabaseClient.from('inventory_items').update({ kitted: newKitted }).eq('id', existing.id);
    } else {
      await supabaseClient.from('inventory_items').insert({
        org_id: orgId,
        item_name: recipeName,
        kitted: newKitted,
        quantity_on_hand: null,
      });
    }
  } else {
    const currentKitted = existing?.kitted ?? 0;
    const newKitted = Math.max(0, currentKitted - qty);
    const yieldPer = existing?.yield_per_portion;
    const yieldUnit = recipeYieldUnit || existing?.yield_unit || 'portions';
    const availUnit = recipeYieldUnit || existing?.unit || yieldUnit;
    const currentAvail = existing?.quantity_on_hand ?? 0;
    const produced = yieldPer != null && yieldPer > 0 ? qty * yieldPer : qty;
    const newAvail = currentAvail + produced;

    const payload = { kitted: newKitted, quantity_on_hand: newAvail, unit: availUnit, yield_unit: yieldUnit };
    if (existing?.id) {
      await supabaseClient.from('inventory_items').update(payload).eq('id', existing.id);
    } else {
      await supabaseClient.from('inventory_items').insert({
        org_id: orgId,
        item_name: recipeName,
        kitted: newKitted,
        quantity_on_hand: newAvail,
        unit: availUnit,
        yield_unit: yieldUnit,
      });
    }
  }
}
