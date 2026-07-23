export interface SQLPreset {
  id: string;
  title: string;
  description: string;
  dialect: 'PostgreSQL' | 'Oracle' | 'Clickhouse' | 'DuckDB';
  sql: string;
}

export const sqlPresets: SQLPreset[] = [
  {
    id: 'empty-sandbox',
    title: 'Пустая песочница (Введите ваш SQL)',
    description: 'Абсолютно чистое рабочее пространство для ввода или вставки любого SQL-скрипта.',
    dialect: 'PostgreSQL',
    sql: ''
  },
  {
    id: 'postgres-cte-window',
    title: 'PostgreSQL: Аналитика продаж с UNION ALL и оконными функциями',
    description: 'Сложный аналитический запрос, использующий обобщенные табличные выражения (CTE), множественный UNION ALL, группировку и оконную функцию DENSE_RANK() OVER (PARTITION BY ... ORDER BY ...).',
    dialect: 'PostgreSQL',
    sql: `WITH regional_sales AS (
    SELECT 'Web' AS source, region, amount FROM web_orders
    UNION ALL
    SELECT 'Retail' AS source, region, price AS amount FROM retail_orders
    UNION ALL
    SELECT 'Mobile' AS source, region, total_amount AS amount FROM mobile_orders
),
top_regions AS (
    SELECT 
        region
    FROM regional_sales
    GROUP BY region
    HAVING SUM(amount) > 10000
)
SELECT 
    source,
    region,
    SUM(amount) AS total_sales,
    DENSE_RANK() OVER (PARTITION BY source ORDER BY SUM(amount) DESC) AS sales_rank
FROM regional_sales
WHERE region IN (SELECT region FROM top_regions)
GROUP BY source, region;`
  },
  {
    id: 'clickhouse-logs-arrays',
    title: 'ClickHouse: Анализ логов с подзапросами и UNION ALL',
    description: 'ClickHouse-запрос для агрегации событий из разных источников (Android, iOS, Web) через вложенный подзапрос с UNION ALL, уникальным подсчетом и функциями даты.',
    dialect: 'Clickhouse',
    sql: `SELECT 
    event_date,
    platform,
    uniqExact(uid) AS active_users,
    sum(views) AS total_views
FROM (
    SELECT toDate(event_time) AS event_date, 'Android' AS platform, user_id AS uid, 1 AS views FROM logs_android WHERE status = 200
    UNION ALL
    SELECT toDate(event_time) AS event_date, 'iOS' AS platform, user_id AS uid, 1 AS views FROM logs_ios WHERE status = 200
    UNION ALL
    SELECT toDate(event_time) AS event_date, 'Web' AS platform, visitor_id AS uid, page_views AS views FROM logs_web WHERE response_code = 200
) sub_logs
GROUP BY event_date, platform
ORDER BY event_date DESC, active_users DESC;`
  },
  {
    id: 'oracle-financial-audit',
    title: 'Oracle: Финансовый аудит и баланс с UNION ALL',
    description: 'Oracle-запрос, объединяющий депозиты и списания во вложенном подзапросе через UNION ALL и вычисляющий кумулятивный итог (нарастающий баланс) с помощью оконного агрегирования OVER (PARTITION BY ... ORDER BY ...).',
    dialect: 'Oracle',
    sql: `SELECT 
    account_id,
    transaction_type,
    amount,
    val_date,
    SUM(amount) OVER (PARTITION BY account_id ORDER BY val_date, transaction_id) AS running_balance
FROM (
    SELECT acc_id AS account_id, 'DEPOSIT' AS transaction_type, dep_amount AS amount, deposit_date AS val_date, dep_id AS transaction_id FROM deposits WHERE status = 'CLEARED'
    UNION ALL
    SELECT acc_id AS account_id, 'WITHDRAWAL' AS transaction_type, -draw_amount AS amount, withdrawal_date AS val_date, draw_id AS transaction_id FROM withdrawals WHERE status = 'CLEARED'
) sub_tx
WHERE val_date >= ADD_MONTHS(SYSDATE, -12);`
  },
  {
    id: 'postgres-truncate-multi',
    title: 'PostgreSQL: Множественная очистка таблиц (TRUNCATE)',
    description: 'Демонстрация работы парсинга DDL команды TRUNCATE для очистки нескольких таблиц одновременно с детальным разбором целевых сущностей.',
    dialect: 'PostgreSQL',
    sql: `TRUNCATE TABLE staging_orders, staging_payments, staging_refunds;`
  },
  {
    id: 'oracle-plsql-procedure',
    title: 'Oracle: PL/SQL хранимая процедура аудита',
    description: 'Хранимая PL/SQL процедура с объявлением переменных, обновлением (UPDATE) и добавлением (INSERT) записей, присвоением значений и блоком исключений (EXCEPTION).',
    dialect: 'Oracle',
    sql: `CREATE OR REPLACE PROCEDURE audit_user_status (
    p_min_login_date IN DATE,
    p_status_changed OUT NUMBER
) IS
    v_suspended_count NUMBER := 0;
BEGIN
    -- Step 1: Update statuses of stale accounts
    UPDATE users 
    SET status = 'suspended', suspension_reason = 'Stale inactivity'
    WHERE last_login < p_min_login_date AND status = 'active';
    
    v_suspended_count := SQL%ROWCOUNT;
    
    -- Step 2: Log suspends into audit timeline
    INSERT INTO audit_log (event_name, affected_rows, timestamp)
    VALUES ('USER_AUTO_SUSPEND', v_suspended_count, SYSDATE);
    
    -- Step 3: Assign out-parameter
    p_status_changed := v_suspended_count;
    
    COMMIT;
EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        RAISE_APPLICATION_ERROR(-20001, 'Audit user suspension failed');
END;`
  },

  // ==========================================
  // ДОПОЛНИТЕЛЬНЫЕ ПРЕСЕТЫ POSTGRESQL (10 шт)
  // ==========================================
  {
    id: 'pg-preset-upsert-inventory',
    title: 'PostgreSQL: Продвинутый UPSERT складских остатков',
    description: 'INSERT ... ON CONFLICT с динамическим пересчетом количества товаров и логированием изменения цен.',
    dialect: 'PostgreSQL',
    sql: `INSERT INTO warehouse_inventory (product_id, quantity, last_supplier_price, updated_at)
VALUES (501, 150, 2450.00, NOW())
ON CONFLICT (product_id) 
DO UPDATE SET 
    quantity = warehouse_inventory.quantity + EXCLUDED.quantity,
    last_supplier_price = EXCLUDED.last_supplier_price,
    updated_at = EXCLUDED.updated_at
RETURNING product_id, quantity AS total_in_stock;`
  },
  {
    id: 'pg-preset-recursive-tree',
    title: 'PostgreSQL: Построение полного древа категорий',
    description: 'Использование WITH RECURSIVE для формирования хлебных крошек и уровня глубины вложенности.',
    dialect: 'PostgreSQL',
    sql: `WITH RECURSIVE category_tree AS (
    SELECT id, name, parent_id, name::text AS breadcrumb, 1 AS depth
    FROM catalog_categories
    WHERE parent_id IS NULL
    UNION ALL
    SELECT c.id, c.name, c.parent_id, (t.breadcrumb || ' > ' || c.name)::text, t.depth + 1
    FROM catalog_categories c
    INNER JOIN category_tree t ON c.parent_id = t.id
)
SELECT id, breadcrumb, depth FROM category_tree ORDER BY breadcrumb;`
  },
  {
    id: 'pg-preset-jsonb-analytics',
    title: 'PostgreSQL: Анализ атрибутов пользовательского JSONB',
    description: 'Фильтрация и разворачивание JSONB массивов с помощью jsonb_array_elements и операторов ->>.',
    dialect: 'PostgreSQL',
    sql: `SELECT 
    user_id,
    profile->>'country' AS country,
    tag_element->>'name' AS tag_name
FROM users_profiles,
jsonb_array_elements(profile->'tags') AS tag_element
WHERE profile->'settings'->>'notifications' = 'true'
  AND profile @> '{"is_verified": true}';`
  },
  {
    id: 'pg-preset-window-cohorts',
    title: 'PostgreSQL: Когортный анализ LTV пользователей',
    description: 'Рассчет накопительного дохода LTV с помощью DATE_TRUNC и оконных функций SUM() OVER.',
    dialect: 'PostgreSQL',
    sql: `SELECT 
    user_id,
    DATE_TRUNC('month', order_date) AS order_month,
    amount,
    SUM(amount) OVER (PARTITION BY user_id ORDER BY order_date ROWS UNBOUNDED PRECEDING) AS cumulative_ltv,
    LAG(amount, 1) OVER (PARTITION BY user_id ORDER BY order_date) AS prev_order_amount
FROM customer_orders
WHERE order_date >= '2025-01-01';`
  },
  {
    id: 'pg-preset-lateral-top3',
    title: 'PostgreSQL: Выборка 3 самых дорогих товаров в каждой категории',
    description: 'Оператор CROSS JOIN LATERAL для эффективного извлечения топ-N элементов группы.',
    dialect: 'PostgreSQL',
    sql: `SELECT 
    c.id AS category_id,
    c.category_name,
    p.product_id,
    p.title,
    p.price
FROM categories c
CROSS JOIN LATERAL (
    SELECT product_id, title, price
    FROM products
    WHERE category_id = c.id
    ORDER BY price DESC
    LIMIT 3
) p;`
  },
  {
    id: 'pg-preset-full-text-rank',
    title: 'PostgreSQL: Полнотекстовый поиск с ранжированием',
    description: 'Использование to_tsvector, to_tsquery и ts_rank_cd для поиска по статьям блога.',
    dialect: 'PostgreSQL',
    sql: `SELECT 
    id,
    title,
    ts_rank_cd(to_tsvector('russian', content), query) AS relevance
FROM blog_posts, to_tsquery('russian', 'база & данные | оптимизация') query
WHERE to_tsvector('russian', content) @@ query
ORDER BY relevance DESC
LIMIT 10;`
  },
  {
    id: 'pg-preset-partitioned-ddl',
    title: 'PostgreSQL: Создание секционированной таблицы логов',
    description: 'Схема таблицы с секционированием по диапазону дат (PARTITION BY RANGE).',
    dialect: 'PostgreSQL',
    sql: `CREATE TABLE system_events (
    event_id BIGSERIAL,
    event_time TIMESTAMP NOT NULL,
    user_id BIGINT,
    payload JSONB
) PARTITION BY RANGE (event_time);

CREATE TABLE system_events_2025_q1 PARTITION OF system_events
    FOR VALUES FROM ('2025-01-01') TO ('2025-04-01');`
  },
  {
    id: 'pg-preset-partitioned-index',
    title: 'PostgreSQL: Частичный параллельный индекс с условием',
    description: 'Создание индекса без блокировки таблицы через CONCURRENTLY для активных заказов.',
    dialect: 'PostgreSQL',
    sql: `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_active_unpaid_orders 
ON orders (customer_id, created_at DESC) 
WHERE status = 'unpaid' AND is_deleted = false;`
  },
  {
    id: 'pg-preset-distinct-on-last',
    title: 'PostgreSQL: Последний статус доставки на каждого клиента',
    description: 'Использование выразительного синтаксиса DISTINCT ON (column_name).',
    dialect: 'PostgreSQL',
    sql: `SELECT DISTINCT ON (customer_id) 
    customer_id,
    tracking_code,
    status,
    updated_at
FROM shipment_status_history
ORDER BY customer_id, updated_at DESC;`
  },
  {
    id: 'pg-preset-generate-series-calendar',
    title: 'PostgreSQL: Заполнение пропусков в днях продажи',
    description: 'Генерация всех дат месяца через generate_series и LEFT JOIN к фактам.',
    dialect: 'PostgreSQL',
    sql: `SELECT 
    cal.day::DATE AS sales_date,
    COALESCE(SUM(s.amount), 0) AS total_revenue
FROM generate_series('2025-01-01'::DATE, '2025-01-31'::DATE, '1 day'::INTERVAL) AS cal(day)
LEFT JOIN daily_sales s ON s.sale_date = cal.day::DATE
GROUP BY cal.day
ORDER BY sales_date;`
  },

  // ==========================================
  // ДОПОЛНИТЕЛЬНЫЕ ПРЕСЕТЫ ORACLE (10 шт)
  // ==========================================
  {
    id: 'ora-preset-connect-by-org',
    title: 'Oracle: Организационная иерархия с SYS_CONNECT_BY_PATH',
    description: 'CONNECT BY PRIOR с отступами уровня и полным деревом подчиненных.',
    dialect: 'Oracle',
    sql: `SELECT 
    LEVEL,
    LPAD(' ', (LEVEL - 1) * 4) || first_name || ' ' || last_name AS employee_tree,
    job_id,
    SYS_CONNECT_BY_PATH(last_name, ' / ') AS full_path
FROM hr.employees
START WITH manager_id IS NULL
CONNECT BY PRIOR employee_id = manager_id
ORDER SIBLINGS BY last_name;`
  },
  {
    id: 'ora-preset-merge-upsert',
    title: 'Oracle: Слияние справочника клиентов (MERGE INTO)',
    description: 'Классический условный MERGE со вставкой и обновлением существующих записей.',
    dialect: 'Oracle',
    sql: `MERGE INTO customers_master t
USING customers_stage s
ON (t.national_id = s.national_id)
WHEN MATCHED THEN
    UPDATE SET t.email = s.email, t.phone = s.phone, t.last_update = SYSDATE
WHEN NOT MATCHED THEN
    INSERT (customer_id, national_id, email, phone, created_at)
    VALUES (seq_cust_id.NEXTVAL, s.national_id, s.email, s.phone, SYSDATE);`
  },
  {
    id: 'ora-preset-listagg-dept',
    title: 'Oracle: Сворачивание сотрудников в строку (LISTAGG)',
    description: 'LISTAGG ... WITHIN GROUP с ограничением по зарплате и сортировкой.',
    dialect: 'Oracle',
    sql: `SELECT 
    department_id,
    COUNT(*) AS total_staff,
    LISTAGG(last_name || ' (' || salary || ')', '; ') 
        WITHIN GROUP (ORDER BY salary DESC) AS staff_list
FROM hr.employees
GROUP BY department_id
HAVING COUNT(*) >= 3;`
  },
  {
    id: 'ora-preset-pivot-sales',
    title: 'Oracle: Квартальный сводный отчет продаж (PIVOT)',
    description: 'Переворот строк кварталов в отдельные столбцы через синтаксис PIVOT.',
    dialect: 'Oracle',
    sql: `SELECT * FROM (
    SELECT region, quarter, revenue FROM quarterly_sales
)
PIVOT (
    SUM(revenue) FOR quarter IN ('Q1' AS Q1_Sales, 'Q2' AS Q2_Sales, 'Q3' AS Q3_Sales, 'Q4' AS Q4_Sales)
)
ORDER BY region;`
  },
  {
    id: 'ora-preset-offset-fetch-paged',
    title: 'Oracle: Оптимизированная пагинация (OFFSET FETCH)',
    description: 'Современная пагинация без использования устаревших подзапросов с ROWNUM.',
    dialect: 'Oracle',
    sql: `SELECT employee_id, first_name, last_name, salary
FROM hr.employees
WHERE salary > 3000
ORDER BY salary DESC, employee_id ASC
OFFSET 10 ROWS FETCH NEXT 15 ROWS ONLY;`
  },
  {
    id: 'ora-preset-json-table-unpack',
    title: 'Oracle: Преобразование JSON массива в таблицу',
    description: 'Использование JSON_TABLE для извлечения полей встроенного документа.',
    dialect: 'Oracle',
    sql: `SELECT p.id, j.item_code, j.quantity, j.price
FROM purchase_orders p,
JSON_TABLE(p.order_json, '$.items[*]'
    COLUMNS (
        item_code VARCHAR2(50) PATH '$.code',
        quantity  NUMBER       PATH '$.qty',
        price     NUMBER       PATH '$.price'
    )
) j;`
  },
  {
    id: 'ora-preset-flashback-time',
    title: 'Oracle: Flashback Запрос состояния данных до сбоя',
    description: 'Чтение состояния таблицы на 20 минут назад с помощью AS OF TIMESTAMP.',
    dialect: 'Oracle',
    sql: `SELECT * 
FROM customer_accounts AS OF TIMESTAMP (SYSTIMESTAMP - INTERVAL '20' MINUTE)
WHERE status = 'BLOCKED';`
  },
  {
    id: 'ora-preset-with-function-plsql',
    title: 'Oracle: Встроенная логика расчёта налогов в SQL',
    description: 'Локальная PL/SQL функция объявленная прямо в б блоке WITH (12c+).',
    dialect: 'Oracle',
    sql: `WITH FUNCTION calc_vat(p_amount NUMBER) RETURN NUMBER IS
BEGIN
    RETURN ROUND(p_amount * 0.20, 2);
END;
SELECT order_id, total_amount, calc_vat(total_amount) AS vat_amount
FROM orders_header
WHERE order_date >= TRUNC(SYSDATE, 'MM');`
  },
  {
    id: 'ora-preset-match-recognize-stocks',
    title: 'Oracle: Анализ финансовых трендов MATCH_RECOGNIZE',
    description: 'Детектирование паттернов падения и последующего роста стоимости активов.',
    dialect: 'Oracle',
    sql: `SELECT * FROM ticker_quotes
MATCH_RECOGNIZE (
    PARTITION BY symbol ORDER BY quote_date
    MEASURES STRT.price AS start_p, LAST(DOWN.price) AS min_p, LAST(UP.price) AS recovery_p
    PATTERN (STRT DOWN+ UP+)
    DEFINE DOWN AS DOWN.price < PREV(DOWN.price),
           UP AS UP.price > PREV(UP.price)
);`
  },
  {
    id: 'ora-preset-result-cache-hint',
    title: 'Oracle: Оптимизация агрегации с RESULT_CACHE',
    description: 'Инструкция оптимизатору кешировать результат вычислений тяжелого отчета.',
    dialect: 'Oracle',
    sql: `SELECT /*+ RESULT_CACHE */ 
    department_id, 
    ROUND(AVG(salary), 2) AS avg_sal, 
    MAX(salary) AS max_sal 
FROM hr.employees 
GROUP BY department_id;`
  },

  // ==========================================
  // ДОПОЛНИТЕЛЬНЫЕ ПРЕСЕТЫ CLICKHOUSE (10 шт)
  // ==========================================
  {
    id: 'ch-preset-hourly-uau',
    title: 'ClickHouse: Анализ кликов с uniqExact и toStartOfHour',
    description: 'Вычисление точных уникальных пользователей и суммарных хитов по часам.',
    dialect: 'Clickhouse',
    sql: `SELECT 
    toStartOfHour(event_time) AS hour_bucket,
    country_code,
    uniqExact(user_id) AS uau,
    count() AS total_events
FROM web_hits_log
WHERE event_date >= today() - 7
GROUP BY hour_bucket, country_code
ORDER BY hour_bucket DESC;`
  },
  {
    id: 'ch-preset-replacing-final',
    title: 'ClickHouse: Поиск актуального состояния из ReplacingMergeTree',
    description: 'Дедупликация изменений пользователей с помощью модификатора FINAL и LIMIT BY.',
    dialect: 'Clickhouse',
    sql: `SELECT 
    user_id,
    email,
    user_status,
    updated_at
FROM users_register_stream FINAL
WHERE is_deleted = 0
LIMIT 1 BY user_id;`
  },
  {
    id: 'ch-preset-argmax-status',
    title: 'ClickHouse: Получение последней локации устройств (argMax)',
    description: 'Быстрый агрегат argMax для поиска параметров, связанных с последней меткой времени.',
    dialect: 'Clickhouse',
    sql: `SELECT 
    device_id,
    argMax(latitude, recorded_at) AS last_lat,
    argMax(longitude, recorded_at) AS last_lon,
    max(recorded_at) AS last_seen
FROM device_telemetry
GROUP BY device_id;`
  },
  {
    id: 'ch-preset-array-join-tags',
    title: 'ClickHouse: Разворачивание массивов интересов (ARRAY JOIN)',
    dialect: 'Clickhouse',
    description: 'Преобразование столбца с массивом категорий в отдельные строки.',
    sql: `SELECT 
    user_id,
    category_tag,
    event_time
FROM user_browsing_log
ARRAY JOIN categories_list AS category_tag
WHERE event_date = today();`
  },
  {
    id: 'ch-preset-quantiles-latency',
    title: 'ClickHouse: Перцентили задержки микросервисов p50, p95, p99',
    description: 'Функция quantilesExact для точной оценки SLA ответов API.',
    dialect: 'Clickhouse',
    sql: `SELECT 
    endpoint_path,
    quantilesExact(0.50, 0.95, 0.99)(duration_ms) AS latencies
FROM api_access_log
WHERE event_date = today()
GROUP BY endpoint_path;`
  },
  {
    id: 'ch-preset-dict-lookup',
    title: 'ClickHouse: Мгновенное подтягивание стран из словаря (dictGet)',
    description: 'Запрос атрибутов из кешированного словаря без медленных операций JOIN.',
    dialect: 'Clickhouse',
    sql: `SELECT 
    user_id,
    dictGet('geo_dictionary', 'country_name', toUInt64(ip_number)) AS country,
    count() AS page_views
FROM click_stream
GROUP BY user_id, country;`
  },
  {
    id: 'ch-preset-array-lambda',
    title: 'ClickHouse: Обработка массива цен через лямбды (arrayFilter)',
    dialect: 'Clickhouse',
    description: 'Функциональная фильтрация элементов внутри массива по условию.',
    sql: `SELECT 
    cart_id,
    items_prices,
    arrayFilter(x -> x >= 5000, items_prices) AS premium_items,
    arrayMap(x -> round(x * 0.9, 2), items_prices) AS discounted_prices
FROM shopping_carts;`
  },
  {
    id: 'ch-preset-qualify-top3',
    title: 'ClickHouse: Отбор 3 первых действий пользователя (QUALIFY)',
    description: 'Компактный финишный фильтр QUALIFY для отсечения лишних оконных результатов.',
    dialect: 'Clickhouse',
    sql: `SELECT 
    user_id,
    event_time,
    action_type,
    ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY event_time ASC) AS action_step
FROM user_session_events
QUALIFY action_step <= 3;`
  },
  {
    id: 'ch-preset-sample-query',
    title: 'ClickHouse: Приближенная аналитика на сэмпле данных',
    description: 'Быстрая гипотеза на 10% сэмпле огромного лога через SAMPLE 0.1.',
    dialect: 'Clickhouse',
    sql: `SELECT 
    page_url,
    count() * 10 AS estimated_total_views
FROM web_analytics SAMPLE 0.1
WHERE event_date = today()
GROUP BY page_url
ORDER BY estimated_total_views DESC
LIMIT 20;`
  },
  {
    id: 'ch-preset-mergetree-ddl',
    title: 'ClickHouse: Таблица MergeTree с TTL и партициями',
    description: 'Оптимальная схема колонкового хранилища с автоудалением старых логов.',
    dialect: 'Clickhouse',
    sql: `CREATE TABLE IF NOT EXISTS app_performance_log (
    log_date Date,
    server_id LowCardinality(String),
    cpu_usage Float32,
    created_at DateTime
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(log_date)
ORDER BY (server_id, log_date, created_at)
TTL log_date + INTERVAL 6 MONTH;`
  },

  // ==========================================
  // ДОПОЛНИТЕЛЬНЫЕ ПРЕСЕТЫ DUCKDB (10 шт)
  // ==========================================
  {
    id: 'duck-preset-s3-parquet-read',
    title: 'DuckDB: Анализ гигантского Parquet файла из S3',
    description: 'Прямой SQL выбор с фильтрацией и агрегацией по удаленному Parquet файлу.',
    dialect: 'DuckDB',
    sql: `SELECT 
    passenger_count,
    COUNT(*) AS trip_count,
    ROUND(AVG(trip_distance), 2) AS avg_distance,
    ROUND(AVG(total_amount), 2) AS avg_fare
FROM read_parquet('https://d37ci6vzurychx.cloudfront.net/trip-data/yellow_tripdata_2024-01.parquet')
WHERE trip_distance > 0
GROUP BY passenger_count
ORDER BY trip_count DESC;`
  },
  {
    id: 'duck-preset-pivot-sales-data',
    title: 'DuckDB: Встроенный свернутый отчет (PIVOT)',
    description: 'Лаконичный родной PIVOT синтаксис DuckDB без длинных CASE WHEN блоков.',
    dialect: 'DuckDB',
    sql: `PIVOT regional_sales
ON product_category
USING SUM(revenue)
GROUP BY sales_year, country_code;`
  },
  {
    id: 'duck-preset-columns-regexp',
    title: 'DuckDB: Массовое умножение всех колонок продажи (COLUMNS)',
    description: 'Мощный регулярочный селектор COLUMNS("^sales_.*") для групповых трансформаций.',
    dialect: 'DuckDB',
    sql: `SELECT 
    store_id,
    COLUMNS('^sales_.*') * 1.20 AS boosted_sales,
    COLUMNS('date|time')
FROM monthly_financial_summary;`
  },
  {
    id: 'duck-preset-exclude-replace-cols',
    title: 'DuckDB: Исключение секретных колонок через EXCLUDE и REPLACE',
    description: 'Выгрузка большинства колонок с параллельной модификацией отдельных полей.',
    dialect: 'DuckDB',
    sql: `SELECT 
    * EXCLUDE (user_password_hash, api_token),
    REPLACE (LOWER(user_email) AS user_email)
FROM client_accounts_database;`
  },
  {
    id: 'duck-preset-filter-aggs',
    title: 'DuckDB: Выборка метрик с предложением FILTER',
    description: 'Несколько обособленных агрегатов в одной строке вывода.',
    dialect: 'DuckDB',
    sql: `SELECT 
    seller_id,
    SUM(order_value) FILTER (WHERE status = 'DELIVERED') AS net_sales,
    SUM(order_value) FILTER (WHERE status = 'CANCELLED') AS cancelled_sales,
    COUNT(*) FILTER (WHERE delivery_days > 5) AS delayed_orders_count
FROM merchant_orders
GROUP BY seller_id;`
  },
  {
    id: 'duck-preset-export-zstd-parquet',
    title: 'DuckDB: Быстрый экспорт выборки в Parquet ZSTD',
    description: 'Сохранение обработанного отчета в файл на диске одной командой COPY.',
    dialect: 'DuckDB',
    sql: `COPY (
    SELECT 
        customer_id, 
        COUNT(id) AS total_orders, 
        SUM(amount) AS ltv
    FROM orders
    GROUP BY customer_id
) TO 'customer_ltv_report.parquet' (FORMAT PARQUET, COMPRESSION ZSTD);`
  },
  {
    id: 'duck-preset-generate-series-days',
    title: 'DuckDB: Генератор календарных дней для тайм-серий',
    description: 'Формирование временных рядов помощью встроенной generate_series.',
    dialect: 'DuckDB',
    sql: `SELECT 
    day::DATE AS calendar_date,
    dayname(day) AS day_name,
    is_weekend(day) AS weekend_flag
FROM generate_series(DATE '2025-01-01', DATE '2025-01-31', INTERVAL '1 day') AS t(day);`
  },
  {
    id: 'duck-preset-read-json-autodetect',
    title: 'DuckDB: Прямое сканирование всех NDJSON архивов',
    description: 'Чтение сжатых текстовых логов с автовыводом схемы данных.',
    dialect: 'DuckDB',
    sql: `SELECT 
    timestamp,
    user.id AS user_id,
    event_name
FROM read_json_auto('./logs/*.json.gz', format='newline_delimited');`
  },
  {
    id: 'duck-preset-asof-join-trades',
    title: 'DuckDB: Финансовое слияние ASOF JOIN котировок',
    description: 'Привязка каждой сделки к ближайшей цене предложения на момент времени.',
    dialect: 'DuckDB',
    sql: `SELECT 
    t.trade_id,
    t.execution_time,
    q.quote_time,
    t.volume,
    q.bid_price
FROM stock_trades t
ASOF JOIN market_quotes q 
  ON t.ticker = q.ticker 
 AND t.execution_time >= q.quote_time;`
  },
  {
    id: 'duck-preset-summarize-profile',
    title: 'DuckDB: Быстрая статистика и профилирование файла',
    description: 'Команда SUMMARIZE для вывода типов, пропусков и квантилей всей таблицы.',
    dialect: 'DuckDB',
    sql: `SUMMARIZE SELECT * FROM read_parquet('dataset.parquet');`
  }
];
