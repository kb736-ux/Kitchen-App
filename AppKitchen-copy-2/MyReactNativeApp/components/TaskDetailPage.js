import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../utils/supabase';
import { Colors } from '../constants/theme';

/** Extract a recipe name from task text like "make Smoked Salmon", "kit 2 Focaccia", "make 3 blueberry compote". */
function parseRecipeFromTask(text) {
  if (!text) return null;
  const m = text.match(/^(?:make|kit|prep)\s+(?:\d+\s+)?(.+)$/i);
  return m ? m[1].trim() : null;
}

const TaskDetailPage = ({ onBack, task, toggleTask, toggleUrgent, orgId }) => {
  const [recipe, setRecipe] = useState(null);
  const [recipeLoading, setRecipeLoading] = useState(false);

  useEffect(() => {
    const name = parseRecipeFromTask(task?.text);
    if (!name || !orgId) { setRecipe(null); return; }
    setRecipeLoading(true);
    supabase
      .from('recipes')
      .select('name, ingredients, steps, yield_amount, yield_unit')
      .eq('org_id', orgId)
      .ilike('name', name)
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        setRecipe(data || null);
        setRecipeLoading(false);
      })
      .catch(() => setRecipeLoading(false));
  }, [task?.text, orgId]);

  const handleComplete = async () => {
    if (task.completed) return;
    const r = await toggleTask(task.id);
    if (r?.ok) onBack?.();
    else if (r?.message) Alert.alert('Could not update task', r.message);
  };

  const handleUrgentPress = async () => {
    const r = await toggleUrgent(task.id);
    if (r?.ok) onBack?.();
    else if (r?.message) Alert.alert('Could not update task', r.message);
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={onBack}>
          <Ionicons name="arrow-back" size={24} color="#333" />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content}>
        {/* Task Title */}
        <Text style={styles.title}>{task.text}</Text>

        {/* Recipe info (ingredients + steps) */}
        {recipeLoading && (
          <ActivityIndicator color={Colors.primary} style={{ marginBottom: 20 }} />
        )}
        {recipe && (
          <View style={styles.recipeCard}>
            <Text style={styles.recipeName}>{recipe.name}</Text>
            {recipe.yield_amount ? (
              <Text style={styles.recipeYield}>
                Yield: {recipe.yield_amount} {recipe.yield_unit || 'portions'}
              </Text>
            ) : null}

            {Array.isArray(recipe.ingredients) && recipe.ingredients.length > 0 && (
              <>
                <Text style={styles.recipeSectionTitle}>Ingredients</Text>
                {recipe.ingredients.map((ing, idx) => {
                  const label = typeof ing === 'string'
                    ? ing
                    : `${ing.qty ?? ''} ${ing.unit ?? ''} ${ing.name ?? ''}`.trim();
                  return (
                    <View key={idx} style={styles.recipeListRow}>
                      <Text style={styles.bulletChar}>{'\u2022'}</Text>
                      <Text style={styles.recipeListText}>{label}</Text>
                    </View>
                  );
                })}
              </>
            )}

            {Array.isArray(recipe.steps) && recipe.steps.length > 0 && (
              <>
                <Text style={styles.recipeSectionTitle}>Steps</Text>
                {recipe.steps.map((step, idx) => {
                  const label = typeof step === 'string' ? step : step.text || JSON.stringify(step);
                  return (
                    <View key={idx} style={styles.recipeListRow}>
                      <Text style={styles.stepNumber}>{idx + 1}.</Text>
                      <Text style={styles.recipeListText}>{label}</Text>
                    </View>
                  );
                })}
              </>
            )}
          </View>
        )}

        {/* Move to Urgent / Remove Urgent */}
        {toggleUrgent && !task.completed && (
          <TouchableOpacity
            style={[styles.transferButton, styles.urgentButton, task.is_urgent && styles.urgentButtonActive]}
            onPress={handleUrgentPress}
          >
            <Ionicons name="flame" size={18} color={task.is_urgent ? '#718096' : '#e53e3e'} style={{ marginRight: 8 }} />
            <Text style={[styles.transferButtonText, task.is_urgent && styles.urgentButtonText]}>
              {task.is_urgent ? 'Remove from Urgent' : 'Move to Urgent'}
            </Text>
          </TouchableOpacity>
        )}

        {/* Completed Button */}
        <TouchableOpacity 
          style={[
            styles.completedButton,
            task.completed && styles.completedButtonActive
          ]} 
          onPress={handleComplete}
        >
          {task.completed ? (
            <>
              <Ionicons name="checkmark" size={24} color={Colors.success} />
              <Text style={styles.completedButtonTextActive}>Completed</Text>
            </>
          ) : (
            <Text style={styles.completedButtonText}>Completed</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 50,
    paddingBottom: 20,
    backgroundColor: 'white',
  },
  backButton: {
    padding: 8,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    textAlign: 'center',
    marginBottom: 30,
  },
  transferButton: {
    borderWidth: 2,
    borderColor: '#333',
    paddingVertical: 15,
    paddingHorizontal: 30,
    alignSelf: 'center',
    marginBottom: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  transferButtonText: {
    fontSize: 16,
    color: '#333',
    fontWeight: '500',
  },
  urgentButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  urgentButtonActive: {
    borderColor: '#e53e3e',
    backgroundColor: '#fff5f5',
  },
  urgentButtonText: {
    color: '#718096',
  },
  completedButton: {
    borderWidth: 2,
    borderColor: '#333',
    paddingVertical: 15,
    paddingHorizontal: 30,
    alignSelf: 'center',
    marginBottom: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 150,
  },
  completedButtonActive: {
    borderColor: Colors.primary,
    backgroundColor: '#f0f8f0',
  },
  completedButtonText: {
    fontSize: 16,
    color: '#333',
    fontWeight: '500',
  },
  completedButtonTextActive: {
    fontSize: 16,
    color: Colors.primary,
    fontWeight: '500',
    marginLeft: 8,
  },
  recipeCard: {
    backgroundColor: 'white',
    borderRadius: 14,
    padding: 18,
    marginBottom: 28,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  recipeName: {
    fontSize: 18,
    fontWeight: '700',
    color: '#2d3748',
    marginBottom: 4,
  },
  recipeYield: {
    fontSize: 13,
    color: '#718096',
    marginBottom: 14,
  },
  recipeSectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#4a5568',
    marginTop: 12,
    marginBottom: 8,
  },
  recipeListRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 6,
    paddingLeft: 4,
  },
  bulletChar: {
    fontSize: 16,
    color: '#718096',
    marginRight: 8,
    lineHeight: 22,
  },
  stepNumber: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.primary,
    marginRight: 8,
    lineHeight: 22,
    minWidth: 20,
  },
  recipeListText: {
    flex: 1,
    fontSize: 15,
    color: '#2d3748',
    lineHeight: 22,
  },
});

export default TaskDetailPage;