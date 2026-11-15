<?php
/**
 * Plugin Name: UA Music Studio
 * Plugin URI: https://uaserver.pp.ua
 * Description: Студія для аналізу музики, роботи з акордами, транспонування та особистої колекції композицій.
 * Version: 3.0.0
 * Author: UA Server
 * Text Domain: ua-music-studio
 * Domain Path: /languages
 */

if (!defined('ABSPATH')) exit;

define('UAMS_VERSION', '3.0.0');
define('UAMS_FILE', __FILE__);
define('UAMS_PATH', plugin_dir_path(__FILE__));
define('UAMS_URL', plugin_dir_url(__FILE__));
define('UAMS_GITHUB_USER', 'portallcomua');
define('UAMS_GITHUB_REPO', 'ua-music-studio');
define('UAMS_FREE_SONG_LIMIT', 10);
define('UAMS_COLLECTION_META', 'uams_collection');

function uams_get_language() {
    $locale = determine_locale();
    return (strpos($locale, 'uk') === 0 || strpos($locale, 'ua') === 0) ? 'uk' : 'en';
}

function uams_text($uk, $en) {
    return uams_get_language() === 'uk' ? $uk : $en;
}

add_action('plugins_loaded', function () {
    load_plugin_textdomain('ua-music-studio', false, dirname(plugin_basename(__FILE__)) . '/languages');
});

/* UA PAY BOX */

if (!function_exists('ua_music_studio_is_pro')) {
    function ua_music_studio_hub() {
        return 'https://uaserver.pp.ua/wp-json/upb/v1/';
    }

    function ua_music_studio_domain() {
        $host = (string) wp_parse_url(home_url(), PHP_URL_HOST);
        return strtolower(preg_replace('/^www\./', '', $host));
    }

    function ua_music_studio_state($force = false) {
        $cache = get_option('ua_music_studio_pro');
        if (!is_array($cache)) {
            $cache = array('state' => 'free', 'expires' => 0, 'checked' => 0);
        }

        $checked = isset($cache['checked']) ? (int) $cache['checked'] : 0;
        if ($force || time() - $checked > 6 * HOUR_IN_SECONDS) {
            $response = wp_remote_get(add_query_arg(array(
                'service' => 'ua-music-studio',
                'domain' => ua_music_studio_domain()
            ), ua_music_studio_hub() . 'status'), array(
                'timeout' => 8,
                'headers' => array('Accept' => 'application/json')
            ));

            if (!is_wp_error($response) && 200 === (int) wp_remote_retrieve_response_code($response)) {
                $data = json_decode(wp_remote_retrieve_body($response), true);
                if (is_array($data) && isset($data['state'])) {
                    $state = sanitize_key($data['state']);
                    if (!in_array($state, array('free', 'active', 'expiring', 'unlimited'), true)) {
                        $state = 'free';
                    }
                    $cache = array(
                        'state' => $state,
                        'expires' => isset($data['expires']) ? absint($data['expires']) : 0,
                        'checked' => time()
                    );
                    update_option('ua_music_studio_pro', $cache, false);
                }
            } elseif (time() - $checked > 7 * DAY_IN_SECONDS) {
                $cache['state'] = 'free';
                update_option('ua_music_studio_pro', $cache, false);
            }
        }
        return $cache;
    }

    function ua_music_studio_is_pro() {
        $state = ua_music_studio_state();
        return in_array($state['state'], array('active', 'expiring', 'unlimited'), true)
            && (empty($state['expires']) || (int) $state['expires'] > time());
    }

    function ua_music_studio_activate_pro() {
        $response = wp_remote_post(ua_music_studio_hub() . 'activate', array(
            'timeout' => 15,
            'body' => array(
                'service' => 'ua-music-studio',
                'domain' => ua_music_studio_domain(),
                'email' => get_option('admin_email'),
                'site_url' => home_url()
            )
        ));
        if (is_wp_error($response)) return $response;

        $data = json_decode(wp_remote_retrieve_body($response), true);
        if (200 !== (int) wp_remote_retrieve_response_code($response) || !is_array($data)) {
            return new WP_Error('uams_paybox', isset($data['message']) ? sanitize_text_field($data['message']) : 'Payment server error.');
        }
        ua_music_studio_state(true);
        return $data;
    }
}

function uams_is_pro() {
    return function_exists('ua_music_studio_is_pro') && ua_music_studio_is_pro();
}

/* COLLECTION */

function uams_get_collection($user_id) {
    $items = get_user_meta($user_id, UAMS_COLLECTION_META, true);
    return is_array($items) ? array_values($items) : array();
}

function uams_get_collection_count($user_id) {
    return count(uams_get_collection($user_id));
}

function uams_can_save_song($user_id) {
    return uams_is_pro() || uams_get_collection_count($user_id) < UAMS_FREE_SONG_LIMIT;
}

function uams_find_song($collection, $song_id) {
    foreach ($collection as $index => $song) {
        if (!empty($song['id']) && hash_equals((string) $song['id'], (string) $song_id)) return $index;
    }
    return false;
}

/* PRIVATE AUDIO STORAGE */

function uams_private_directory() {
    $uploads = wp_upload_dir();
    $dir = trailingslashit($uploads['basedir']) . 'uams-private';
    if (!is_dir($dir)) wp_mkdir_p($dir);

    if (is_dir($dir)) {
        if (!file_exists($dir . '/index.php')) file_put_contents($dir . '/index.php', "<?php\n// Silence is golden.\n");
        if (!file_exists($dir . '/.htaccess')) {
            file_put_contents($dir . '/.htaccess', "Options -Indexes\n<IfModule mod_authz_core.c>\nRequire all denied\n</IfModule>\n<IfModule !mod_authz_core.c>\nOrder deny,allow\nDeny from all\n</IfModule>\n");
        }
    }
    return $dir;
}

function uams_allowed_audio_mimes() {
    return array(
        'mp3' => 'audio/mpeg', 'wav' => 'audio/wav', 'ogg' => 'audio/ogg',
        'oga' => 'audio/ogg', 'm4a' => 'audio/mp4', 'mp4' => 'audio/mp4',
        'aac' => 'audio/aac', 'flac' => 'audio/flac', 'webm' => 'audio/webm'
    );
}

function uams_store_uploaded_audio($user_id, $file) {
    if (empty($file['tmp_name']) || !is_uploaded_file($file['tmp_name'])) {
        return new WP_Error('uams_upload', uams_text('Файл не отримано.', 'No file received.'));
    }
    if (!empty($file['error'])) return new WP_Error('uams_upload', uams_text('Помилка завантаження файлу.', 'Upload error.'));
    if ((int) $file['size'] > 100 * MB_IN_BYTES) {
        return new WP_Error('uams_size', uams_text('Максимальний розмір файлу — 100 МБ.', 'Maximum file size is 100 MB.'));
    }

    $ext = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
    $mimes = uams_allowed_audio_mimes();
    if (!isset($mimes[$ext])) return new WP_Error('uams_type', uams_text('Непідтримуваний формат аудіо.', 'Unsupported audio format.'));

    $base = uams_private_directory();
    $dir = trailingslashit($base) . absint($user_id);
    if (!is_dir($dir)) wp_mkdir_p($dir);
    if (!is_dir($dir) || !is_writable($dir)) return new WP_Error('uams_directory', 'Audio storage directory is not writable.');

    $name = wp_generate_password(32, false, false) . '.' . $ext;
    $path = trailingslashit($dir) . $name;
    if (!move_uploaded_file($file['tmp_name'], $path)) return new WP_Error('uams_move', 'Could not store audio file.');

    return array(
        'id' => wp_generate_uuid4(),
        'name' => sanitize_file_name($file['name']),
        'path' => $path,
        'mime' => $mimes[$ext],
        'size' => (int) filesize($path)
    );
}

function uams_delete_media_file($media) {
    if (empty($media['path']) || !is_file($media['path'])) return;
    $base = trailingslashit(wp_normalize_path(uams_private_directory()));
    $path = wp_normalize_path($media['path']);
    if (strpos($path, $base) === 0) @unlink($path);
}

/* ACTIVATION */

function uams_activate_plugin() {
    uams_private_directory();
    flush_rewrite_rules();
}
register_activation_hook(__FILE__, 'uams_activate_plugin');

register_deactivation_hook(__FILE__, function () {
    flush_rewrite_rules();
});

/* FRONTEND ASSETS */

function uams_enqueue_assets() {
    if (!is_singular()) return;
    global $post;
    if (!$post || !has_shortcode($post->post_content, 'ua_music_studio')) return;

    wp_enqueue_style('uams-studio', UAMS_URL . 'assets/css/studio.css', array(), UAMS_VERSION);

    $scripts = array(
        'uams-model-loader' => 'model-loader.js',
        'uams-audio-engine' => 'audio-engine.js',
        'uams-pitch-shifter' => 'pitch-shifter.js',
        'uams-chord-analyzer' => 'chord-analyzer.js',
        'uams-stem-separator' => 'stem-separator.js',
        'uams-lyrics-recognition' => 'lyrics-recognition.js',
        'uams-translation' => 'translation.js',
        'uams-collection' => 'collection.js',
        'uams-studio' => 'studio.js'
    );

    $deps = array();
    foreach ($scripts as $handle => $file) {
        $path = UAMS_PATH . 'assets/js/' . $file;
        if (!file_exists($path)) continue;
        wp_enqueue_script($handle, UAMS_URL . 'assets/js/' . $file, $deps, filemtime($path), true);
        $deps[] = $handle;
    }

    $config_handle = wp_script_is('uams-model-loader', 'enqueued') ? 'uams-model-loader' : 'uams-studio';
    if (wp_script_is($config_handle, 'enqueued')) {
        wp_localize_script($config_handle, 'UAMS_CONFIG', array(
            'ajaxUrl' => admin_url('admin-ajax.php'),
            'streamUrl' => admin_url('admin-post.php'),
            'nonce' => wp_create_nonce('uams_nonce'),
            'version' => UAMS_VERSION,
            'language' => uams_get_language(),
            'loggedIn' => is_user_logged_in(),
            'isPro' => uams_is_pro(),
            'freeLimit' => UAMS_FREE_SONG_LIMIT,
            'collectionCount' => is_user_logged_in() ? uams_get_collection_count(get_current_user_id()) : 0,
            'models' => array(
                'whisper' => 'onnx-community/whisper-tiny',
                'translation' => 'Xenova/opus-mt-en-uk',
                'demucs' => 'https://huggingface.co/StemSplitio/htdemucs-6s-onnx/resolve/main/htdemucs_6s_fp16weights.onnx'
            ),
            'messages' => array(
                'loginRequired' => uams_text('Увійдіть на сайт, щоб користуватися колекцією.', 'Log in to use your collection.'),
                'saveError' => uams_text('Не вдалося зберегти композицію.', 'Could not save composition.'),
                'deleteError' => uams_text('Не вдалося видалити композицію.', 'Could not delete composition.'),
                'saved' => uams_text('Композицію збережено.', 'Composition saved.'),
                'deleted' => uams_text('Композицію видалено.', 'Composition deleted.'),
                'limitReached' => uams_text('Безкоштовна колекція дозволяє зберегти 10 композицій. Для більшої колекції потрібен PRO.', 'The free collection allows 10 saved compositions. PRO is required for a larger collection.'),
                'buyPro' => uams_text('Придбати PRO', 'Buy PRO')
            )
        ));
    }
}
add_action('wp_enqueue_scripts', 'uams_enqueue_assets');

/* STUDIO SHORTCODE */

function uams_studio_shortcode() {
    ob_start(); ?>
    <div id="uams-app" class="uams-app">
        <header class="uams-header">
            <div class="uams-brand"><div class="uams-logo">🎸</div><div><h1>UA Music Studio</h1><p><?php echo esc_html(uams_text('Музика. Акорди. Твоя гітара.', 'Music. Chords. Your guitar.')); ?></p></div></div>
            <span class="uams-version"><?php echo esc_html(UAMS_VERSION); ?></span>
        </header>
        <main class="uams-main">
            <section class="uams-panel">
                <h2><?php echo esc_html(uams_text('1. Завантаж композицію', '1. Load a composition')); ?></h2>
                <label for="uams-audio-file" class="uams-file-label"><span>🎵</span><strong><?php echo esc_html(uams_text('Вибрати аудіофайл', 'Choose audio file')); ?></strong><small>MP3, WAV, OGG, M4A, FLAC</small></label>
                <input type="file" id="uams-audio-file" accept="audio/*">
                <div class="uams-url-row"><input type="url" id="uams-audio-url" placeholder="<?php echo esc_attr(uams_text('Пряме посилання на аудіофайл', 'Direct audio file URL')); ?>"><button type="button" id="uams-load-url"><?php echo esc_html(uams_text('Завантажити', 'Load')); ?></button></div>
                <div id="uams-file-info" class="uams-file-info"><?php echo esc_html(uams_text('Композицію ще не вибрано.', 'No composition selected.')); ?></div>
            </section>
            <section class="uams-panel">
                <h2><?php echo esc_html(uams_text('2. Прослуховування', '2. Listening')); ?></h2>
                <audio id="uams-original-audio" controls preload="metadata"></audio><div id="uams-player-status" class="uams-status"></div>
            </section>
            <section class="uams-panel">
                <h2><?php echo esc_html(uams_text('3. Аналіз композиції', '3. Composition analysis')); ?></h2>
                <div class="uams-analysis-grid">
                    <div class="uams-info-card"><span><?php echo esc_html(uams_text('Тональність', 'Key')); ?></span><strong id="uams-key">—</strong></div>
                    <div class="uams-info-card"><span><?php echo esc_html(uams_text('Темп', 'Tempo')); ?></span><strong id="uams-bpm">—</strong></div>
                    <div class="uams-info-card"><span><?php echo esc_html(uams_text('Тривалість', 'Duration')); ?></span><strong id="uams-duration">—</strong></div>
                </div>
                <button type="button" id="uams-analyze" class="uams-primary-button" disabled><?php echo esc_html(uams_text('Проаналізувати композицію', 'Analyze composition')); ?></button><div id="uams-analysis-status" class="uams-status"></div>
            </section>
            <section class="uams-panel">
                <h2><?php echo esc_html(uams_text('4. Акорди та гітара', '4. Chords and guitar')); ?></h2>
                <div id="uams-chord-timeline" class="uams-chord-timeline"><?php echo esc_html(uams_text('Тут з’явиться карта акордів.', 'The chord map will appear here.')); ?></div>
                <div id="uams-chord-diagram" class="uams-chord-diagram"><?php echo esc_html(uams_text('Вибери акорд, щоб побачити схему постановки пальців.', 'Select a chord to see its fingering diagram.')); ?></div>
            </section>
            <section class="uams-panel">
                <h2><?php echo esc_html(uams_text('5. Обробка композиції', '5. Audio processing')); ?></h2>
                <div class="uams-control-group">
                    <label for="uams-transpose"><?php echo esc_html(uams_text('Транспонування:', 'Transpose:')); ?> <strong id="uams-transpose-value">0</strong> <?php echo esc_html(uams_text('півтонів', 'semitones')); ?></label>
                    <input type="range" id="uams-transpose" min="-12" max="12" step="1" value="0" disabled>
                    <div class="uams-range-labels"><span>-12</span><span><?php echo esc_html(uams_text('Оригінал', 'Original')); ?></span><span>+12</span></div>
                    <button type="button" id="uams-apply-transpose" disabled><?php echo esc_html(uams_text('Застосувати транспонування', 'Apply transpose')); ?></button>
                </div>
                <h3><?php echo esc_html(uams_text('Окремі доріжки', 'Separate tracks')); ?></h3>
                <p class="uams-help"><?php echo esc_html(uams_text('Перше розділення завантажує AI-модель. Обробка відбувається у браузері й може потребувати багато пам’яті.', 'The first separation downloads an AI model. Processing runs in your browser and may require substantial memory.')); ?></p>
                <button type="button" id="uams-separate-stems" disabled><?php echo esc_html(uams_text('Розділити на доріжки', 'Separate into stems')); ?></button>
                <div id="uams-stems-list" class="uams-stems-list"></div><div id="uams-processing-status" class="uams-status"></div>
                <div class="uams-processed-player"><h3><?php echo esc_html(uams_text('Оброблена композиція', 'Processed composition')); ?></h3><audio id="uams-processed-audio" controls preload="metadata"></audio><button type="button" id="uams-download-processed" disabled><?php echo esc_html(uams_text('Завантажити оброблену композицію', 'Download processed composition')); ?></button></div>
            </section>
            <section class="uams-panel">
                <h2><?php echo esc_html(uams_text('6. Текст пісні та переклад', '6. Lyrics and translation')); ?></h2>
                <p class="uams-help"><?php echo esc_html(uams_text('Розпізнавання співу експериментальне: результат залежить від вокалу, музики та мови.', 'Singing transcription is experimental and depends on vocals, music and language.')); ?></p>
                <button type="button" id="uams-recognize-lyrics" disabled><?php echo esc_html(uams_text('Розпізнати текст пісні', 'Recognize lyrics')); ?></button><div id="uams-lyrics-status" class="uams-status"></div>
                <div class="uams-lyrics-grid"><div><h3><?php echo esc_html(uams_text('Оригінальний текст', 'Original lyrics')); ?></h3><div id="uams-lyrics" class="uams-lyrics" contenteditable="true"></div></div><div><h3><?php echo esc_html(uams_text('Український переклад', 'Ukrainian translation')); ?></h3><button type="button" id="uams-translate-lyrics" disabled><?php echo esc_html(uams_text('Перекласти українською', 'Translate to Ukrainian')); ?></button><div id="uams-translation" class="uams-lyrics" contenteditable="true"></div></div></div>
            </section>
            <section class="uams-panel">
                <h2><?php echo esc_html(uams_text('7. Зберегти композицію', '7. Save composition')); ?></h2>
                <label for="uams-song-title"><?php echo esc_html(uams_text('Назва композиції', 'Composition title')); ?></label><input type="text" id="uams-song-title" placeholder="<?php echo esc_attr(uams_text('Назва пісні', 'Song title')); ?>">
                <label for="uams-song-notes"><?php echo esc_html(uams_text('Мої нотатки', 'My notes')); ?></label><textarea id="uams-song-notes" rows="3"></textarea>
                <button type="button" id="uams-save-song" class="uams-primary-button" disabled><?php echo esc_html(uams_text('Зберегти в колекцію', 'Save to collection')); ?></button><div id="uams-save-status" class="uams-status"></div>
                <p class="uams-help"><?php echo esc_html(uams_text('Безкоштовно можна зберегти 10 композицій. Прослуховування й обробка без збереження не обмежуються.', 'You can save 10 compositions for free. Listening and processing without saving are not limited.')); ?></p>
                <button type="button" id="uams-buy-pro"><?php echo esc_html(uams_text('Придбати PRO', 'Buy PRO')); ?></button>
            </section>
            <section class="uams-panel">
                <h2><?php echo esc_html(uams_text('8. Моя колекція', '8. My collection')); ?></h2>
                <div class="uams-collection-tools"><input type="search" id="uams-collection-search" placeholder="<?php echo esc_attr(uams_text('Пошук композицій...', 'Search compositions...')); ?>"><select id="uams-collection-sort"><option value="newest"><?php echo esc_html(uams_text('Спочатку нові', 'Newest first')); ?></option><option value="oldest"><?php echo esc_html(uams_text('Спочатку старі', 'Oldest first')); ?></option><option value="title"><?php echo esc_html(uams_text('За назвою', 'By title')); ?></option><option value="key"><?php echo esc_html(uams_text('За тональністю', 'By key')); ?></option></select></div>
                <div id="uams-collection-count" class="uams-status"></div><div id="uams-collection-list"><?php echo esc_html(uams_text('Колекція завантажується...', 'Loading collection...')); ?></div>
            </section>
        </main>
        <footer class="uams-footer">UA Music Studio <?php echo esc_html(UAMS_VERSION); ?> · UA Server</footer>
    </div>
    <?php
    return ob_get_clean();
}
add_shortcode('ua_music_studio', 'uams_studio_shortcode');

/* AJAX COMMON */

function uams_check_ajax_access() {
    check_ajax_referer('uams_nonce', 'nonce');
    if (!is_user_logged_in()) wp_send_json_error(array('message' => uams_text('Потрібно увійти на сайт.', 'You must log in.')), 401);
}

function uams_ajax_get_collection() {
    uams_check_ajax_access();
    $items = uams_get_collection(get_current_user_id());
    foreach ($items as &$song) unset($song['audio_file'], $song['processed_file']);
    unset($song);
    wp_send_json_success(array(
        'collection' => $items,
        'count' => count($items),
        'limit' => UAMS_FREE_SONG_LIMIT,
        'isPro' => uams_is_pro(),
        'canSave' => uams_can_save_song(get_current_user_id())
    ));
}
add_action('wp_ajax_uams_get_collection', 'uams_ajax_get_collection');

function uams_ajax_save_song() {
    uams_check_ajax_access();
    $user_id = get_current_user_id();

    if (!uams_can_save_song($user_id)) {
        wp_send_json_error(array(
            'code' => 'limit_reached',
            'message' => uams_text('Безкоштовний ліміт — 10 композицій. Придбайте PRO.', 'Free limit is 10 compositions. Upgrade to PRO.'),
            'count' => uams_get_collection_count($user_id),
            'limit' => UAMS_FREE_SONG_LIMIT
        ), 403);
    }

    $title = isset($_POST['title']) ? sanitize_text_field(wp_unslash($_POST['title'])) : '';
    if ($title === '') wp_send_json_error(array('message' => uams_text('Вкажи назву композиції.', 'Enter a composition title.')), 400);

    $decode = function ($key) {
        if (!isset($_POST[$key])) return array();
        $value = json_decode(wp_unslash($_POST[$key]), true);
        return is_array($value) ? $value : array();
    };

    $song = array(
        'id' => wp_generate_uuid4(),
        'title' => $title,
        'key' => isset($_POST['key']) ? sanitize_text_field(wp_unslash($_POST['key'])) : '',
        'bpm' => isset($_POST['bpm']) ? absint($_POST['bpm']) : 0,
        'duration' => isset($_POST['duration']) ? absint($_POST['duration']) : 0,
        'transpose' => isset($_POST['transpose']) ? max(-12, min(12, intval($_POST['transpose']))) : 0,
        'notes' => isset($_POST['notes']) ? sanitize_textarea_field(wp_unslash($_POST['notes'])) : '',
        'lyrics' => isset($_POST['lyrics']) ? sanitize_textarea_field(wp_unslash($_POST['lyrics'])) : '',
        'translation' => isset($_POST['translation']) ? sanitize_textarea_field(wp_unslash($_POST['translation'])) : '',
        'chords' => $decode('chords'),
        'segments' => $decode('segments'),
        'audio_file' => array(),
        'processed_file' => array(),
        'created' => current_time('timestamp')
    );

    $items = uams_get_collection($user_id);
    $items[] = $song;
    update_user_meta($user_id, UAMS_COLLECTION_META, array_values($items));

    wp_send_json_success(array('song' => $song, 'count' => count($items), 'isPro' => uams_is_pro(), 'message' => uams_text('Композицію додано до колекції.', 'Composition added to collection.')));
}
add_action('wp_ajax_uams_save_song', 'uams_ajax_save_song');

function uams_ajax_upload_media() {
    uams_check_ajax_access();
    $user_id = get_current_user_id();
    $song_id = isset($_POST['song_id']) ? sanitize_text_field(wp_unslash($_POST['song_id'])) : '';
    $kind = isset($_POST['kind']) ? sanitize_key(wp_unslash($_POST['kind'])) : 'original';
    if (!$song_id || !in_array($kind, array('original', 'processed'), true) || empty($_FILES['file'])) {
        wp_send_json_error(array('message' => uams_text('Не вистачає даних для завантаження.', 'Missing upload information.')), 400);
    }

    $items = uams_get_collection($user_id);
    $index = uams_find_song($items, $song_id);
    if ($index === false) wp_send_json_error(array('message' => uams_text('Композицію не знайдено.', 'Composition not found.')), 404);

    $stored = uams_store_uploaded_audio($user_id, $_FILES['file']);
    if (is_wp_error($stored)) wp_send_json_error(array('message' => $stored->get_error_message()), 400);

    $field = $kind === 'processed' ? 'processed_file' : 'audio_file';
    if (!empty($items[$index][$field])) uams_delete_media_file($items[$index][$field]);
    $items[$index][$field] = $stored;
    update_user_meta($user_id, UAMS_COLLECTION_META, array_values($items));

    wp_send_json_success(array('media' => array('id' => $stored['id'], 'name' => $stored['name'], 'size' => $stored['size'])));
}
add_action('wp_ajax_uams_upload_media', 'uams_ajax_upload_media');

function uams_ajax_delete_song() {
    uams_check_ajax_access();
    $user_id = get_current_user_id();
    $song_id = isset($_POST['song_id']) ? sanitize_text_field(wp_unslash($_POST['song_id'])) : '';
    $items = uams_get_collection($user_id);
    $index = uams_find_song($items, $song_id);
    if ($index === false) wp_send_json_error(array('message' => uams_text('Композицію не знайдено.', 'Composition not found.')), 404);

    foreach (array('audio_file', 'processed_file') as $field) {
        if (!empty($items[$index][$field])) uams_delete_media_file($items[$index][$field]);
    }
    array_splice($items, $index, 1);
    update_user_meta($user_id, UAMS_COLLECTION_META, array_values($items));
    wp_send_json_success(array('count' => count($items), 'message' => uams_text('Композицію видалено.', 'Composition deleted.')));
}
add_action('wp_ajax_uams_delete_song', 'uams_ajax_delete_song');

function uams_ajax_update_notes() {
    uams_check_ajax_access();
    $user_id = get_current_user_id();
    $song_id = isset($_POST['song_id']) ? sanitize_text_field(wp_unslash($_POST['song_id'])) : '';
    $notes = isset($_POST['notes']) ? sanitize_textarea_field(wp_unslash($_POST['notes'])) : '';
    $items = uams_get_collection($user_id);
    $index = uams_find_song($items, $song_id);
    if ($index === false) wp_send_json_error(array('message' => uams_text('Композицію не знайдено.', 'Composition not found.')), 404);
    $items[$index]['notes'] = $notes;
    update_user_meta($user_id, UAMS_COLLECTION_META, array_values($items));
    wp_send_json_success(array('message' => uams_text('Нотатки оновлено.', 'Notes updated.')));
}
add_action('wp_ajax_uams_update_notes', 'uams_ajax_update_notes');

function uams_get_media_url($media_id, $download = false) {
    return add_query_arg(array(
        'action' => 'uams_stream_media',
        'media_id' => $media_id,
        'download' => $download ? '1' : '0',
        '_wpnonce' => wp_create_nonce('uams_stream_media')
    ), admin_url('admin-post.php'));
}

function uams_ajax_get_media_url() {
    uams_check_ajax_access();
    $user_id = get_current_user_id();
    $song_id = isset($_POST['song_id']) ? sanitize_text_field(wp_unslash($_POST['song_id'])) : '';
    $kind = isset($_POST['kind']) ? sanitize_key(wp_unslash($_POST['kind'])) : 'original';
    $items = uams_get_collection($user_id);
    $index = uams_find_song($items, $song_id);
    if ($index === false || !in_array($kind, array('original', 'processed'), true)) wp_send_json_error(array('message' => 'Invalid media request.'), 400);

    $field = $kind === 'processed' ? 'processed_file' : 'audio_file';
    if (empty($items[$index][$field]['id'])) wp_send_json_error(array('message' => uams_text('Аудіофайл не збережено.', 'Audio file is not saved.')), 404);
    $id = $items[$index][$field]['id'];
    wp_send_json_success(array('url' => uams_get_media_url($id), 'downloadUrl' => uams_get_media_url($id, true)));
}
add_action('wp_ajax_uams_get_media_url', 'uams_ajax_get_media_url');

/* SECURE AUDIO STREAM WITH HTTP RANGE SUPPORT */

function uams_stream_media() {
    if (!is_user_logged_in()) { status_header(401); exit; }
    $nonce = isset($_GET['_wpnonce']) ? sanitize_text_field(wp_unslash($_GET['_wpnonce'])) : '';
    if (!wp_verify_nonce($nonce, 'uams_stream_media')) { status_header(403); exit; }

    $media_id = isset($_GET['media_id']) ? sanitize_text_field(wp_unslash($_GET['media_id'])) : '';
    $items = uams_get_collection(get_current_user_id());
    $media = false;

    foreach ($items as $song) {
        foreach (array('audio_file', 'processed_file') as $field) {
            if (!empty($song[$field]['id']) && hash_equals((string) $song[$field]['id'], $media_id)) {
                $media = $song[$field];
                break 2;
            }
        }
    }

    if (!$media || empty($media['path']) || !is_file($media['path'])) { status_header(404); exit; }
    $base = trailingslashit(wp_normalize_path(uams_private_directory()));
    $path = wp_normalize_path($media['path']);
    if (strpos($path, $base) !== 0) { status_header(403); exit; }

    $size = (int) filesize($path);
    $start = 0;
    $end = max(0, $size - 1);
    $status = 200;

    if (!empty($_SERVER['HTTP_RANGE']) && preg_match('/bytes=(\d*)-(\d*)/', sanitize_text_field(wp_unslash($_SERVER['HTTP_RANGE'])), $matches)) {
        if ($matches[1] !== '') $start = (int) $matches[1];
        if ($matches[2] !== '') $end = (int) $matches[2];
        if ($matches[1] === '' && $matches[2] !== '') {
            $suffix = (int) $matches[2];
            $start = max(0, $size - $suffix);
            $end = $size - 1;
        }
        if ($start > $end || $start >= $size) {
            status_header(416);
            header('Content-Range: bytes */' . $size);
            exit;
        }
        $end = min($end, $size - 1);
        $status = 206;
    }

    $length = $end - $start + 1;
    $mime = !empty($media['mime']) ? $media['mime'] : 'application/octet-stream';
    $download = isset($_GET['download']) && $_GET['download'] === '1';

    while (ob_get_level()) ob_end_clean();
    status_header($status);
    header('Content-Type: ' . $mime);
    header('Accept-Ranges: bytes');
    header('Content-Length: ' . $length);
    header('X-Content-Type-Options: nosniff');
    header('Cache-Control: private, max-age=3600');
    if ($status === 206) header("Content-Range: bytes $start-$end/$size");
    header('Content-Disposition: ' . ($download ? 'attachment' : 'inline') . '; filename="' . rawurlencode(basename($media['name'])) . '"');

    $fp = fopen($path, 'rb');
    if (!$fp) { status_header(500); exit; }
    fseek($fp, $start);
    $remaining = $length;
    while ($remaining > 0 && !feof($fp)) {
        $chunk = fread($fp, min(8192, $remaining));
        if ($chunk === false || $chunk === '') break;
        echo $chunk;
        $remaining -= strlen($chunk);
        flush();
    }
    fclose($fp);
    exit;
}
add_action('admin_post_uams_stream_media', 'uams_stream_media');
add_action('admin_post_nopriv_uams_stream_media', 'uams_stream_media');

/* UA PAY BOX PRO ACTIVATION */

function uams_ajax_activate_pro() {
    check_ajax_referer('uams_nonce', 'nonce');
    if (!current_user_can('manage_options')) wp_send_json_error(array('message' => uams_text('Оплату PRO може ініціювати адміністратор сайту.', 'Only the site administrator can initiate PRO activation.')), 403);
    if (!function_exists('ua_music_studio_activate_pro')) wp_send_json_error(array('message' => 'UA Pay Box integration is unavailable.'), 500);

    $result = ua_music_studio_activate_pro();
    if (is_wp_error($result)) wp_send_json_error(array('message' => $result->get_error_message()), 500);
    $url = !empty($result['url']) ? esc_url_raw($result['url']) : '';
    if (!$url) wp_send_json_error(array('message' => uams_text('Сервер оплати не повернув посилання.', 'Payment server did not return a URL.')), 500);
    wp_send_json_success(array('url' => $url));
}
add_action('wp_ajax_uams_activate_pro', 'uams_ajax_activate_pro');

/* GITHUB UPDATER */

function uams_github_latest_release() {
    $cached = get_transient('uams_github_release');
    if (is_array($cached)) return $cached;

    $url = sprintf('https://api.github.com/repos/%s/%s/releases/latest', UAMS_GITHUB_USER, UAMS_GITHUB_REPO);
    $response = wp_remote_get($url, array('timeout' => 10, 'headers' => array(
        'Accept' => 'application/vnd.github+json',
        'User-Agent' => 'UA-Music-Studio-WordPress-Updater'
    )));
    if (is_wp_error($response) || 200 !== (int) wp_remote_retrieve_response_code($response)) return false;

    $data = json_decode(wp_remote_retrieve_body($response), true);
    if (!is_array($data) || empty($data['tag_name']) || empty($data['assets'])) return false;

    $package = '';
    foreach ($data['assets'] as $asset) {
        if (!empty($asset['name']) && $asset['name'] === 'ua-music-studio.zip' && !empty($asset['browser_download_url'])) {
            $package = esc_url_raw($asset['browser_download_url']);
            break;
        }
    }
    if (!$package) return false;

    $release = array(
        'version' => ltrim(sanitize_text_field($data['tag_name']), 'v'),
        'package' => $package,
        'url' => !empty($data['html_url']) ? esc_url_raw($data['html_url']) : ''
    );
    set_transient('uams_github_release', $release, 6 * HOUR_IN_SECONDS);
    return $release;
}

function uams_check_for_update($transient) {
    if (empty($transient->checked)) return $transient;
    $release = uams_github_latest_release();
    if (!$release) return $transient;

    if (version_compare($release['version'], UAMS_VERSION, '>')) {
        $basename = plugin_basename(UAMS_FILE);
        $transient->response[$basename] = (object) array(
            'slug' => 'ua-music-studio',
            'plugin' => $basename,
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
add_filter('pre_set_site_transient_update_plugins', 'uams_check_for_update');

function uams_plugin_information($result, $action, $args) {
    if ($action !== 'plugin_information' || empty($args->slug) || $args->slug !== 'ua-music-studio') return $result;
    $release = uams_github_latest_release();
    if (!$release) return $result;

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
add_filter('plugins_api', 'uams_plugin_information', 20, 3);

add_action('upgrader_process_complete', function () {
    delete_transient('uams_github_release');
});
