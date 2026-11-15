(function () {
    'use strict';

    class UAMSCollection {
        constructor(config) {
            this.config = config || {};
            this.ajaxUrl = this.config.ajaxUrl || '';
            this.nonce = this.config.nonce || '';
            this.songs = [];
        }

        async request(action, data) {
            if (!this.ajaxUrl) {
                throw new Error('Не визначено адресу WordPress AJAX.');
            }

            const body = new FormData();
            body.append('action', action);
            body.append('nonce', this.nonce);

            Object.entries(data || {}).forEach(([key, value]) => {
                body.append(
                    key,
                    typeof value === 'object' && value !== null
                        ? JSON.stringify(value)
                        : String(value ?? '')
                );
            });

            const response = await fetch(this.ajaxUrl, {
                method: 'POST',
                credentials: 'same-origin',
                body
            });

            let result;

            try {
                result = await response.json();
            } catch (error) {
                throw new Error('Сервер повернув некоректну відповідь замість JSON.');
            }

            if (!response.ok || !result.success) {
                const message = result?.data?.message ||
                    'Помилка запиту до сервера.';
                const error = new Error(message);
                error.code = result?.data?.code || '';
                error.status = response.status;
                throw error;
            }

            return result.data;
        }

        async load() {
            const data = await this.request('uams_get_collection', {});
            this.songs = Array.isArray(data.collection)
                ? data.collection
                : [];

            this.count = Number(data.count || 0);
            this.limit = Number(data.limit || 10);
            this.isPro = Boolean(data.isPro);
            this.canSave = Boolean(data.canSave);

            return this.songs;
        }

        async save(song) {
            if (!song || !String(song.title || '').trim()) {
                throw new Error('Вкажіть назву композиції.');
            }

            const data = await this.request('uams_save_song', {
                title: song.title,
                key: song.key || '',
                bpm: song.bpm || 0,
                duration: song.duration || 0,
                transpose: song.transpose || 0,
                notes: song.notes || '',
                lyrics: song.lyrics || '',
                translation: song.translation || '',
                chords: song.chords || [],
                segments: song.segments || []
            });

            if (data.song) {
                this.songs.push(data.song);
            }

            this.count = Number(data.count || this.songs.length);

            return data;
        }

        async uploadMedia(songId, file, kind) {
            if (!songId || !file) {
                throw new Error('Не вказано композицію або аудіофайл.');
            }

            const body = new FormData();
            body.append('action', 'uams_upload_media');
            body.append('nonce', this.nonce);
            body.append('song_id', songId);
            body.append('kind', kind === 'processed' ? 'processed' : 'original');
            body.append('file', file, file.name || 'audio.wav');

            const response = await fetch(this.ajaxUrl, {
                method: 'POST',
                credentials: 'same-origin',
                body
            });

            let result;

            try {
                result = await response.json();
            } catch (error) {
                throw new Error('Сервер повернув некоректну відповідь під час завантаження аудіо.');
            }

            if (!response.ok || !result.success) {
                throw new Error(
                    result?.data?.message || 'Не вдалося завантажити аудіофайл.'
                );
            }

            return result.data;
        }

        async getMediaUrl(songId, kind) {
            return this.request('uams_get_media_url', {
                song_id: songId,
                kind: kind === 'processed' ? 'processed' : 'original'
            });
        }

        async remove(songId) {
            const data = await this.request('uams_delete_song', {
                song_id: songId
            });

            this.songs = this.songs.filter(song => song.id !== songId);
            this.count = Number(data.count || this.songs.length);

            return data;
        }

        async updateNotes(songId, notes) {
            const data = await this.request('uams_update_notes', {
                song_id: songId,
                notes: notes
            });

            const song = this.songs.find(item => item.id === songId);
            if (song) song.notes = notes;

            return data;
        }

        find(query) {
            const term = String(query || '').trim().toLocaleLowerCase();

            if (!term) return this.songs.slice();

            return this.songs.filter(song => {
                const searchable = [
                    song.title,
                    song.key,
                    song.notes,
                    song.lyrics,
                    song.translation
                ].join(' ').toLocaleLowerCase();

                return searchable.includes(term);
            });
        }

        sort(mode) {
            const items = this.songs.slice();

            switch (mode) {
                case 'oldest':
                    return items.sort((a, b) =>
                        Number(a.created || 0) - Number(b.created || 0)
                    );

                case 'title':
                    return items.sort((a, b) =>
                        String(a.title || '').localeCompare(
                            String(b.title || ''),
                            undefined,
                            { sensitivity: 'base' }
                        )
                    );

                case 'key':
                    return items.sort((a, b) =>
                        String(a.key || '').localeCompare(
                            String(b.key || '')
                        )
                    );

                case 'newest':
                default:
                    return items.sort((a, b) =>
                        Number(b.created || 0) - Number(a.created || 0)
                    );
            }
        }
    }

    window.UAMSCollection = UAMSCollection;
})();
