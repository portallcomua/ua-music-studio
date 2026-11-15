<?php
/**
 * Plugin Name: UA Music Studio
 * Plugin URI: https://uaserver.pp.ua/ua-music-studio/
 * Description: Студія для аналізу музики, роботи з акордами, транспонування та особистої колекції композицій.
 * Version: 3.0.0
 * Author: UA Server
 * Text Domain: ua-music-studio
 * Domain Path: /languages
 */

if (!defined('ABSPATH')) {
    exit;
}

/* =====================================================
 * ОСНОВНІ НАЛАШТУВАННЯ
 * ===================================================== */

define('UAMS_VERSION', '3.0.0');
define('UAMS_FILE', __FILE__);
define('UAMS_PATH', plugin_dir_path(__FILE__));
define('UAMS_URL', plugin_dir_url(__FILE__));

/*
 * GitHub:
 * Якщо назва репозиторію зміниться, зміни тільки ці константи.
 */
define('UAMS_GITHUB_USER', 'portallcomua');
define('UAMS_GITHUB_REPO', 'ua-music-studio');

define('UAMS_FREE_SONG_LIMIT', 10);


/* =====================================================
 * МОВА ІНТЕРФЕЙСУ
 * ===================================================== */

function uams_get_language() {
    $locale = determine_locale();

    if (
        strpos($locale, 'uk') === 0 ||
        strpos($locale, 'ua') === 0
    ) {
        return 'uk';
    }

    return 'en';
}

function uams_text($uk, $en) {
    return uams_get_language() === 'uk' ? $uk : $en;
}

function uams_load_textdomain() {
    load_plugin_textdomain(
        'ua-music-studio',
        false,
        dirname(plugin_basename(__FILE__)) . '/languages'
    );
}
add_action('plugins_loaded', 'uams_load_textdomain');


/* =====================================================
 * UNIVERSAL PAY BOX — UA MUSIC STUDIO
 *
 * PRO прив'язаний до домену.
 * Статус перевіряється через REST UA Pay Box.
 * ===================================================== */

if (!function_exists('ua_music_studio_is_pro')) {

    function ua_music_studio_hub() {
        return 'https://uaserver.pp.ua/wp-json/upb/v1/';
    }

    function ua_music_studio_domain() {
        $host = (string) wp_parse_url(
            home_url(),
            PHP_URL_HOST
        );

        return strtolower(
            preg_replace('/^www\./', '', $host)
        );
    }

    function ua_music_studio_state($force = false) {

        $cache = get_option('ua_music_studio_pro');

        if (!is_array($cache)) {
            $cache = array(
                'state' => 'free',
                'expires' => 0,
                'checked' => 0
            );
        }

        $checked = isset($cache['checked'])
            ? (int) $cache['checked']
            : 0;

        $expired_cache = time() - $checked > 6 * HOUR_IN_SECONDS;

        if ($force || $expired_cache) {

            $response = wp_remote_get(
                add_query_arg(
                    array(
                        'service' => 'ua-music-studio',
                        'domain' => ua_music_studio_domain()
                    ),
                    ua_music_studio_hub() . 'status'
                ),
                array(
                    'timeout' => 8,
                    'headers' => array(
                        'Accept' => 'application/json'
                    )
                )
            );

            if (
                !is_wp_error($response) &&
                200 === (int) wp_remote_retrieve_response_code($response)
            ) {

                $data = json_decode(
                    wp_remote_retrieve_body($response),
                    true
                );

                if (
                    is_array($data) &&
                    isset($data['state'])
                ) {

                    $allowed_states = array(
                        'free',
                        'active',
                        'expiring',
                        'unlimited'
                    );

                    $state = sanitize_key($data['state']);

                    if (!in_array($state, $allowed_states, true)) {
                        $state = 'free';
                    }

                    $cache = array(
                        'state' => $state,
                        'expires' => isset($data['expires'])
                            ? absint($data['expires'])
                            : 0,
                        'checked' => time()
                    );

                    update_option(
                        'ua_music_studio_pro',
                        $cache,
                        false
                    );
                }

            } elseif (time() - $checked > 7 * DAY_IN_SECONDS) {

                $cache['state'] = 'free';

                update_option(
                    'ua_music_studio_pro',
                    $cache,
                    false
                );
            }
        }

        return $cache;
    }

    function ua_music_studio_is_pro() {

        $cache = ua_music_studio_state();

        $state = isset($cache['state'])
            ? $cache['state']
            : 'free';

        $expires = isset($cache['expires'])
            ? (int) $cache['expires']
            : 0;

        return in_array(
            $state,
            array('active', 'expiring', 'unlimited'),
            true
        ) && (
            !$expires || $expires > time()
        );
    }

    function ua_music_studio_activate_pro() {

        $response = wp_remote_post(
            ua_music_studio_hub() . 'activate',
            array(
                'timeout' => 15,
                'body' => array(
                    'service' => 'ua-music-studio',
                    'domain' => ua_music_studio_domain(),
                    'email' => get_option('admin_email'),
                    'site_url' => home_url()
                )
            )
        );

        if (is_wp_error($response)) {
            return $response;
        }

        $data = json_decode(
            wp_remote_retrieve_body($response),
            true
        );

        if (
            200 !== (int) wp_remote_retrieve_response_code($response) ||
            !is_array($data)
        ) {
            return new WP_Error(
                'ua_music_studio_paybox',
                isset($data['message'])
                    ? sanitize_text_field($data['message'])
                    : 'Payment server error.'
            );
        }

        ua_music_studio_state(true);

        return $data;
    }
}


/* =====================================================
 * СТАТУС PRO ТА ЛІМІТ КОЛЕКЦІЇ
 * ===================================================== */

function uams_is_pro() {
    return function_exists('ua_music_studio_is_pro')
        && ua_music_studio_is_pro();
}

function uams_get_collection($user_id) {

    $collection = get_user_meta(
        $user_id,
        'uams_collection',
        true
    );

    return is_array($collection)
        ? array_values($collection)
        : array();
}

function uams_get_collection_count($user_id) {
    return count(uams_get_collection($user_id));
}

function uams_can_save_song($user_id) {

    if (uams_is_pro()) {
        return true;
    }

    return uams_get_collection_count($user_id) < UAMS_FREE_SONG_LIMIT;
}


/* =====================================================
 * ПІДКЛЮЧЕННЯ CSS І JAVASCRIPT
 * ===================================================== */

function uams_enqueue_assets() {

    if (!is_singular()) {
        return;
    }

    global $post;

    if (
        !$post ||
        !has_shortcode($post->post_content, 'ua_music_studio')
    ) {
        return;
    }

    wp_enqueue_style(
        'uams-studio',
        UAMS_URL . 'assets/css/studio.css',
        array(),
        UAMS_VERSION
    );

    $scripts = array(
        'uams-audio-engine' => 'audio-engine.js',
        'uams-pitch-shifter' => 'pitch-shifter.js',
        'uams-chord-analyzer' => 'chord-analyzer.js',
        'uams-stem-separator' => 'stem-separator.js',
        'uams-lyrics-recognition' => 'lyrics-recognition.js',
        'uams-translation' => 'translation.js',
        'uams-collection' => 'collection.js',
        'uams-studio' => 'studio.js'
    );

    $dependencies = array();

    foreach ($scripts as $handle => $filename) {

        wp_enqueue_script(
            $handle,
            UAMS_URL . 'assets/js/' . $filename,
            $dependencies,
            UAMS_VERSION,
            true
        );

        $dependencies[] = $handle;
    }

    wp_localize_script(
        'uams-studio',
        'UAMS_CONFIG',
        array(
            'ajaxUrl' => admin_url('admin-ajax.php'),
            'nonce' => wp_create_nonce('uams_nonce'),
            'version' => UAMS_VERSION,
            'language' => uams_get_language(),
            'loggedIn' => is_user_logged_in(),
            'isPro' => uams_is_pro(),
            'freeLimit' => UAMS_FREE_SONG_LIMIT,
            'collectionCount' => is_user_logged_in()
                ? uams_get_collection_count(get_current_user_id())
                : 0,
            'messages' => array(
                'loginRequired' => uams_text(
                    'Увійдіть на сайт, щоб зберігати композиції.',
                    'Log in to save compositions.'
                ),
                'saveError' => uams_text(
                    'Не вдалося зберегти композицію.',
                    'Could not save composition.'
                ),
                'deleteError' => uams_text(
                    'Не вдалося видалити композицію.',
                    'Could not delete composition.'
                ),
                'saved' => uams_text(
                    'Композицію збережено.',
                    'Composition saved.'
                ),
                'deleted' => uams_text(
                    'Композицію видалено.',
                    'Composition deleted.'
                ),
                'limitReached' => uams_text(
                    'Безкоштовна колекція містить максимум 10 композицій. Придбайте PRO, щоб зберігати більше.',
                    'The free collection allows up to 10 compositions. Upgrade to PRO to save more.'
                ),
                'buyPro' => uams_text(
                    'Придбати PRO',
                    'Buy PRO'
                )
            )
        )
    );
}
add_action('wp_enqueue_scripts', 'uams_enqueue_assets');


/* =====================================================
 * ШОРТКОД СТУДІЇ
 * ===================================================== */

function uams_studio_shortcode() {

    ob_start();
    ?>

    <div id="uams-app" class="uams-app">

        <header class="uams-header">
            <div class="uams-brand">
                <div class="uams-logo">🎸</div>

                <div>
                    <h1>UA Music Studio</h1>
                    <p>
                        <?php
                        echo esc_html(
                            uams_text(
                                'Музика. Акорди. Твоя гітара.',
                                'Music. Chords. Your guitar.'
                            )
                        );
                        ?>
                    </p>
                </div>
            </div>

            <span class="uams-version">
                3.0.0
            </span>
        </header>

        <main class="uams-main">

            <section class="uams-panel uams-upload-panel">

                <h2>
                    <?php echo esc_html(uams_text('1. Завантаж композицію', '1. Load a composition')); ?>
                </h2>

                <label for="uams-audio-file" class="uams-file-label">

                    <span class="uams-upload-icon">🎵</span>

                    <strong>
                        <?php echo esc_html(uams_text('Вибрати аудіофайл', 'Choose audio file')); ?>
                    </strong>

                    <small>
                        MP3, WAV, OGG, M4A
                    </small>

                </label>

                <input
                    type="file"
                    id="uams-audio-file"
                    accept="audio/*"
                >

                <div class="uams-url-row">

                    <input
                        type="url"
                        id="uams-audio-url"
                        placeholder="<?php echo esc_attr(uams_text('Пряме посилання на аудіофайл', 'Direct audio file URL')); ?>"
                    >

                    <button type="button" id="uams-load-url">
                        <?php echo esc_html(uams_text('Завантажити', 'Load')); ?>
                    </button>

                </div>

                <div id="uams-file-info" class="uams-file-info">
                    <?php echo esc_html(uams_text('Композицію ще не вибрано.', 'No composition selected.')); ?>
                </div>

            </section>


            <section class="uams-panel">

                <h2>
                    <?php echo esc_html(uams_text('2. Прослуховування', '2. Listening')); ?>
                </h2>

                <audio
                    id="uams-original-audio"
                    controls
                    preload="metadata"
                ></audio>

                <div id="uams-player-status" class="uams-status"></div>

            </section>


            <section class="uams-panel">

                <h2>
                    <?php echo esc_html(uams_text('3. Аналіз композиції', '3. Composition analysis')); ?>
                </h2>

                <div class="uams-analysis-grid">

                    <div class="uams-info-card">
                        <span><?php echo esc_html(uams_text('Тональність', 'Key')); ?></span>
                        <strong id="uams-key">—</strong>
                    </div>

                    <div class="uams-info-card">
                        <span><?php echo esc_html(uams_text('Темп', 'Tempo')); ?></span>
                        <strong id="uams-bpm">—</strong>
                    </div>

                    <div class="uams-info-card">
                        <span><?php echo esc_html(uams_text('Тривалість', 'Duration')); ?></span>
                        <strong id="uams-duration">—</strong>
                    </div>

                </div>

                <button
                    type="button"
                    id="uams-analyze"
                    class="uams-primary-button"
                    disabled
                >
                    <?php echo esc_html(uams_text('Проаналізувати композицію', 'Analyze composition')); ?>
                </button>

                <div id="uams-analysis-status" class="uams-status"></div>

            </section>


            <section class="uams-panel">

                <h2>
                    <?php echo esc_html(uams_text('4. Акорди та гітара', '4. Chords and guitar')); ?>
                </h2>

                <div id="uams-chord-timeline" class="uams-chord-timeline">
                    <?php echo esc_html(uams_text('Тут з’явиться карта акордів.', 'The chord map will appear here.')); ?>
                </div>

                <div id="uams-chord-diagram" class="uams-chord-diagram">
                    <?php echo esc_html(uams_text('Вибери акорд, щоб побачити схему постановки пальців.', 'Select a chord to see its fingering diagram.')); ?>
                </div>

            </section>


            <section class="uams-panel">

                <h2>
                    <?php echo esc_html(uams_text('5. Обробка композиції', '5. Audio processing')); ?>
                </h2>

                <div class="uams-control-group">

                    <label for="uams-transpose">
                        <?php echo esc_html(uams_text('Транспонування:', 'Transpose:')); ?>

                        <strong id="uams-transpose-value">0</strong>

                        <?php echo esc_html(uams_text('півтонів', 'semitones')); ?>
                    </label>

                    <input
                        type="range"
                        id="uams-transpose"
                        min="-12"
                        max="12"
                        step="1"
                        value="0"
                        disabled
                    >

                    <div class="uams-range-labels">
                        <span>-12</span>
                        <span><?php echo esc_html(uams_text('Оригінал', 'Original')); ?></span>
                        <span>+12</span>
                    </div>

                </div>

                <div class="uams-toggle-list">

                    <label class="uams-toggle">

                        <input
                            type="checkbox"
                            id="uams-vocals-toggle"
                            disabled
                        >

                        <span>
                            <?php echo esc_html(uams_text('Вокал', 'Vocals')); ?>
                        </span>

                        <small>
                            <?php echo esc_html(uams_text('Увімкнути або вимкнути вокальну доріжку', 'Enable or disable vocal track')); ?>
                        </small>

                    </label>

                    <label class="uams-toggle">

                        <input
                            type="checkbox"
                            id="uams-guitar-toggle"
                            disabled
                        >

                        <span>
                            <?php echo esc_html(uams_text('Гітара', 'Guitar')); ?>
                        </span>

                        <small>
                            <?php echo esc_html(uams_text('Увімкнути або вимкнути гітарну доріжку', 'Enable or disable guitar track')); ?>
                        </small>

                    </label>

                </div>

                <div id="uams-processing-status" class="uams-status"></div>

                <div class="uams-processed-player">

                    <h3>
                        <?php echo esc_html(uams_text('Оброблена композиція', 'Processed composition')); ?>
                    </h3>

                    <audio
                        id="uams-processed-audio"
                        controls
                        preload="metadata"
                    ></audio>

                    <button
                        type="button"
                        id="uams-download-processed"
                        disabled
                    >
                        <?php echo esc_html(uams_text('Завантажити оброблену композицію', 'Download processed composition')); ?>
                    </button>

                </div>

            </section>


            <section class="uams-panel">

                <h2>
                    <?php echo esc_html(uams_text('6. Текст пісні та переклад', '6. Lyrics and translation')); ?>
                </h2>

                <div class="uams-lyrics-controls">

                    <label>
                        <input
                            type="checkbox"
                            id="uams-subtitles-toggle"
                            checked
                        >
                        <?php echo esc_html(uams_text('Оригінальний текст', 'Original lyrics')); ?>
                    </label>

                    <label>
                        <input
                            type="checkbox"
                            id="uams-translation-toggle"
                        >
                        <?php echo esc_html(uams_text('Український переклад', 'Ukrainian translation')); ?>
                    </label>

                </div>

                <div id="uams-lyrics-original" class="uams-lyrics">
                    <?php echo esc_html(uams_text('Тут з’явиться розпізнаний текст.', 'Recognized lyrics will appear here.')); ?>
                </div>

                <div id="uams-lyrics-translation" class="uams-lyrics uams-translation">
                    <?php echo esc_html(uams_text('Тут з’явиться український переклад.', 'Ukrainian translation will appear here.')); ?>
                </div>

                <div id="uams-lyrics-status" class="uams-status"></div>

            </section>


            <section class="uams-panel uams-collection-panel">

                <h2>
                    <?php echo esc_html(uams_text('7. Моя колекція', '7. My collection')); ?>
                </h2>

                <p>
                    <?php
                    echo esc_html(
                        uams_text(
                            'Працюй із композиціями без збереження або додавай готові результати до особистої колекції.',
                            'Work with songs without saving, or add finished results to your personal collection.'
                        )
                    );
                    ?>
                </p>

                <div id="uams-plan-status" class="uams-plan-status"></div>

                <div class="uams-save-form">

                    <label for="uams-song-title">
                        <?php echo esc_html(uams_text('Назва композиції', 'Composition title')); ?>
                    </label>

                    <input
                        type="text"
                        id="uams-song-title"
                        placeholder="<?php echo esc_attr(uams_text('Назва пісні або виконавець', 'Song title or artist')); ?>"
                    >

                    <label for="uams-song-notes">
                        <?php echo esc_html(uams_text('Мої нотатки', 'My notes')); ?>
                    </label>

                    <textarea
                        id="uams-song-notes"
                        rows="3"
                        placeholder="<?php echo esc_attr(uams_text('Наприклад: ля мінор, без вокалу і гітари...', 'Example: A minor, without vocals and guitar...')); ?>"
                    ></textarea>

                    <button
                        type="button"
                        id="uams-save-song"
                        class="uams-primary-button"
                        disabled
                    >
                        <?php echo esc_html(uams_text('Зберегти в колекцію', 'Save to collection')); ?>
                    </button>

                    <button
                        type="button"
                        id="uams-buy-pro"
                        class="uams-pro-button"
                        style="display:none"
                    >
                        <?php echo esc_html(uams_text('Придбати PRO', 'Buy PRO')); ?>
                    </button>

                    <div id="uams-save-status" class="uams-status"></div>

                </div>

                <div class="uams-collection-tools">

                    <input
                        type="search"
                        id="uams-collection-search"
                        placeholder="<?php echo esc_attr(uams_text('Пошук композицій...', 'Search compositions...')); ?>"
                    >

                    <select id="uams-collection-sort">

                        <option value="newest">
                            <?php echo esc_html(uams_text('Спочатку нові', 'Newest first')); ?>
                        </option>

                        <option value="oldest">
                            <?php echo esc_html(uams_text('Спочатку старі', 'Oldest first')); ?>
                        </option>

                        <option value="title">
                            <?php echo esc_html(uams_text('За назвою', 'By title')); ?>
                        </option>

                    </select>

                </div>

                <div id="uams-collection-list">
                    <?php echo esc_html(uams_text('Колекція завантажується...', 'Loading collection...')); ?>
                </div>

            </section>

        </main>

        <footer class="uams-footer">
            UA Music Studio 3.0.0 · UA Server
        </footer>

    </div>

    <?php

    return ob_get_clean();
}

add_shortcode('ua_music_studio', 'uams_studio_shortcode');


/* =====================================================
 * AJAX: ПЕРЕВІРКА ДОСТУПУ
 * ===================================================== */

function uams_check_ajax_access() {

    check_ajax_referer('uams_nonce', 'nonce');

    if (!is_user_logged_in()) {

        wp_send_json_error(
            array(
                'message' => uams_text(
                    'Потрібно увійти на сайт.',
                    'You must log in.'
                )
            ),
            401
        );
    }
}


/* =====================================================
 * AJAX: ОТРИМАННЯ КОЛЕКЦІЇ
 * ===================================================== */

function uams_ajax_get_collection() {

    uams_check_ajax_access();

    $user_id = get_current_user_id();

    $collection = uams_get_collection($user_id);

    wp_send_json_success(
        array(
            'collection' => $collection,
            'count' => count($collection),
            'limit' => UAMS_FREE_SONG_LIMIT,
            'isPro' => uams_is_pro(),
            'canSave' => uams_can_save_song($user_id)
        )
    );
}

add_action(
    'wp_ajax_uams_get_collection',
    'uams_ajax_get_collection'
);


/* =====================================================
 * AJAX: ЗБЕРЕЖЕННЯ КОМПОЗИЦІЇ
 * ===================================================== */

function uams_ajax_save_song() {

    uams_check_ajax_access();

    $user_id = get_current_user_id();

    /*
     * Перевіряємо ліміт на сервері.
     * Змінити ліміт через браузер неможливо.
     */
    if (!uams_can_save_song($user_id)) {

        wp_send_json_error(
            array(
                'code' => 'limit_reached',
                'message' => uams_text(
                    'Безкоштовний ліміт — 10 композицій. Придбайте PRO.',
                    'Free limit is 10 compositions. Upgrade to PRO.'
                ),
                'count' => uams_get_collection_count($user_id),
                'limit' => UAMS_FREE_SONG_LIMIT
            ),
            403
        );
    }

    $title = isset($_POST['title'])
        ? sanitize_text_field(wp_unslash($_POST['title']))
        : '';

    $notes = isset($_POST['notes'])
        ? sanitize_textarea_field(wp_unslash($_POST['notes']))
        : '';

    $key = isset($_POST['key'])
        ? sanitize_text_field(wp_unslash($_POST['key']))
        : '';

    $transpose = isset($_POST['transpose'])
        ? intval($_POST['transpose'])
        : 0;

    $lyrics = isset($_POST['lyrics'])
        ? sanitize_textarea_field(wp_unslash($_POST['lyrics']))
        : '';

    $translation = isset($_POST['translation'])
        ? sanitize_textarea_field(wp_unslash($_POST['translation']))
        : '';

    $chords = isset($_POST['chords'])
        ? sanitize_textarea_field(wp_unslash($_POST['chords']))
        : '';

    if ($title === '') {

        wp_send_json_error(
            array(
                'message' => uams_text(
                    'Вкажи назву композиції.',
                    'Enter a composition title.'
                )
            ),
            400
        );
    }

    $collection = uams_get_collection($user_id);

    $song = array(
        'id' => wp_generate_uuid4(),
        'title' => $title,
        'notes' => $notes,
        'key' => $key,
        'transpose' => max(-12, min(12, $transpose)),
        'lyrics' => $lyrics,
        'translation' => $translation,
        'chords' => $chords,
        'created' => current_time('timestamp')
    );

    $collection[] = $song;

    update_user_meta(
        $user_id,
        'uams_collection',
        array_values($collection)
    );

    wp_send_json_success(
        array(
            'message' => uams_text(
                'Композицію збережено.',
                'Composition saved.'
            ),
            'song' => $song,
            'count' => count($collection),
            'isPro' => uams_is_pro()
        )
    );
}

add_action(
    'wp_ajax_uams_save_song',
    'uams_ajax_save_song'
);


/* =====================================================
 * AJAX: ВИДАЛЕННЯ КОМПОЗИЦІЇ
 * ===================================================== */

function uams_ajax_delete_song() {

    uams_check_ajax_access();

    $song_id = isset($_POST['song_id'])
        ? sanitize_text_field(wp_unslash($_POST['song_id']))
        : '';

    if ($song_id === '') {
        wp_send_json_error(
            array('message' => 'Missing song ID.'),
            400
        );
    }

    $user_id = get_current_user_id();

    $collection = uams_get_collection($user_id);

    $updated = array();

    foreach ($collection as $song) {

        if (
            !isset($song['id']) ||
            $song['id'] !== $song_id
        ) {
            $updated[] = $song;
        }
    }

    update_user_meta(
        $user_id,
        'uams_collection',
        array_values($updated)
    );

    wp_send_json_success(
        array(
            'message' => uams_text(
                'Композицію видалено.',
                'Composition deleted.'
            ),
            'count' => count($updated)
        )
    );
}

add_action(
    'wp_ajax_uams_delete_song',
    'uams_ajax_delete_song'
);


/* =====================================================
 * AJAX: РЕДАГУВАННЯ НОТАТОК
 * ===================================================== */

function uams_ajax_update_notes() {

    uams_check_ajax_access();

    $song_id = isset($_POST['song_id'])
        ? sanitize_text_field(wp_unslash($_POST['song_id']))
        : '';

    $notes = isset($_POST['notes'])
        ? sanitize_textarea_field(wp_unslash($_POST['notes']))
        : '';

    if ($song_id === '') {
        wp_send_json_error(
            array('message' => 'Missing song ID.'),
            400
        );
    }

    $user_id = get_current_user_id();

    $collection = uams_get_collection($user_id);

    $found = false;

    foreach ($collection as &$song) {

        if (
            isset($song['id']) &&
            $song['id'] === $song_id
        ) {
            $song['notes'] = $notes;
            $found = true;
            break;
        }
    }

    unset($song);

    if (!$found) {
        wp_send_json_error(
            array('message' => 'Composition not found.'),
            404
        );
    }

    update_user_meta(
        $user_id,
        'uams_collection',
        array_values($collection)
    );

    wp_send_json_success(
        array(
            'message' => uams_text(
                'Нотатки оновлено.',
                'Notes updated.'
            )
        )
    );
}

add_action(
    'wp_ajax_uams_update_notes',
    'uams_ajax_update_notes'
);


/* =====================================================
 * AJAX: АКТИВАЦІЯ PRO ЧЕРЕЗ UA PAY BOX
 * ===================================================== */

function uams_ajax_activate_pro() {

    check_ajax_referer('uams_nonce', 'nonce');

    if (!current_user_can('manage_options')) {

        wp_send_json_error(
            array(
                'message' => uams_text(
                    'Оплату PRO може ініціювати адміністратор сайту.',
                    'Only the site administrator can initiate PRO activation.'
                )
            ),
            403
        );
    }

    if (!function_exists('ua_music_studio_activate_pro')) {

        wp_send_json_error(
            array(
                'message' => 'UA Pay Box integration is unavailable.'
            ),
            500
        );
    }

    $result = ua_music_studio_activate_pro();

    if (is_wp_error($result)) {

        wp_send_json_error(
            array(
                'message' => $result->get_error_message()
            ),
            500
        );
    }

    $payment_url = '';

    if (isset($result['url'])) {
        $payment_url = esc_url_raw($result['url']);
    }

    if (!$payment_url) {

        wp_send_json_error(
            array(
                'message' => uams_text(
                    'Сервер оплати не повернув посилання.',
                    'Payment server did not return a URL.'
                )
            ),
            500
        );
    }

    wp_send_json_success(
        array(
            'url' => $payment_url
        )
    );
}

add_action(
    'wp_ajax_uams_activate_pro',
    'uams_ajax_activate_pro'
);


/* =====================================================
 * GITHUB AUTO-UPDATER
 *
 * Очікується GitHub Release з ZIP-архівом:
 * ua-music-studio.zip
 * ===================================================== */

function uams_github_latest_release() {

    $cached = get_transient('uams_github_release');

    if (is_array($cached)) {
        return $cached;
    }

    $api_url = sprintf(
        'https://api.github.com/repos/%s/%s/releases/latest',
        UAMS_GITHUB_USER,
        UAMS_GITHUB_REPO
    );

    $response = wp_remote_get(
        $api_url,
        array(
            'timeout' => 10,
            'headers' => array(
                'Accept' => 'application/vnd.github+json',
                'User-Agent' => 'UA-Music-Studio-WordPress-Updater'
            )
        )
    );

    if (
        is_wp_error($response) ||
        200 !== (int) wp_remote_retrieve_response_code($response)
    ) {
        return false;
    }

    $data = json_decode(
        wp_remote_retrieve_body($response),
        true
    );

    if (
        !is_array($data) ||
        empty($data['tag_name']) ||
        empty($data['assets'])
    ) {
        return false;
    }

    $package = '';

    foreach ($data['assets'] as $asset) {

        if (
            !empty($asset['name']) &&
            $asset['name'] === 'ua-music-studio.zip' &&
            !empty($asset['browser_download_url'])
        ) {
            $package = esc_url_raw(
                $asset['browser_download_url']
            );

            break;
        }
    }

    if (!$package) {
        return false;
    }

    $release = array(
        'version' => ltrim(
            sanitize_text_field($data['tag_name']),
            'v'
        ),
        'package' => $package,
        'url' => isset($data['html_url'])
            ? esc_url_raw($data['html_url'])
            : ''
    );

    set_transient(
        'uams_github_release',
        $release,
        6 * HOUR_IN_SECONDS
    );

    return $release;
}


/**
 * Перевірка оновлення WordPress.
 */
function uams_check_for_update($transient) {

    if (empty($transient->checked)) {
        return $transient;
    }

    $release = uams_github_latest_release();

    if (!$release) {
        return $transient;
    }

    if (
        version_compare(
            $release['version'],
            UAMS_VERSION,
            '>'
        )
    ) {

        $plugin_basename = plugin_basename(UAMS_FILE);

        $transient->response[$plugin_basename] = (object) array(
            'slug' => 'ua-music-studio',
            'plugin' => $plugin_basename,
            'new_version' => $release['version'],
            'url' => $release['url'],
            'package' => $release['package'],
            'tested' => get_bloginfo('version'),
            'requires' => '6.0',
            'requires_php' => '7.4'
        );
    }

    return $transient;
}

add_filter(
    'pre_set_site_transient_update_plugins',
    'uams_check_for_update'
);


/**
 * Інформація про плагін у вікні деталей.
 */
function uams_plugin_information(
    $result,
    $action,
    $args
) {

    if (
        $action !== 'plugin_information' ||
        empty($args->slug) ||
        $args->slug !== 'ua-music-studio'
    ) {
        return $result;
    }

    $release = uams_github_latest_release();

    if (!$release) {
        return $result;
    }

    return (object) array(
        'name' => 'UA Music Studio',
        'slug' => 'ua-music-studio',
        'version' => $release['version'],
        'author' => 'UA Server',
        'homepage' => 'https://uaserver.pp.ua/ua-music-studio/',
        'download_link' => $release['package'],
        'sections' => array(
            'description' => 'Music analysis, guitar chords, audio processing and personal collection.',
            'changelog' => 'See the GitHub release notes.'
        )
    );
}

add_filter(
    'plugins_api',
    'uams_plugin_information',
    20,
    3
);


/**
 * Очищення кешу GitHub після оновлення.
 */
function uams_clear_github_cache() {
    delete_transient('uams_github_release');
}

add_action(
    'upgrader_process_complete',
    'uams_clear_github_cache',
    10,
    0
);
