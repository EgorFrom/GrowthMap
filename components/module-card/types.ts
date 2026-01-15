/**
 * Статусы модуля обучения
 * - done: модуль пройден
 * - active: модуль доступен для прохождения
 * - locked: модуль заблокирован (требуется пройти предыдущие)
 */
export type ModuleStatus = 'done' | 'active' | 'locked';

/**
 * Интерфейс модуля обучения
 */
export interface Module {
  id: number;
  title: string;
  status: ModuleStatus;
}

/**
 * Пропсы компонента карточки модуля
 */
export interface ModuleCardProps {
  module: Module;
}
