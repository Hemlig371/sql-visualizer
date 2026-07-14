export interface SQLPreset {
  id: string;
  title: string;
  description: string;
  dialect: 'PostgreSQL' | 'Oracle' | 'Clickhouse';
  sql: string;
}

export const sqlPresets: SQLPreset[] = [
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
    id: 'postgres-insert-select-monitoring',
    title: 'PostgreSQL: TRUNCATE & INSERT INTO ... SELECT (Аналитика мониторинга)',
    description: 'Реальный сложный аналитический скрипт пользователя, сочетающий быструю очистку TRUNCATE и последующий INSERT INTO без перечисления колонок, извлекающий данные из исходного отчета с приведением типов, округлением и форматированием.',
    dialect: 'PostgreSQL',
    sql: `truncate reports."Monitoring_v2";

insert into reports."Monitoring_v2"
SELECT
    "Профиль" as "Наименование",
    "Госпитализации, план" "План, госп",
    "Госпитализации, факт" "Факт, госп",
    to_char(round("Госпитализации, факт"::NUMERIC / "Госпитализации, план"::NUMERIC, 2)* 100, '9999%') "% госп",
    round("Сумма, план"::NUMERIC / 1000000, 4) "План, млн.руб",
    round("Сумма, факт"::NUMERIC / 1000000, 4) "Факт, млн.руб",
    to_char(round("Сумма, факт"::NUMERIC / "Сумма, план"::NUMERIC, 2)* 100, '9999%') "% млн.руб",
    round("Сумма, план"::NUMERIC / "Госпитализации, план"::NUMERIC, 2) AS "Ср. стоимость, план",
    round("Сумма, факт"::NUMERIC / "Госпитализации, факт"::NUMERIC, 2) AS "Ср. стоимость, факт",
    date_trunc('month',"Период")::date "Период"
FROM reports.raw_monitoring;`
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
  {
    id: 'empty-sandbox',
    title: 'Пустая песочница (Введите ваш SQL)',
    description: 'Абсолютно чистое рабочее пространство для ввода или вставки любого SQL-скрипта.',
    dialect: 'PostgreSQL',
    sql: ''
  }
];
