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
    $json  = wp_json_encode($clean, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
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
                }
            }
            if ($model === '' || $color === '') {
                continue; // Без модели и цвета позицию не сопоставить с формой — пропускаем.
            }
            $items[] = array(
                'model'     => $model,
                'color'     => $color,
                'age'       => $age,
                'price'     => $price,
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
