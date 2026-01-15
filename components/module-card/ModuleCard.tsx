import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { useColorScheme } from '@/hooks/use-color-scheme';
import React, { useCallback } from 'react';
import { Alert, Platform, StyleSheet, TouchableOpacity } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring
} from 'react-native-reanimated';
import { CARD_STYLES, ICON_COLORS, ICON_CONFIG, TEXT_COLORS } from './constants';
import { ModuleCardProps } from './types';

/**
 * Карточка модуля обучения
 * Отображает модуль с соответствующим статусом (done/active/locked)
 * Использует react-native-reanimated для плавных анимаций
 * Использует статические словари для оптимизации производительности
 */
function ModuleCardComponent({ module }: ModuleCardProps) {
  const colorScheme = useColorScheme();
  const scale = useSharedValue(1);
  const theme = (colorScheme ?? 'light') as 'light' | 'dark';

  // Анимированный стиль для карточки (масштаб и прозрачность)
  const animatedStyle = useAnimatedStyle(() => {
    return {
      transform: [{ scale: scale.value }],
    };
  });

  // Обработчики нажатий с анимацией
  const handlePressIn = useCallback(() => {
    scale.value = withSpring(0.99);
  }, [scale]);

  const handlePressOut = useCallback(() => {
    scale.value = withSpring(1);
  }, [scale]);

  const handlePress = useCallback(() => {
    if (module.status === 'locked') {
      // На вебе используем window.alert для лучшей совместимости
      // На мобильных платформах используем Alert.alert
      if (Platform.OS === 'web') {
        window.alert('Урок недоступен\n\nПройдите предыдущие уроки, чтобы открыть этот модуль.');
      } else {
        Alert.alert('Урок недоступен', 'Пройдите предыдущие уроки, чтобы открыть этот модуль.');
      }
      return;
    }

    if (module.status === 'active') {
      console.log('Start lesson');
    }
  }, [module.status]);

  // Получаем стили из статического словаря
  const cardStyle = CARD_STYLES[theme][module.status];

  // Получаем конфигурацию иконки и создаем элемент
  const iconConfig = ICON_CONFIG[module.status];
  const iconColor = ICON_COLORS[theme][module.status];

  return (
    <Animated.View style={animatedStyle}>
      <TouchableOpacity
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        activeOpacity={0.8}
      >
        <ThemedView style={cardStyle}>
          <ThemedView style={styles.content}>
            <IconSymbol
              name={iconConfig.name}
              size={iconConfig.size}
              color={iconColor}
              style={styles.icon}
            />
            <ThemedText
              type="defaultSemiBold"
              lightColor={TEXT_COLORS.light[module.status]}
              darkColor={TEXT_COLORS.dark[module.status]}
              style={styles.title}>
              {module.title}
            </ThemedText>
            {module.status === 'active' && (
              <ThemedView style={styles.badge}>
                <ThemedText>Начать</ThemedText>
              </ThemedView>
            )}
          </ThemedView>
        </ThemedView>
      </TouchableOpacity>
    </Animated.View>
  );
}

/**
 * Экспортируем мемоизированный компонент для оптимизации рендеринга
 * Компонент будет перерендериваться только при изменении props.module
 */
export const ModuleCard = React.memo(ModuleCardComponent);

const styles = StyleSheet.create({
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'transparent',
  },
  icon: {
    marginRight: 16,
  },
  title: {
    flex: 1,
  },
  badge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
});
