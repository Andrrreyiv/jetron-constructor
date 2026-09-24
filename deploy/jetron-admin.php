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
    // serialize_precision на хостинге стоит 17, поэтому round($v, 4) уходил в файл как
    // 0.29999999999999998889776975... Значение верное, но файл распухает. -1 включает
    // кратчайшую запись, разбирающуюся обратно в то же число.
    $prev = @ini_get('serialize_precision');
    @ini_set('serialize_precision', '-1');
    $json = wp_json_encode(empty($data) ? new stdClass() : $data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($prev !== false) {
        @ini_set('serialize_precision', $prev);
    }
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
        $data['fonts'] = jetron_admin_sort_fonts($fonts);
        return jetron_admin_save($data) === false
            ? array('error', 'Не удалось записать настройки.')
            : array('ok', 'Шрифт «' . $name . '» добавлен.');
    }

    if ($action === 'font_del') {
        $id = sanitize_text_field(wp_unslash($_POST['font_id'] ?? ''));
        $fonts = isset($data['fonts']) && is_array($data['fonts']) ? $data['fonts'] : jetron_admin_base_fonts();
        $data['fonts'] = jetron_admin_sort_fonts(array_values(array_filter($fonts, function ($f) use ($id) {
            return ($f['id'] ?? '') !== $id;
        })));
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

    // Оттенок кружка у УЖЕ СУЩЕСТВУЮЩЕЙ расцветки. Через «Добавить модель» его не поменять:
    // там цвет пишется, только если id новый (см. $has_color ниже) — на это клиент и жаловался 07.09.
    if ($action === 'colors') {
        $colors  = isset($data['colors']) && is_array($data['colors']) ? $data['colors'] : jetron_admin_base_colors();
        $sent    = (array) ($_POST['hex'] ?? array());
        $changed = 0;
        foreach ($colors as &$c) {
            $id = $c['id'] ?? '';
            if ($id === '' || !isset($sent[$id]) || !is_scalar($sent[$id])) {
                continue;
            }
            $hex = sanitize_hex_color(wp_unslash($sent[$id]));
            if (!$hex) {
                continue;
            }
            // Сравнивать надо с тем, что человек ВИДЕЛ в поле, а не с записанным: с 09.09
            // конструктор берёт кружки из фильтра каталога, и форма показывает именно их.
            // Иначе нажатие «Сохранить цвета» без единой правки записало бы все 14 оттенков
            // как ручные и молча выключило бы привязку целиком.
            $site      = jetron_admin_site_hex($c['name'] ?? '');
            $effective = !empty($c['hexManual']) || $site === '' ? (string) ($c['hex'] ?? '') : $site;
            if (strtolower($hex) === strtolower($effective)) {
                continue;
            }
            $c['hex'] = $hex;
            // Метка «оттенок задан руками» — без неё ручная правка молча вернулась бы к значению
            // сайта, ровно та жалоба 07.09 («поменял салатовый, а квадратик не поменялся»),
            // только с другой стороны. Поставил ровно сайтовый оттенок — привязка включается назад.
            if ($site !== '' && strtolower($hex) === strtolower($site)) {
                unset($c['hexManual']);
            } else {
                $c['hexManual'] = true;
            }
            $changed++;
        }
        unset($c);
        if ($changed === 0) {
            return array('ok', 'Цвета не изменились.');
        }
        $data['colors'] = $colors;
        // Записи моделей хранят свой снимок оттенка. Правим его ТОЛЬКО если каталог уже переопределён:
        // иначе в admin.json лёг бы весь список форм, которого там не было.
        if (isset($data['forms']) && is_array($data['forms'])) {
            $by_id = array();
            foreach ($colors as $c2) {
                if (($c2['id'] ?? '') !== '' && !empty($c2['hex'])) {
                    $by_id[$c2['id']] = $c2['hex'];
                }
            }
            foreach ($data['forms'] as &$f) {
                $cid = $f['colorId'] ?? '';
                if ($cid !== '' && isset($by_id[$cid])) {
                    $f['colorHex'] = $by_id[$cid];
                }
            }
            unset($f);
        }
        return jetron_admin_save($data) === false
            ? array('error', 'Не удалось записать настройки.')
            : array('ok', 'Палитра обновлена, изменено кружков: ' . $changed
                . '. Покупатель увидит новый оттенок после обновления страницы конструктора.');
    }

    if ($action === 'model_move') {
        $id    = sanitize_text_field(wp_unslash($_POST['form_id'] ?? ''));
        $куда  = sanitize_key(wp_unslash($_POST['dir'] ?? ''));
        // Тот же запасной путь, что у удаления: если раздела в admin.json ещё нет, берём базовый
        // каталог целиком. Иначе перестановка записала бы список из одной модели.
        $forms = isset($data['forms']) && is_array($data['forms']) ? array_values($data['forms']) : jetron_admin_base_forms();
        $поз = null;
        foreach ($forms as $i => $f) {
            if (($f['id'] ?? '') === $id) {
                $поз = $i;
                break;
            }
        }
        if ($поз === null) {
            return array('error', 'Модель не найдена, обновите страницу и повторите.');
        }
        $новая = $поз;
        if ($куда === 'up') {
            $новая = $поз - 1;
        } elseif ($куда === 'down') {
            $новая = $поз + 1;
        } elseif ($куда === 'top') {
            $новая = 0;
        } else {
            return array('error', 'Непонятное направление.');
        }
        if ($новая < 0 || $новая >= count($forms) || $новая === $поз) {
            return array('ok', 'Модель уже на этом месте.');
        }
        // Вырезаем и вставляем: так одинаково работают и соседний шаг, и переход в начало.
        // ⚠️ Число моделей запоминаем ДО перестановки: сравнивать после бессмысленно, там
        // обе стороны уже одинаковые, и страховка молча превращается в пустую строку кода.
        $было  = count($forms);
        $кусок = array_splice($forms, $поз, 1);
        array_splice($forms, $новая, 0, $кусок);
        if (count($forms) !== $было) {
            return array('error', 'Перестановка не сошлась, каталог не тронут.');
        }
        $data['forms'] = array_values($forms);
        $первая = $data['forms'][0]['line'] ?? '';
        return jetron_admin_save($data) === false
            ? array('error', 'Не удалось записать настройки.')
            : array('ok', 'Порядок изменён. Первой открывается «' . $первая . '». Обновите страницу конструктора.');
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

    if ($action === 'view') {
        $sent = (array) ($_POST['view'] ?? array());
        $view = array();
        $плохие = array();
        foreach (jetron_admin_view_fields() as $f) {
            $raw = isset($sent[$f['key']]) && is_scalar($sent[$f['key']]) ? wp_unslash($sent[$f['key']]) : '';
            if (trim((string) $raw) === '') {
                continue; // пустое поле = «оставить как в вёрстке», а не «ноль»
            }
            $val = jetron_admin_view_value($f['type'], $raw);
            if ($val === null) {
                $плохие[] = $f['label'];
                continue;
            }
            $view[$f['key']] = $val;
        }
        // Говорим вслух, что именно не приняли: молчаливое отбрасывание читается как
        // «кнопка не работает», и следующим сообщением придёт жалоба.
        if ($плохие) {
            return array('error', 'Не приняты поля: ' . implode(', ', $плохие)
                . '. Цвет пишется как #ffffff или transparent, отступ — целое число от 0 до '
                . JETRON_VIEW_PAD_MAX . '.');
        }
        // Чекбокс приходит только когда включён, поэтому состояние берём из факта наличия.
        $view['cardShadow'] = !empty($sent['cardShadow']);
        $data['appearance'] = $view;
        return jetron_admin_save($data) === false
            ? array('error', 'Не удалось записать настройки.')
            : array('ok', 'Внешний вид сохранён. Обновите страницу конструктора, чтобы увидеть.');
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

/**
 * Сравнение названий шрифтов. Строки уже приведены к нижнему регистру.
 *
 * ☠️ **`strnatcasecmp` здесь НЕ годится: он пропускает пробелы.** Замер на живом списке
 * (43 шрифта, 24.09) показал два расхождения с конструктором: админка ставила
 * «Manchester City 23-24» впереди «Man City 24/25», а «BarcelonaLaliga-Regular» впереди
 * «Barcelona La Liga 2023 2024». У покупателя `localeCompare` пробел не выбрасывает
 * и даёт обратный порядок, то есть владелец и покупатель видели РАЗНЫЕ списки.
 *
 * Правило здесь повторяет `localeCompare(…, { numeric: true, sensitivity: 'base' })`:
 * пробелы и знаки — обычные символы (и, как более младшие коды, идут впереди букв),
 * а подряд идущие цифры сравниваются числом, поэтому «21/22» раньше «2021», а
 * «Brazil 2021» раньше «Brazil 2024». Байтовое сравнение годится и для кириллицы:
 * UTF-8 сохраняет порядок кодовых точек.
 */
function jetron_admin_font_cmp($x, $y) {
    $i = 0;
    $j = 0;
    $lx = strlen($x);
    $ly = strlen($y);
    while ($i < $lx && $j < $ly) {
        $цифраX = $x[$i] >= '0' && $x[$i] <= '9';
        $цифраY = $y[$j] >= '0' && $y[$j] <= '9';
        if ($цифраX && $цифраY) {
            $нx = $i;
            while ($i < $lx && $x[$i] >= '0' && $x[$i] <= '9') { $i++; }
            $нy = $j;
            while ($j < $ly && $y[$j] >= '0' && $y[$j] <= '9') { $j++; }
            // Ведущие нули не должны делать число «длиннее»: 007 и 7 это одно и то же.
            $чx = ltrim(substr($x, $нx, $i - $нx), '0');
            $чy = ltrim(substr($y, $нy, $j - $нy), '0');
            if (strlen($чx) !== strlen($чy)) { return strlen($чx) < strlen($чy) ? -1 : 1; }
            if ($чx !== $чy) { return $чx < $чy ? -1 : 1; }
            continue;
        }
        if ($x[$i] !== $y[$j]) { return ord($x[$i]) < ord($y[$j]) ? -1 : 1; }
        $i++;
        $j++;
    }
    if ($i >= $lx && $j >= $ly) { return 0; }
    return $i >= $lx ? -1 : 1;   // более короткая строка идёт первой
}

/**
 * Порядок шрифтов (клиент 24.09): русские первыми и в том порядке, в котором их завёл
 * владелец — «где кириллица да, их лучше бы не трогать»; клубные по алфавиту.
 * Сравнение натуральное, поэтому «Brazil 2021» идёт раньше «Brazil 2024», а добавленный
 * последним «AL Hilal» встаёт на своё место, а не в хвост.
 * ⚠️ Тот же порядок задаёт фронт (`упорядочитьШрифты` в AdminOverrides.js) — он и решает,
 * что видит покупатель. Здесь сортировка нужна, чтобы admin.json на диске совпадал с экраном.
 * ⚠️ Русские обязаны остаться первыми: запасной шрифт по умолчанию берётся как fonts[0].
 * ⚠️ Сверять порядок обязательно на ЖИВОМ списке: на составе из 25 шрифтов расхождение
 * с конструктором не проявлялось, а на боевых 43 вылезло сразу (см. jetron_admin_font_cmp).
 * Расходиться эти два порядка могут ещё на клубном шрифте с РУССКИМ названием при сборке
 * PHP без mbstring; на боевом mbstring есть (PHP 8.3.33, замер 24.09), таких имён тоже нет.
 */
function jetron_admin_sort_fonts($fonts) {
    if (!is_array($fonts)) {
        return $fonts;
    }
    $ru = array();
    $club = array();
    foreach ($fonts as $f) {
        if (!empty($f['cyrillic'])) {
            $ru[] = $f;
        } else {
            $club[] = $f;
        }
    }
    usort($club, function ($a, $b) {
        $x = (string) (is_array($a) && isset($a['name']) ? $a['name'] : '');
        $y = (string) (is_array($b) && isset($b['name']) ? $b['name'] : '');
        // Русское название идёт впереди латинского — так же, как localeCompare(…, 'ru')
        // у конструктора. Без этого правила «Зенит» оказался бы в конце списка в админке
        // и в начале у покупателя: два разных порядка на двух экранах.
        $кир = function ($s) { return (bool) preg_match('/[\xd0-\xd1]/', $s); };
        if ($кир($x) !== $кир($y)) { return $кир($x) ? -1 : 1; }
        // Регистр гасим mb_strtolower ради кириллицы; где mbstring не собран, латиницу
        // догасит strtolower — иначе «AL Hilal» встал бы впереди «Adventor».
        $x = function_exists('mb_strtolower') ? mb_strtolower($x, 'UTF-8') : strtolower($x);
        $y = function_exists('mb_strtolower') ? mb_strtolower($y, 'UTF-8') : strtolower($y);
        return jetron_admin_font_cmp($x, $y);
    });
    return array_values(array_merge($ru, $club));
}
function jetron_admin_base_colors() {
    $c = jetron_admin_base_config();
    return isset($c['colors']) && is_array($c['colors']) ? $c['colors'] : array();
}
function jetron_admin_base_forms() {
    $c = jetron_admin_base_config();
    return isset($c['forms']) && is_array($c['forms']) ? $c['forms'] : array();
}

/**
 * Оттенок кружка этой расцветки, взятый с самого сайта — поле «Цвет для иконки» у термина
 * «Цвет» (клиент 09.09: «привяжи автоматически»). Список отдаёт jetron-zones.php, он же
 * кормит им конструктор; здесь он нужен, чтобы форма показывала то же, что видит покупатель.
 * '' = функции нет (плагин зон выключен) или оттенок у расцветки не заведён.
 */
function jetron_admin_site_hex($name) {
    static $map = null;
    if ($map === null) {
        $map = array();
        if (function_exists('jetron_color_icons')) {
            foreach (jetron_color_icons() as $row) {
                if (isset($row['name'], $row['hex'])) {
                    $map[jetron_admin_color_key($row['name'])] = $row['hex'];
                }
            }
        }
    }
    $key = jetron_admin_color_key($name);
    return $key !== '' && isset($map[$key]) ? $map[$key] : '';
}

/** Ключ сравнения названий расцветок: регистр, лишние пробелы и ё/е не должны мешать. */
function jetron_admin_color_key($name) {
    $s = trim((string) $name);
    if ($s === '') {
        return '';
    }
    $s = function_exists('mb_strtolower') ? mb_strtolower($s, 'UTF-8') : strtolower($s);
    return str_replace('ё', 'е', $s);
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
        'view'   => 'Внешний вид',
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
    } elseif ($tab === 'view') {
        jetron_admin_tab_view($data, $nonce);
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
    // Показываем в том же порядке, в каком список уйдёт покупателю: русские сверху,
    // клубные по алфавиту (клиент 24.09). Данные при показе не переписываются — файл
    // нормализуется при ближайшем добавлении или удалении шрифта.
    $fonts = jetron_admin_sort_fonts(jetron_admin_value($data, array('fonts'), array()));
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
    // Оттенок берём из палитры: правится он там, а в записи модели лежит снимок на момент добавления.
    $colors = jetron_admin_value($data, array('colors'), array());
    if (!is_array($colors) || !$colors) {
        $colors = jetron_admin_base_colors();
    }
    $palette = array();
    foreach ((array) $colors as $c) {
        if (($c['id'] ?? '') !== '') {
            $palette[$c['id']] = $c['hex'] ?? '';
        }
    }

    echo '<h3>Каталог моделей <span style="font-weight:400;color:#50575e">(' . count((array) $forms) . ')</span></h3>';
    // Клиент 13.09: «а здесь можно делать сортировку, чтобы я мог менять местами… наверняка
    // пригодится». Порядок этого списка — это и порядок моделей у покупателя, и первая строка
    // открывается по умолчанию. Поводом стал Чемпион: он стоял первым, а взрослой у него нет
    // ни в одной расцветке, и кнопка «Взрослая» выглядела отсутствующей.
    echo '<p style="max-width:720px;color:#50575e">Порядок в таблице — это порядок моделей '
       . 'у покупателя. Самая верхняя открывается первой, когда он заходит в конструктор.</p>';
    $mapped = jetron_admin_mapped_forms();
    $список = array_values((array) $forms);
    $всего  = count($список);
    echo '<table class="widefat striped" style="max-width:900px"><thead><tr>'
       . '<th style="width:90px">Фото</th><th>Линейка</th><th>Цвет</th><th>Зоны нанесения</th>'
       . '<th style="width:120px">Порядок</th><th></th></tr></thead><tbody>';
    foreach ($список as $индекс => $f) {
        $img = home_url('/constructor/' . ($f['images']['front'] ?? ''));
        echo '<tr><td><img src="' . esc_url($img) . '" alt="" style="width:70px;height:70px;object-fit:contain"></td>';
        echo '<td>' . esc_html($f['line'] ?? '') . '</td>';
        $swatch = $palette[$f['colorId'] ?? ''] ?? '';
        if ($swatch === '') {
            $swatch = $f['colorHex'] ?? '#fff';
        }
        echo '<td><span style="display:inline-block;width:14px;height:14px;border-radius:3px;border:1px solid #ccc;'
           . 'vertical-align:middle;background:' . esc_attr($swatch) . '"></span> '
           . esc_html($f['color'] ?? '') . '</td>';
        // Новая модель наследует ОБЩИЕ зоны: если их не поправить, номер и фамилия сядут мимо.
        $is_mapped = in_array(($f['id'] ?? ''), $mapped, true);
        // Ссылка ведёт сразу на ЭТУ модель: редактор читает параметр form и открывает её.
        $mark_url = add_query_arg('form', ($f['id'] ?? ''), home_url('/constructor/?zones=edit'));
        echo '<td>' . ($is_mapped
            ? '<span style="color:#1a7f37">размечены</span><br><a href="' . esc_url($mark_url) . '" target="_blank">поправить</a>'
            : '<span style="color:#bd5d00">не размечены</span><br><a href="' . esc_url($mark_url) . '" target="_blank">разметить</a>')
           . '</td>';

        // Перестановка. Формы СОСЕДНИЕ, не вложенные: вложенный </form> закрыл бы внешний,
        // и в POST ушло бы чужое действие (та же грабля описана у кнопки сброса раздела).
        echo '<td>';
        $кнопка = function ($куда, $подпись, $титул, $выкл) use ($nonce, $f) {
            if ($выкл) {
                echo '<span style="display:inline-block;width:22px;text-align:center;color:#c3c4c7">' . $подпись . '</span>';
                return;
            }
            echo '<form method="post" style="display:inline">';
            echo '<input type="hidden" name="_wpnonce" value="' . esc_attr($nonce) . '">';
            echo '<input type="hidden" name="jetron_admin_action" value="model_move">';
            echo '<input type="hidden" name="form_id" value="' . esc_attr($f['id'] ?? '') . '">';
            echo '<input type="hidden" name="dir" value="' . esc_attr($куда) . '">';
            echo '<button class="button-link" title="' . esc_attr($титул) . '" '
               . 'style="display:inline-block;width:22px;text-align:center">' . $подпись . '</button>';
            echo '</form>';
        };
        $кнопка('up', '↑', 'Поднять на одну строку', $индекс === 0);
        $кнопка('down', '↓', 'Опустить на одну строку', $индекс === $всего - 1);
        $кнопка('top', 'в начало', 'Сделать первой: её покупатель увидит при входе', $индекс === 0);
        echo '</td><td>';
        echo '<form method="post" onsubmit="return confirm(&quot;Убрать модель из каталога? Вернуть можно кнопкой внизу страницы.&quot;)">';
        echo '<input type="hidden" name="_wpnonce" value="' . esc_attr($nonce) . '">';
        echo '<input type="hidden" name="jetron_admin_action" value="model_del">';
        echo '<input type="hidden" name="form_id" value="' . esc_attr($f['id'] ?? '') . '">';
        echo '<button class="button-link" style="color:#b32d2e">убрать</button></form></td></tr>';
    }
    echo '</tbody></table>';

    // Клиент 07.09: «поменял салатовый в админке, а квадратик не поменялся». Менять оттенок
    // существующей расцветки было негде — форма ниже заводит цвет только вместе с новой моделью.
    echo '<h3 style="margin-top:26px">Цвета кружков в фильтре</h3>';
    echo '<p class="description" style="max-width:900px">Это те кружки, по которым покупатель выбирает расцветку. '
       . 'Меняется только оттенок кружка: названия, модели и фотографии остаются как есть.<br>'
       . 'По умолчанию оттенок берётся с сайта — из поля «Цвет для иконки» у расцветки '
       . '(<em>Товары → Атрибуты → Цвет → Настроить термины</em>), чтобы кружок в конструкторе '
       . 'совпадал с кружком в фильтре каталога. Если поставить оттенок здесь, он станет '
       . 'сильнее сайта и больше меняться сам не будет — в столбце справа видно, где как. '
       . 'Чтобы вернуть расцветку на автоматический оттенок, поставьте ей ровно тот же цвет, '
       . 'что на сайте.</p>';
    echo '<form method="post">';
    echo '<input type="hidden" name="_wpnonce" value="' . esc_attr($nonce) . '">';
    echo '<input type="hidden" name="jetron_admin_action" value="colors">';
    echo '<table class="widefat striped" style="max-width:520px"><thead><tr>'
       . '<th>Название</th><th style="width:130px">Кружок</th><th>Откуда оттенок</th></tr></thead><tbody>';
    foreach ((array) $colors as $c) {
        $cid = $c['id'] ?? '';
        if ($cid === '') {
            continue;
        }
        // Показываем ДЕЙСТВУЮЩИЙ оттенок, тот же, что видит покупатель. Записанный показывать
        // нельзя: с 09.09 кружок берётся с сайта, и форма врала бы про цвет, а сохранение
        // без правок записало бы все 14 как ручные и выключило бы привязку.
        $site = jetron_admin_site_hex($c['name'] ?? '');
        $chex = sanitize_hex_color(!empty($c['hexManual']) || $site === '' ? ($c['hex'] ?? '') : $site);
        if (!$chex) {
            $chex = '#ffffff';
        }
        $src = !empty($c['hexManual'])
            ? 'задан здесь руками'
            : ($site !== '' ? 'с сайта, из фильтра каталога' : 'свой, на сайте не задан');
        echo '<tr><td>' . esc_html($c['name'] ?? $cid) . '</td>'
           . '<td><input type="color" name="hex[' . esc_attr($cid) . ']" value="' . esc_attr($chex) . '"></td>'
           . '<td class="description">' . esc_html($src) . '</td></tr>';
    }
    echo '</tbody></table>';
    submit_button('Сохранить цвета', 'primary', 'save_colors', false);
    echo '</form>';

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
    // Клиент 30.07: «чтобы цвет подтягивался, а не выбирать руками». На сайте у атрибута «Цвет»
    // хранится только название, оттенка там нет (проверено: у терминов pa_color нет ни hex,
    // ни свотч-меты). Поэтому берём цвет прямо с загружаемого фото: считаем самый частый
    // насыщенный оттенок изделия, игнорируя светлый фон и тени. Значение подставляется
    // ТОЛЬКО если админ ещё не трогал пикер вручную.
    echo '<script>(function(){
      var f=document.getElementById("img_front"), c=document.getElementById("color_hex");
      if(!f||!c) return;
      var touched=false; c.addEventListener("input",function(){touched=true;});
      f.addEventListener("change",function(){
        var file=f.files&&f.files[0]; if(!file||touched) return;
        var url=URL.createObjectURL(file), im=new Image();
        im.onload=function(){
          try{
            var n=140, cv=document.createElement("canvas"); cv.width=n; cv.height=n;
            var x=cv.getContext("2d"); x.drawImage(im,0,0,n,n);
            var d=x.getImageData(0,0,n,n).data, bins={}, best=null, bestN=0;
            for(var i=0;i<d.length;i+=4){
              var r=d[i],g=d[i+1],b=d[i+2],a=d[i+3];
              if(a<200) continue;
              var mx=Math.max(r,g,b), mn=Math.min(r,g,b);
              if(mx>238&&mx-mn<18) continue;      // белый фон
              if(mx<26) continue;                  // почти чёрный шум
              var k=(r>>4)+","+(g>>4)+","+(b>>4);
              var e=bins[k]||(bins[k]={n:0,r:0,g:0,b:0});
              e.n++; e.r+=r; e.g+=g; e.b+=b;
              if(e.n>bestN){bestN=e.n;best=e;}
            }
            if(best){
              var h=function(v){v=Math.round(v/best.n).toString(16);return v.length<2?"0"+v:v;};
              c.value="#"+h(best.r)+h(best.g)+h(best.b);
            }
          }catch(err){/* фото с другого домена или битое — оставляем ручной выбор */}
          URL.revokeObjectURL(url);
        };
        im.onerror=function(){URL.revokeObjectURL(url);};
        im.src=url;
      });
    })();</script>';
    submit_button('Добавить модель', 'primary', 'submit', false);
    echo '</form>';
    echo '<p style="margin-top:18px;color:#50575e">После добавления разметьте зоны нанесения: '
       . '<a href="' . esc_url($editor) . '" target="_blank">открыть редактор зон</a>. '
       . 'Выберите там новую модель, расставьте рамки и нажмите «Сохранить».</p>';
    jetron_admin_reset_form('forms', $nonce, 'Вернуть исходный каталог моделей и цветов');
}

/**
 * Поля раздела «Внешний вид».
 *
 * 🔴 Список ОБЯЗАН совпадать с `ПОЛЯ_ВИДА` в `src/js/core/Appearance.js`: там по нему значения
 * превращаются в CSS-переменные. Разъедутся — админ будет менять поле, которого покупатель
 * не увидит, и это не проявится ни ошибкой, ни тестом на стороне PHP.
 */
function jetron_admin_view_fields() {
    return array(
        array('key' => 'stageBg',     'type' => 'color', 'label' => 'Фон сцены',              'def' => '#ffffff',
              'hint' => 'Картинки формы нарисованы на белом листе. Пока фон белый, лист не видно и форма «висит».'),
        array('key' => 'stageBorder', 'type' => 'color', 'label' => 'Рамка сцены',            'def' => '#ece3d0',
              'hint' => 'Тонкая линия по краю всей панели с формой.'),
        array('key' => 'cardBg',      'type' => 'color', 'label' => 'Фон карточки формы',     'def' => 'transparent',
              'hint' => 'Подложка под самой формой. Прозрачная — форма лежит прямо на фоне сцены.'),
        array('key' => 'cardBorder',  'type' => 'color', 'label' => 'Рамка карточки формы',   'def' => 'transparent',
              'hint' => 'Рамка вокруг формы. Убрать нельзя, можно сделать прозрачной: её ширину держит вёрстка.'),
        array('key' => 'padTop',      'type' => 'px',    'label' => 'Отступ сверху, px',      'def' => 40,
              'hint' => 'Меньше — форма и кнопки поднимаются выше.'),
        array('key' => 'padSide',     'type' => 'px',    'label' => 'Отступы по бокам, px',   'def' => 32, 'hint' => ''),
        array('key' => 'padBottom',   'type' => 'px',    'label' => 'Отступ снизу, px',       'def' => 28, 'hint' => ''),
    );
}

/** Потолок отступа. Тот же, что `ПРЕДЕЛ_ОТСТУПА` в Appearance.js. */
const JETRON_VIEW_PAD_MAX = 200;

/**
 * Проверка значения поля. Правила повторяют Appearance.js один в один: цвет только `#rrggbb`
 * либо `transparent`, отступ — целое 0..200. Негодное возвращает null и НЕ сохраняется:
 * пустое поле означает «оставить как в вёрстке», а не «поставить ноль».
 * ⚠️ `sanitize_hex_color()` не годится: она пропускает и короткую запись `#fff`, которую
 * не примет проверка на стороне конструктора, и значение молча потерялось бы уже у покупателя.
 */
function jetron_admin_view_value($type, $raw) {
    $v = trim((string) $raw);
    if ($v === '') {
        return null;
    }
    if ($type === 'color') {
        if ($v === 'transparent') {
            return 'transparent';
        }
        return preg_match('/^#[0-9a-fA-F]{6}$/', $v) ? strtolower($v) : null;
    }
    if (!preg_match('/^\d{1,3}$/', $v)) {
        return null;
    }
    $n = (int) $v;
    return ($n >= 0 && $n <= JETRON_VIEW_PAD_MAX) ? $n : null;
}

/** Вкладка «Внешний вид»: фон, рамки и отступы сцены. */
function jetron_admin_tab_view($data, $nonce) {
    $view = jetron_admin_value($data, array('appearance'), array());
    if (!is_array($view)) {
        $view = array();
    }
    echo '<h3>Внешний вид конструктора</h3>';
    echo '<p style="max-width:720px;color:#50575e">Здесь настраивается панель с формой: фон, рамки '
       . 'и отступы. Пустое поле значит «оставить как есть» — тогда работает значение из вёрстки. '
       . 'Цвет пишется как <code>#ffffff</code> либо словом <code>transparent</code> (прозрачный). '
       . 'Отступ — целое число от 0 до ' . JETRON_VIEW_PAD_MAX . '.</p>';
    echo '<p style="max-width:720px;color:#50575e">⚠️ На телефоне отступы свои, вымеренные под узкий '
       . 'экран, и эта настройка их не трогает. После сохранения обновите страницу конструктора.</p>';

    echo '<form method="post">';
    echo '<input type="hidden" name="_wpnonce" value="' . esc_attr($nonce) . '">';
    echo '<input type="hidden" name="jetron_admin_action" value="view">';
    echo '<table class="form-table" role="presentation"><tbody>';
    foreach (jetron_admin_view_fields() as $f) {
        $cur = isset($view[$f['key']]) ? (string) $view[$f['key']] : '';
        echo '<tr><th scope="row"><label for="view_' . esc_attr($f['key']) . '">' . esc_html($f['label']) . '</label></th><td>';
        if ($f['type'] === 'color') {
            // Рядом с текстовым полем — нативный выбор цвета: им удобно тыкать, но он не умеет
            // «прозрачный», поэтому источником правды остаётся текстовое поле.
            echo '<input type="text" class="regular-text" id="view_' . esc_attr($f['key']) . '" name="view[' . esc_attr($f['key']) . ']" '
               . 'value="' . esc_attr($cur) . '" placeholder="' . esc_attr($f['def']) . '" style="max-width:180px">';
            echo ' <input type="color" value="' . esc_attr(preg_match('/^#[0-9a-fA-F]{6}$/', $cur) ? $cur : (is_string($f['def']) && $f['def'][0] === '#' ? $f['def'] : '#ffffff')) . '" '
               . 'oninput="document.getElementById(\'view_' . esc_js($f['key']) . '\').value=this.value" '
               . 'style="vertical-align:middle;width:42px;height:30px;padding:0;border:1px solid #8c8f94">';
            echo ' <button type="button" class="button-link" style="margin-left:8px" '
               . 'onclick="document.getElementById(\'view_' . esc_js($f['key']) . '\').value=\'transparent\'">прозрачный</button>';
        } else {
            echo '<input type="number" min="0" max="' . JETRON_VIEW_PAD_MAX . '" step="1" id="view_' . esc_attr($f['key']) . '" '
               . 'name="view[' . esc_attr($f['key']) . ']" value="' . esc_attr($cur) . '" '
               . 'placeholder="' . esc_attr((string) $f['def']) . '" style="width:100px">';
        }
        if ($f['hint'] !== '') {
            echo '<p class="description">' . esc_html($f['hint']) . '</p>';
        }
        echo '</td></tr>';
    }
    $shadow = isset($view['cardShadow']) ? (bool) $view['cardShadow'] : false;
    echo '<tr><th scope="row">Тень под формой</th><td>'
       . '<label><input type="checkbox" name="view[cardShadow]" value="1" ' . checked($shadow, true, false) . '> показывать</label>'
       . '<p class="description">При прозрачной карточке тень висит вокруг пустоты, поэтому по умолчанию выключена.</p>'
       . '</td></tr>';
    echo '</tbody></table>';
    submit_button('Сохранить внешний вид');
    echo '</form>';
    jetron_admin_reset_form('appearance', $nonce, 'Вернуть внешний вид по умолчанию');
}
