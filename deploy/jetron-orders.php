<?php
/**
 * Plugin Name: Jetron — касса и журнал заказов конструктора
 * Description: Пересчитывает цену комплекта НА СЕРВЕРЕ и записывает заказы конструктора в журнал.
 * Version: 1.0.0
 *
 * Зачем отдельный файл. Плагин jetron-constructor.php создаёт скрытый товар с фиксированной
 * ценой JETRON_FIXED_PRICE и кладёт присланное браузером число в мету «Расчёт конструктора».
 * Цену корзины при этом не переопределяет никто: покупатель с полным нанесением платил столько
 * же, сколько за голую форму. Здесь это закрывается, но БЕЗ правок рабочего файла — цепляемся
 * к тем же хукам следующим приоритетом. Откат = удалить этот файл, поведение вернётся к прежнему.
 *
 * Главное правило: присланное браузером число (jetron_total) НИКОГДА не становится ценой.
 * Оно сохраняется рядом только для сверки. Цена считается заново из проверенной спецификации
 * по тем же источникам, что и у конструктора: mock-config.json + admin.json + карточки товаров.
 */

if (!defined('ABSPATH')) { exit; }

if (!defined('JETRON_ORDERS_DB_VERSION')) { define('JETRON_ORDERS_DB_VERSION', '1'); }
/** Разумные границы цены за комплект. Выход за них = считаем расчёт несостоявшимся. */
if (!defined('JETRON_ORDERS_MIN_UNIT')) { define('JETRON_ORDERS_MIN_UNIT', 100); }
if (!defined('JETRON_ORDERS_MAX_UNIT')) { define('JETRON_ORDERS_MAX_UNIT', 1000000); }

/* -------------------------------------------------------------------------
 * Разбор и проверка спецификации
 * ---------------------------------------------------------------------- */

/**
 * Нормализация названий — ровно как в CatalogPrices.js (norm): написание модели и цвета
 * в каталоге и в конфиге расходится («Жёлтый»/«Желтый», регистр, двойные пробелы).
 * Разойдись эти две реализации — цена молча свалится на запасную, и никто не заметит.
 */
function jetron_orders_norm($v) {
    $v = trim((string) $v);
    $v = function_exists('mb_strtolower') ? mb_strtolower($v, 'UTF-8') : strtolower($v);
    $v = str_replace(array("\xd1\x91", "\xd0\x81"), "\xd0\xb5", $v); // ё, Ё → е
    return preg_replace('/\s+/u', ' ', $v);
}

/**
 * Спецификация из POST → проверенный массив, либо null.
 * Всё, что пришло от браузера, здесь либо приводится к строгому типу, либо отбрасывается.
 */
function jetron_orders_parse($raw) {
    if (!is_string($raw) || $raw === '' || strlen($raw) > 8192) { return null; }
    $data = json_decode($raw, true, 8);
    if (!is_array($data)) { return null; }

    $age = isset($data['age']) ? (string) $data['age'] : '';
    if ($age !== 'adult' && $age !== 'child') { return null; } // единственные две группы каталога

    $cut = function ($v) {
        $v = sanitize_text_field((string) $v);
        return function_exists('mb_substr') ? mb_substr($v, 0, 100) : substr($v, 0, 100);
    };

    // Группы нанесений. Список от браузера, поэтому: только известные ключи, без повторов,
    // с потолком по количеству — чтобы подставленный массив на 10 000 элементов ничего не подвесил.
    $groups = array();
    if (isset($data['groups']) && is_array($data['groups'])) {
        foreach (array_slice($data['groups'], 0, 40) as $g) {
            $key = sanitize_key((string) $g);
            if ($key !== '' && !in_array($key, $groups, true)) { $groups[] = $key; }
        }
    }

    return array(
        'age'     => $age,
        'model'   => $cut(isset($data['model']) ? $data['model'] : ''),
        'color'   => $cut(isset($data['color']) ? $data['color'] : ''),
        'size'    => $cut(isset($data['size']) ? $data['size'] : ''),
        'groups'  => $groups,
        'gaiters' => !empty($data['gaiters']),
        'jchest'  => !empty($data['jetron']['chest']),
        'jback'   => !empty($data['jetron']['back']),
    );
}

/* -------------------------------------------------------------------------
 * Прайс: те же источники, что и у конструктора
 * ---------------------------------------------------------------------- */

/** Действующий прайс: база из mock-config.json, поверх — правки владельца из admin.json. */
function jetron_orders_prices() {
    $base = function_exists('jetron_admin_base_config') ? jetron_admin_base_config() : array();
    $prices = isset($base['prices']) && is_array($base['prices']) ? $base['prices'] : array();

    $saved = function_exists('jetron_admin_load') ? jetron_admin_load() : array();
    $saved = isset($saved['prices']) && is_array($saved['prices']) ? $saved['prices'] : array();

    foreach (array('form', 'placement', 'discounts') as $section) {
        if (isset($saved[$section]) && is_array($saved[$section])) {
            $prices[$section] = array_merge(
                isset($prices[$section]) && is_array($prices[$section]) ? $prices[$section] : array(),
                $saved[$section]
            );
        }
    }
    foreach (array('gaiters', 'baseFee') as $scalar) {
        if (isset($saved[$scalar]) && is_numeric($saved[$scalar])) { $prices[$scalar] = $saved[$scalar]; }
    }
    return $prices;
}

/**
 * Собственные цены зон из конфига: группа → максимальная цена зоны этой группы.
 * Нужны как запасной вариант — ровно как в PriceCalculator.js, где отсутствующая в прайсе
 * группа тарифицируется по цене самой зоны. Источник — конфиг на сервере, не браузер:
 * иначе цену нанесения можно было бы прислать своей.
 */
function jetron_orders_zone_prices() {
    static $cache = null;
    if ($cache !== null) { return $cache; }

    $cache = array();
    $base = function_exists('jetron_admin_base_config') ? jetron_admin_base_config() : array();

    $collect = function ($zones) use (&$cache) {
        foreach ((array) $zones as $z) {
            if (!is_array($z)) { continue; }
            $group = !empty($z['priceGroup']) ? $z['priceGroup'] : (isset($z['key']) ? $z['key'] : '');
            $group = sanitize_key((string) $group);
            if ($group === '') { continue; }
            $price = isset($z['price']) ? (float) $z['price'] : 0.0;
            if (!isset($cache[$group]) || $price > $cache[$group]) { $cache[$group] = $price; }
        }
    };

    $collect(isset($base['zoneTemplate']) ? $base['zoneTemplate'] : array());
    foreach ((array) (isset($base['zoneSets']) ? $base['zoneSets'] : array()) as $set) { $collect($set); }
    foreach ((array) (isset($base['forms']) ? $base['forms'] : array()) as $form) {
        if (isset($form['zones'])) { $collect($form['zones']); }
    }
    return $cache;
}

/** Цена изделия из карточки товара по линейке/цвету/возрасту. 0 = позиции нет. */
function jetron_orders_catalog_price($model, $color, $age) {
    if (!function_exists('jetron_catalog_prices')) { return 0.0; }
    $want = jetron_orders_norm($age) . '|' . jetron_orders_norm($model) . '|' . jetron_orders_norm($color);
    foreach ((array) jetron_catalog_prices() as $item) {
        if (empty($item['model']) || empty($item['color'])) { continue; }
        $key = jetron_orders_norm(isset($item['age']) ? $item['age'] : '') . '|'
             . jetron_orders_norm($item['model']) . '|' . jetron_orders_norm($item['color']);
        if ($key === $want) {
            $price = (float) $item['price'];
            return $price > 0 ? $price : 0.0;
        }
    }
    return 0.0;
}

/**
 * Цена за ОДИН комплект. Повторяет calculatePrice() из PriceCalculator.js.
 * $quantity нужен только для правила «логотип на груди бесплатно от N комплектов» —
 * умножение на количество делает сама WooCommerce, здесь его быть не должно.
 * Возвращает массив с разбором расчёта либо null, если посчитать не удалось.
 */
function jetron_orders_calc($order, $quantity) {
    $prices = jetron_orders_prices();
    if (empty($prices['form']) || !is_array($prices['form'])) { return null; }

    // Цена изделия: карточка товара — источник правды, прайс конфига — запасной (клиент 27.07).
    $form = jetron_orders_catalog_price($order['model'], $order['color'], $order['age']);
    $from_catalog = $form > 0;
    if (!$from_catalog) {
        $fallback = isset($prices['form'][$order['age']]) ? (float) $prices['form'][$order['age']] : 0.0;
        if ($fallback <= 0) { return null; }
        $form = $fallback;
    }

    $table = isset($prices['placement']) && is_array($prices['placement']) ? $prices['placement'] : array();
    $disc  = isset($prices['discounts']) && is_array($prices['discounts']) ? $prices['discounts'] : array();
    $bulk_from = isset($disc['bulk_free_chest_logo_from']) ? (int) $disc['bulk_free_chest_logo_from'] : 0;

    // Каждая ценовая группа тарифицируется один раз (ТЗ §5). Цена — из прайса, иначе собственная
    // цена зоны из конфига. Выдуманная группа не найдётся ни там, ни там и будет стоить 0,
    // то есть подстановкой лишних ключей заказ не удешевить.
    $zone_prices = jetron_orders_zone_prices();
    $placement_total = 0.0;
    $charged = array();
    foreach ($order['groups'] as $group) {
        if (isset($table[$group])) {
            $group_price = (float) $table[$group];
        } elseif (isset($zone_prices[$group])) {
            $group_price = (float) $zone_prices[$group];
        } else {
            continue; // группы нет ни в прайсе, ни среди зон — считать нечего
        }
        $free = ($bulk_from > 0 && $quantity >= $bulk_from && $group === 'chest_logo_small');
        $sum = $free ? 0.0 : $group_price;
        $placement_total += $sum;
        $charged[$group] = $free ? 'бесплатно (опт)' : $sum;
    }

    $gaiters = $order['gaiters'] && isset($prices['gaiters']) ? (float) $prices['gaiters'] : 0.0;
    $base_fee = isset($prices['baseFee']) ? (float) $prices['baseFee'] : 0.0;

    $pct = 0.0;
    if ($order['jchest'] && isset($disc['jetron_chest'])) { $pct += (float) $disc['jetron_chest']; }
    if ($order['jback']  && isset($disc['jetron_back']))  { $pct += (float) $disc['jetron_back']; }
    if ($pct < 0) { $pct = 0.0; }
    if ($pct > 0.9) { $pct = 0.9; } // потолок скидки: битый admin.json не должен обнулять заказ

    $unit = round(($form + $placement_total + $gaiters + $base_fee) * (1 - $pct));

    if ($unit < JETRON_ORDERS_MIN_UNIT || $unit > JETRON_ORDERS_MAX_UNIT) { return null; }

    return array(
        'unit'         => $unit,
        'form'         => $form,
        'from_catalog' => $from_catalog,
        'placement'    => $placement_total,
        'charged'      => $charged,
        'gaiters'      => $gaiters,
        'base_fee'     => $base_fee,
        'discount_pct' => $pct,
    );
}

/* -------------------------------------------------------------------------
 * Корзина
 * ---------------------------------------------------------------------- */

/** Спецификация попадает в корзину рядом с данными основного плагина (тот работает на 10). */
add_filter('woocommerce_add_cart_item_data', 'jetron_orders_capture', 20, 2);
function jetron_orders_capture($cart_item_data, $product_id) {
    $target = (int) get_option('jetron_wc_product', 0);
    if (!$target || (int) $product_id !== $target) { return $cart_item_data; }
    if (!isset($_POST['jetron_order'])) { return $cart_item_data; } // старая вкладка из кеша — прежнее поведение

    $order = jetron_orders_parse(wp_unslash($_POST['jetron_order']));
    if ($order) { $cart_item_data['jetron_order'] = $order; }
    return $cart_item_data;
}

/** Собственно касса: цена позиции = пересчёт сервера. */
add_action('woocommerce_before_calculate_totals', 'jetron_orders_apply_price', 20, 1);
function jetron_orders_apply_price($cart) {
    if (!$cart || !is_object($cart) || !method_exists($cart, 'get_cart')) { return; }
    if (is_admin() && !defined('DOING_AJAX')) { return; }

    foreach ($cart->get_cart() as $item) {
        if (empty($item['jetron_order']) || empty($item['data'])) { continue; }
        // Количество берём из корзины, а не из POST: покупатель мог изменить его после добавления,
        // а от количества зависит бесплатный логотип на груди.
        $qty = isset($item['quantity']) ? max(1, (int) $item['quantity']) : 1;
        $calc = jetron_orders_calc($item['jetron_order'], $qty);
        // Посчитать не удалось — цену не трогаем: остаётся прежняя, поведение как до плагина.
        if ($calc) { $item['data']->set_price($calc['unit']); }
    }
}

/** Строка в заказе: что именно сервер посчитал. Рядом с присланным числом видно расхождение. */
add_action('woocommerce_checkout_create_order_line_item', 'jetron_orders_line_meta', 20, 4);
function jetron_orders_line_meta($item, $cart_item_key, $values, $order) {
    if (empty($values['jetron_order'])) { return; }
    $qty = isset($values['quantity']) ? max(1, (int) $values['quantity']) : 1;
    $calc = jetron_orders_calc($values['jetron_order'], $qty);
    if (!$calc) { return; }

    $spec = $values['jetron_order'];
    $item->add_meta_data('Расчёт сервера, ₽ за комплект', (int) $calc['unit']);
    $item->add_meta_data('Проверено сервером', jetron_orders_summary($spec, $calc));

    try {
        jetron_orders_log_write($spec, $calc, $qty, $order, $values);
    } catch (Exception $e) {
        // Журнал не должен ронять оформление заказа.
    }
}

/** Человекочитаемый разбор расчёта — владельцу видно, за что списаны деньги. */
function jetron_orders_summary($spec, $calc) {
    $parts = array();
    $parts[] = 'Изделие: ' . $spec['model'] . ' / ' . $spec['color']
             . ' / ' . ($spec['age'] === 'child' ? 'детская' : 'взрослая')
             . ($spec['size'] !== '' ? ' / размер ' . $spec['size'] : '');
    $parts[] = 'Цена изделия: ' . (int) $calc['form'] . ' ₽ ('
             . ($calc['from_catalog'] ? 'карточка товара' : 'прайс конфига, позиция не найдена') . ')';
    if ($calc['charged']) {
        $bits = array();
        foreach ($calc['charged'] as $group => $sum) {
            $bits[] = $group . ': ' . (is_string($sum) ? $sum : (int) $sum . ' ₽');
        }
        $parts[] = 'Нанесение: ' . implode(', ', $bits);
    }
    if ($calc['gaiters'] > 0)      { $parts[] = 'Гетры: ' . (int) $calc['gaiters'] . ' ₽'; }
    if ($calc['base_fee'] > 0)     { $parts[] = 'Сбор: ' . (int) $calc['base_fee'] . ' ₽'; }
    if ($calc['discount_pct'] > 0) { $parts[] = 'Скидка: ' . round($calc['discount_pct'] * 100) . '%'; }
    return implode("\n", $parts);
}

/* -------------------------------------------------------------------------
 * Журнал заказов
 * ---------------------------------------------------------------------- */

function jetron_orders_table() {
    global $wpdb;
    return $wpdb->prefix . 'jetron_orders';
}

/** Таблица создаётся один раз; проверка по опции, чтобы не гонять dbDelta на каждый запрос. */
add_action('init', 'jetron_orders_install', 5);
function jetron_orders_install() {
    if (get_option('jetron_orders_db') === JETRON_ORDERS_DB_VERSION) { return; }
    global $wpdb;
    $table = jetron_orders_table();
    $charset = $wpdb->get_charset_collate();
    $sql = "CREATE TABLE $table (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        created_at DATETIME NOT NULL,
        order_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
        model VARCHAR(100) NOT NULL DEFAULT '',
        color VARCHAR(100) NOT NULL DEFAULT '',
        age VARCHAR(10) NOT NULL DEFAULT '',
        size VARCHAR(100) NOT NULL DEFAULT '',
        quantity INT NOT NULL DEFAULT 1,
        unit_server INT NOT NULL DEFAULT 0,
        unit_client INT NOT NULL DEFAULT 0,
        mismatch TINYINT(1) NOT NULL DEFAULT 0,
        spec LONGTEXT NULL,
        PRIMARY KEY (id),
        KEY order_id (order_id),
        KEY created_at (created_at)
    ) $charset;";
    require_once ABSPATH . 'wp-admin/includes/upgrade.php';
    dbDelta($sql);
    update_option('jetron_orders_db', JETRON_ORDERS_DB_VERSION, false);
}

function jetron_orders_log_write($spec, $calc, $qty, $order, $values) {
    global $wpdb;
    // Присланное браузером число сохраняем ТОЛЬКО ради сверки: систематическое расхождение
    // означает либо рассинхрон прайсов, либо подмену на стороне покупателя.
    $client = isset($values['jetron_total']) ? (int) $values['jetron_total'] : 0;
    $server_grand = (int) $calc['unit'] * $qty;

    $wpdb->insert(jetron_orders_table(), array(
        'created_at'  => current_time('mysql'),
        'order_id'    => $order && method_exists($order, 'get_id') ? (int) $order->get_id() : 0,
        'model'       => $spec['model'],
        'color'       => $spec['color'],
        'age'         => $spec['age'],
        'size'        => $spec['size'],
        'quantity'    => $qty,
        'unit_server' => (int) $calc['unit'],
        'unit_client' => $client > 0 ? (int) round($client / max(1, $qty)) : 0,
        'mismatch'    => ($client > 0 && abs($client - $server_grand) > 1) ? 1 : 0,
        'spec'        => wp_json_encode($spec, JSON_UNESCAPED_UNICODE),
    ), array('%s', '%d', '%s', '%s', '%s', '%s', '%d', '%d', '%d', '%d', '%s'));
}

/* -------------------------------------------------------------------------
 * Страница журнала в админке
 * ---------------------------------------------------------------------- */

add_action('admin_menu', function () {
    add_submenu_page(
        'woocommerce',
        'Заказы конструктора',
        'Заказы конструктора',
        'manage_woocommerce',
        'jetron-orders',
        'jetron_orders_page'
    );
});

function jetron_orders_page() {
    if (!current_user_can('manage_woocommerce')) {
        wp_die('Недостаточно прав.');
    }
    global $wpdb;
    $table = jetron_orders_table();
    $rows = $wpdb->get_results("SELECT * FROM $table ORDER BY id DESC LIMIT 200");

    echo '<div class="wrap"><h1>Заказы конструктора формы</h1>';
    echo '<p>Последние 200 заказов. Столбец «Расхождение» отмечает случаи, когда сумма, '
       . 'показанная покупателю в браузере, не совпала с расчётом сервера. Деньги считаются '
       . 'по расчёту сервера — присланное браузером число ценой не становится.</p>';

    if (!$rows) {
        echo '<p><em>Пока пусто: заказов через конструктор ещё не было.</em></p></div>';
        return;
    }

    echo '<table class="widefat striped"><thead><tr>'
       . '<th>Дата</th><th>Заказ</th><th>Изделие</th><th>Размер</th><th>Кол-во</th>'
       . '<th>За комплект (сервер)</th><th>Итого</th><th>Расхождение</th>'
       . '</tr></thead><tbody>';
    foreach ($rows as $r) {
        $link = $r->order_id
            ? '<a href="' . esc_url(admin_url('post.php?post=' . (int) $r->order_id . '&action=edit')) . '">#'
              . (int) $r->order_id . '</a>'
            : '—';
        echo '<tr>'
           . '<td>' . esc_html(mysql2date('d.m.Y H:i', $r->created_at)) . '</td>'
           . '<td>' . $link . '</td>'
           . '<td>' . esc_html($r->model . ' / ' . $r->color . ' / ' . ($r->age === 'child' ? 'детская' : 'взрослая')) . '</td>'
           . '<td>' . esc_html($r->size) . '</td>'
           . '<td>' . (int) $r->quantity . '</td>'
           . '<td>' . number_format_i18n((int) $r->unit_server) . ' &#8381;</td>'
           . '<td>' . number_format_i18n((int) $r->unit_server * (int) $r->quantity) . ' &#8381;</td>'
           . '<td>' . ((int) $r->mismatch
                ? '<strong style="color:#b32d2e">да, ' . number_format_i18n((int) $r->unit_client) . ' &#8381;</strong>'
                : 'нет') . '</td>'
           . '</tr>';
    }
    echo '</tbody></table></div>';
}
