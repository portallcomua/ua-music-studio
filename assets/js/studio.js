(function () {
    'use strict';

    document.addEventListener('DOMContentLoaded', function () {
        const root = document.querySelector('.uams-studio');

        if (!root) {
            return;
        }

        const config = window.UAMS_CONFIG || {};

        const engine = new window.UAMSAudioEngine();
        const analyzer = new window.UAMSChordAnalyzer();
        const pitchShifter = new window.UAMSPitchShifter();
        const separator = new window.UAMSStemSeparator();
        const lyrics = new window.UAMSLyricsRecognition();
        const translation = new window.UAMSTranslation();
        const collection = new window.UAMSCollection(config);

        let currentFile = null;
        let currentAnalysis = null;
        let currentTranspose = 0;

        const $ = selector => root.querySelector(selector);

        function status(message, type) {
            const element = $('#uams-status');

            if (!element) {
                alert(message);
                return;
            }

            element.textContent = message;
            element.className =
                'uams-status is-visible uams-status-' +
                (type || 'info');
        }

        function clearStatus() {
            const element = $('#uams-status');

            if (element) {
                element.textContent = '';
                element.className = 'uams-status';
            }
        }

        function formatTime(seconds) {
            seconds = Math.floor(Number(seconds) || 0);

            const minutes = Math.floor(seconds / 60);
            const remaining = seconds % 60;

            return minutes + ':' + String(remaining).padStart(2, '0');
        }

        function setText(selector, value) {
            const element = $(selector);

            if (element) {
                element.textContent = value;
            }
        }

        function renderAnalysis(result) {
            setText('#uams-key', result.key || '—');
            setText('#uams-bpm', result.bpm || '—');

            const chordBox = $('#uams-chords');

            if (!chordBox) {
                return;
            }

            chordBox.innerHTML = '';

            if (!result.chords || !result.chords.length) {
                chordBox.textContent = 'Акорди не визначені.';
                return;
            }

            result.chords.forEach(chord => {
                const item = document.createElement('div');
                item.className = 'uams-chord';

                const name = document.createElement('strong');
                name.textContent = chord.name;

                const time = document.createElement('small');
                time.textContent = formatTime(chord.time);

                item.appendChild(name);
                item.appendChild(time);

                item.addEventListener('click', () => {
                    engine.seek(chord.time);
                    engine.play().catch(error => status(
                        error.message,
                        'error'
                    ));
                });

                chordBox.appendChild(item);
            });
        }

        function updatePlayer(current, duration) {
            const currentLabel = $('#uams-current-time');
            const durationLabel = $('#uams-duration');
            const progress = $('#uams-progress');

            if (currentLabel) {
                currentLabel.textContent = formatTime(current);
            }

            if (durationLabel) {
                durationLabel.textContent = formatTime(duration);
            }

            if (progress) {
                const percent = duration > 0
                    ? current / duration * 100
                    : 0;

                progress.style.width = percent + '%';
            }
        }

        const fileInput = $('#uams-audio-file');

        if (fileInput) {
            fileInput.addEventListener('change', async function () {
                const file = this.files && this.files[0];

                if (!file) {
                    return;
                }

                try {
                    clearStatus();
                    status('Завантаження аудіофайлу...');

                    const info = await engine.loadFile(file);

                    currentFile = file;
                    currentAnalysis = null;
                    currentTranspose = 0;

                    setText('#uams-file-name', info.name);
                    setText('#uams-duration', formatTime(info.duration));

                    status(
                        'Композицію завантажено. Можна слухати та аналізувати.',
                        'success'
                    );
                } catch (error) {
                    status(error.message, 'error');
                }
            });
        }

        const urlButton = $('#uams-load-url');

        if (urlButton) {
            urlButton.addEventListener('click', async function () {
                const input = $('#uams-audio-url');

                if (!input || !input.value.trim()) {
                    status('Введіть посилання на аудіофайл.', 'error');
                    return;
                }

                try {
                    status('Завантаження аудіо за посиланням...');

                    const info = await engine.loadUrl(input.value.trim());

                    currentFile = null;
                    currentAnalysis = null;

                    setText('#uams-file-name', info.name);
                    setText('#uams-duration', formatTime(info.duration));

                    status('Аудіо завантажено.', 'success');
                } catch (error) {
                    status(error.message, 'error');
                }
            });
        }

        const playButton = $('#uams-play');

        if (playButton) {
            playButton.addEventListener('click', async function () {
                try {
                    await engine.play();
                } catch (error) {
                    status(error.message, 'error');
                }
            });
        }

        const pauseButton = $('#uams-pause');

        if (pauseButton) {
            pauseButton.addEventListener('click', function () {
                engine.pause();
            });
        }

        const stopButton = $('#uams-stop');

        if (stopButton) {
            stopButton.addEventListener('click', function () {
                engine.stop();
                updatePlayer(0, engine.getDuration());
            });
        }

        const volume = $('#uams-volume');

        if (volume) {
            volume.addEventListener('input', function () {
                engine.setVolume(this.value);
            });
        }

        const seek = $('#uams-seek');

        if (seek) {
            seek.addEventListener('input', function () {
                const duration = engine.getDuration();

                if (duration > 0) {
                    engine.seek(duration * Number(this.value) / 100);
                }
            });
        }

        engine.onTimeUpdate = function (current, duration) {
            updatePlayer(current, duration);

            if (seek && duration > 0) {
                seek.value = current / duration * 100;
            }
        };

        engine.onEnded = function () {
            if (seek) {
                seek.value = 0;
            }
        };

        const analyzeButton = $('#uams-analyze');

        if (analyzeButton) {
            analyzeButton.addEventListener('click', function () {
                try {
                    const buffer = engine.getBuffer();

                    if (!buffer) {
                        throw new Error(
                            'Для аналізу потрібен локально доступний аудіофайл.'
                        );
                    }

                    status('Аналіз композиції...');

                    currentAnalysis = analyzer.analyzeBuffer(buffer);

                    renderAnalysis(currentAnalysis);

                    status(
                        'Базовий аналіз завершено. Результати можуть потребувати перевірки.',
                        'success'
                    );
                } catch (error) {
                    status(error.message, 'error');
                }
            });
        }

        function updateTransposeDisplay() {
            setText(
                '#uams-transpose-value',
                (currentTranspose > 0 ? '+' : '') + currentTranspose
            );

            if (currentAnalysis) {
                const shifted = analyzer.transposeChords(
                    currentAnalysis.chords,
                    currentTranspose
                );

                renderAnalysis({
                    ...currentAnalysis,
                    key: currentTranspose === 0
                        ? currentAnalysis.key
                        : analyzer.transposeChord(
                            currentAnalysis.key.replace(' minor', '').replace(' major', ''),
                            currentTranspose
                        ) + (
                            currentAnalysis.key.includes('minor')
                                ? ' minor'
                                : ' major'
                        ),
                    chords: shifted
                });
            }
        }

        const transposeDown = $('#uams-transpose-down');
        const transposeUp = $('#uams-transpose-up');
        const transposeReset = $('#uams-transpose-reset');

        if (transposeDown) {
            transposeDown.addEventListener('click', function () {
                currentTranspose = Math.max(-12, currentTranspose - 1);
                updateTransposeDisplay();
            });
        }

        if (transposeUp) {
            transposeUp.addEventListener('click', function () {
                currentTranspose = Math.min(12, currentTranspose + 1);
                updateTransposeDisplay();
            });
        }

        if (transposeReset) {
            transposeReset.addEventListener('click', function () {
                currentTranspose = 0;
                updateTransposeDisplay();
            });
        }

        const separateButton = $('#uams-separate');

        if (separateButton) {
            separateButton.addEventListener('click', async function () {
                try {
                    const buffer = engine.getBuffer();

                    if (!buffer) {
                        throw new Error('Спочатку завантажте аудіофайл.');
                    }

                    await separator.separate(buffer, [
                        'vocals',
                        'guitar',
                        'bass',
                        'drums',
                        'piano',
                        'other'
                    ]);
                } catch (error) {
                    status(error.message, 'error');
                }
            });
        }

        const lyricsButton = $('#uams-recognize-lyrics');

        if (lyricsButton) {
            lyricsButton.addEventListener('click', async function () {
                try {
                    const buffer = engine.getBuffer();

                    if (!buffer) {
                        throw new Error('Спочатку завантажте аудіофайл.');
                    }

                    const result = await lyrics.recognize(buffer, {
                        language: 'auto'
                    });

                    const output = $('#uams-lyrics');

                    if (output) {
                        output.textContent = result.text;
                    }

                    status('Розпізнавання завершено.', 'success');
                } catch (error) {
                    status(error.message, 'error');
                }
            });
        }

        const translateButton = $('#uams-translate');

        if (translateButton) {
            translateButton.addEventListener('click', async function () {
                try {
                    const output = $('#uams-lyrics');

                    if (!output || !output.textContent.trim()) {
                        throw new Error('Спочатку отримайте текст композиції.');
                    }

                    const result = await translation.translate(
                        output.textContent,
                        'uk'
                    );

                    const translated = $('#uams-translation');

                    if (translated) {
                        translated.textContent = result;
                    }

                    status('Переклад завершено.', 'success');
                } catch (error) {
                    status(error.message, 'error');
                }
            });
        }

        const exportButton = $('#uams-export-wav');

        if (exportButton) {
            exportButton.addEventListener('click', async function () {
                try {
                    const blob = await engine.exportWav();
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement('a');

                    link.href = url;
                    link.download = 'ua-music-studio.wav';
                    link.click();

                    setTimeout(() => URL.revokeObjectURL(url), 1000);

                    status('WAV-файл підготовлено.', 'success');
                } catch (error) {
                    status(error.message, 'error');
                }
            });
        }

        const saveButton = $('#uams-save-song');

        if (saveButton) {
            saveButton.addEventListener('click', async function () {
                try {
                    const titleInput = $('#uams-song-title');
                    const notesInput = $('#uams-song-notes');

                    const title = titleInput
                        ? titleInput.value.trim()
                        : '';

                    if (!title) {
                        throw new Error('Введіть назву композиції.');
                    }

                    const song = {
                        title: title,
                        key: currentAnalysis
                            ? currentAnalysis.key
                            : '',
                        bpm: currentAnalysis
                            ? currentAnalysis.bpm
                            : '',
                        chords: currentAnalysis
                            ? currentAnalysis.chords
                            : [],
                        notes: notesInput
                            ? notesInput.value
                            : '',
                        transpose: currentTranspose,
                        created: Math.floor(Date.now() / 1000)
                    };

                    await collection.save(song);

                    status('Композицію збережено в колекцію.', 'success');

                    await renderCollection();
                } catch (error) {
                    status(error.message, 'error');
                }
            });
        }

        async function renderCollection() {
            const container = $('#uams-song-list');

            if (!container) {
                return;
            }

            try {
                await collection.load();

                container.innerHTML = '';

                if (!collection.songs.length) {
                    container.textContent =
                        'У колекції поки немає композицій.';
                    return;
                }

                collection.sort('newest').forEach(song => {
                    const item = document.createElement('div');
                    item.className = 'uams-song-item';

                    const info = document.createElement('div');
                    info.className = 'uams-song-info';

                    const title = document.createElement('strong');
                    title.textContent = song.title || 'Без назви';

                    const details = document.createElement('small');
                    details.textContent =
                        (song.key || 'Тональність не визначена') +
                        (song.bpm ? ' · ' + song.bpm + ' BPM' : '');

                    info.appendChild(title);
                    info.appendChild(details);

                    const actions = document.createElement('div');
                    actions.className = 'uams-song-actions';

                    const deleteButton = document.createElement('button');
                    deleteButton.type = 'button';
                    deleteButton.className =
                        'uams-button uams-button-danger';
                    deleteButton.textContent = 'Видалити';

                    deleteButton.addEventListener('click', async function () {
                        if (!confirm('Видалити композицію з колекції?')) {
                            return;
                        }

                        try {
                            await collection.remove(song.id);
                            await renderCollection();
                            status('Композицію видалено.', 'success');
                        } catch (error) {
                            status(error.message, 'error');
                        }
                    });

                    actions.appendChild(deleteButton);
                    item.appendChild(info);
                    item.appendChild(actions);
                    container.appendChild(item);
                });
            } catch (error) {
                status(error.message, 'error');
            }
        }

        const search = $('#uams-collection-search');

        if (search) {
            search.addEventListener('input', function () {
                const container = $('#uams-song-list');

                if (!container) return;

                const results = collection.find(this.value);
                container.innerHTML = '';

                results.forEach(song => {
                    const item = document.createElement('div');
                    item.className = 'uams-song-item';

                    const title = document.createElement('strong');
                    title.textContent = song.title || 'Без назви';

                    item.appendChild(title);
                    container.appendChild(item);
                });
            });
        }

        renderCollection();

        window.UAMSMusicStudio = {
            engine: engine,
            analyzer: analyzer,
            pitchShifter: pitchShifter,
            separator: separator,
            lyrics: lyrics,
            translation: translation,
            collection: collection
        };
    });
})();
