<?php
/**
 * Plugin Name: Jetron Constructor (WooCommerce bridge)
 * Description: Priem zakaza iz onlayn-konstruktora formy: odin tovar pod zakaz s fiksirovannoy tsenoy + maket (PNG) i spetsifikatsiya v zakaze. Stavitsya kak mu-plugin, yadro/temu ne trogaet.
 * Version: 1.0.0
 * Author: Jetron
 */

if (!defined('ABSPATH')) { exit; }

add_action('plugins_loaded', function () {
    if (!class_exists('WooCommerce')) { return; }

    if (!defined('JETRON_FIXED_PRICE'))   { define('JETRON_FIXED_PRICE', 1280); }
    if (!defined('JETRON_PRODUCT_TITLE')) { define('JETRON_PRODUCT_TITLE', "\xd0\x98\xd0\xbd\xd0\xb4\xd0\xb8\xd0\xb2\xd0\xb8\xd0\xb4\xd1\x83\xd0\xb0\xd0\xbb\xd1\x8c\xd0\xbd\xd0\xb0\xd1\x8f \xd1\x84\xd0\xbe\xd1\x80\xd0\xbc\xd0\xb0 (\xd0\xba\xd0\xbe\xd0\xbd\xd1\x81\xd1\x82\xd1\x80\xd1\x83\xd0\xba\xd1\x82\xd0\xbe\xd1\x80)"); }
    if (!defined('JETRON_UPLOAD_SUBDIR')) { define('JETRON_UPLOAD_SUBDIR', 'jetron-orders'); }

    add_action('init', 'jetron_ensure_product', 20);
    add_filter('woocommerce_add_cart_item_data', 'jetron_add_cart_item_data', 10, 2);
    add_filter('woocommerce_get_item_data', 'jetron_display_cart_item_data', 10, 2);
    add_filter('woocommerce_cart_item_thumbnail', 'jetron_cart_item_thumbnail', 10, 3);
    add_action('woocommerce_checkout_create_order_line_item', 'jetron_add_order_line_meta', 10, 4);
    add_filter('woocommerce_add_to_cart_validation', 'jetron_force_valid', 99, 3);
    add_filter('woocommerce_is_purchasable', 'jetron_force_purchasable', 99, 2);
});

function jetron_is_target($product_id) {
    $target = (int) get_option('jetron_wc_product', 0);
    return $target && (int) $product_id === $target;
}

function jetron_force_valid($passed, $product_id, $qty) {
    if (jetron_is_target($product_id)) { return true; }
    return $passed;
}

function jetron_force_purchasable($purchasable, $product) {
    if (is_object($product) && method_exists($product, 'get_id') && jetron_is_target($product->get_id())) {
        return true;
    }
    return $purchasable;
}

function jetron_ensure_product() {
    $pid = (int) get_option('jetron_wc_product', 0);
    $product = $pid ? wc_get_product($pid) : null;

    if (!$product || $product->get_status() === 'trash') {
        $product = new WC_Product_Simple();
        $product->set_name(JETRON_PRODUCT_TITLE);
        $product->set_status('publish');
        $product->set_catalog_visibility('hidden');
        $product->set_regular_price(JETRON_FIXED_PRICE);
        $product->set_price(JETRON_FIXED_PRICE);
        $product->set_virtual(false);
        $product->set_manage_stock(false);
        $pid = $product->save();
        update_option('jetron_wc_product', $pid);
    }

    $target = ABSPATH . 'constructor/woo.json';
    $payload = wp_json_encode(array(
        'productId' => (int) $pid,
        'siteUrl'   => untrailingslashit(home_url()),
        'price'     => (int) JETRON_FIXED_PRICE,
    ));
    $existing = @file_get_contents($target);
    if ($existing !== $payload && is_dir(dirname($target)) && is_writable(dirname($target))) {
        @file_put_contents($target, $payload);
    }
}

function jetron_add_cart_item_data($cart_item_data, $product_id) {
    $target = (int) get_option('jetron_wc_product', 0);
    if (!$target || (int) $product_id !== $target) { return $cart_item_data; }

    $uid = wp_generate_uuid4();
    $cart_item_data['jetron_uid'] = $uid;

    if (isset($_POST['jetron_spec'])) {
        $cart_item_data['jetron_spec'] = sanitize_textarea_field(wp_unslash($_POST['jetron_spec']));
    }
    if (isset($_POST['jetron_total'])) {
        $cart_item_data['jetron_total'] = (int) $_POST['jetron_total'];
    }
    if (!empty($_POST['jetron_png'])) {
        $saved = jetron_save_png_dataurl(wp_unslash($_POST['jetron_png']), $uid);
        if (!empty($saved['url']))   { $cart_item_data['jetron_png']   = $saved['url']; }
        if (!empty($saved['thumb'])) { $cart_item_data['jetron_thumb'] = $saved['thumb']; }
    }
    // Исходники логотипов покупателя — в медиатеку, их ID — в additional.logos.
    // Приёмник уже написан в теме (WC_Cart_Logo_Jetronsport): он сам пишет метки заказа
    // «Логотипов» и logos и рисует ссылки в админке. Нам остаётся только отдать ID.
    // Потолок 10 файлов — защита от мусорного POST, комплект столько нанесений не несёт.
    if (!empty($_POST['jetron_logos']) && is_array($_POST['jetron_logos'])) {
        $ids = array();
        foreach ((array) $_POST['jetron_logos'] as $dataurl) {
            if (count($ids) >= 10) { break; }
            $id = jetron_save_logo_attachment(wp_unslash($dataurl), $uid, count($ids) + 1);
            if ($id) { $ids[] = $id; }
        }
        if ($ids) { $cart_item_data['additional']['logos'] = $ids; }
    }
    return $cart_item_data;
}

// Логотип покупателя → вложение WordPress. Тема ждёт именно ID вложения
// (делает wp_get_attachment_url), поэтому файла на диске мало — нужна запись в медиатеке.
// Форматы те же, что принимает загрузчик конструктора, кроме svg: растр печатается как есть.
function jetron_save_logo_attachment($dataurl, $uid, $n) {
    if (!preg_match('#^data:image/(png|jpe?g|webp|gif);base64,#i', $dataurl, $m)) { return 0; }
    $tip  = strtolower($m[1]);
    $ext  = ($tip === 'jpeg' || $tip === 'jpg') ? 'jpg' : $tip;
    $mime = ($ext === 'jpg') ? 'image/jpeg' : 'image/' . $ext;

    $b64   = substr($dataurl, strpos($dataurl, ',') + 1);
    $bytes = base64_decode($b64, true);
    if ($bytes === false || strlen($bytes) < 32 || strlen($bytes) > 8 * 1024 * 1024) { return 0; }

    $up  = wp_upload_dir();
    $dir = trailingslashit($up['basedir']) . JETRON_UPLOAD_SUBDIR;
    if (!is_dir($dir)) { wp_mkdir_p($dir); }
    $base = 'jetron-logo-' . preg_replace('/[^a-z0-9]/i', '', $uid) . '-' . (int) $n;
    $path = trailingslashit($dir) . $base . '.' . $ext;
    if (file_put_contents($path, $bytes) === false) { return 0; }

    $url = trailingslashit($up['baseurl']) . JETRON_UPLOAD_SUBDIR . '/' . $base . '.' . $ext;
    $id  = wp_insert_attachment(array(
        'guid'           => $url,
        'post_mime_type' => $mime,
        'post_title'     => $base,
        'post_content'   => '',
        'post_status'    => 'inherit',
    ), $path, 0);
    if (is_wp_error($id) || !$id) { return 0; }

    require_once ABSPATH . 'wp-admin/includes/image.php';
    $meta = wp_generate_attachment_metadata($id, $path);
    if (!is_wp_error($meta) && $meta) { wp_update_attachment_metadata($id, $meta); }
    return (int) $id;
}

function jetron_save_png_dataurl($dataurl, $uid) {
    if (!preg_match('#^data:image/(png|jpe?g);base64,#i', $dataurl, $m)) { return array(); }
    $ext = strtolower($m[1]) === 'png' ? 'png' : 'jpg';
    $b64 = substr($dataurl, strpos($dataurl, ',') + 1);
    $bytes = base64_decode($b64, true);
    if ($bytes === false || strlen($bytes) < 32 || strlen($bytes) > 8 * 1024 * 1024) { return array(); }

    $up = wp_upload_dir();
    $dir = trailingslashit($up['basedir']) . JETRON_UPLOAD_SUBDIR;
    if (!is_dir($dir)) { wp_mkdir_p($dir); }
    $base = 'jetron-' . preg_replace('/[^a-z0-9]/i', '', $uid);
    $path = trailingslashit($dir) . $base . '.' . $ext;
    if (file_put_contents($path, $bytes) === false) { return array(); }

    $baseurl = trailingslashit($up['baseurl']) . JETRON_UPLOAD_SUBDIR . '/';
    return array(
        'url'   => $baseurl . $base . '.' . $ext,
        'thumb' => jetron_make_thumb($path, $dir, $baseurl, $base, $ext),
    );
}

// Макет весит до 8 МБ, а в корзине он показывается картинкой ~100 px. Уменьшенная копия
// делается один раз при добавлении в корзину; если редактор изображений в WP недоступен,
// возвращается пустая строка и корзина показывает полный файл.
function jetron_make_thumb($path, $dir, $baseurl, $base, $ext) {
    $editor = wp_get_image_editor($path);
    if (is_wp_error($editor)) { return ''; }
    $editor->resize(300, 300, false);
    $saved = $editor->save(trailingslashit($dir) . $base . '-thumb.' . $ext);
    if (is_wp_error($saved) || empty($saved['file'])) { return ''; }
    return $baseurl . basename($saved['file']);
}

// Кириллица здесь и ниже записана байтами \xNN намеренно: файл едет на боевой через elFinder,
// и литералы в нём уже один раз приезжали побитой кодировкой — отсюда прежний транслит.
function jetron_display_cart_item_data($item_data, $cart_item) {
    if (!empty($cart_item['jetron_spec'])) {
        $item_data[] = array(
            'key'   => "\xd0\x9a\xd0\xbe\xd0\xbd\xd1\x84\xd0\xb8\xd0\xb3\xd1\x83\xd1\x80\xd0\xb0\xd1\x86\xd0\xb8\xd1\x8f",
            'value' => nl2br(esc_html($cart_item['jetron_spec'])),
        );
    }
    if (!empty($cart_item['jetron_png'])) {
        $item_data[] = array(
            'key'   => "\xd0\x9c\xd0\xb0\xd0\xba\xd0\xb5\xd1\x82",
            'value' => '<a href="' . esc_url($cart_item['jetron_png']) . '" target="_blank" rel="noopener">'
                . "\xd0\xbe\xd1\x82\xd0\xba\xd1\x80\xd1\x8b\xd1\x82\xd1\x8c \xd0\xb8\xd0\xb7\xd0\xbe\xd0\xb1\xd1\x80\xd0\xb0\xd0\xb6\xd0\xb5\xd0\xbd\xd0\xb8\xd0\xb5"
                . '</a>',
        );
    }
    return $item_data;
}

// Картинка позиции в корзине: у товара-заглушки «Индивидуальная форма» изображения нет вовсе,
// поэтому покупатель видел пустое место. Показываем сам макет — он и есть то, что заказано.
function jetron_cart_item_thumbnail($thumbnail, $cart_item, $cart_item_key) {
    if (empty($cart_item['jetron_png'])) { return $thumbnail; }
    $src = !empty($cart_item['jetron_thumb']) ? $cart_item['jetron_thumb'] : $cart_item['jetron_png'];
    return '<img src="' . esc_url($src) . '" alt="'
        . esc_attr("\xd0\x9c\xd0\xb0\xd0\xba\xd0\xb5\xd1\x82 \xd0\xb7\xd0\xb0\xd0\xba\xd0\xb0\xd0\xb7\xd0\xb0")
        . '" class="attachment-woocommerce_thumbnail size-woocommerce_thumbnail" loading="lazy" />';
}

/**
 * Клиент 22.09: «по-прежнему не отображается картинка из конструктора в заказе».
 * Мета хранит URL, а WooCommerce печатает его текстом. Рисуем картинкой со ссылкой —
 * фильтр общий для админки и письма покупателю (оба идут через wc_display_item_meta).
 * ⚠️ Ловим и «Макет», и прежнее «Макет (PNG)»: у заказов до 22.09 имя со скобкой.
 */
add_filter('woocommerce_order_item_display_meta_value', 'jetron_order_meta_png', 20, 3);
function jetron_order_meta_png($value, $meta = null, $item = null) {
    $key = '';
    if (is_object($meta) && isset($meta->key)) { $key = (string) $meta->key; }
    elseif (is_array($meta) && isset($meta['key'])) { $key = (string) $meta['key']; }
    $макет = "\xd0\x9c\xd0\xb0\xd0\xba\xd0\xb5\xd1\x82";
    if ($key === '' || strpos($key, $макет) !== 0) { return $value; }

    $url = is_string($value) ? trim(wp_strip_all_tags($value)) : '';
    if (!preg_match('~^https?://~i', $url)) { return $value; }

    return '<a href="' . esc_url($url) . '" target="_blank" rel="noopener">'
         . '<img src="' . esc_url($url) . '" alt="' . esc_attr("\xd0\x9c\xd0\xb0\xd0\xba\xd0\xb5\xd1\x82 \xd0\xb7\xd0\xb0\xd0\xba\xd0\xb0\xd0\xb7\xd0\xb0") . '"'
         . ' style="max-width:260px;height:auto;display:block;margin:6px 0;border:1px solid #ddd" />'
         . '</a>';
}

/**
 * Миниатюра позиции в админке заказа: у товара-заглушки «Индивидуальная форма» изображения
 * нет, поэтому там был пустой серый квадрат. Показываем сам макет — ровно как в корзине.
 */
add_filter('woocommerce_admin_order_item_thumbnail', 'jetron_admin_order_thumbnail', 20, 3);
function jetron_admin_order_thumbnail($thumbnail, $item_id, $item) {
    if (!is_object($item) || !method_exists($item, 'get_meta')) { return $thumbnail; }
    $url = (string) $item->get_meta("\xd0\x9c\xd0\xb0\xd0\xba\xd0\xb5\xd1\x82");
    if ($url === '') { $url = (string) $item->get_meta("\xd0\x9c\xd0\xb0\xd0\xba\xd0\xb5\xd1\x82 (PNG)"); }
    if (!preg_match('~^https?://~i', $url)) { return $thumbnail; }
    return '<img src="' . esc_url($url) . '" alt="' . esc_attr("\xd0\x9c\xd0\xb0\xd0\xba\xd0\xb5\xd1\x82 \xd0\xb7\xd0\xb0\xd0\xba\xd0\xb0\xd0\xb7\xd0\xb0") . '"'
         . ' style="width:38px;height:38px;object-fit:cover" />';
}

function jetron_add_order_line_meta($item, $cart_item_key, $values, $order) {
    if (!empty($values['jetron_spec'])) {
        $item->add_meta_data("\xd0\x9a\xd0\xbe\xd0\xbd\xd1\x84\xd0\xb8\xd0\xb3\xd1\x83\xd1\x80\xd0\xb0\xd1\x86\xd0\xb8\xd1\x8f", $values['jetron_spec']);
    }
    if (!empty($values['jetron_png'])) {
        // Имя без «(PNG)»: браузер отдаёт и jpeg, подпись врала (клиент 22.09 смотрел
        // на .jpg под заголовком «Макет (PNG)»). Старые заказы фильтр ловит по началу строки.
        $item->add_meta_data("\xd0\x9c\xd0\xb0\xd0\xba\xd0\xb5\xd1\x82", $values['jetron_png']);
    }
    if (!empty($values['jetron_total'])) {
        // ⛔ Клиент 22.09 просил убрать из заказа дублирующие числа: «Расчёт конструктора» снят
        // вместе с «Расчёт сервера» и «Проверено сервером» (jetron-orders.php). Число живёт в журнале.
        // $item->add_meta_data("\xd0\xa0\xd0\xb0\xd1\x81\xd1\x87\xd1\x91\xd1\x82 \xd0\xba\xd0\xbe\xd0\xbd\xd1\x81\xd1\x82\xd1\x80\xd1\x83\xd0\xba\xd1\x82\xd0\xbe\xd1\x80\xd0\xb0, \xe2\x82\xbd", (int) $values['jetron_total']);
    }
}
