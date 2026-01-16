# Проектирование базы данных для системы обучения

## Обзор

Данный документ описывает схему базы данных для хранения прогресса пользователей в системе обучения с модулями, которые открываются последовательно.

## Структура данных

### Таблицы

#### 1. `modules` - Каталог модулей обучения

Хранит статическую информацию о всех доступных модулях в системе.

```sql
CREATE TABLE modules (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  order_index INTEGER NOT NULL UNIQUE, -- Порядок отображения модулей
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_modules_order ON modules(order_index);
```

**Поля:**
- `id` - Уникальный идентификатор модуля
- `title` - Название модуля
- `description` - Описание модуля (опционально)
- `order_index` - Порядок отображения модулей (для последовательного открытия)
- `created_at`, `updated_at` - Временные метки

#### 2. `user_module_progress` - Прогресс пользователя по модулям

Связывает пользователя с модулями и хранит статус прохождения.

```sql
CREATE TABLE user_module_progress (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  module_id INTEGER NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'locked' CHECK (status IN ('done', 'active', 'locked')),
  completed_at TIMESTAMP WITH TIME ZONE,
  started_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, module_id)
);

CREATE INDEX idx_user_module_progress_user ON user_module_progress(user_id);
CREATE INDEX idx_user_module_progress_module ON user_module_progress(module_id);
CREATE INDEX idx_user_module_progress_status ON user_module_progress(user_id, status);
```

**Поля:**
- `id` - Уникальный идентификатор записи
- `user_id` - Ссылка на пользователя (Supabase использует UUID из `auth.users`)
- `module_id` - Ссылка на модуль
- `status` - Статус модуля: `done`, `active`, `locked`
- `completed_at` - Время завершения модуля (заполняется при статусе `done`)
- `started_at` - Время начала модуля (заполняется при статусе `active`)
- `created_at`, `updated_at` - Временные метки

**Ограничения:**
- Уникальная пара `(user_id, module_id)` - один пользователь может иметь только одну запись прогресса по модулю
- Проверка значения `status` через CHECK constraint

## Логика определения статуса модуля

### Алгоритм вычисления статуса

Статус модуля определяется по следующей логике:

1. **`done`** - Модуль пройден (есть запись в `user_module_progress` со статусом `done`)
2. **`active`** - Модуль доступен для прохождения:
   - Все предыдущие модули (по `order_index`) имеют статус `done`
   - Или это первый модуль (`order_index = 1`)
3. **`locked`** - Модуль заблокирован (не все предыдущие модули пройдены)

## Эффективный запрос для фронтенда

### Функция для получения модулей конкретного пользователя

Функция получает список модулей для конкретного пользователя со статусами из таблицы прогресса:

```sql
CREATE OR REPLACE FUNCTION get_user_modules(p_user_id UUID)
RETURNS TABLE (
  id INTEGER,
  title VARCHAR(255),
  description TEXT,
  order_index INTEGER,
  status VARCHAR(20),
  completed_at TIMESTAMP WITH TIME ZONE,
  started_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    m.id,
    m.title,
    m.description,
    m.order_index,
    COALESCE(ump.status, 'locked')::VARCHAR(20) AS status,
    ump.completed_at,
    ump.started_at
  FROM modules m
  LEFT JOIN user_module_progress ump ON m.id = ump.module_id AND ump.user_id = p_user_id
  ORDER BY m.order_index;
END;
$$ LANGUAGE plpgsql STABLE;
```

### Использование на фронтенде (Supabase Client)

```typescript
// Пример использования в TypeScript/React
import { supabase } from './supabase';

async function getUserModules(userId: string) {
  const { data, error } = await supabase.rpc('get_user_modules', {
    p_user_id: userId
  });
  
  if (error) throw error;
  return data;
}
```

## Функция для завершения модуля

### Атомарное завершение модуля и открытие следующего

Используется функция `complete_module`, которая атомарно завершает текущий модуль и открывает следующий. Это гарантирует, что оба действия выполняются в одной транзакции - невозможно завершить модуль без открытия следующего.

```sql
CREATE OR REPLACE FUNCTION complete_module(p_user_id UUID, p_module_id INTEGER)
RETURNS VOID AS $$
DECLARE
  v_next_module_id INTEGER;
  v_current_status VARCHAR(20);
BEGIN
  -- Проверяем, что модуль существует и пользователь имеет к нему доступ
  SELECT status INTO v_current_status
  FROM user_module_progress
  WHERE user_id = p_user_id AND module_id = p_module_id;
  
  -- Если записи нет, модуль заблокирован или уже завершен, ничего не делаем
  IF v_current_status IS NULL OR v_current_status != 'active' THEN
    RETURN;
  END IF;
  
  -- Отмечаем текущий модуль как завершенный
  UPDATE user_module_progress
  SET 
    status = 'done',
    completed_at = NOW(),
    updated_at = NOW()
  WHERE user_id = p_user_id AND module_id = p_module_id;
  
  -- Находим следующий модуль по порядку
  SELECT id INTO v_next_module_id
  FROM modules
  WHERE order_index = (
    SELECT order_index + 1
    FROM modules
    WHERE id = p_module_id
  )
  LIMIT 1;
  
  -- Если следующий модуль существует, открываем его
  IF v_next_module_id IS NOT NULL THEN
    INSERT INTO user_module_progress (user_id, module_id, status, started_at)
    VALUES (p_user_id, v_next_module_id, 'active', NOW())
    ON CONFLICT (user_id, module_id) 
    DO UPDATE SET 
      status = 'active',
      started_at = COALESCE(user_module_progress.started_at, NOW()),
      updated_at = NOW()
    WHERE user_module_progress.status != 'done';
  END IF;
END;
$$ LANGUAGE plpgsql;
```

**Важно:** Эта функция выполняет оба действия атомарно в одной транзакции. Если произойдет ошибка, транзакция откатится, и состояние останется консистентным.

### Использование на фронтенде (Supabase Client)

```typescript
// Пример использования в TypeScript/React
import { supabase } from './supabase';

async function completeModule(userId: string, moduleId: number) {
  const { error } = await supabase.rpc('complete_module', {
    p_user_id: userId,
    p_module_id: moduleId
  });
  
  if (error) throw error;
}
```

## Row Level Security (RLS) для Supabase

Для безопасности данных настраиваем RLS политики:

```sql
-- Включаем RLS
ALTER TABLE user_module_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE modules ENABLE ROW LEVEL SECURITY;

-- Пользователи могут читать все модули
CREATE POLICY "Users can view all modules"
ON modules FOR SELECT
USING (true);

-- Пользователи могут читать только свой прогресс
CREATE POLICY "Users can view own progress"
ON user_module_progress FOR SELECT
USING (auth.uid() = user_id);

-- Пользователи могут обновлять только свой прогресс
CREATE POLICY "Users can update own progress"
ON user_module_progress FOR UPDATE
USING (auth.uid() = user_id);

-- Пользователи могут создавать только свой прогресс
CREATE POLICY "Users can insert own progress"
ON user_module_progress FOR INSERT
WITH CHECK (auth.uid() = user_id);
```

## Оптимизация производительности

### Индексы

```sql
-- Составной индекс для быстрого поиска модулей пользователя с определенным статусом
CREATE INDEX idx_user_module_progress_user_status 
ON user_module_progress(user_id, status) 
WHERE status IN ('done', 'active');

-- Индекс для быстрого поиска предыдущих модулей
CREATE INDEX idx_modules_order_id ON modules(order_index, id);
```

### Материализованное представление (опционально, только для больших систем)

**Примечание:** Для обычного использования рекомендуется функция `get_user_modules()`. Материализованное представление следует использовать только при очень больших объемах данных (десятки тысяч пользователей) и необходимости кэширования.

Для очень больших объемов данных можно использовать материализованное представление как кэш:

```sql
CREATE MATERIALIZED VIEW user_modules_status_cache AS
SELECT 
  ump.user_id,
  m.id AS module_id,
  m.order_index,
  COALESCE(ump.status, 'locked') AS status
FROM modules m
CROSS JOIN (SELECT DISTINCT user_id FROM user_module_progress) users
LEFT JOIN user_module_progress ump ON m.id = ump.module_id AND ump.user_id = users.user_id;

CREATE UNIQUE INDEX ON user_modules_status_cache(user_id, module_id);
```

**Обновление кэша:**
```sql
REFRESH MATERIALIZED VIEW CONCURRENTLY user_modules_status_cache;
```

## Резюме

### Ответы на вопросы

1. **Какие таблицы нужны?**
   - `modules` - каталог всех модулей обучения
   - `user_module_progress` - прогресс пользователей по модулям

2. **Как связать пользователя и статус урока?**
   - Через таблицу `user_module_progress` с внешними ключами на `auth.users` (Supabase) и `modules`
   - Уникальное ограничение на пару `(user_id, module_id)` гарантирует одну запись прогресса на модуль для каждого пользователя

3. **Как эффективно отдавать на фронтенд список, где сразу понятно, что открыто, а что закрыто?**
   - Использовать функцию `get_user_modules(p_user_id)`, которая возвращает модули со статусами
   - Для завершения модуля использовать функцию `complete_module(p_user_id, p_module_id)`, которая атомарно завершает текущий модуль и открывает следующий
   - Индексы оптимизируют запросы

### Преимущества данного подхода

- **Производительность**: Вычисление статусов на уровне БД, использование индексов
- **Консистентность**: Функция `complete_module` атомарно завершает модуль и открывает следующий в одной транзакции - невозможно завершить модуль без открытия следующего
- **Надежность**: Все операции выполняются в одной транзакции, при ошибке происходит откат - состояние всегда остается консистентным
- **Безопасность**: RLS политики защищают данные пользователей
- **Масштабируемость**: Структура легко расширяется для новых модулей и пользователей
- **Простота использования**: Один вызов функции возвращает готовый список модулей со статусами
