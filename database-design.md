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

### Функция для вычисления статуса

```sql
CREATE OR REPLACE FUNCTION get_module_status(
  p_user_id UUID,
  p_module_id INTEGER
) RETURNS VARCHAR(20) AS $$
DECLARE
  v_order_index INTEGER;
  v_previous_done_count INTEGER;
  v_total_previous_modules INTEGER;
  v_current_status VARCHAR(20);
BEGIN
  -- Получаем порядковый номер модуля
  SELECT order_index INTO v_order_index
  FROM modules
  WHERE id = p_module_id;
  
  -- Проверяем текущий статус в таблице прогресса
  SELECT status INTO v_current_status
  FROM user_module_progress
  WHERE user_id = p_user_id AND module_id = p_module_id;
  
  -- Если модуль уже пройден, возвращаем done
  IF v_current_status = 'done' THEN
    RETURN 'done';
  END IF;
  
  -- Если это первый модуль, он всегда active
  IF v_order_index = 1 THEN
    RETURN 'active';
  END IF;
  
  -- Считаем количество пройденных предыдущих модулей
  SELECT COUNT(*) INTO v_previous_done_count
  FROM user_module_progress ump
  JOIN modules m ON m.id = ump.module_id
  WHERE ump.user_id = p_user_id
    AND ump.status = 'done'
    AND m.order_index < v_order_index;
  
  -- Считаем общее количество предыдущих модулей
  SELECT COUNT(*) INTO v_total_previous_modules
  FROM modules
  WHERE order_index < v_order_index;
  
  -- Если все предыдущие модули пройдены, модуль active
  IF v_previous_done_count = v_total_previous_modules THEN
    RETURN 'active';
  END IF;
  
  -- Иначе модуль locked
  RETURN 'locked';
END;
$$ LANGUAGE plpgsql;
```

## Эффективный запрос для фронтенда

### Представление (View) для получения списка модулей с статусами

Создаем представление, которое объединяет информацию о модулях и прогрессе пользователя:

```sql
CREATE OR REPLACE VIEW user_modules_with_status AS
SELECT 
  m.id,
  m.title,
  m.description,
  m.order_index,
  COALESCE(
    CASE 
      WHEN ump.status = 'done' THEN 'done'
      ELSE get_module_status(ump.user_id, m.id)
    END,
    get_module_status(NULL, m.id) -- Для новых пользователей
  ) AS status,
  ump.completed_at,
  ump.started_at,
  ump.user_id
FROM modules m
LEFT JOIN user_module_progress ump ON m.id = ump.module_id
ORDER BY m.order_index;
```

### Оптимизированный запрос для конкретного пользователя

Для получения списка модулей конкретного пользователя с вычисленными статусами:

```sql
-- Функция для получения модулей пользователя с актуальными статусами
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
  WITH module_statuses AS (
    SELECT 
      m.id,
      m.title,
      m.description,
      m.order_index,
      CASE 
        -- Если модуль пройден, возвращаем done
        WHEN ump.status = 'done' THEN 'done'::VARCHAR(20)
        -- Если это первый модуль, он всегда active
        WHEN m.order_index = 1 THEN 'active'::VARCHAR(20)
        -- Проверяем, все ли предыдущие модули пройдены
        WHEN (
          SELECT COUNT(*) 
          FROM user_module_progress ump2
          JOIN modules m2 ON m2.id = ump2.module_id
          WHERE ump2.user_id = p_user_id
            AND ump2.status = 'done'
            AND m2.order_index < m.order_index
        ) = (
          SELECT COUNT(*) 
          FROM modules m3
          WHERE m3.order_index < m.order_index
        ) THEN 'active'::VARCHAR(20)
        -- Иначе locked
        ELSE 'locked'::VARCHAR(20)
      END AS status,
      ump.completed_at,
      ump.started_at
    FROM modules m
    LEFT JOIN user_module_progress ump ON m.id = ump.module_id AND ump.user_id = p_user_id
    ORDER BY m.order_index
  )
  SELECT * FROM module_statuses;
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

## Триггеры для автоматического управления статусами

### Триггер для автоматического открытия следующего модуля

При завершении модуля (`status = 'done'`) автоматически открываем следующий модуль:

```sql
CREATE OR REPLACE FUNCTION handle_module_completion()
RETURNS TRIGGER AS $$
DECLARE
  v_next_module_id INTEGER;
  v_next_order_index INTEGER;
BEGIN
  -- Если модуль завершен
  IF NEW.status = 'done' AND (OLD.status IS NULL OR OLD.status != 'done') THEN
    -- Находим следующий модуль по порядку
    SELECT id, order_index INTO v_next_module_id, v_next_order_index
    FROM modules
    WHERE order_index = (
      SELECT order_index + 1
      FROM modules
      WHERE id = NEW.module_id
    )
    LIMIT 1;
    
    -- Если следующий модуль существует, открываем его
    IF v_next_module_id IS NOT NULL THEN
      INSERT INTO user_module_progress (user_id, module_id, status, started_at)
      VALUES (NEW.user_id, v_next_module_id, 'active', NOW())
      ON CONFLICT (user_id, module_id) 
      DO UPDATE SET 
        status = 'active',
        started_at = COALESCE(user_module_progress.started_at, NOW()),
        updated_at = NOW()
      WHERE user_module_progress.status != 'done';
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_module_completion
AFTER INSERT OR UPDATE ON user_module_progress
FOR EACH ROW
EXECUTE FUNCTION handle_module_completion();
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

### Материализованное представление (опционально)

Для очень больших объемов данных можно использовать материализованное представление:

```sql
CREATE MATERIALIZED VIEW user_modules_status_cache AS
SELECT 
  ump.user_id,
  m.id AS module_id,
  m.order_index,
  CASE 
    WHEN ump.status = 'done' THEN 'done'
    WHEN m.order_index = 1 THEN 'active'
    WHEN (
      SELECT COUNT(*) 
      FROM user_module_progress ump2
      JOIN modules m2 ON m2.id = ump2.module_id
      WHERE ump2.user_id = ump.user_id
        AND ump2.status = 'done'
        AND m2.order_index < m.order_index
    ) = (
      SELECT COUNT(*) 
      FROM modules m3
      WHERE m3.order_index < m.order_index
    ) THEN 'active'
    ELSE 'locked'
  END AS status
FROM modules m
CROSS JOIN (SELECT DISTINCT user_id FROM user_module_progress) users
LEFT JOIN user_module_progress ump ON m.id = ump.module_id AND ump.user_id = users.user_id;

CREATE UNIQUE INDEX ON user_modules_status_cache(user_id, module_id);
```

**Обновление кэша:**
```sql
REFRESH MATERIALIZED VIEW CONCURRENTLY user_modules_status_cache;
```

## Миграция данных

### SQL скрипт для создания всех объектов

```sql
-- 1. Создание таблицы modules
CREATE TABLE modules (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  order_index INTEGER NOT NULL UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Создание таблицы user_module_progress
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

-- 3. Создание индексов
CREATE INDEX idx_modules_order ON modules(order_index);
CREATE INDEX idx_user_module_progress_user ON user_module_progress(user_id);
CREATE INDEX idx_user_module_progress_module ON user_module_progress(module_id);
CREATE INDEX idx_user_module_progress_status ON user_module_progress(user_id, status);
CREATE INDEX idx_user_module_progress_user_status 
ON user_module_progress(user_id, status) 
WHERE status IN ('done', 'active');
CREATE INDEX idx_modules_order_id ON modules(order_index, id);

-- 4. Создание функции get_user_modules
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
  WITH module_statuses AS (
    SELECT 
      m.id,
      m.title,
      m.description,
      m.order_index,
      CASE 
        WHEN ump.status = 'done' THEN 'done'::VARCHAR(20)
        WHEN m.order_index = 1 THEN 'active'::VARCHAR(20)
        WHEN (
          SELECT COUNT(*) 
          FROM user_module_progress ump2
          JOIN modules m2 ON m2.id = ump2.module_id
          WHERE ump2.user_id = p_user_id
            AND ump2.status = 'done'
            AND m2.order_index < m.order_index
        ) = (
          SELECT COUNT(*) 
          FROM modules m3
          WHERE m3.order_index < m.order_index
        ) THEN 'active'::VARCHAR(20)
        ELSE 'locked'::VARCHAR(20)
      END AS status,
      ump.completed_at,
      ump.started_at
    FROM modules m
    LEFT JOIN user_module_progress ump ON m.id = ump.module_id AND ump.user_id = p_user_id
    ORDER BY m.order_index
  )
  SELECT * FROM module_statuses;
END;
$$ LANGUAGE plpgsql STABLE;

-- 5. Создание триггера для автоматического открытия следующего модуля
CREATE OR REPLACE FUNCTION handle_module_completion()
RETURNS TRIGGER AS $$
DECLARE
  v_next_module_id INTEGER;
BEGIN
  IF NEW.status = 'done' AND (OLD.status IS NULL OR OLD.status != 'done') THEN
    SELECT id INTO v_next_module_id
    FROM modules
    WHERE order_index = (
      SELECT order_index + 1
      FROM modules
      WHERE id = NEW.module_id
    )
    LIMIT 1;
    
    IF v_next_module_id IS NOT NULL THEN
      INSERT INTO user_module_progress (user_id, module_id, status, started_at)
      VALUES (NEW.user_id, v_next_module_id, 'active', NOW())
      ON CONFLICT (user_id, module_id) 
      DO UPDATE SET 
        status = 'active',
        started_at = COALESCE(user_module_progress.started_at, NOW()),
        updated_at = NOW()
      WHERE user_module_progress.status != 'done';
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_module_completion
AFTER INSERT OR UPDATE ON user_module_progress
FOR EACH ROW
EXECUTE FUNCTION handle_module_completion();

-- 6. Настройка RLS
ALTER TABLE user_module_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE modules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view all modules"
ON modules FOR SELECT
USING (true);

CREATE POLICY "Users can view own progress"
ON user_module_progress FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can update own progress"
ON user_module_progress FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own progress"
ON user_module_progress FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- 7. Вставка начальных данных
INSERT INTO modules (title, order_index) VALUES
  ('Welcome Journey', 1),
  ('Переключение на себя', 2),
  ('Источник вдохновения', 3),
  ('Пространство идей', 4),
  ('Финальный тест', 5);
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
   - Использовать функцию `get_user_modules(p_user_id)`, которая вычисляет статусы на уровне БД
   - Статус вычисляется по бизнес-логике: `done` → `active` → `locked`
   - Индексы оптимизируют запросы
   - Для больших объемов данных можно использовать материализованное представление с периодическим обновлением

### Преимущества данного подхода

- **Производительность**: Вычисление статусов на уровне БД, использование индексов
- **Консистентность**: Триггеры автоматически открывают следующие модули
- **Безопасность**: RLS политики защищают данные пользователей
- **Масштабируемость**: Структура легко расширяется для новых модулей и пользователей
- **Простота использования**: Один вызов функции возвращает готовый список модулей со статусами
