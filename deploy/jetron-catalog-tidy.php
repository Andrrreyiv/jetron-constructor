<?php
/**
 * Plugin Name: Jetron Catalog Tidy
 * Description: Убирает служебную категорию «Без категории» из каталога. Товар конструктора
 *              («Индивидуальная форма (конструктор)») обязан где-то лежать, а WooCommerce
 *              возвращает ему категорию по умолчанию при каждом сохранении и не даёт её удалить.
 * Version: 1.0.0
 *
 * Устанавливать как mu-plugin: wp-content/mu-plugins/jetron-catalog-tidy.php.
 * Клиент 30.07 (голос): «эта без категории у меня в каталоге высвечивается… можете её как-то скрыть».
 * Прячем ТОЛЬКО вывод покупателю: в админке категория остаётся на месте, товар и корзина не тронуты.
 */

if (!defined('ABSPATH')) {
    exit;
}

/** Идентификатор категории по умолчанию (обычно «Без категории», slug misc). */
function jetron_tidy_default_cat_id() {
    $id = (int) get_option('default_product_cat');
    if ($id) {
        return $id;
    }
    // Опции нет — ищем по слагу, который WooCommerce ставит по умолчанию.
    foreach (array('misc', 'uncategorized', 'bez-kategorii') as $slug) {
        $term = get_term_by('slug', $slug, 'product_cat');
        if ($term && !is_wp_error($term)) {
            return (int) $term->term_id;
        }
    }
    return 0;
}

/**
 * Прячем категорию из любых списков категорий товаров на витрине.
 * Админку не трогаем: там она нужна, иначе владелец не поймёт, куда делся товар.
 */
add_filter('get_terms_args', function ($args, $taxonomies) {
    if (is_admin() || !is_array($taxonomies) || !in_array('product_cat', $taxonomies, true)) {
        return $args;
    }
    $id = jetron_tidy_default_cat_id();
    if (!$id) {
        return $args;
    }
    $exclude = isset($args['exclude']) ? (array) $args['exclude'] : array();
    $exclude[] = $id;
    $args['exclude'] = array_values(array_unique(array_map('intval', $exclude)));
    return $args;
}, 10, 2);

/** Виджет категорий строит запрос своим путём — закрываем и его. */
add_filter('woocommerce_product_categories_widget_args', function ($args) {
    $id = jetron_tidy_default_cat_id();
    if ($id) {
        $exclude = isset($args['exclude']) ? (array) $args['exclude'] : array();
        $exclude[] = $id;
        $args['exclude'] = array_values(array_unique(array_map('intval', $exclude)));
    }
    return $args;
});
