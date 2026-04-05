import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase, ORG_ID } from '../utils/supabase';
import { quickAdjustKitted, quickAdjustAvailable } from '../utils/inventorySync';

const FRACTIONAL_UNITS = ['qt', 'pt', 'liters', 'cups', 'oz', 'lbs', 'kg', 'g'];
const SHOULD_SEED_SAMPLE_DATA = false;
function getAdjustStep(unit) {
  return FRACTIONAL_UNITS.includes((unit || '').toLowerCase()) ? 0.5 : 1;
}

const RecipesPage = ({ orgId }) => {
  const [searchText, setSearchText] = useState('');
  const [recipes, setRecipes] = useState([]);
  const [dishes, setDishes] = useState([]);
  const [inventoryMap, setInventoryMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [updating, setUpdating] = useState(null);
  const [view, setView] = useState('active'); // 'dishes' | 'active' | 'inactive'
  const [expandedId, setExpandedId] = useState(null);

  const fetchInventory = useCallback(async () => {
    if (!orgId) return;
    const activeNames = recipes.filter((r) => r.status === 'active').map((r) => r.name);
    const dishNamesRaw = dishes.flatMap((d) => (d.recipes || []).map(r => typeof r === 'string' ? r : (r?.name || ''))).filter(Boolean);
    const namesSet = new Set([...activeNames]);
    dishNamesRaw.forEach((name) => {
      namesSet.add(name);
      const recipe = recipes.find((r) => (r.name || '').toLowerCase() === (name || '').toLowerCase());
      if (recipe?.name) namesSet.add(recipe.name);
    });
    const names = [...namesSet];
    if (names.length === 0) {
      setInventoryMap({});
      return;
    }
    const { data: invRows, error } = await supabase
      .from('inventory_items')
      .select('item_name, kitted, quantity_on_hand, unit, yield_per_portion, yield_unit')
      .eq('org_id', orgId)
      .in('item_name', names);
    if (error) return;
    const map = {};
    (invRows || []).forEach((r) => {
      const recipe = recipes.find(rec => (rec.name || '').toLowerCase() === (r.item_name || '').toLowerCase());
      map[r.item_name] = {
        kitted: r.kitted ?? null,
        available: r.quantity_on_hand ?? null,
        unit: (recipe?.yield_unit || r.unit || r.yield_unit || 'portions'),
      };
    });
    setInventoryMap(map);
  }, [orgId, recipes, dishes]);

  useEffect(() => {
    if (orgId) {
      (async () => {
        await fetchRecipes();
        await fetchDishes();
      })();
    } else {
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    if (recipes.length > 0 && orgId) fetchInventory();
  }, [recipes, orgId, fetchInventory]);

  async function fetchRecipes() {
    const effectiveOrgId = orgId || ORG_ID;
    if (!effectiveOrgId) return;
    setLoading(true);
    const cols = 'id, name, status, desc, ingredients, steps, yield_amount, yield_unit';
    let { data, error } = await supabase
      .from('recipes')
      .select(cols)
      .eq('org_id', effectiveOrgId)
      .order('name', { ascending: true });

    if (error && (error.message?.includes('desc') || error.message?.includes('column'))) {
      const fallbackCols = 'id, name, status, ingredients, steps, yield_amount, yield_unit';
      const res = await supabase.from('recipes').select(fallbackCols).eq('org_id', effectiveOrgId).order('name', { ascending: true });
      data = res.data;
      error = res.error;
      if (!error && data) data = data.map((r) => ({ ...r, desc: r.desc || '' }));
    }

    if (error) {
      console.warn('[Supabase] fetchRecipes failed:', error.message);
      setRecipes([]);
    } else {
      const list = data || [];
      setRecipes(list);
      if (list.length === 0 && SHOULD_SEED_SAMPLE_DATA) {
        await seedRecipes(effectiveOrgId);
      }
    }
    setLoading(false);
  }

  async function seedRecipes(effectiveOrgId) {
    if (!effectiveOrgId) return;
    try {
      const samples = [
        { name: 'Focaccia Kit', desc: 'House focaccia with olive oil and sea salt', status: 'active', ingredients: ['500g flour', '400ml warm water', '10g salt', '7g yeast', '50ml olive oil', 'Sea salt, rosemary'], steps: [{ prep: 'Measure flour, water, salt, yeast. Oil a large baking pan.', active: 'Mix dough, knead 10 min. Proof 1 hr. Stretch into pan, dimple, drizzle oil. Bake 220°C 25 min.' }], yield_amount: 4, yield_unit: 'portions' },
        { name: 'Balsamic Glaze', desc: 'Reduced balsamic for dressings and drizzles', status: 'active', ingredients: ['500ml balsamic vinegar', '2 tbsp honey'], steps: [{ prep: 'Measure vinegar and honey.', active: 'Simmer until reduced by half, 15–20 min. Cool.' }], yield_amount: 1, yield_unit: 'qt' },
        { name: 'Chilled Pea Soup', desc: 'Creamy pea soup with mint', status: 'active', ingredients: ['500g frozen peas', '1 onion', '500ml veg stock', '100ml cream', 'Mint'], steps: [{ prep: 'Dice onion. Defrost peas.', active: 'Sauté onion. Add peas + stock. Simmer 5 min. Blend, stir in cream. Chill.' }], yield_amount: 4, yield_unit: 'portions' },
      ];
      for (const r of samples) {
        const row = { org_id: effectiveOrgId, name: r.name, status: r.status, desc: r.desc, ingredients: r.ingredients, steps: r.steps, yield_amount: r.yield_amount, yield_unit: r.yield_unit };
        const { error } = await supabase.from('recipes').insert(row);
        if (error && error.message?.includes('desc')) {
          const { desc, ...rest } = row;
          await supabase.from('recipes').insert(rest);
        }
      }
      const { data } = await supabase.from('recipes').select('id, name, status, ingredients, steps, yield_amount, yield_unit').eq('org_id', effectiveOrgId).order('name', { ascending: true });
      setRecipes((data || []).map((r) => ({ ...r, desc: r.desc || '' })));
    } catch (e) {
      console.warn('[RecipesPage] seedRecipes failed:', e?.message);
    }
  }

  async function fetchDishes() {
    const effectiveOrgId = orgId || ORG_ID;
    if (!effectiveOrgId) return;
    const errFull = (e) => [e?.message, e?.details, e?.hint].filter(Boolean).join(' ');
    let { data, error } = await supabase
      .from('dishes')
      .select('id, name, recipes')
      .eq('org_id', effectiveOrgId)
      .order('id', { ascending: true });
    if (error && /column|does not exist|400/i.test(errFull(error))) {
      const res = await supabase
        .from('dishes')
        .select('id, name, recipes')
        .eq('org_id', effectiveOrgId);
      data = res.data;
      error = res.error;
    }

    if (error) {
      console.warn('[Supabase] fetchDishes failed:', error.message);
      setDishes([]);
    } else {
      const list = data || [];
      setDishes(list);
      if (list.length === 0 && SHOULD_SEED_SAMPLE_DATA) {
        await seedDishes();
      }
    }
  }

  async function seedDishes() {
    const effectiveOrgId = orgId || ORG_ID;
    if (!effectiveOrgId) return;
    try {
      const { data: recipeList } = await supabase.from('recipes').select('name').eq('org_id', effectiveOrgId).eq('status', 'active');
      const recipeNames = (recipeList || []).map((r) => r.name);
      if (recipeNames.length > 0) {
        const { error } = await supabase.from('dishes').insert({
          org_id: effectiveOrgId,
          name: 'Salmon Appetizer',
          recipes: recipeNames.slice(0, 2),
        });
        if (!error) {
          const { data } = await supabase.from('dishes').select('id, name, recipes').eq('org_id', effectiveOrgId).order('id', { ascending: true });
          setDishes(data || []);
        }
      }
    } catch (e) {
      console.warn('[RecipesPage] seedDishes failed:', e?.message);
    }
  }

  const componentNamesLower = new Set(
    dishes.flatMap(d => (d.recipes || []).map(r => (typeof r === 'string' ? r : r?.name || '').toLowerCase()).filter(Boolean))
  );
  const componentNames = new Set(
    dishes.flatMap((d) => (d.recipes || []).map((r) => (typeof r === 'string' ? r : (r?.name || ''))).filter(Boolean))
  );
  const isRecipeActive = (recipe) => {
    const name = (recipe?.name || '').toLowerCase();
    if (name && componentNamesLower.has(name)) return true;
    return ((recipe?.status || '').toString().trim().toLowerCase() === 'active');
  };
  // Deduplicate recipes by name (case-insensitive, normalize typos like vanila->vanilla)
  const normalizeKey = (s) => (s || '').toLowerCase().replace(/\bvanila\b/g, 'vanilla');
  const byKey = {};
  recipes.forEach((r) => {
    const key = normalizeKey(r.name);
    if (!key) return;
    if (!byKey[key]) byKey[key] = [];
    byKey[key].push(r);
  });
  const dedupedRecipes = Object.keys(byKey).map((key) => {
    const group = byKey[key];
    const exactMatch = [...componentNames].find(c => normalizeKey(typeof c === 'string' ? c : (c?.name || '')) === key);
    const preferred = exactMatch ? group.find(r => r.name === exactMatch) : null;
    return preferred || group[0];
  });
  const filtered = dedupedRecipes.filter(r => {
    const matchSearch = (r.name || '').toLowerCase().includes(searchText.toLowerCase());
    if (view === 'active') {
      return isRecipeActive(r) && matchSearch;
    }
    if (view === 'inactive') {
      return !isRecipeActive(r) && matchSearch;
    }
    // dishes view does not use this filtered list
    return matchSearch;
  });

  // Active/Inactive are based on manager-set recipe.status from Supabase.
  const activeCount = dedupedRecipes.filter((r) => isRecipeActive(r)).length;
  const inactiveCount = dedupedRecipes.filter((r) => !isRecipeActive(r)).length;
  const filteredDishes = dishes.filter(d => (d.name || '').toLowerCase().includes(searchText.toLowerCase()));

  const toggleExpand = (id) => setExpandedId(prev => (prev === id ? null : id));

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchRecipes();
    await fetchDishes(); // runs after recipes so seedDishes can use seeded recipes
    setRefreshing(false);
  };

  const handleAdjustKitted = async (recipeName, delta) => {
    const effectiveOrgId = orgId || ORG_ID;
    if (!effectiveOrgId) return;
    setUpdating(recipeName);
    await quickAdjustKitted(supabase, effectiveOrgId, recipeName, delta);
    await fetchInventory();
    setUpdating(null);
  };

  const handleAdjustAvailable = async (recipeName, unit, delta) => {
    const effectiveOrgId = orgId || ORG_ID;
    if (!effectiveOrgId) return;
    setUpdating(recipeName);
    const step = getAdjustStep(unit);
    await quickAdjustAvailable(supabase, effectiveOrgId, recipeName, delta * step);
    await fetchInventory();
    setUpdating(null);
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Menu & Recipes</Text>
        <View style={styles.headerTabs}>
          <TouchableOpacity
            style={[styles.tabBtn, view === 'dishes' && styles.tabBtnDishes]}
            onPress={() => { setView('dishes'); setExpandedId(null); }}
          >
            <Ionicons name="fast-food" size={16} color={view === 'dishes' ? '#ed8936' : '#a0aec0'} />
            <Text style={[styles.tabBtnText, view === 'dishes' && styles.tabBtnTextDishes]}>
              Dishes ({dishes.length})
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tabBtn, view === 'active' && styles.tabBtnActive]}
            onPress={() => { setView('active'); setExpandedId(null); }}
          >
            <Ionicons name="checkmark-circle" size={16} color={view === 'active' ? '#4CAF50' : '#a0aec0'} />
            <Text style={[styles.tabBtnText, view === 'active' && styles.tabBtnTextActive]}>
              Active{activeCount > 0 ? ` (${activeCount})` : ''}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tabBtn, view === 'inactive' && styles.tabBtnInactive]}
            onPress={() => { setView('inactive'); setExpandedId(null); }}
          >
            <Ionicons name="archive" size={16} color={view === 'inactive' ? '#718096' : '#a0aec0'} />
            <Text style={[styles.tabBtnText, view === 'inactive' && styles.tabBtnTextInactive]}>
              Inactive{inactiveCount > 0 ? ` (${inactiveCount})` : ''}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        style={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#4CAF50']} />
        }
      >
        {/* Search */}
        <View style={styles.searchInputContainer}>
          <Ionicons name="search" size={18} color="#4a5568" style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search recipes..."
            value={searchText}
            onChangeText={setSearchText}
            placeholderTextColor="#a0aec0"
          />
          {searchText.length > 0 && (
            <TouchableOpacity onPress={() => setSearchText('')}>
              <Ionicons name="close-circle" size={18} color="#a0aec0" />
            </TouchableOpacity>
          )}
        </View>

        {/* Section label */}
        <Text style={styles.sectionLabel}>
          {view === 'active' ? '🍽  On the Menu' : view === 'dishes' ? '🍴  Dishes' : '📦  Off the Menu'}
        </Text>

        {/* Dishes view — only dish rows from DB (e.g. 3 dishes) */}
        {view === 'dishes' && filteredDishes.length === 0 && (
          <View style={styles.emptyContainer}>
            <Ionicons name="fast-food-outline" size={40} color="#e2e8f0" />
            <Text style={styles.emptyText}>
              {searchText ? `No dishes match "${searchText}"` : 'No dishes yet'}
            </Text>
            {!searchText && (
              <Text style={styles.emptySubtext}>Add dishes on the web dashboard.</Text>
            )}
          </View>
        )}
        {view === 'dishes' && filteredDishes.length > 0 && filteredDishes.map(dish => {
            const isExpanded = expandedId === dish.id;
            const componentRecipes = dish.recipes || [];
            return (
              <View key={dish.id} style={styles.dishCard}>
                <TouchableOpacity onPress={() => toggleExpand(dish.id)} activeOpacity={0.85}>
                  <View style={styles.cardTop}>
                    <View style={styles.dishIcon}>
                      <Ionicons name="fast-food" size={20} color="#ed8936" />
                    </View>
                    <View style={styles.cardBody}>
                      <Text style={styles.dishName}>{dish.name}</Text>
                      <Text style={styles.dishMeta}>
                        {componentRecipes.length} recipe{componentRecipes.length !== 1 ? 's' : ''} required
                      </Text>
                    </View>
                    <Ionicons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={18} color="#cbd5e0" />
                  </View>
                </TouchableOpacity>
                {isExpanded && (
                  <View style={styles.ingredientsList}>
                    <Text style={styles.ingredientsTitle}>Recipes Used</Text>
                    <View style={styles.dishRecipeTags}>
                      {componentRecipes.map((recipeName, i) => (
                        <View key={i} style={styles.dishRecipeTag}>
                          <Ionicons name="book" size={12} color="#4CAF50" />
                          <Text style={styles.dishRecipeTagText}>{recipeName}</Text>
                        </View>
                      ))}
                    </View>
                    {componentRecipes.length > 0 && (
                      <View style={styles.dishInventorySection}>
                        <Text style={styles.ingredientsTitle}>Inventory</Text>
                        {componentRecipes.map((recipeName, i) => {
                          const invKey = Object.keys(inventoryMap).find(k => (k || '').toLowerCase() === (recipeName || '').toLowerCase());
                          const inv = invKey ? inventoryMap[invKey] : {};
                          const recipe = recipes.find((r) => (r.name || '').toLowerCase() === (recipeName || '').toLowerCase());
                          const unit = recipe?.yield_unit || inv.unit || 'portions';
                          return (
                            <View key={i} style={styles.dishInventoryRow}>
                              <Text style={styles.dishInventoryRecipeName}>{recipeName}</Text>
                              <View style={styles.dishInventoryBlocks}>
                                <View style={styles.dishInvBlock}>
                                  <Text style={styles.invLabel}>Kitted</Text>
                                  <View style={styles.adjGroup}>
                                    <TouchableOpacity
                                      style={styles.adjBtn}
                                      onPress={() => handleAdjustKitted(recipeName, -1)}
                                      disabled={updating === recipeName}
                                    >
                                      <Text style={styles.adjBtnText}>−</Text>
                                    </TouchableOpacity>
                                    <Text style={styles.adjValue}>
                                      {inv.kitted != null ? `${inv.kitted} portion${inv.kitted !== 1 ? 's' : ''}` : '—'}
                                    </Text>
                                    <TouchableOpacity
                                      style={styles.adjBtn}
                                      onPress={() => handleAdjustKitted(recipeName, 1)}
                                      disabled={updating === recipeName}
                                    >
                                      <Text style={styles.adjBtnText}>+</Text>
                                    </TouchableOpacity>
                                  </View>
                                </View>
                                <View style={styles.dishInvBlock}>
                                  <Text style={styles.invLabel}>In Stock</Text>
                                  <View style={styles.adjGroup}>
                                    <TouchableOpacity
                                      style={styles.adjBtn}
                                      onPress={() => handleAdjustAvailable(recipeName, unit, -1)}
                                      disabled={updating === recipeName}
                                    >
                                      <Text style={styles.adjBtnText}>−</Text>
                                    </TouchableOpacity>
                                    <Text style={styles.adjValue}>
                                      {inv.available != null ? `${inv.available} ${unit}` : '—'}
                                    </Text>
                                    <TouchableOpacity
                                      style={styles.adjBtn}
                                      onPress={() => handleAdjustAvailable(recipeName, unit, 1)}
                                      disabled={updating === recipeName}
                                    >
                                      <Text style={styles.adjBtnText}>+</Text>
                                    </TouchableOpacity>
                                  </View>
                                </View>
                              </View>
                            </View>
                          );
                        })}
                      </View>
                    )}
                  </View>
                )}
              </View>
            );
        })}

        {/* Recipes views (active / inactive) — only when NOT on Dishes tab */}
        {view !== 'dishes' && (
          loading ? (
            <ActivityIndicator size="small" color="#4CAF50" style={{ marginTop: 24 }} />
          ) : filtered.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Ionicons name={view === 'active' ? 'restaurant-outline' : 'archive-outline'} size={40} color="#e2e8f0" />
              <Text style={styles.emptyText}>
                {searchText ? `No results for "${searchText}"` : view === 'active' ? 'No active recipes on the menu.' : 'No inactive recipes.'}
              </Text>
              {!searchText && view === 'active' && (
                <Text style={styles.emptySubtext}>Add recipes from the web dashboard.</Text>
              )}
            </View>
          ) : (
          filtered.map((recipe) => {
            const extra = recipe.desc
              ? { desc: recipe.desc, ingredients: recipe.ingredients || [], steps: recipe.steps || [] }
              : { desc: '', ingredients: recipe.ingredients || [], steps: recipe.steps || [] };
            const isExpanded = expandedId === recipe.id;
            const invKey = view === 'active' ? Object.keys(inventoryMap).find(k => (k || '').toLowerCase() === (recipe.name || '').toLowerCase()) : null;
            const inv = view === 'active' ? (invKey ? inventoryMap[invKey] : inventoryMap[recipe.name] || {}) : {};
            const showInventory = view === 'active';
            return (
              <View key={recipe.id} style={[styles.card, view === 'inactive' && styles.cardInactive]}>
                <TouchableOpacity onPress={() => toggleExpand(recipe.id)} activeOpacity={0.85}>
                  <View style={styles.cardTop}>
                    <View style={[styles.cardIcon, view === 'inactive' && styles.cardIconInactive]}>
                      <Ionicons
                        name="restaurant"
                        size={20}
                        color={view === 'active' ? '#4CAF50' : '#a0aec0'}
                      />
                    </View>
                    <View style={styles.cardBody}>
                      <Text style={[styles.cardName, view === 'inactive' && styles.cardNameInactive]}>
                        {recipe.name}
                      </Text>
                      {isExpanded && extra?.desc ? (
                        <Text style={styles.cardDesc} numberOfLines={isExpanded ? undefined : 1}>
                          {extra.desc}
                        </Text>
                      ) : null}
                      {isExpanded && (recipe.yield_amount != null && recipe.yield_unit) ? (
                        <Text style={styles.cardYield}>Makes {recipe.yield_amount} {recipe.yield_unit}</Text>
                      ) : null}
                      {isExpanded && extra?.ingredients?.length > 0 && (
                        <Text style={styles.cardMeta}>
                          {extra.ingredients.length} ingredient{extra.ingredients.length !== 1 ? 's' : ''}
                        </Text>
                      )}
                    </View>
                    <Ionicons
                      name={isExpanded ? 'chevron-up' : 'chevron-down'}
                      size={18}
                      color="#cbd5e0"
                    />
                  </View>
                </TouchableOpacity>

                {/* Inventory +/- for active recipes */}
                {showInventory && isExpanded && (() => {
                  const stockUnit = recipe?.yield_unit || inv.unit || 'portions';
                  return (
                  <View style={styles.inventoryRow}>
                    <View style={styles.invBlock}>
                      <Text style={styles.invLabel}>Kitted</Text>
                      <View style={styles.adjGroup}>
                        <TouchableOpacity
                          style={styles.adjBtn}
                          onPress={() => handleAdjustKitted(recipe.name, -1)}
                          disabled={updating === recipe.name}
                        >
                          <Text style={styles.adjBtnText}>−</Text>
                        </TouchableOpacity>
                        <Text style={styles.adjValue}>
                          {inv.kitted != null ? `${inv.kitted} portion${inv.kitted !== 1 ? 's' : ''}` : '—'}
                        </Text>
                        <TouchableOpacity
                          style={styles.adjBtn}
                          onPress={() => handleAdjustKitted(recipe.name, 1)}
                          disabled={updating === recipe.name}
                        >
                          <Text style={styles.adjBtnText}>+</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                    <View style={styles.invBlock}>
                      <Text style={styles.invLabel}>In Stock</Text>
                      <View style={styles.adjGroup}>
                        <TouchableOpacity
                          style={styles.adjBtn}
                          onPress={() => handleAdjustAvailable(recipe.name, stockUnit, -1)}
                          disabled={updating === recipe.name}
                        >
                          <Text style={styles.adjBtnText}>−</Text>
                        </TouchableOpacity>
                        <Text style={styles.adjValue}>
                          {inv.available != null ? `${inv.available} ${stockUnit}` : '—'}
                        </Text>
                        <TouchableOpacity
                          style={styles.adjBtn}
                          onPress={() => handleAdjustAvailable(recipe.name, stockUnit, 1)}
                          disabled={updating === recipe.name}
                        >
                          <Text style={styles.adjBtnText}>+</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>
                  );
                })()}

                {/* Expanded ingredient list + steps */}
                {isExpanded && (extra?.desc || extra?.ingredients?.length > 0 || extra?.steps?.length > 0) && (
                  <View style={styles.ingredientsList}>
                    {extra?.desc ? (
                      <>
                        <Text style={styles.ingredientsTitle}>Description</Text>
                        <Text style={styles.ingredientText}>{extra.desc}</Text>
                      </>
                    ) : null}
                    {extra.ingredients?.length > 0 && (
                      <View style={{ marginTop: extra?.desc ? 14 : 0 }}>
                        <Text style={styles.ingredientsTitle}>Ingredients</Text>
                        {extra.ingredients.map((ing, i) => (
                          <View key={`ing-${i}`} style={styles.ingredientRow}>
                            <View style={[styles.ingredientDot, view === 'inactive' && { backgroundColor: '#a0aec0' }]} />
                            <Text style={[styles.ingredientText, view === 'inactive' && styles.ingredientTextInactive]}>
                              {ing}
                            </Text>
                          </View>
                        ))}
                      </View>
                    )}
                    {extra.steps?.length > 0 && (
                      <View style={{ marginTop: extra.ingredients?.length ? 14 : 0 }}>
                        <Text style={styles.ingredientsTitle}>Steps</Text>
                        {extra.steps.map((step, i) => {
                          const isObject = step && typeof step === 'object';
                          const prep = isObject ? step.prep : null;
                          const active = isObject ? step.active : null;
                          const text = isObject ? null : String(step);
                          return (
                            <View key={`step-${i}`} style={{ marginBottom: 8 }}>
                              {prep ? (
                                <Text style={styles.ingredientText}>{`${i + 1}. ${prep}`}</Text>
                              ) : null}
                              {active ? (
                                <Text style={[styles.ingredientText, { marginTop: prep ? 2 : 0 }]}>
                                  {active}
                                </Text>
                              ) : null}
                              {text ? (
                                <Text style={styles.ingredientText}>{`${i + 1}. ${text}`}</Text>
                              ) : null}
                            </View>
                          );
                        })}
                      </View>
                    )}
                  </View>
                )}
              </View>
            );
          })
          )
        )}

        <View style={{ height: 32 }} />
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f9fa' },

  // Header
  header: {
    paddingHorizontal: 20,
    paddingTop: 50,
    paddingBottom: 16,
    backgroundColor: 'white',
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  headerTitle: { fontSize: 22, fontWeight: '700', color: '#2d3748', marginBottom: 14 },
  headerTabs: { flexDirection: 'row', gap: 10 },
  tabBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: '#e2e8f0',
    backgroundColor: '#f8f9fa',
  },
  tabBtnActive: { borderColor: '#4CAF50', backgroundColor: '#f0fff4' },
  tabBtnInactive: { borderColor: '#cbd5e0', backgroundColor: '#f7fafc' },
  tabBtnDishes: { borderColor: '#ed8936', backgroundColor: '#fffaf0' },
  tabBtnText: { fontSize: 12, fontWeight: '600', color: '#a0aec0' },
  tabBtnTextActive: { color: '#2e7d32' },
  tabBtnTextDishes: { color: '#c05621' },
  tabBtnTextInactive: { color: '#718096' },

  // Content
  content: { flex: 1, paddingHorizontal: 16, paddingTop: 16 },

  // Search
  searchInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'white',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 12,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, paddingVertical: 11, fontSize: 15, color: '#2d3748' },

  // Section label
  sectionLabel: { fontSize: 13, fontWeight: '700', color: '#718096', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 12 },

  // Cards
  card: {
    backgroundColor: 'white',
    borderRadius: 12,
    marginBottom: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  cardInactive: { backgroundColor: '#fafafa', borderColor: '#edf2f7' },
  cardTop: { flexDirection: 'row', alignItems: 'center' },
  cardIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#f0fff4',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  cardIconInactive: { backgroundColor: '#f7fafc' },
  cardBody: { flex: 1, marginRight: 8 },
  cardName: { fontSize: 16, fontWeight: '700', color: '#2d3748', marginBottom: 2 },
  cardNameInactive: { color: '#a0aec0', textDecorationLine: 'line-through' },
  cardDesc: { fontSize: 13, color: '#718096', lineHeight: 18 },
  cardYield: { fontSize: 12, color: '#718096', fontWeight: '600', marginTop: 2 },
  cardMeta: { fontSize: 12, color: '#4CAF50', fontWeight: '600', marginTop: 4 },

  // Inventory row (active recipes)
  inventoryRow: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
  },
  invBlock: { flex: 1 },
  invLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#a0aec0',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 6,
  },
  adjGroup: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  adjBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#e2e8f0',
    backgroundColor: '#f7fafc',
    justifyContent: 'center',
    alignItems: 'center',
  },
  adjBtnText: { fontSize: 20, fontWeight: '700', color: '#4a5568' },
  adjValue: { fontSize: 14, fontWeight: '600', color: '#2d3748', minWidth: 60, textAlign: 'center' },

  // Expanded ingredients
  ingredientsList: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
  },
  ingredientsTitle: { fontSize: 12, fontWeight: '700', color: '#4a5568', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  ingredientRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  ingredientDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#4CAF50', marginRight: 10 },
  ingredientText: { fontSize: 14, color: '#2d3748' },
  ingredientTextInactive: { color: '#a0aec0' },

  // Dish cards
  dishCard: {
    backgroundColor: 'white',
    borderRadius: 12,
    marginBottom: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: '#fbd38d',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  dishIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#fffaf0',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  dishName: { fontSize: 16, fontWeight: '700', color: '#2d3748', marginBottom: 2 },
  dishMeta: { fontSize: 12, color: '#ed8936', fontWeight: '600' },
  dishRecipeTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  dishRecipeTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(76, 175, 80, 0.08)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(76, 175, 80, 0.2)',
  },
  dishRecipeTagText: { fontSize: 13, fontWeight: '600', color: '#276749' },
  dishInventorySection: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#e2e8f0' },
  dishInventoryRow: { marginBottom: 12 },
  dishInventoryRecipeName: { fontSize: 13, fontWeight: '600', color: '#4a5568', marginBottom: 6 },
  dishInventoryBlocks: { flexDirection: 'row', gap: 16 },
  dishInvBlock: { flex: 1 },

  // Empty state
  emptyContainer: { alignItems: 'center', paddingVertical: 48, gap: 10 },
  emptyText: { fontSize: 16, color: '#a0aec0', fontWeight: '500', textAlign: 'center' },
  emptySubtext: { fontSize: 13, color: '#cbd5e0', textAlign: 'center' },
});

export default RecipesPage;
