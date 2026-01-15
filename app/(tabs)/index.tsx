import { Module, ModuleCard } from '@/components/module-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import React, { useCallback } from 'react';
import { FlatList, ListRenderItem, StyleSheet, View } from 'react-native';

/**
 * Данные модулей обучения (захардкожены согласно заданию)
 * Модули открываются последовательно: done -> active -> locked
 */
const MODULES: Module[] = [
  { id: 1, title: 'Welcome Journey', status: 'done' },
  { id: 2, title: 'Переключение на себя', status: 'active' },
  { id: 3, title: 'Источник вдохновения', status: 'locked' },
  { id: 4, title: 'Пространство идей', status: 'locked' },
  { id: 5, title: 'Финальный тест', status: 'locked' },
];

/**
 * Главный экран со списком модулей обучения
 * Использует FlatList для оптимизации рендеринга списка
 */
export default function HomeScreen() {
  const renderItem: ListRenderItem<Module> = useCallback(
    ({ item }) => <ModuleCard module={item} />,
    []
  );

  const keyExtractor = useCallback((item: Module) => item.id.toString(), []);

  return (
    <ThemedView style={styles.container}>
      <View style={styles.header}>
        <ThemedText type="title" style={styles.headerTitle}>
          Модули обучения
        </ThemedText>
        <ThemedText style={styles.headerSubtitle}>
          Пройдите уроки последовательно
        </ThemedText>
      </View>
      <FlatList
        data={MODULES}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        removeClippedSubviews={true}
        maxToRenderPerBatch={10}
        windowSize={15}
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingTop: 60,
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  headerTitle: {
    fontSize: 32,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  headerSubtitle: {
    fontSize: 16,
    opacity: 0.7,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
});
