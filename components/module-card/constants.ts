import { Colors } from '@/constants/theme';
import { SymbolViewProps } from 'expo-symbols';
import { StyleProp, ViewStyle } from 'react-native';
import { ModuleStatus } from './types';

/**
 * Базовый стиль карточки (общие свойства для всех статусов)
 */
const baseCardStyle = {
  borderRadius: 16,
  padding: 16,
  marginBottom: 12,
  borderWidth: 1,
  shadowColor: Colors.light.shadow,
  shadowOffset: {
    width: 0,
    height: 2,
  },
  shadowOpacity: 0.1,
  shadowRadius: 3.84,
  elevation: 5, // для Android
};

/**
 * Статические словари для стилей карточек
 * Создаются один раз при загрузке модуля, а не при каждом рендере
 */
export const CARD_STYLES: Record<'light' | 'dark', Record<ModuleStatus, StyleProp<ViewStyle>>> = {
  light: {
    done: {
      ...baseCardStyle,
      backgroundColor: Colors.light.cardBackground,
      borderColor: Colors.light.cardBorder,
    },
    active: {
      ...baseCardStyle,
      backgroundColor: Colors.light.cardActiveBackground,
      borderColor: Colors.light.tint,
      borderWidth: 2,
    },
    locked: {
      ...baseCardStyle,
      backgroundColor: Colors.light.cardLockedBackground,
      borderColor: Colors.light.cardBorder,
      opacity: 0.6,
    },
  },
  dark: {
    done: {
      ...baseCardStyle,
      backgroundColor: Colors.dark.cardBackground,
      borderColor: Colors.dark.cardBorder,
    },
    active: {
      ...baseCardStyle,
      backgroundColor: Colors.dark.cardActiveBackground,
      borderColor: Colors.dark.tint,
      borderWidth: 2,
    },
    locked: {
      ...baseCardStyle,
      backgroundColor: Colors.dark.cardLockedBackground,
      borderColor: Colors.dark.cardBorder,
      opacity: 0.6,
    },
  },
};

/**
 * Конфигурация иконок для каждого статуса
 * Храним конфигурацию, а не JSX элементы для оптимизации
 */
export const ICON_CONFIG: Record<ModuleStatus, { name: SymbolViewProps['name']; size: number }> =
  {
    done: {
      name: 'checkmark.circle.fill',
      size: 24,
    },
    active: {
      name: 'play.circle.fill',
      size: 28,
    },
    locked: {
      name: 'lock.fill',
      size: 24,
    },
  };

/**
 * Статические словари для цветов иконок
 */
export const ICON_COLORS: Record<'light' | 'dark', Record<ModuleStatus, string>> = {
  light: {
    done: Colors.light.success,
    active: Colors.light.tint,
    locked: Colors.light.disabled,
  },
  dark: {
    done: Colors.dark.success,
    active: Colors.dark.tint,
    locked: Colors.dark.disabled,
  },
};

/**
 * Статические словари для цветов текста
 */
export const TEXT_COLORS: Record<'light' | 'dark', Record<ModuleStatus, string>> = {
  light: {
    done: Colors.light.text,
    active: Colors.light.tint,
    locked: Colors.light.disabled,
  },
  dark: {
    done: Colors.dark.text,
    active: Colors.dark.tint,
    locked: Colors.dark.disabled,
  },
};
