(function () {
    'use strict';

    document.addEventListener('DOMContentLoaded', function () {
        const root = document.querySelector('#uams-app');
        if (!root) return;

        const cfg = window.UAMS_CONFIG || {};
        const $ = id => root.querySelector('#' + id);

        const engine = new UAMSAudioEngine();
        const analyzer = new UAMSChordAnalyzer();
        const collection = new UAMSCollection(cfg);
        const shifter = new UAMSPitchShifter();
        const separator = new UAMSStemSeparator();
        const lyrics = new UAMSLyricsRecognition();
        const translation = new UAMSTranslation();

        let sourceFile = null;
        let analysis = null;
        let processedBlob = null;
        let transpose = 0;

        const message = (id, text, type) => {
            const el = $(id);
            if (!el) return;
            el.textContent = text || '';
            el.className = 'uams-status' + (text ? ' is-visible uams-status-' + (type || 'info') : '');
        };

        const time = seconds => {
            seconds = Math.max(0, Math.floor(Number(seconds) || 0));
            return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0');
        };

        const enable = (id, value) => {
            const el = $(id);
            if (el) el.disabled = !value;
        };

        function updateFileInfo(info) {
            const el = $('uams-file-info');
            if (el) el.textContent = info.name + ' · ' + time(info.duration);
            if ($('uams-duration')) $('uams-duration').textContent = time(info.duration);

            [
                'uams-analyze',
                'uams-transpose',
                'uams-apply-transpose',
                'uams-separate-stems',
                'uams-recognize-lyrics',
                'uams-save-song'
            ].forEach(id => enable(id, true));
        }

        $('uams-audio-file')?.addEventListener('change', async function () {
            const file = this.files && this.files[0];
            if (!file) return;

            try {
                message('uams-player-status', 'Завантаження аудіофайлу…');
                const info = await engine.loadFile(file);
                sourceFile = file;
                analysis = null;
                transpose = 0;
                processedBlob = null;
                updateFileInfo(info);
                $('uams-original-audio').src = engine.getAudioElement().src;
                message('uams-player-status', 'Файл завантажено. Можна прослухати композицію.', 'success');
            } catch (error) {
                message('uams-player-status', error.message, 'error');
            }
        });

        $('uams-load-url')?.addEventListener('click', async function () {
            const url = $('uams-audio-url')?.value.trim();
            if (!url) {
                message('uams-player-status', 'Введіть пряме посилання на аудіофайл.', 'error');
                return;
            }

            try {
                message('uams-player-status', 'Завантаження аудіо за посиланням…');
                const info = await engine.loadUrl(url);
                sourceFile = null;
                analysis = null;
                transpose = 0;
                processedBlob = null;
                updateFileInfo(info);
                $('uams-original-audio').src = engine.getAudioElement().src;
                message('uams-player-status', 'Аудіо відкрито.', 'success');
            } catch (error) {
                message('uams-player-status', error.message, 'error');
            }
        });

        $('uams-analyze')?.addEventListener('click', async function () {
            const buffer = engine.getBuffer();
            if (!buffer) {
                message('uams-analysis-status', 'Для аналізу потрібен локально доступний аудіофайл. Якщо URL не дозволяє CORS, завантажте файл із пристрою.', 'error');
                return;
            }

            this.disabled = true;
            message('uams-analysis-status', 'Аналіз аудіо… Це може зайняти деякий час.');

            try {
                await new Promise(resolve => setTimeout(resolve, 30));
                analysis = analyzer.analyzeBuffer(buffer);

                $('uams-key').textContent = analysis.key || '—';
                $('uams-bpm').textContent = analysis.bpm || '—';

                renderChords(analysis.chords || []);
                $('uams-song-title').value =
                    $('uams-song-title').value || (sourceFile ? sourceFile.name.replace(/\.[^.]+$/, '') : 'Нова композиція');

                message('uams-analysis-status', 'Аналіз завершено. Автоматично визначені акорди й тональність можуть потребувати ручної перевірки.', 'success');
                enable('uams-save-song', true);
            } catch (error) {
                message('uams-analysis-status', error.message, 'error');
            } finally {
                this.disabled = false;
            }
        });

        function renderChords(chords) {
            const timeline = $('uams-chord-timeline');
            if (!timeline) return;

            timeline.replaceChildren();

            if (!chords.length) {
                timeline.textContent = 'Акорди не визначено.';
                return;
            }

            chords.forEach(chord => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'uams-chord';
                button.innerHTML = '<strong></strong><small></small>';
                button.querySelector('strong').textContent = chord.name;
                button.querySelector('small').textContent = time(chord.time);

                button.addEventListener('click', () => {
                    engine.seek(chord.time);
                    engine.play().catch(() => {});
                    renderChordDiagram(chord.name);
                });

                timeline.appendChild(button);
            });
        }

        function renderChordDiagram(name) {
            const box = $('uams-chord-diagram');
            if (!box) return;

            const shapes = {
                C: ['x', 3, 2, 0, 1, 0],
                D: ['x', 'x', 0, 2, 3, 2],
                E: [0, 2, 2, 1, 0, 0],
                G: [3, 2, 0, 0, 0, 3],
                A: ['x', 0, 2, 2, 2, 0],
                Am: ['x', 0, 2, 2, 1, 0],
                Em: [0, 2, 2, 0, 0, 0],
                Dm: ['x', 'x', 0, 2, 3, 1]
            };

            const rootName = name.replace(/(maj7|m7|7|m|sus|dim|aug).*$/, '');
            const fingers = shapes[name] || shapes[rootName] || null;

            box.replaceChildren();

            const heading = document.createElement('strong');
            heading.textContent = name;
            box.appendChild(heading);

            if (!fingers) {
                const note = document.createElement('p');
                note.textContent = 'Для цього акорду автоматична схема аплікатури не задана.';
                box.appendChild(note);
                return;
            }

            const svgNS = 'http://www.w3.org/2000/svg';
            const svg = document.createElementNS(svgNS, 'svg');
            svg.setAttribute('viewBox', '0 0 150 175');
            svg.setAttribute('width', '150');
            svg.setAttribute('height', '175');

            for (let fret = 0; fret <= 4; fret++) {
                const line = document.createElementNS(svgNS, 'line');
                line.setAttribute('x1', 25);
                line.setAttribute('x2', 125);
                line.setAttribute('y1', 30 + fret * 28);
                line.setAttribute('y2', 30 + fret * 28);
                line.setAttribute('stroke', '#555');
                line.setAttribute('stroke-width', fret === 0 ? 4 : 1);
                svg.appendChild(line);
            }

            for (let string = 0; string < 6; string++) {
                const line = document.createElementNS(svgNS, 'line');
                line.setAttribute('x1', 25 + string * 20);
                line.setAttribute('x2', 25 + string * 20);
                line.setAttribute('y1', 30);
                line.setAttribute('y2', 142);
                line.setAttribute('stroke', '#777');
                svg.appendChild(line);

                const value = fingers[string];
                const label = document.createElementNS(svgNS, 'text');
                label.setAttribute('x', 25 + string * 20);
                label.setAttribute('y', 19);
                label.setAttribute('text-anchor', 'middle');
                label.setAttribute('font-size', '11');
                label.textContent = value === 'x' ? '×' : value === 0 ? '○' : '';
                svg.appendChild(label);

                if (Number(value) > 0) {
                    const circle = document.createElementNS(svgNS, 'circle');
                    circle.setAttribute('cx', 25 + string * 20);
                    circle.setAttribute('cy', 30 + (Number(value) - 0.5) * 28);
                    circle.setAttribute('r', 7);
                    circle.setAttribute('fill', '#2563eb');
                    svg.appendChild(circle);
                }
            }

            box.appendChild(svg);
        }

        $('uams-transpose')?.addEventListener('input', function () {
            transpose = Number(this.value) || 0;
            $('uams-transpose-value').textContent = (transpose > 0 ? '+' : '') + transpose;
        });

        $('uams-apply-transpose')?.addEventListener('click', async function () {
            const buffer = engine.getBuffer();
            if (!buffer) {
                message('uams-processing-status', 'Немає аудіоданих для транспонування.', 'error');
                return;
            }

            if (transpose === 0) {
                message('uams-processing-status', 'Виберіть кількість півтонів.', 'info');
                return;
            }

            message('uams-processing-status', 'Підготовка транспонування…');
            try {
                const result = await shifter.process(buffer, transpose);
                const blob = await audioBufferToWav(result);
                processedBlob = blob;
                const url = URL.createObjectURL(blob);
                $('uams-processed-audio').src = url;
                enable('uams-download-processed', true);

                if (analysis) {
                    const shifted = analyzer.transposeChords(analysis.chords, transpose);
                    renderChords(shifted);
                }

                message('uams-processing-status', 'Оброблений WAV готовий.', 'success');
            } catch (error) {
                message('uams-processing-status', error.message, 'error');
            }
        });

        async function audioBufferToWav(buffer) {
            const channels = buffer.numberOfChannels;
            const length = buffer.length;
            const bytes = length * channels * 2;
            const output = new ArrayBuffer(44 + bytes);
            const view = new DataView(output);
            const write = (offset, text) => {
                for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
            };

            write(0, 'RIFF');
            view.setUint32(4, 36 + bytes, true);
            write(8, 'WAVE');
            write(12, 'fmt ');
            view.setUint32(16, 16, true);
            view.setUint16(20, 1, true);
            view.setUint16(22, channels, true);
            view.setUint32(24, buffer.sampleRate, true);
            view.setUint32(28, buffer.sampleRate * channels * 2, true);
            view.setUint16(32, channels * 2, true);
            view.setUint16(34, 16, true);
            write(36, 'data');
            view.setUint32(40, bytes, true);

            let offset = 44;
            for (let i = 0; i < length; i++) {
                for (let c = 0; c < channels; c++) {
                    const sample = Math.max(-1, Math.min(1, buffer.getChannelData(c)[i]));
                    view.setInt16(offset, sample < 0 ? sample * 32768 : sample * 32767, true);
                    offset += 2;
                }
            }
            return new Blob([output], { type: 'audio/wav' });
        }

        $('uams-download-processed')?.addEventListener('click', function () {
            if (!processedBlob) return;
            const url = URL.createObjectURL(processedBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'ua-music-studio-processed.wav';
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1500);
        });

        $('uams-separate-stems')?.addEventListener('click', async function () {
            const buffer = engine.getBuffer();
            if (!buffer) {
                message('uams-processing-status', 'Спочатку завантажте аудіо.', 'error');
                return;
            }

            try {
                message('uams-processing-status', 'Завантаження моделі розділення…');
                await separator.initialize({ modelUrl: cfg.models?.demucs });
                const result = await separator.separate(buffer);
                renderStems(result);
            } catch (error) {
                message('uams-processing-status', error.message, 'error');
            }
        });

        function renderStems(result) {
            const box = $('uams-stems-list');
            if (!box) return;
            box.replaceChildren();

            Object.entries(result || {}).forEach(([name, blob]) => {
                if (!(blob instanceof Blob)) return;
                const url = URL.createObjectURL(blob);
                const item = document.createElement('div');
                const title = document.createElement('strong');
                title.textContent = name;
                const audio = document.createElement('audio');
                audio.controls = true;
                audio.src = url;
                item.append(title, audio);
                box.appendChild(item);
            });
        }

        $('uams-recognize-lyrics')?.addEventListener('click', async function () {
            const buffer = engine.getBuffer();
            if (!buffer) {
                message('uams-lyrics-status', 'Спочатку завантажте аудіофайл.', 'error');
                return;
            }

            this.disabled = true;
            message('uams-lyrics-status', 'Завантаження Whisper і розпізнавання…');

            try {
                const result = await UAMSModelLoader.transcribe(buffer, {
                    language: undefined
                });
                $('uams-lyrics').textContent = result.text || '';
                $('uams-translate-lyrics').disabled = !result.text;
                message('uams-lyrics-status', 'Розпізнавання завершено. Для співу точність може бути нижчою, ніж для звичайного мовлення.', 'success');
            } catch (error) {
                message('uams-lyrics-status', error.message, 'error');
            } finally {
                this.disabled = false;
            }
        });

        $('uams-translate-lyrics')?.addEventListener('click', async function () {
            const text = $('uams-lyrics')?.textContent.trim();
            if (!text) {
                message('uams-lyrics-status', 'Спочатку розпізнайте або введіть текст.', 'error');
                return;
            }

            this.disabled = true;
            message('uams-lyrics-status', 'Завантаження моделі перекладу…');

            try {
                const result = await UAMSModelLoader.translate(text);
                $('uams-translation').textContent = result;
                message('uams-lyrics-status', 'Переклад завершено.', 'success');
            } catch (error) {
                message('uams-lyrics-status', error.message, 'error');
            } finally {
                this.disabled = false;
            }
        });

        $('uams-save-song')?.addEventListener('click', async function () {
            if (!cfg.loggedIn) {
                message('uams-save-status', cfg.messages?.loginRequired || 'Увійдіть на сайт.', 'error');
                return;
            }

            const title = $('uams-song-title')?.value.trim();
            if (!title) {
                message('uams-save-status', 'Введіть назву композиції.', 'error');
                return;
            }

            this.disabled = true;
            try {
                const saved = await collection.save({
                    title,
                    key: analysis?.key || '',
                    bpm: analysis?.bpm || 0,
                    duration: engine.getDuration(),
                    transpose,
                    notes: $('uams-song-notes')?.value || '',
                    lyrics: $('uams-lyrics')?.textContent || '',
                    translation: $('uams-translation')?.textContent || '',
                    chords: analysis?.chords || [],
                    segments: []
                });

                if (sourceFile && saved.song?.id) {
                    await collection.uploadMedia(saved.song.id, sourceFile, 'original');
                }

                if (processedBlob && saved.song?.id) {
                    const file = new File([processedBlob], 'processed.wav', { type: 'audio/wav' });
                    await collection.uploadMedia(saved.song.id, file, 'processed');
                }

                message('uams-save-status', cfg.messages?.saved || 'Композицію збережено.', 'success');
                await renderCollection();
            } catch (error) {
                message('uams-save-status', error.message, 'error');
            } finally {
                this.disabled = false;
            }
        });

        async function renderCollection() {
            const box = $('uams-collection-list');
            if (!box) return;

            try {
                await collection.load();
                const query = $('uams-collection-search')?.value || '';
                const sort = $('uams-collection-sort')?.value || 'newest';
                const filtered = collection.find(query);
                const sorted = filtered.sort((a, b) => {
                    if (sort === 'oldest') return (a.created || 0) - (b.created || 0);
                    if (sort === 'title') return String(a.title).localeCompare(String(b.title));
                    if (sort === 'key') return String(a.key).localeCompare(String(b.key));
                    return (b.created || 0) - (a.created || 0);
                });

                $('uams-collection-count').textContent =
                    collection.count + (cfg.language === 'uk' ? ' композицій у колекції' : ' compositions in collection');

                box.replaceChildren();

                if (!sorted.length) {
                    box.textContent = 'Колекція порожня або нічого не знайдено.';
                    return;
                }

                sorted.forEach(song => {
                    const item = document.createElement('article');
                    item.className = 'uams-song-item';

                    const info = document.createElement('div');
                    const title = document.createElement('strong');
                    title.textContent = song.title || 'Без назви';

                    const details = document.createElement('p');
                    details.textContent = [song.key, song.bpm ? song.bpm + ' BPM' : '', time(song.duration)].filter(Boolean).join(' · ');

                    const notes = document.createElement('textarea');
                    notes.value = song.notes || '';
                    notes.placeholder = 'Нотатки';

                    const saveNotes = document.createElement('button');
                    saveNotes.type = 'button';
                    saveNotes.textContent = 'Зберегти нотатки';
                    saveNotes.addEventListener('click', async () => {
                        try {
                            await collection.updateNotes(song.id, notes.value);
                            message('uams-save-status', 'Нотатки оновлено.', 'success');
                        } catch (error) {
                            message('uams-save-status', error.message, 'error');
                        }
                    });

                    const actions = document.createElement('div');
                    const remove = document.createElement('button');
                    remove.type = 'button';
                    remove.textContent = 'Видалити';
                    remove.addEventListener('click', async () => {
                        if (!confirm('Видалити композицію з колекції?')) return;
                        try {
                            await collection.remove(song.id);
                            await renderCollection();
                        } catch (error) {
                            message('uams-save-status', error.message, 'error');
                        }
                    });

                    const play = document.createElement('button');
                    play.type = 'button';
                    play.textContent = 'Відкрити аудіо';
                    play.addEventListener('click', async () => {
                        try {
                            const media = await collection.getMediaUrl(song.id, 'original');
                            $('uams-original-audio').src = media.url;
                            $('uams-original-audio').play();
                        } catch (error) {
                            message('uams-save-status', error.message, 'error');
                        }
                    });

                    actions.append(play, remove);
                    info.append(title, details, notes, saveNotes);
                    item.append(info, actions);
                    box.appendChild(item);
                });
            } catch (error) {
                box.textContent = error.message;
            }
        }

        $('uams-collection-search')?.addEventListener('input', renderCollection);
        $('uams-collection-sort')?.addEventListener('change', renderCollection);

        $('uams-buy-pro')?.addEventListener('click', async function () {
            try {
                const data = await collection.request('uams_activate_pro', {});
                if (data.url) window.location.href = data.url;
            } catch (error) {
                message('uams-save-status', error.message, 'error');
            }
        });

        if (cfg.loggedIn) renderCollection();

        window.UAMSMusicStudio = {
            engine,
            analyzer,
            collection,
            separator,
            shifter
        };
    });
})();
