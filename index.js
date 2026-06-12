window.addEventListener("DOMContentLoaded", function () {
    const mixerPanel = document.getElementById("mixerPanel");
    const mixerToggle = document.getElementById("mixerToggle");
    const trackGrid = document.getElementById("trackGrid");
    const transportPlay = document.getElementById("transportPlay");
    const transportSeek = document.getElementById("transportSeek");
    const transportElapsed = document.getElementById("transportElapsed");
    const transportDuration = document.getElementById("transportDuration");

    if (!mixerPanel || !mixerToggle || !trackGrid) {
        return;
    }

    const TRACKS = [
        { name: "Master", file: null },
        { name: "Kick", file: null },
        { name: "Snare", file: "Snappy Snare02.wav" },
        { name: "HiHat", file: "Inst 606.wav" },
        { name: "Bass", file: "Inst 303.wav" },
        { name: "Piano", file: "Inst 101.wav" },
        { name: "Guitar", file: "Inst 404.wav" },
        { name: "Synth", file: "Synth.wav" },
        { name: "Lead", file: null },
        { name: "Pad", file: null },
        { name: "FX", file: null },
        { name: "Vox", file: "Vox.wav" },
    ];

    const EQ_BANDS = [
        { label: "Low", type: "lowshelf", frequency: 320 },
        { label: "Mid", type: "peaking", frequency: 1000, Q: 1 },
        { label: "High", type: "highshelf", frequency: 3200 },
    ];

    let audioContext = null;
    let masterGain = null;
    let masterFilters = null;
    const trackChannels = [];
    let isPlaying = false;
    let isScrubbing = false;
    let isLoading = false;
    let playbackOffset = 0;
    let playbackAnchorTime = 0;
    let wantsToPlay = false;

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function formatTime(seconds) {
        const safe = Math.max(0, Number(seconds) || 0);
        const mins = Math.floor(safe / 60);
        const secs = Math.floor(safe % 60);
        return `${mins}:${String(secs).padStart(2, "0")}`;
    }

    function getFaderMetrics() {
        const root = document.documentElement;
        const styles = getComputedStyle(root);
        const faderHeight = parseFloat(styles.getPropertyValue("--fader-h")) || 168;
        const railTop = parseFloat(styles.getPropertyValue("--fader-rail-top")) || 10;
        const railBottom = parseFloat(styles.getPropertyValue("--fader-rail-bottom")) || 10;
        const thumbHeight = parseFloat(styles.getPropertyValue("--fader-thumb-h")) || 14;
        const railHeight = faderHeight - railTop - railBottom;
        return {
            railTop: railTop,
            railHeight: railHeight,
            thumbHeight: thumbHeight,
            maxFill: Math.max(0, railHeight - 5),
        };
    }

    function valueToY(value) {
        const metrics = getFaderMetrics();
        const ratio = clamp(value, 0, 100) / 100;
        return metrics.railTop + (1 - ratio) * (metrics.railHeight - metrics.thumbHeight);
    }

    function valueToFill(value) {
        const metrics = getFaderMetrics();
        return (clamp(value, 0, 100) / 100) * metrics.maxFill;
    }

    function faderToGain(value) {
        return clamp(Number(value), 0, 100) / 100;
    }

    function trackSrc(file) {
        return encodeURIComponent(file);
    }

    function getTrackFaderValue(index) {
        const faderInput = trackGrid.children[index]?.querySelector(".faderInput");
        return faderInput ? Number(faderInput.value) : 55;
    }

    function getTimelineDuration() {
        let maxDuration = 0;
        trackChannels.forEach(function (trackState) {
            if (trackState.buffer) {
                maxDuration = Math.max(maxDuration, trackState.buffer.duration);
            }
        });
        return maxDuration;
    }

    function getCurrentPlaybackTime() {
        const duration = getTimelineDuration();
        if (!isPlaying || !audioContext || duration <= 0) {
            return playbackOffset;
        }
        const elapsed = audioContext.currentTime - playbackAnchorTime;
        return (playbackOffset + elapsed) % duration;
    }

    function updateTransportUI(currentTime) {
        const duration = getTimelineDuration();

        if (transportElapsed) {
            transportElapsed.textContent = formatTime(currentTime);
        }
        if (transportDuration) {
            transportDuration.textContent = formatTime(duration);
        }
        if (!transportSeek) {
            return;
        }

        if (duration > 0) {
            transportSeek.disabled = false;
            transportSeek.max = String(Math.max(1, Math.round(duration * 1000)));
            if (!isScrubbing) {
                transportSeek.value = String(Math.round(clamp(currentTime, 0, duration) * 1000));
            }
        }
    }

    function ensureAudioContext() {
        if (!audioContext) {
            audioContext = new AudioContext();
            masterGain = audioContext.createGain();
            masterGain.gain.value = 1;

            masterFilters = EQ_BANDS.map(function (band) {
                const filter = audioContext.createBiquadFilter();
                filter.type = band.type;
                filter.frequency.value = band.frequency;
                if (band.Q) {
                    filter.Q.value = band.Q;
                }
                filter.gain.value = 0;
                return filter;
            });

            let chainEnd = masterGain;
            for (let i = 0; i < masterFilters.length; i += 1) {
                chainEnd.connect(masterFilters[i]);
                chainEnd = masterFilters[i];
            }
            chainEnd.connect(audioContext.destination);
        }

        if (audioContext.state === "suspended") {
            return audioContext.resume();
        }

        return Promise.resolve();
    }

    function createEqBand(label, initialValue, onInput) {
        const band = document.createElement("div");
        band.className = "eqBand";

        const slider = document.createElement("input");
        slider.className = "eqSlider";
        slider.type = "range";
        slider.min = "-12";
        slider.max = "12";
        slider.step = "1";
        slider.value = String(initialValue);

        const value = document.createElement("div");
        value.className = "eqValue";
        value.textContent = `${initialValue > 0 ? "+" : ""}${initialValue}`;

        const text = document.createElement("div");
        text.className = "eqLabel";
        text.textContent = label;

        slider.addEventListener("input", function () {
            const v = Number(slider.value);
            value.textContent = `${v > 0 ? "+" : ""}${v}`;
            if (onInput) {
                onInput(v);
            }
        });

        band.appendChild(slider);
        band.appendChild(value);
        band.appendChild(text);
        return band;
    }

    function createTrackFilters() {
        return EQ_BANDS.map(function (band) {
            const filter = audioContext.createBiquadFilter();
            filter.type = band.type;
            filter.frequency.value = band.frequency;
            if (band.Q) {
                filter.Q.value = band.Q;
            }
            filter.gain.value = 0;
            return filter;
        });
    }

    function connectFilterChain(filters, gainNode) {
        for (let i = 0; i < filters.length - 1; i += 1) {
            filters[i].connect(filters[i + 1]);
        }
        filters[filters.length - 1].connect(gainNode);
        return filters[0];
    }

    function createTrack(track, initialValue) {
        const channel = document.createElement("div");
        channel.className = "trackChannel";

        const nameEl = document.createElement("div");
        nameEl.className = "trackName";
        nameEl.textContent = track.name;

        const trackState = {
            name: track.name,
            file: track.file,
            buffer: null,
            source: null,
            gainNode: null,
            filters: null,
            filterHead: null,
            loadStatus: track.file ? "idle" : "none",
            loadError: null,
            duration: 0,
        };

        const eqSection = document.createElement("div");
        eqSection.className = "eqSection";

        EQ_BANDS.forEach(function (band, index) {
            eqSection.appendChild(
                createEqBand(band.label, 0, function (dbValue) {
                    ensureAudioContext().then(function () {
                        if (track.name === "Master" && masterFilters) {
                            masterFilters[index].gain.value = dbValue;
                            return;
                        }
                        if (trackState.filters) {
                            trackState.filters[index].gain.value = dbValue;
                        }
                    });
                })
            );
        });

        const fader = document.createElement("div");
        fader.className = "fader";

        const rail = document.createElement("div");
        rail.className = "faderRail";

        const fill = document.createElement("div");
        fill.className = "faderFill";

        const thumb = document.createElement("div");
        thumb.className = "faderThumb";

        const input = document.createElement("input");
        input.className = "faderInput";
        input.type = "range";
        input.min = "0";
        input.max = "100";
        input.value = String(initialValue);
        input.step = "1";

        const valueEl = document.createElement("div");
        valueEl.className = "trackValue";

        function render(value) {
            const safe = clamp(Number(value), 0, 100);
            thumb.style.top = `${valueToY(safe)}px`;
            fill.style.height = `${valueToFill(safe)}px`;
            valueEl.textContent = `${safe}%`;
        }

        input.addEventListener("input", function () {
            render(input.value);
            ensureAudioContext().then(function () {
                const gain = faderToGain(input.value);
                if (track.name === "Master" && masterGain) {
                    masterGain.gain.value = gain;
                    return;
                }
                if (trackState.gainNode) {
                    trackState.gainNode.gain.value = gain;
                }
            });
        });

        fader.appendChild(rail);
        fader.appendChild(fill);
        fader.appendChild(thumb);
        fader.appendChild(input);

        channel.appendChild(nameEl);
        channel.appendChild(eqSection);
        channel.appendChild(fader);
        channel.appendChild(valueEl);

        render(initialValue);
        trackChannels.push(trackState);
        return channel;
    }

    function buildTrackChain(trackState, initialFaderValue) {
        const filters = createTrackFilters();
        const gainNode = audioContext.createGain();
        gainNode.gain.value = faderToGain(initialFaderValue);
        const filterHead = connectFilterChain(filters, gainNode);
        gainNode.connect(masterGain);
        trackState.filters = filters;
        trackState.gainNode = gainNode;
        trackState.filterHead = filterHead;
    }

    async function setupTrackAudio(trackState, initialFaderValue) {
        if (!trackState.file || !audioContext) {
            return;
        }
        if (trackState.buffer || trackState.loadStatus === "loading") {
            return;
        }

        trackState.loadStatus = "loading";
        trackState.loadError = null;

        try {
            const response = await fetch(trackSrc(trackState.file));
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

            trackState.buffer = audioBuffer;
            trackState.duration = audioBuffer.duration;
            trackState.loadStatus = "ready";
            buildTrackChain(trackState, initialFaderValue);
            updateTransportUI(getCurrentPlaybackTime());
        } catch (error) {
            trackState.loadStatus = "error";
            trackState.loadError = error?.message || "failed to decode";
        }
    }

    function stopTrackSource(trackState) {
        if (!trackState.source) {
            return;
        }
        try {
            trackState.source.stop();
        } catch (error) {
            // Source may already be stopped.
        }
        trackState.source.disconnect();
        trackState.source = null;
    }

    function stopAllSources() {
        trackChannels.forEach(stopTrackSource);
    }

    function startTrackSource(trackState, offsetSeconds) {
        if (!trackState.buffer || !trackState.filterHead || trackState.loadStatus !== "ready") {
            return false;
        }

        stopTrackSource(trackState);

        const source = audioContext.createBufferSource();
        source.buffer = trackState.buffer;
        source.loop = true;
        source.connect(trackState.filterHead);

        const trackOffset = offsetSeconds % trackState.buffer.duration;
        source.start(audioContext.currentTime, trackOffset);
        trackState.source = source;
        return true;
    }

    function startPlayback(fromOffset) {
        if (!audioContext) {
            return false;
        }

        if (audioContext.state === "suspended") {
            void audioContext.resume();
        }

        if (masterGain) {
            masterGain.gain.value = faderToGain(getTrackFaderValue(0));
        }

        stopAllSources();
        playbackOffset = fromOffset;
        playbackAnchorTime = audioContext.currentTime;

        let startedCount = 0;
        trackChannels.forEach(function (trackState) {
            if (startTrackSource(trackState, fromOffset)) {
                startedCount += 1;
            }
        });

        if (startedCount === 0) {
            isPlaying = false;
            setTransportLabel(false);
            return false;
        }

        isPlaying = true;
        setTransportLabel(true);
        updateTransportUI(getCurrentPlaybackTime());
        return true;
    }

    function pausePlayback() {
        playbackOffset = getCurrentPlaybackTime();
        stopAllSources();
        isPlaying = false;
        wantsToPlay = false;
        setTransportLabel(false);
    }

    async function ensureTracksLoaded() {
        if (isLoading) {
            return;
        }

        isLoading = true;
        const toLoad = trackChannels
            .map(function (trackState, index) {
                return { trackState: trackState, index: index };
            })
            .filter(function (entry) {
                return entry.trackState.file && !entry.trackState.buffer;
            });

        for (let i = 0; i < toLoad.length; i += 1) {
            const entry = toLoad[i];
            if (entry.trackState.loadStatus === "error") {
                entry.trackState.loadStatus = "idle";
                entry.trackState.loadError = null;
            }

            await setupTrackAudio(entry.trackState, getTrackFaderValue(entry.index));

            if (!wantsToPlay) {
                continue;
            }

            if (!isPlaying && entry.trackState.loadStatus === "ready") {
                startPlayback(0);
            } else if (isPlaying && entry.trackState.loadStatus === "ready") {
                startTrackSource(entry.trackState, getCurrentPlaybackTime());
            }
        }

        isLoading = false;
    }

    function seekAllTracks(seconds) {
        const duration = getTimelineDuration();
        if (duration <= 0) {
            return;
        }

        playbackOffset = clamp(seconds, 0, duration);
        if (isPlaying) {
            startPlayback(playbackOffset);
        } else {
            updateTransportUI(playbackOffset);
        }
    }

    function setTransportLabel(playing) {
        if (transportPlay) {
            transportPlay.textContent = playing ? "Pause" : "Play";
            transportPlay.setAttribute("aria-pressed", String(playing));
        }
    }

    function togglePlayback() {
        if (isPlaying) {
            pausePlayback();
            return;
        }

        wantsToPlay = true;

        void ensureAudioContext().then(function () {
            if (audioContext && audioContext.state === "suspended") {
                return audioContext.resume();
            }
        }).then(function () {
            const readyTracks = trackChannels.filter(function (trackState) {
                return trackState.loadStatus === "ready" && trackState.buffer;
            });

            if (readyTracks.length > 0) {
                startPlayback(playbackOffset);
            }

            return ensureTracksLoaded();
        }).then(function () {
            if (!wantsToPlay) {
                return;
            }

            const readyTracks = trackChannels.filter(function (trackState) {
                return trackState.loadStatus === "ready" && trackState.buffer;
            });

            if (!isPlaying && readyTracks.length > 0) {
                startPlayback(0);
            }
        });
    }

    document.documentElement.style.setProperty("--track-count", String(TRACKS.length));

    TRACKS.forEach(function (track, i) {
        const startValue = i === 0 ? 85 : 55;
        trackGrid.appendChild(createTrack(track, startValue));
    });

    function setOpen(isOpen) {
        mixerPanel.classList.toggle("open", isOpen);
        mixerToggle.setAttribute("aria-expanded", String(isOpen));
    }

    setOpen(false);
    setTimeout(function () {
        setOpen(true);
    }, 120);

    mixerToggle.addEventListener("click", function () {
        const currentlyOpen = mixerPanel.classList.contains("open");
        setOpen(!currentlyOpen);
    });

    if (transportPlay) {
        transportPlay.addEventListener("click", togglePlayback);
    }

    if (transportSeek) {
        transportSeek.addEventListener("pointerdown", function () {
            isScrubbing = true;
        });

        transportSeek.addEventListener("input", function () {
            const duration = getTimelineDuration();
            if (duration <= 0) {
                return;
            }
            const seconds = Number(transportSeek.value) / 1000;
            seekAllTracks(seconds);
        });

        transportSeek.addEventListener("pointerup", function () {
            isScrubbing = false;
        });
    }

    function tickTransport() {
        if (isPlaying && !isScrubbing) {
            updateTransportUI(getCurrentPlaybackTime());
        }
        requestAnimationFrame(tickTransport);
    }

    window.addEventListener("resize", function () {
        trackGrid.querySelectorAll(".faderInput").forEach(function (input) {
            const channel = input.closest(".trackChannel");
            const valueEl = channel?.querySelector(".trackValue");
            const thumb = channel?.querySelector(".faderThumb");
            const fill = channel?.querySelector(".faderFill");
            if (!thumb || !fill || !valueEl) {
                return;
            }
            const safe = clamp(Number(input.value), 0, 100);
            thumb.style.top = `${valueToY(safe)}px`;
            fill.style.height = `${valueToFill(safe)}px`;
        });
    });

    tickTransport();
});
