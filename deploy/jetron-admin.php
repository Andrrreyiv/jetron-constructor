<?php
/**
 * Plugin Name: Jetron Constructor Admin
 * Description: Страница настроек конструктора формы: цены нанесений, размерные сетки, шрифты, модели и цвета. Пишет constructor/admin.json.
 * Version: 1.0.0
 *
 * Устанавливать как mu-plugin: wp-content/mu-plugins/jetron-admin.php (автозагрузка без активации).
 * Зеркалит подход jetron-zones.php: проверка прав администратора + nonce, валидация структуры,
 * запись JSON рядом с конструктором. Конструктор читает admin.json поверх базового конфига
 * (src/js/core/AdminOverrides.js), битый раздел там игнорируется и стенд не падает.
 *
 * Цена САМОГО ИЗДЕЛИЯ здесь НЕ настраивается — она приходит из карточки товара WooCommerce
 * (jetron-zones.php, экшен jetron_prices). Здесь только цены нанесений.
 */

if (!defined('ABSPATH')) {
    exit;
}

const JETRON_ADMIN_NONCE = 'jetron_admin';

/** Путь к admin.json — рядом с конструктором. */
function jetron_admin_file_path() {
    return ABSPATH . 'constructor/admin.json';
}

/** Каталоги для загрузки файлов конструктора. */
function jetron_admin_dir($sub) {
    return ABSPATH . 'constructor/assets/' . $sub . '/';
}

/** Текущие настройки (пустой массив, если файла ещё нет или он битый). */
function jetron_admin_load() {
    $path = jetron_admin_file_path();
    if (!file_exists($path)) {
        return array();
    }
    $data = json_decode(file_get_contents($path), true);
    return is_array($data) ? $data : array();
}

/** Запись admin.json. Возвращает число байт или false. */
function jetron_admin_save($data) {
    // Пустой массив PHP кодируется как [], а конструктор ждёт объект. Работает и так (разделы
    // проверяются поштучно), но [] сбивает с толку при отладке — приводим к {} явно.
    $json = wp_json_encode(empty($data) ? new stdClass() : $data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    return file_put_contents(jetron_admin_file_path(), $json, LOCK_EX);
}

/** Неотрицательное число или null. Пустая строка = «не задано», а не ноль. */
function jetron_admin_num($v) {
    if ($v === null || $v === '') {
        return null;
    }
    $v = str_replace(',', '.', (string) $v);
    if (!is_numeric($v)) {
        return null;
    }
    $n = (float) $v;
    return $n >= 0 ? $n : null;
}

/** Безопасное имя файла: латиница/цифры/дефис + расширение из белого списка. */
function jetron_admin_safe_name($name, $allowed) {
    $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
    if (!in_array($ext, $allowed, true)) {
        return null;
    }
    $base = pathinfo($name, PATHINFO_FILENAME);
    $base = sanitize_title($base);          // кириллица → транслит, пробелы → дефисы
    if ($base === '') {
        $base = 'file-' . substr(md5($name . microtime()), 0, 6);
    }
    return $base . '.' . $ext;
}

/**
 * Приём загруженного файла в constructor/assets/<sub>/.
 * Возвращает относительный путь для конфига (assets/<sub>/имя) или null.
 */
function jetron_admin_upload($field, $sub, $allowed, $max_mb = 8, $must_be_image = false) {
    if (empty($_FILES[$field]['name']) || !is_uploaded_file($_FILES[$field]['tmp_name'])) {
        return null;
    }
    // Тяжёлый файл тормозит конструктор у покупателя, поэтому режем на входе с понятным текстом.
    if ($_FILES[$field]['size'] > $max_mb * 1024 * 1024) {
        return array('error' => 'Файл больше ' . $max_mb . ' МБ. Сожмите его и попробуйте снова.');
    }
    // Расширения мало: под видом .png может прийти что угодно. Для фото проверяем, что это картинка.
    if ($must_be_image && !@getimagesize($_FILES[$field]['tmp_name'])) {
        return array('error' => 'Это не изображение. Нужен PNG, JPG или WebP.');
    }
    $name = jetron_admin_safe_name($_FILES[$field]['name'], $allowed);
    if ($name === null) {
        return array('error' => 'Формат файла не подходит. Разрешены: ' . implode(', ', $allowed) . '.');
    }
    $dir = jetron_admin_dir($sub);
    if (!is_dir($dir)) {
        wp_mkdir_p($dir);
    }
    // Не затираем чужой файл: при совпадении имени добавляем короткий суффикс.
    if (file_exists($dir . $name)) {
        $ext  = pathinfo($name, PATHINFO_EXTENSION);
        $base = pathinfo($name, PATHINFO_FILENAME);
        $name = $base . '-' . substr(md5(microtime()), 0, 4) . '.' . $ext;
    }
    if (!move_uploaded_file($_FILES[$field]['tmp_name'], $dir . $name)) {
        return null;
    }
    return 'assets/' . $sub . '/' . $name;
}

/** Разбор таблицы размеров из textarea: первая строка — заголовки, дальше строки через ; или таб. */
function jetron_admin_parse_grid($title, $text) {
    $lines = preg_split('/\r\n|\r|\n/', trim((string) $text));
    $lines = array_values(array_filter($lines, function ($l) { return trim($l) !== ''; }));
    if (count($lines) < 2) {
        return null; // нужна хотя бы шапка и одна строка
    }
    $split = function ($line) {
        $parts = preg_split('/\t|;/', $line);
        return array_values(array_map('trim', $parts));
    };
    $columns = $split(array_shift($lines));
    $rows = array();
    foreach ($lines as $line) {
        $cells = $split($line);
        if (count($cells)) {
            $rows[] = $cells;
        }
    }
    if (!count($columns) || !count($rows)) {
        return null;
    }
    // Строка с другим числом ячеек развалила бы таблицу у покупателя, а заметил бы это уже он.
    // Поэтому не сохраняем молча, а возвращаем номер проблемной строки для понятного сообщения.
    foreach ($rows as $i => $cells) {
        if (count($cells) !== count($columns)) {
            return array('error' => sprintf(
                'Строка %d: %d значений, а в заголовке %d. Проверьте точки с запятой.',
                $i + 2, count($cells), count($columns)
            ));
        }
    }
    return array('title' => (string) $title, 'columns' => $columns, 'rows' => $rows);
}

/** Обратно в текст для textarea. */
function jetron_admin_grid_text($grid) {
    if (!is_array($grid) || empty($grid['columns'])) {
        return '';
    }
    $out = array(implode(' ; ', $grid['columns']));
    foreach ((array) ($grid['rows'] ?? array()) as $row) {
        $out[] = implode(' ; ', (array) $row);
    }
    return implode("\n", $out);
}

/** Пункт меню в админке. */
add_action('admin_menu', function () {
    add_menu_page(
        'Конструктор формы',
        'Конструктор формы',
        'manage_options',
        'jetron-constructor',
        'jetron_admin_page',
        'dashicons-art',
        58
    );
});

/** Обработка отправленной формы. Возвращает текст уведомления. */
function jetron_admin_handle_post() {
    if (empty($_POST['jetron_admin_action'])) {
        return null;
    }
    if (!current_user_can('manage_options')) {
        return array('error', 'Недостаточно прав.');
    }
    if (!isset($_POST['_wpnonce']) || !wp_verify_nonce($_POST['_wpnonce'], JETRON_ADMIN_NONCE)) {
        return array('error', 'Страница устарела, обновите её и повторите.');
    }

    $data   = jetron_admin_load();
    $action = sanitize_text_field(wp_unslash($_POST['jetron_admin_action']));

    if ($action === 'prices') {
        $placement = array();
        foreach ((array) ($_POST['placement'] ?? array()) as $key => $value) {
            $num = jetron_admin_num(wp_unslash($value));
            if ($num !== null) {
                $placement[sanitize_key($key)] = $num;
            }
        }
        $prices = array('placement' => $placement);
        $gaiters = jetron_admin_num(wp_unslash($_POST['gaiters'] ?? ''));
        if ($gaiters !== null) {
            $prices['gaiters'] = $gaiters;
        }
        $discounts = array();
        foreach ((array) ($_POST['discounts'] ?? array()) as $key => $value) {
            $num = jetron_admin_num(wp_unslash($value));
            if ($num !== null) {
                // Проценты в интерфейсе задаются числом 0..100, в конфиге хранится доля.
                $discounts[sanitize_key($key)] = (strpos($key, 'bulk') === 0) ? $num : $num / 100;
            }
        }
        $prices['discounts'] = $discounts;
        $data['prices'] = $prices;
        return jetron_admin_save($data) === false
            ? array('error', 'Не удалось записать настройки.')
            : array('ok', 'Цены нанесений сохранены.');
    }

    if ($action === 'sizes') {
        $sizes = array();
        foreach (array('child' => 'Детские размеры', 'adult' => 'Взрослые размеры') as $key => $default) {
            $title = sanitize_text_field(wp_unslash($_POST['title_' . $key] ?? $default));
            $grid  = jetron_admin_parse_grid($title, wp_unslash($_POST['grid_' . $key] ?? ''));
            if (is_array($grid) && isset($grid['error'])) {
                return array('error', ($key === 'child' ? 'Детская таблица. ' : 'Взрослая таблица. ') . $grid['error']);
            }
            if ($grid !== null) {
                $sizes[$key] = $grid;
            }
        }
        if (!count($sizes)) {
            return array('error', 'Таблица пуста или заполнена неверно. Нужна строка заголовков и хотя бы одна строка размеров.');
        }
        $data['sizes'] = $sizes;
        return jetron_admin_save($data) === false
            ? array('error', 'Не удалось записать настройки.')
            : array('ok', 'Размерные сетки сохранены.');
    }

    if ($action === 'font_add') {
        $file = jetron_admin_upload('font_file', 'fonts', array('ttf', 'otf', 'woff', 'woff2'), 5);
        if (is_array($file)) {
            return array('error', $file['error']);
        }
        if ($file === null) {
            return array('error', 'Выберите файл шрифта: .ttf, .otf, .woff или .woff2.');
        }
        $name = sanitize_text_field(wp_unslash($_POST['font_name'] ?? ''));
        if ($name === '') {
            $name = pathinfo($file, PATHINFO_FILENAME);
        }
        $fonts = isset($data['fonts']) && is_array($data['fonts']) ? $data['fonts'] : jetron_admin_base_fonts();
        $fonts[] = array(
            'id'       => sanitize_key(pathinfo($file, PATHINFO_FILENAME)) . '-' . substr(md5($file), 0, 4),
            'name'     => $name,
            'file'     => $file,
            'cyrillic' => !empty($_POST['font_cyrillic']),
        );
        $data['fonts'] = $fonts;
        return jetron_admin_save($data) === false
            ? array('error', 'Не удалось записать настройки.')
            : array('ok', 'Шрифт «' . $name . '» добавлен.');
    }

    if ($action === 'font_del') {
        $id = sanitize_text_field(wp_unslash($_POST['font_id'] ?? ''));
        $fonts = isset($data['fonts']) && is_array($data['fonts']) ? $data['fonts'] : jetron_admin_base_fonts();
        $data['fonts'] = array_values(array_filter($fonts, function ($f) use ($id) {
            return ($f['id'] ?? '') !== $id;
        }));
        return jetron_admin_save($data) === false
            ? array('error', 'Не удалось записать настройки.')
            : array('ok', 'Шрифт удалён.');
    }
    return jetron_admin_handle_models($data, $action);
}

/** Обработка вкладки «Модели и цвета». */
function jetron_admin_handle_models($data, $action) {
    if ($action === 'model_add') {
        $front = jetron_admin_upload('img_front', 'mockups', array('png', 'jpg', 'jpeg', 'webp'), 8, true);
        if (is_array($front)) {
            return array('error', 'Фото спереди. ' . $front['error']);
        }
        if ($front === null) {
            return array('error', 'Нужна фотография вида спереди (PNG, JPG или WebP).');
        }
        $back = jetron_admin_upload('img_back', 'mockups', array('png', 'jpg', 'jpeg', 'webp'), 8, true);
        if (is_array($back)) {
            return array('error', 'Фото сзади. ' . $back['error']);
        }
        if ($back === null) {
            $back = $front; // спина не обязательна: пока показываем тот же кадр
        }
        $line  = sanitize_text_field(wp_unslash($_POST['line'] ?? ''));
        $color = sanitize_text_field(wp_unslash($_POST['color_name'] ?? ''));
        $hex   = sanitize_hex_color(wp_unslash($_POST['color_hex'] ?? ''));
        if ($line === '' || $color === '' || !$hex) {
            return array('error', 'Заполните линейку, название цвета и выберите цвет.');
        }
        $color_id = sanitize_key(sanitize_title($color));
        if ($color_id === '') {
            $color_id = 'color-' . substr(md5($color), 0, 4);
        }
        $form_id = sanitize_title($line . '-' . $color);
        if ($form_id === '') {
            $form_id = 'model-' . substr(md5($line . $color), 0, 6);
        }

        // Цвет добавляем в палитру, если такого id ещё нет: иначе модель не с чем показать в фильтре.
        $colors = isset($data['colors']) && is_array($data['colors']) ? $data['colors'] : jetron_admin_base_colors();
        $has_color = false;
        foreach ($colors as $c) {
            if (($c['id'] ?? '') === $color_id) {
                $has_color = true;
                break;
            }
        }
        if (!$has_color) {
            $colors[] = array('id' => $color_id, 'name' => $color, 'hex' => $hex);
        }
        $data['colors'] = $colors;

        $entry = array(
            'id'       => $form_id,
            'line'     => $line,
            'colorId'  => $color_id,
            'color'    => $color,
            'colorHex' => $hex,
            'images'   => array('front' => $front, 'back' => $back, 'shoulder' => null),
        );
        // Такая пара «линейка + цвет» уже есть — это замена фотографий, а не второй такой же пункт каталога.
        $forms    = isset($data['forms']) && is_array($data['forms']) ? $data['forms'] : jetron_admin_base_forms();
        $replaced = false;
        foreach ($forms as &$f) {
            if (($f['id'] ?? '') === $form_id) {
                $f = $entry;
                $replaced = true;
            }
        }
        unset($f);
        if (!$replaced) {
            $forms[] = $entry;
        }
        $data['forms'] = $forms;
        return jetron_admin_save($data) === false
            ? array('error', 'Не удалось записать настройки.')
            : array('ok', 'Модель «' . $line . ' ' . $color . '» ' . ($replaced ? 'обновлена.' : 'добавлена.')
                . ' ВАЖНО: зоны нанесения пока общие — откройте редактор зон и поправьте рамки под это фото, иначе номер и фамилия сядут мимо.');
    }

    if ($action === 'model_del') {
        $id    = sanitize_text_field(wp_unslash($_POST['form_id'] ?? ''));
        $forms = isset($data['forms']) && is_array($data['forms']) ? $data['forms'] : jetron_admin_base_forms();
        $left  = array_values(array_filter($forms, function ($f) use ($id) {
            return ($f['id'] ?? '') !== $id;
        }));
        if (count($left) === count($forms)) {
            return array('error', 'Модель не найдена, обновите страницу и повторите.');
        }
        $data['forms'] = $left;
        // Цвет без единой модели убираем: иначе в палитре остаётся кружок, за которым ничего нет.
        $used = array();
        foreach ($left as $f) {
            $used[$f['colorId'] ?? ''] = true;
        }
        $colors = isset($data['colors']) && is_array($data['colors']) ? $data['colors'] : jetron_admin_base_colors();
        $data['colors'] = array_values(array_filter($colors, function ($c) use ($used) {
            return isset($used[$c['id'] ?? '']);
        }));
        return jetron_admin_save($data) === false
            ? array('error', 'Не удалось записать настройки.')
            : array('ok', 'Модель удалена из каталога.');
    }

    if ($action === 'reset') {
        $section = sanitize_key(wp_unslash($_POST['section'] ?? ''));
        // Каталог моделей и палитра цветов связаны, сбрасываем их только вместе.
        $keys = $section === 'forms' ? array('forms', 'colors') : array($section);
        $hit  = false;
        foreach ($keys as $k) {
            if ($k !== '' && isset($data[$k])) {
                unset($data[$k]);
                $hit = true;
            }
        }
        if (!$hit) {
            return array('ok', 'Раздел и так со значениями по умолчанию.');
        }
        return jetron_admin_save($data) === false
            ? array('error', 'Не удалось записать настройки.')
            : array('ok', 'Раздел сброшен к значениям по умолчанию.');
    }
    return null;
}

/** Модели, для которых зоны уже размечены в редакторе (ключи zones.json). */
function jetron_admin_mapped_forms() {
    $path = ABSPATH . 'constructor/zones.json';
    if (!file_exists($path)) {
        return array();
    }
    $data = json_decode(file_get_contents($path), true);
    return is_array($data) ? array_keys($data) : array();
}

/** Базовый конфиг конструктора — источник значений по умолчанию для полей формы. */
function jetron_admin_base_config() {
    static $cache = null;
    if ($cache !== null) {
        return $cache;
    }
    $path = ABSPATH . 'constructor/src/config/mock-config.json';
    $cache = file_exists($path) ? json_decode(file_get_contents($path), true) : array();
    if (!is_array($cache)) {
        $cache = array();
    }
    return $cache;
}

function jetron_admin_base_fonts() {
    $c = jetron_admin_base_config();
    return isset($c['fonts']) && is_array($c['fonts']) ? $c['fonts'] : array();
}
function jetron_admin_base_colors() {
    $c = jetron_admin_base_config();
    return isset($c['colors']) && is_array($c['colors']) ? $c['colors'] : array();
}
function jetron_admin_base_forms() {
    $c = jetron_admin_base_config();
    return isset($c['forms']) && is_array($c['forms']) ? $c['forms'] : array();
}

/** Текущее значение: из админки, иначе из базового конфига. */
function jetron_admin_value($data, $path, $default = '') {
    $cur = $data;
    foreach ($path as $key) {
        if (!is_array($cur) || !isset($cur[$key])) {
            $cur = null;
            break;
        }
        $cur = $cur[$key];
    }
    if ($cur !== null) {
        return $cur;
    }
    $base = jetron_admin_base_config();
    foreach ($path as $key) {
        if (!is_array($base) || !isset($base[$key])) {
            return $default;
        }
        $base = $base[$key];
    }
    return $base;
}

/** Отрисовка страницы настроек. */
function jetron_admin_page() {
    if (!current_user_can('manage_options')) {
        wp_die('Недостаточно прав.');
    }
    $notice = jetron_admin_handle_post();
    $data   = jetron_admin_load();
    $tab    = isset($_GET['tab']) ? sanitize_key($_GET['tab']) : 'prices';
    $tabs   = array(
        'prices' => 'Цены нанесений',
        'sizes'  => 'Размерные сетки',
        'fonts'  => 'Шрифты',
        'models' => 'Модели и цвета',
    );
    $base   = jetron_admin_base_config();
    $nonce  = wp_create_nonce(JETRON_ADMIN_NONCE);
    $url    = admin_url('admin.php?page=jetron-constructor');

    echo '<div class="wrap"><h1>Конструктор формы</h1>';
    echo '<p style="margin:6px 0 14px"><a class="button" href="' . esc_url(home_url('/constructor/')) . '" target="_blank">Открыть конструктор</a> '
       . '<a class="button" href="' . esc_url(home_url('/constructor/?zones=edit')) . '" target="_blank">Редактор зон</a></p>';
    echo '<p style="max-width:720px;color:#50575e">Здесь настраивается то, что видит покупатель в конструкторе. '
       . 'Цена самой формы сюда не входит: она берётся из карточки товара. '
       . 'Изменения появляются у покупателей после обновления страницы конструктора.</p>';

    if (is_array($notice)) {
        $cls = $notice[0] === 'ok' ? 'notice-success' : 'notice-error';
        echo '<div class="notice ' . esc_attr($cls) . ' is-dismissible"><p>' . esc_html($notice[1]) . '</p></div>';
    }
    if (!is_writable(dirname(jetron_admin_file_path()))) {
        echo '<div class="notice notice-error"><p>Папка constructor/ недоступна для записи. '
           . 'Настройки не сохранятся, нужна помощь хостинга.</p></div>';
    }

    echo '<h2 class="nav-tab-wrapper">';
    foreach ($tabs as $key => $label) {
        $active = $key === $tab ? ' nav-tab-active' : '';
        echo '<a class="nav-tab' . $active . '" href="' . esc_url($url . '&tab=' . $key) . '">' . esc_html($label) . '</a>';
    }
    echo '</h2><div style="max-width:900px;margin-top:18px">';

    if ($tab === 'prices') {
        jetron_admin_tab_prices($data, $base, $nonce);
    } elseif ($tab === 'sizes') {
        jetron_admin_tab_sizes($data, $nonce);
    } elseif ($tab === 'fonts') {
        jetron_admin_tab_fonts($data, $nonce);
    } else {
        jetron_admin_tab_models($data, $nonce);
    }
    echo '</div></div>';
}

// ВАЖНО: вызывать ТОЛЬКО после закрытия основной формы. Вложенные формы браузер не допускает —
// внутренний </form> закроет внешний, и в POST уйдёт action=reset вместо сохранения раздела.
function jetron_admin_reset_form($section, $nonce, $label) {
    echo '<form method="post" style="display:inline-block;margin-left:10px" '
       . 'onsubmit="return confirm(\'Сбросить раздел к значениям по умолчанию?\')">';
    echo '<input type="hidden" name="_wpnonce" value="' . esc_attr($nonce) . '">';
    echo '<input type="hidden" name="jetron_admin_action" value="reset">';
    echo '<input type="hidden" name="section" value="' . esc_attr($section) . '">';
    echo '<button type="submit" class="button-link" style="color:#b32d2e">' . esc_html($label) . '</button>';
    echo '</form>';
}

/** Вкладка «Цены нанесений». Подписи берём из placementOptions, чтобы совпадали с конструктором. */
function jetron_admin_tab_prices($data, $base, $nonce) {
    $labels = array();
    foreach ((array) ($base['placementOptions'] ?? array()) as $opt) {
        if (!empty($opt['id'])) {
            $labels[$opt['id']] = $opt['title'] ?? $opt['id'];
        }
    }
    $extra = array(
        'logo_under_number' => 'Логотип под номером (спина)',
        'shorts_number'     => 'Номер на шортах',
        'shorts_logo'       => 'Логотип на шортах',
    );
    $labels = array_merge($labels, $extra);
    // Показываем ОБЪЕДИНЕНИЕ базовых и сохранённых групп: иначе группа, появившаяся в базовом
    // конфиге позже, никогда не попала бы в форму (в admin.json её нет, а он перекрывает базу).
    $base_pl  = jetron_admin_base_config();
    $base_pl  = isset($base_pl['prices']['placement']) ? (array) $base_pl['prices']['placement'] : array();
    $saved_pl = isset($data['prices']['placement']) ? (array) $data['prices']['placement'] : array();
    $placement = array_merge($base_pl, $saved_pl);

    echo '<form method="post"><input type="hidden" name="_wpnonce" value="' . esc_attr($nonce) . '">';
    echo '<input type="hidden" name="jetron_admin_action" value="prices">';
    echo '<table class="form-table"><tbody>';
    foreach ($placement as $key => $value) {
        $label = $labels[$key] ?? $key;
        echo '<tr><th scope="row"><label for="pl-' . esc_attr($key) . '">' . esc_html($label) . '</label></th>';
        echo '<td><input type="number" min="0" step="10" id="pl-' . esc_attr($key) . '" '
           . 'name="placement[' . esc_attr($key) . ']" value="' . esc_attr($value) . '" class="small-text"> ₽</td></tr>';
    }
    echo '<tr><th scope="row"><label for="gaiters">Гетры</label></th><td>'
       . '<input type="number" min="0" step="10" id="gaiters" name="gaiters" value="'
       . esc_attr(jetron_admin_value($data, array('prices', 'gaiters'), 0)) . '" class="small-text"> ₽</td></tr>';

    $disc = jetron_admin_value($data, array('prices', 'discounts'), array());
    $pct = function ($v) { return round(((float) $v) * 100, 2); };
    echo '<tr><th scope="row">Скидка за логотип Джетрон на груди</th><td>'
       . '<input type="number" min="0" step="1" name="discounts[jetron_chest]" value="'
       . esc_attr($pct($disc['jetron_chest'] ?? 0)) . '" class="small-text"> %</td></tr>';
    echo '<tr><th scope="row">Скидка за логотип Джетрон на спине</th><td>'
       . '<input type="number" min="0" step="1" name="discounts[jetron_back]" value="'
       . esc_attr($pct($disc['jetron_back'] ?? 0)) . '" class="small-text"> %</td></tr>';
    echo '<tr><th scope="row">Малый логотип груди бесплатно от</th><td>'
       . '<input type="number" min="0" step="1" name="discounts[bulk_free_chest_logo_from]" value="'
       . esc_attr($disc['bulk_free_chest_logo_from'] ?? 0) . '" class="small-text"> комплектов</td></tr>';
    echo '</tbody></table>';
    submit_button('Сохранить цены', 'primary', 'submit', false);
    echo '</form>';
    jetron_admin_reset_form('prices', $nonce, 'Сбросить к значениям по умолчанию');
}

/** Вкладка «Размерные сетки». Таблица правится текстом: строка = размер, колонки через ; */
function jetron_admin_tab_sizes($data, $nonce) {
    echo '<form method="post"><input type="hidden" name="_wpnonce" value="' . esc_attr($nonce) . '">';
    echo '<input type="hidden" name="jetron_admin_action" value="sizes">';
    echo '<p style="color:#50575e">Первая строка — заголовки колонок, дальше по строке на размер. '
       . 'Значения разделяйте точкой с запятой.</p>';
    foreach (array('child' => 'Детская таблица', 'adult' => 'Взрослая таблица') as $key => $label) {
        $grid = jetron_admin_value($data, array('sizes', $key), array());
        echo '<h3>' . esc_html($label) . '</h3>';
        echo '<p><label>Заголовок для покупателя<br><input type="text" name="title_' . esc_attr($key) . '" '
           . 'value="' . esc_attr($grid['title'] ?? '') . '" class="regular-text"></label></p>';
        echo '<textarea name="grid_' . esc_attr($key) . '" rows="10" style="width:100%;font-family:Consolas,monospace">'
           . esc_textarea(jetron_admin_grid_text($grid)) . '</textarea>';
    }
    submit_button('Сохранить размеры', 'primary', 'submit', false);
    echo '</form>';
    jetron_admin_reset_form('sizes', $nonce, 'Сбросить к значениям по умолчанию');
}

/** Вкладка «Шрифты»: список с удалением + загрузка нового файла. */
function jetron_admin_tab_fonts($data, $nonce) {
    $fonts = jetron_admin_value($data, array('fonts'), array());
    echo '<h3>Установленные шрифты</h3><table class="widefat striped" style="max-width:760px"><thead><tr>'
       . '<th>Название</th><th>Файл</th><th>Кириллица</th><th></th></tr></thead><tbody>';
    foreach ((array) $fonts as $f) {
        echo '<tr><td>' . esc_html($f['name'] ?? '') . '</td>';
        echo '<td><code>' . esc_html($f['file'] ?? '') . '</code></td>';
        echo '<td>' . (!empty($f['cyrillic']) ? 'да' : 'нет') . '</td><td>';
        echo '<form method="post" onsubmit="return confirm(&quot;Убрать шрифт из списка?&quot;)">';
        echo '<input type="hidden" name="_wpnonce" value="' . esc_attr($nonce) . '">';
        echo '<input type="hidden" name="jetron_admin_action" value="font_del">';
        echo '<input type="hidden" name="font_id" value="' . esc_attr($f['id'] ?? '') . '">';
        echo '<button class="button-link" style="color:#b32d2e">убрать</button></form></td></tr>';
    }
    echo '</tbody></table>';

    echo '<h3 style="margin-top:26px">Добавить шрифт</h3>';
    echo '<form method="post" enctype="multipart/form-data">';
    echo '<input type="hidden" name="_wpnonce" value="' . esc_attr($nonce) . '">';
    echo '<input type="hidden" name="jetron_admin_action" value="font_add">';
    echo '<table class="form-table"><tbody>';
    echo '<tr><th scope="row"><label for="font_name">Название в списке</label></th>'
       . '<td><input type="text" id="font_name" name="font_name" class="regular-text" placeholder="например, РПЛ"></td></tr>';
    echo '<tr><th scope="row"><label for="font_file">Файл шрифта</label></th>'
       . '<td><input type="file" id="font_file" name="font_file" accept=".ttf,.otf,.woff,.woff2" required>'
       . '<p class="description">Форматы: TTF, OTF, WOFF, WOFF2.</p></td></tr>';
    echo '<tr><th scope="row">Кириллица</th><td><label>'
       . '<input type="checkbox" name="font_cyrillic" value="1" checked> шрифт поддерживает русские буквы</label>'
       . '<p class="description">Если снять галочку, фамилия по-русски может отображаться квадратами.</p></td></tr>';
    echo '</tbody></table>';
    submit_button('Загрузить шрифт', 'primary', 'submit', false);
    echo '</form>';
    jetron_admin_reset_form('fonts', $nonce, 'Вернуть исходный список');
}

/** Вкладка «Модели и цвета»: каталог с удалением + добавление новой модели. */
function jetron_admin_tab_models($data, $nonce) {
    $forms = jetron_admin_value($data, array('forms'), array());
    $editor = home_url('/constructor/?zones=edit');

    echo '<h3>Каталог моделей <span style="font-weight:400;color:#50575e">(' . count((array) $forms) . ')</span></h3>';
    $mapped = jetron_admin_mapped_forms();
    echo '<table class="widefat striped" style="max-width:900px"><thead><tr>'
       . '<th style="width:90px">Фото</th><th>Линейка</th><th>Цвет</th><th>Зоны нанесения</th><th></th></tr></thead><tbody>';
    foreach ((array) $forms as $f) {
        $img = home_url('/constructor/' . ($f['images']['front'] ?? ''));
        echo '<tr><td><img src="' . esc_url($img) . '" alt="" style="width:70px;height:70px;object-fit:contain"></td>';
        echo '<td>' . esc_html($f['line'] ?? '') . '</td>';
        echo '<td><span style="display:inline-block;width:14px;height:14px;border-radius:3px;border:1px solid #ccc;'
           . 'vertical-align:middle;background:' . esc_attr($f['colorHex'] ?? '#fff') . '"></span> '
           . esc_html($f['color'] ?? '') . '</td>';
        // Новая модель наследует ОБЩИЕ зоны: если их не поправить, номер и фамилия сядут мимо.
        $is_mapped = in_array(($f['id'] ?? ''), $mapped, true);
        // Ссылка ведёт сразу на ЭТУ модель: редактор читает параметр form и открывает её.
        $mark_url = add_query_arg('form', ($f['id'] ?? ''), home_url('/constructor/?zones=edit'));
        echo '<td>' . ($is_mapped
            ? '<span style="color:#1a7f37">размечены</span><br><a href="' . esc_url($mark_url) . '" target="_blank">поправить</a>'
            : '<span style="color:#bd5d00">не размечены</span><br><a href="' . esc_url($mark_url) . '" target="_blank">разметить</a>')
           . '</td><td>';
        echo '<form method="post" onsubmit="return confirm(&quot;Убрать модель из каталога? Вернуть можно кнопкой внизу страницы.&quot;)">';
        echo '<input type="hidden" name="_wpnonce" value="' . esc_attr($nonce) . '">';
        echo '<input type="hidden" name="jetron_admin_action" value="model_del">';
        echo '<input type="hidden" name="form_id" value="' . esc_attr($f['id'] ?? '') . '">';
        echo '<button class="button-link" style="color:#b32d2e">убрать</button></form></td></tr>';
    }
    echo '</tbody></table>';

    echo '<h3 style="margin-top:26px">Добавить модель</h3>';
    echo '<form method="post" enctype="multipart/form-data">';
    echo '<input type="hidden" name="_wpnonce" value="' . esc_attr($nonce) . '">';
    echo '<input type="hidden" name="jetron_admin_action" value="model_add">';
    echo '<table class="form-table"><tbody>';
    $lines = array();
    foreach ((array) $forms as $f) {
        if (!empty($f['line'])) { $lines[$f['line']] = true; }
    }
    echo '<datalist id="jetron-lines">';
    foreach (array_keys($lines) as $l) { echo '<option value="' . esc_attr($l) . '">'; }
    echo '</datalist>';
    echo '<tr><th scope="row"><label for="line">Линейка</label></th>'
       . '<td><input type="text" id="line" name="line" list="jetron-lines" class="regular-text" placeholder="например, Champion" required>'
       . '<p class="description">Начните печатать: существующие линейки подскажутся. Новое название создаст новую линейку.</p></td></tr>';
    echo '<tr><th scope="row"><label for="color_name">Название цвета</label></th>'
       . '<td><input type="text" id="color_name" name="color_name" class="regular-text" placeholder="например, Бирюзовый" required></td></tr>';
    echo '<tr><th scope="row"><label for="color_hex">Цвет кружка в фильтре</label></th>'
       . '<td><input type="color" id="color_hex" name="color_hex" value="#1f5fd6"></td></tr>';
    echo '<tr><th scope="row"><label for="img_front">Фото спереди</label></th>'
       . '<td><input type="file" id="img_front" name="img_front" accept=".png,.jpg,.jpeg,.webp" required>'
       . '<p class="description">До 8 МБ. Лучше квадратное фото на однотонном фоне, как у текущих моделей.</p></td></tr>';
    echo '<tr><th scope="row"><label for="img_back">Фото сзади</label></th>'
       . '<td><input type="file" id="img_back" name="img_back" accept=".png,.jpg,.jpeg,.webp">'
       . '<p class="description">Не обязательно. Если не загрузить, для спины возьмётся тот же кадр.</p></td></tr>';
    echo '</tbody></table>';
    submit_button('Добавить модель', 'primary', 'submit', false);
    echo '</form>';
    echo '<p style="margin-top:18px;color:#50575e">После добавления разметьте зоны нанесения: '
       . '<a href="' . esc_url($editor) . '" target="_blank">открыть редактор зон</a>. '
       . 'Выберите там новую модель, расставьте рамки и нажмите «Сохранить».</p>';
    jetron_admin_reset_form('forms', $nonce, 'Вернуть исходный каталог моделей и цветов');
}
