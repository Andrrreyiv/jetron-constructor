<?php
/**
 * Plugin Name: Jetron Zones Editor
 * Description: Сохраняет координаты зон нанесения конструктора в constructor/zones.json. Пишет только администратор.
 * Version: 1.0.0
 *
 * Устанавливать как mu-plugin: wp-content/mu-plugins/jetron-zones.php (автозагрузка без активации).
 * Зеркалит подход jetron-colors.php: фронт-редактор (?zones=edit) шлёт правки на admin-ajax,
 * плагин проверяет права + nonce, валидирует структуру и перезаписывает zones.json рядом с colors.json.
 */

if (!defined('ABSPATH')) {
    exit;
}

/** Путь к zones.json — рядом с конструктором (там же лежит colors.json). */
function jetron_zones_file_path() {
    return ABSPATH . 'constructor/zones.json';
}

/** Путь к crops.json — per-form кадрирование фона (Phase 2), рядом с zones.json. */
function jetron_crops_file_path() {
    return ABSPATH . 'constructor/crops.json';
}

/**
 * Санитайз + валидация структуры { formId: { key: {x,y,w,h — числа} } }.
 * Пропускаем только корректные числовые box, зажимаем каждое значение в [0,1].
 * При мусоре шлёт 400 и завершает запрос. Используется и зонами, и кадрами фона.
 */
function jetron_zones_sanitize($data) {
    if (!is_array($data)) {
        wp_send_json_error(array('message' => 'invalid json'), 400);
    }
    $clean = array();
    $clip = function ($v) { return max(0.0, min(1.0, (float) $v)); };
    foreach ($data as $form_id => $boxes) {
        if (!is_array($boxes)) {
            wp_send_json_error(array('message' => 'bad form ' . $form_id), 400);
        }
        $clean[$form_id] = array();
        foreach ($boxes as $key => $box) {
            if (!is_array($box)) {
                wp_send_json_error(array('message' => 'bad box ' . $key), 400);
            }
            foreach (array('x', 'y', 'w', 'h') as $k) {
                if (!isset($box[$k]) || !is_numeric($box[$k])) {
                    wp_send_json_error(array('message' => 'box ' . $key . ' нет ' . $k), 400);
                }
            }
            $clean[$form_id][$key] = array(
                'x' => $clip($box['x']),
                'y' => $clip($box['y']),
                'w' => $clip($box['w']),
                'h' => $clip($box['h']),
            );
        }
    }
    return $clean;
}

/**
 * Санитайз + валидация ПЛОСКОЙ структуры кадров фона { formId: {x,y,w,h — числа} }.
 * Один кадр на форму (без zoneKey), в отличие от зон. Зажимает каждое значение в [0,1].
 * При мусоре шлёт 400 и завершает запрос.
 */
function jetron_crops_sanitize($data) {
    if (!is_array($data)) {
        wp_send_json_error(array('message' => 'invalid json'), 400);
    }
    $clean = array();
    $clip = function ($v) { return max(0.0, min(1.0, (float) $v)); };
    foreach ($data as $form_id => $box) {
        if (!is_array($box)) {
            wp_send_json_error(array('message' => 'bad crop ' . $form_id), 400);
        }
        foreach (array('x', 'y', 'w', 'h') as $k) {
            if (!isset($box[$k]) || !is_numeric($box[$k])) {
                wp_send_json_error(array('message' => 'crop ' . $form_id . ' нет ' . $k), 400);
            }
        }
        $clean[$form_id] = array(
            'x' => $clip($box['x']),
            'y' => $clip($box['y']),
            'w' => $clip($box['w']),
            'h' => $clip($box['h']),
        );
    }
    return $clean;
}

/** Пишет чистую структуру в файл JSON-ом (PRETTY, без экранирования кириллицы/слэшей). Шлёт 500 при сбое. */
function jetron_zones_write($path, $clean, $label) {
    // serialize_precision на хостинге стоит 17, поэтому round($v, 4) уходил в файл как
    // 0.29999999999999998889776975... Значение верное, но файл распухает. -1 включает
    // кратчайшую запись, разбирающуюся обратно в то же число.
    $prev = @ini_get('serialize_precision');
    @ini_set('serialize_precision', '-1');
    $json  = wp_json_encode($clean, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($prev !== false) {
        @ini_set('serialize_precision', $prev);
    }
    $bytes = file_put_contents($path, $json, LOCK_EX);
    if ($bytes === false) {
        wp_send_json_error(array('message' => 'не удалось записать ' . $label), 500);
    }
    wp_send_json_success(array('bytes' => $bytes));
}

/**
 * Boot: отдаёт свежий nonce, но только администратору.
 * Фронт-редактор дергает это перед первым сохранением. Неадмин получает 403.
 */
add_action('wp_ajax_jetron_zones_boot', function () {
    if (!current_user_can('manage_options')) {
        wp_send_json_error(array('message' => 'forbidden'), 403);
    }
    wp_send_json_success(array('nonce' => wp_create_nonce('jetron_zones')));
});
// Незалогиненный пользователь: экшен есть, но прав нет.
add_action('wp_ajax_nopriv_jetron_zones_boot', function () {
    wp_send_json_error(array('message' => 'login required'), 401);
});

/**
 * Сохранение zones.json. Проверяем права администратора и nonce,
 * валидируем структуру { formId: { zoneKey: {x,y,w,h — числа} } }, затем перезаписываем файл.
 */
add_action('wp_ajax_jetron_save_zones', function () {
    if (!current_user_can('manage_options')) {
        wp_send_json_error(array('message' => 'forbidden'), 403);
    }
    if (!check_ajax_referer('jetron_zones', '_wpnonce', false)) {
        wp_send_json_error(array('message' => 'bad nonce'), 400);
    }
    $raw   = isset($_POST['zones']) ? wp_unslash($_POST['zones']) : '';
    $clean = jetron_zones_sanitize(json_decode($raw, true));
    jetron_zones_write(jetron_zones_file_path(), $clean, 'zones.json');
});
add_action('wp_ajax_nopriv_jetron_save_zones', function () {
    wp_send_json_error(array('message' => 'login required'), 401);
});

/**
 * Сохранение crops.json (Phase 2: per-form кадрирование фона). Та же защита прав + nonce,
 * но структура ПЛОСКАЯ { formId: {x,y,w,h} } (один кадр на форму), поэтому свой санитайз.
 */
add_action('wp_ajax_jetron_save_crops', function () {
    if (!current_user_can('manage_options')) {
        wp_send_json_error(array('message' => 'forbidden'), 403);
    }
    if (!check_ajax_referer('jetron_zones', '_wpnonce', false)) {
        wp_send_json_error(array('message' => 'bad nonce'), 400);
    }
    $raw   = isset($_POST['crops']) ? wp_unslash($_POST['crops']) : '';
    $clean = jetron_crops_sanitize(json_decode($raw, true));
    jetron_zones_write(jetron_crops_file_path(), $clean, 'crops.json');
});
add_action('wp_ajax_nopriv_jetron_save_crops', function () {
    wp_send_json_error(array('message' => 'login required'), 401);
});

/**
 * Таблица размеров модели из ACF-полей термина «Модель» (pa_model): клиент 31.07 на видео
 * показал, что уже сам ведёт её в админке WooCommerce — по КАЖДОЙ модели своя, с российским
 * размером у взрослой сетки. Источник правды, заменяет угадывание по группам линеек
 * (bug 30.07: Winner показывал сетку Star, см. docs/РАЗМЕРЫ-КОНФЛИКТ-2026-07-30.md).
 * Ключи полей сняты прямо с формы редактирования термина (pa_model, term 45 «Winner»):
 * взрослая — field_68640bb660a64 (Размер/Российский размер/Рост), детская — field_6864101160a6b
 * (Размер/Рост/Возраст). ACF на таксономию отдаёт объект term по $post_id вида "pa_model_<id>".
 */
function jetron_model_size_grid($term_id, $age) {
    if (!function_exists('get_field') || !$term_id) {
        return null;
    }
    $term_ref = 'pa_model_' . $term_id;
    if ($age === 'child') {
        $rows = get_field('field_6864101160a6b', $term_ref);
        $field_keys = array('field_6864101160a6d', 'field_6864101160a6e', 'field_6864102960a71');
        $title = 'Детские размеры';
        $columns = array('Размер на бирке', 'Рост, см', 'Возраст, лет');
    } else {
        $rows = get_field('field_68640bb660a64', $term_ref);
        $field_keys = array('field_68640bf060a65', 'field_6a170303804a7', 'field_68640f4a60a67');
        $title = 'Взрослые размеры';
        $columns = array('Размер на бирке', 'Российский размер', 'Рост, см');
    }
    if (!is_array($rows) || !count($rows)) {
        return null; // у модели нет своей сетки на этот возраст (например, взрослого Champion)
    }
    $out = array();
    foreach ($rows as $row) {
        if (!is_array($row)) {
            continue;
        }
        $line = array();
        foreach ($field_keys as $key) {
            $v = isset($row[$key]) ? $row[$key] : '';
            $line[] = is_object($v) && isset($v->name) ? $v->name : (is_array($v) ? '' : (string) $v);
        }
        if ($line[0] !== '') {
            $out[] = $line;
        }
    }
    if (!count($out)) {
        return null;
    }
    return array('title' => $title, 'columns' => $columns, 'rows' => $out);
}

/**
 * Цены изделий из карточек товаров (клиент 2026-07-27: «не подтягивается цена из карточки товара»).
 *
 * Отдаёт плоский список позиций каталога: атрибуты товара «Модель» и «Цвет» совпадают с line/color
 * формы конструктора, категория задаёт возрастную группу. Конструктор строит по нему индекс и берёт
 * цену изделия оттуда, а прайс в конфиге остаётся запасным (каталог недоступен — считаем по нему).
 *
 * Чтение публичных данных: цены и так видны в каталоге, поэтому без nonce и без прав, доступно и гостю.
 * Результат кешируем на 10 минут — иначе на каждый заход конструктора идёт тяжёлый обход каталога.
 */
function jetron_catalog_prices() {
    $cached = get_transient('jetron_catalog_prices');
    if (is_array($cached)) {
        return $cached;
    }
    if (!function_exists('wc_get_products')) {
        return array(); // WooCommerce отключён — конструктор просто останется на прайсе конфига.
    }
    // Категория → возрастная группа конструктора. Слаги совпадают с адресами каталога на сайте.
    $groups = array('vzroslaya-forma' => 'adult', 'detskaya-forma' => 'child');
    $items = array();
    $model_term_cache = array();
    $model_grid_cache = array();
    foreach ($groups as $slug => $age) {
        $products = wc_get_products(array(
            'status'   => 'publish',
            'limit'    => 200,
            'category' => array($slug),
        ));
        foreach ($products as $product) {
            $price = (float) $product->get_price();
            if ($price <= 0) {
                continue;
            }
            $model = '';
            $color = '';
            $sizes = array();
            // Ищем по ЛЕЙБЛУ атрибута, а не по слагу таксономии: слаг на сайте может быть любым.
            foreach ($product->get_attributes() as $attribute) {
                $label = wc_attribute_label($attribute->get_name());
                $values = $product->get_attribute($attribute->get_name());
                $first = trim(strtok((string) $values, ','));
                if ($first === '') {
                    continue;
                }
                if (mb_stripos($label, 'модель') !== false) {
                    $model = $first;
                } elseif (mb_stripos($label, 'цвет') !== false) {
                    $color = $first;
                } elseif (mb_stripos($label, 'размер') !== false) {
                    // Клиент 30.07: у линеек РАЗНЫЕ наборы размеров (New M…4XL, Star L…5XL),
                    // поэтому отдаём набор карточки, чтобы конструктор не предлагал лишние.
                    foreach (explode(',', (string) $values) as $one) {
                        $one = trim($one);
                        if ($one !== '' && !in_array($one, $sizes, true)) {
                            $sizes[] = $one;
                        }
                    }
                }
            }
            if ($model === '' || $color === '') {
                continue; // Без модели и цвета позицию не сопоставить с формой — пропускаем.
            }
            // Готовая сетка размеров этой модели+возраста из ACF (клиент 31.07, см. выше).
            $grid = null;
            if (!array_key_exists($model, $model_term_cache)) {
                $term = get_term_by('name', $model, 'pa_model');
                $model_term_cache[$model] = $term ? (int) $term->term_id : 0;
            }
            $term_id = $model_term_cache[$model];
            if ($term_id) {
                $grid_key = $term_id . '|' . $age;
                if (!array_key_exists($grid_key, $model_grid_cache)) {
                    $model_grid_cache[$grid_key] = jetron_model_size_grid($term_id, $age);
                }
                $grid = $model_grid_cache[$grid_key];
            }
            $items[] = array(
                'model'     => $model,
                'color'     => $color,
                'age'       => $age,
                'price'     => $price,
                'sizes'     => $sizes,
                'sizeGrid'  => $grid,
                'productId' => $product->get_id(),
            );
        }
    }
    set_transient('jetron_catalog_prices', $items, 10 * MINUTE_IN_SECONDS);
    return $items;
}

add_action('wp_ajax_jetron_prices', 'jetron_prices_respond');
add_action('wp_ajax_nopriv_jetron_prices', 'jetron_prices_respond');
function jetron_prices_respond() {
    wp_send_json_success(array('items' => jetron_catalog_prices()));
}
