import * as THREE from "three";
import { ImprovedNoise } from "three/addons/math/ImprovedNoise.js";

const PALETTE = [
    new THREE.Color("#0a1f3d"),
    new THREE.Color("#143960"),
    new THREE.Color("#345f8f"),
    new THREE.Color("#4a75a8"),
    new THREE.Color("#7aa8d4"),
    new THREE.Color("#a4c4e8"),
    new THREE.Color("#d0e3f4"),
];

const particleSize = 0.9;
const particleSpacing = 2.5;
const svgScale = 1.08;
const svgPath = "FIRDAUS.svg";

window.addEventListener("DOMContentLoaded", function () {
    const stage = document.getElementById("visualStage");
    const constellationCanvas = document.getElementById("oceanCanvas");
    const wormholeCanvas = document.getElementById("wormholeCanvas");

    if (!stage || !constellationCanvas || !wormholeCanvas) {
        return;
    }

    const ctx = constellationCanvas.getContext("2d");

    let particles = [];
    let shapeCenter = { x: 0, y: 0 };
    let activeMix = 0;
    let morphT = 0;
    let lastTime = performance.now();

    let wormhole = null;
    let wormholeBuilt = false;

    function lerp(a, b, t) {
        return a + (b - a) * t;
    }

    function smoothstep(t) {
        const x = Math.max(0, Math.min(1, t));
        return x * x * (3 - 2 * x);
    }

    function setCanvasSize() {
        const rect = stage.getBoundingClientRect();
        const width = Math.max(1, Math.floor(rect.width));
        const height = Math.max(1, Math.floor(rect.height));

        constellationCanvas.width = width;
        constellationCanvas.height = height;
        wormholeCanvas.width = width;
        wormholeCanvas.height = height;
    }

    function syncStageInset() {
        const mixerPanel = document.getElementById("mixerPanel");
        if (mixerPanel) {
            stage.style.bottom = `${Math.ceil(mixerPanel.getBoundingClientRect().height)}px`;
        }
        setCanvasSize();
        if (wormhole) {
            wormhole.resize();
        }
    }

    class Particle {
        constructor(x, y, band) {
            this.baseX = x;
            this.baseY = y;
            this.x = x;
            this.y = y;
            this.band = band;
            this.size = particleSize;
            this.density = Math.random() * 30 + 1;
            this.energy = 0;
        }

        sampleEnergy(bins, bassBoost) {
            if (!bins || bins.length === 0) {
                return 0;
            }

            const idx = Math.min(bins.length - 1, Math.floor(this.band * bins.length));
            const local = bins[idx] / 255;
            return Math.min(1, local * 1.8 + bassBoost * 0.35);
        }

        update(bins, bassBoost, mix, morph) {
            const audioMix = mix * (1 - morph * 0.85);
            this.energy = this.sampleEnergy(bins, bassBoost) * audioMix;

            const pull = smoothstep(morph) * 0.11;
            this.x = lerp(this.x, shapeCenter.x, pull);
            this.y = lerp(this.y, shapeCenter.y, pull);

            const dx = this.x - shapeCenter.x;
            const dy = this.y - shapeCenter.y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            const nx = dx / dist;
            const ny = dy / dist;

            if (this.energy > 0.03) {
                const push = this.energy * this.density * 0.42 * (1 - morph * 0.6);
                this.x += nx * push;
                this.y += ny * push;
            } else if (morph < 0.95) {
                const homePull = 0.1 + morph * 0.06;
                this.x = lerp(this.x, this.baseX, homePull);
                this.y = lerp(this.y, this.baseY, homePull);
            }
        }

        draw(morph) {
            const fade = 1 - smoothstep(morph);
            if (fade <= 0.01) {
                return;
            }

            const shrink = 1 - morph * 0.55;
            const alpha = (0.38 + this.energy * 0.62) * fade;
            const radius = (this.size + this.energy * 2.4) * shrink;
            const r = Math.round(164 + this.energy * 46);
            const g = Math.round(196 + this.energy * 35);
            const b = Math.round(232 + this.energy * 18);

            ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
            ctx.beginPath();
            ctx.arc(this.x, this.y, radius, 0, Math.PI * 2);
            ctx.closePath();
            ctx.fill();
        }
    }

    function paletteFromNoise(colorNoise) {
        const t = Math.max(0, Math.min(1, 0.5 - colorNoise));
        const idx = Math.floor(t * (PALETTE.length - 1));
        const frac = t * (PALETTE.length - 1) - idx;
        const color = new THREE.Color();
        color.copy(PALETTE[idx]).lerp(PALETTE[Math.min(idx + 1, PALETTE.length - 1)], frac);
        return color;
    }

    function createWormhole() {
        const renderer = new THREE.WebGLRenderer({
            canvas: wormholeCanvas,
            antialias: true,
        });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
        renderer.setClearColor(0x0a1f3d, 1);

        const scene = new THREE.Scene();
        scene.fog = new THREE.FogExp2(0x0a1f3d, 0.025);
        scene.background = new THREE.Color(0x0a1f3d);

        const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
        camera.position.set(0, 0, 15);

        const noise = new ImprovedNoise();
        const radius = 3;
        const tubeLength = 200;
        const radialSegs = 128;
        const heightSegs = 512;
        const noiseFreq = 0.1;
        const noiseAmp = 0.5;
        const hueNoiseFreq = 0.005;

        const tubeGeo = new THREE.CylinderGeometry(radius, radius, tubeLength, radialSegs, heightSegs, true);
        const tubeVerts = tubeGeo.attributes.position;
        const colorArray = new Float32Array(tubeVerts.count * 3);
        const p = new THREE.Vector3();
        const v3 = new THREE.Vector3();

        for (let i = 0; i < tubeVerts.count; i += 1) {
            p.fromBufferAttribute(tubeVerts, i);
            v3.copy(p);

            const vertexNoise = noise.noise(v3.x * noiseFreq, v3.y * noiseFreq, v3.z);
            v3.addScaledVector(p, vertexNoise * noiseAmp);
            tubeVerts.setXYZ(i, v3.x, p.y, v3.z);

            const colorNoise = noise.noise(
                v3.x * hueNoiseFreq,
                v3.y * hueNoiseFreq,
                i * 0.001 * hueNoiseFreq
            );
            const color = paletteFromNoise(colorNoise);
            colorArray[i * 3] = color.r;
            colorArray[i * 3 + 1] = color.g;
            colorArray[i * 3 + 2] = color.b;
        }

        const tubeColors = new THREE.BufferAttribute(colorArray, 3);
        tubeGeo.setAttribute("color", tubeColors);

        const material = new THREE.PointsMaterial({
            size: 0.03,
            vertexColors: true,
        });

        const baseSpeed = 0.2;
        const baseSpin = 0.005;
        const baseFogDensity = 0.025;
        const audioSmooth = { bass: 0, mid: 0, high: 0, level: 0 };

        function getTube(index) {
            const geo = new THREE.BufferGeometry();
            geo.setAttribute("position", tubeVerts);
            geo.setAttribute("color", tubeColors);

            const points = new THREE.Points(geo, material);
            points.rotation.x = Math.PI * 0.5;
            points.position.z = -tubeLength * index;

            return {
                points: points,
                update: function (speed, spin) {
                    points.rotation.y += spin;
                    points.position.z += speed;
                    if (points.position.z > tubeLength) {
                        points.position.z = -tubeLength;
                    }
                },
            };
        }

        const tubes = [getTube(0), getTube(1)];
        scene.add(tubes[0].points, tubes[1].points);

        function smoothAudio(audio, dt) {
            const rate = Math.min(1, 12 * dt);
            audioSmooth.bass = lerp(audioSmooth.bass, audio.bass, rate);
            audioSmooth.mid = lerp(audioSmooth.mid, audio.mid, rate);
            audioSmooth.high = lerp(audioSmooth.high, audio.high, rate);
            audioSmooth.level = lerp(audioSmooth.level, audio.level, rate);
            return audioSmooth;
        }

        return {
            scene: scene,
            camera: camera,
            renderer: renderer,
            material: material,
            fog: scene.fog,
            tubes: tubes,
            resize: function () {
                const rect = stage.getBoundingClientRect();
                const width = Math.max(1, Math.floor(rect.width));
                const height = Math.max(1, Math.floor(rect.height));
                renderer.setSize(width, height, false);
                camera.aspect = width / height;
                camera.updateProjectionMatrix();
            },
            render: function (time, morph, audio, dt) {
                const fade = smoothstep(morph);
                const snap = smoothAudio(audio, dt);
                const energy = snap.level;
                const drive = fade * (0.35 + energy * 0.65);

                const speed = (baseSpeed + snap.bass * 0.45 + energy * 0.22) * (0.4 + drive * 0.6);
                const spin = baseSpin + snap.mid * 0.022 + snap.high * 0.01 + energy * 0.006;

                material.size = 0.03 + snap.bass * 0.03 + energy * 0.018 + snap.high * 0.008;

                if (scene.fog) {
                    scene.fog.density = baseFogDensity - energy * 0.008;
                }

                const orbit = Math.min(1.15, 0.85 + snap.bass * 0.08 + energy * 0.05);

                tubes.forEach(function (tube) {
                    tube.update(speed, spin);
                    tube.points.scale.set(1, 1, 1);
                });

                camera.position.x = Math.cos(time * 0.001) * orbit;
                camera.position.y = Math.sin(time * 0.001) * orbit;
                camera.position.z = 15;
                camera.lookAt(0, 0, -80);

                wormholeCanvas.style.opacity = String(fade);
                renderer.render(scene, camera);
            },
        };
    }

    function ensureWormhole() {
        if (wormholeBuilt) {
            return;
        }

        wormholeBuilt = true;
        setTimeout(function () {
            wormhole = createWormhole();
            wormhole.resize();
        }, 0);
    }

    async function loadSVG(url) {
        const response = await fetch(url);
        const text = await response.text();
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(text, "image/svg+xml");
        const svgRoot = xmlDoc.getElementsByTagName("svg")[0];
        const paths = Array.from(xmlDoc.getElementsByTagName("path"));

        const viewBox = (svgRoot?.getAttribute("viewBox") || "0 0 100 100")
            .trim()
            .split(/\s+/)
            .map(Number);
        const [vbX, vbY, vbWidth, vbHeight] = viewBox;

        function parseTransform(transformString) {
            const matrix = new DOMMatrix();
            if (!transformString) {
                return matrix;
            }

            const transformRegex = /(\w+)\(([^)]+)\)/g;
            let match = transformRegex.exec(transformString);
            while (match) {
                const type = match[1];
                const values = match[2]
                    .split(/[\s,]+/)
                    .map(Number)
                    .filter(function (value) {
                        return !Number.isNaN(value);
                    });

                if (type === "translate") {
                    matrix.translateSelf(values[0] || 0, values[1] || 0);
                } else if (type === "scale") {
                    matrix.scaleSelf(values[0] || 1, values[1] ?? values[0] ?? 1);
                } else if (type === "rotate") {
                    matrix.rotateSelf(values[0] || 0);
                } else if (type === "matrix" && values.length === 6) {
                    matrix.multiplySelf(new DOMMatrix(values));
                }

                match = transformRegex.exec(transformString);
            }

            return matrix;
        }

        function getCombinedTransform(element) {
            const chain = [];
            let current = element;

            while (current && current.getAttribute) {
                const transform = current.getAttribute("transform");
                if (transform) {
                    chain.unshift(transform);
                }
                current = current.parentElement;
            }

            const combined = new DOMMatrix();
            chain.forEach(function (transform) {
                combined.multiplySelf(parseTransform(transform));
            });
            return combined;
        }

        return {
            viewBox: {
                x: Number.isFinite(vbX) ? vbX : 0,
                y: Number.isFinite(vbY) ? vbY : 0,
                width: Number.isFinite(vbWidth) ? vbWidth : 100,
                height: Number.isFinite(vbHeight) ? vbHeight : 100,
            },
            paths: paths
                .map(function (path) {
                    return {
                        d: path.getAttribute("d"),
                        transform: getCombinedTransform(path),
                    };
                })
                .filter(function (entry) {
                    return Boolean(entry.d);
                }),
        };
    }

    function buildTransformedPath(pathData, transform) {
        const path = new Path2D(pathData);
        const transformedPath = new Path2D();
        transformedPath.addPath(path, transform);
        return transformedPath;
    }

    async function buildParticles() {
        particles = [];
        const loaded = await loadSVG(svgPath);
        const transformedPaths = loaded.paths.map(function (entry) {
            return buildTransformedPath(entry.d, entry.transform);
        });

        const fitScale =
            Math.min(
                constellationCanvas.width / loaded.viewBox.width,
                constellationCanvas.height / loaded.viewBox.height
            ) * svgScale;
        const fitOffsetX = (constellationCanvas.width - loaded.viewBox.width * fitScale) / 2;
        const fitOffsetY = (constellationCanvas.height - loaded.viewBox.height * fitScale) / 2;

        let sumX = 0;
        let sumY = 0;
        let count = 0;

        for (let y = 0; y < constellationCanvas.height; y += particleSpacing) {
            for (let x = 0; x < constellationCanvas.width; x += particleSpacing) {
                const svgX = (x - fitOffsetX) / fitScale + loaded.viewBox.x;
                const svgY = (y - fitOffsetY) / fitScale + loaded.viewBox.y;

                for (let i = 0; i < transformedPaths.length; i += 1) {
                    if (ctx.isPointInPath(transformedPaths[i], svgX, svgY)) {
                        const band = x / Math.max(1, constellationCanvas.width);
                        particles.push(new Particle(x, y, band));
                        sumX += x;
                        sumY += y;
                        count += 1;
                        break;
                    }
                }
            }
        }

        shapeCenter.x = count > 0 ? sumX / count : constellationCanvas.width / 2;
        shapeCenter.y = count > 0 ? sumY / count : constellationCanvas.height / 2;
    }

    function readAudio() {
        const api = window.submarineAudio;
        if (!api) {
            return { bins: null, bass: 0, mid: 0, high: 0, level: 0, playing: false };
        }

        const playing = api.isPlaying();
        const bins = playing && api.getFrequencyData ? api.getFrequencyData() : null;
        const snap = playing && api.getSnapshot ? api.getSnapshot() : { bass: 0, mid: 0, level: 0 };

        return {
            bins: bins,
            bass: snap.bass || 0,
            mid: snap.mid || 0,
            high: snap.high || 0,
            level: snap.level || 0,
            playing: playing,
        };
    }

    function updateMorph(playing, dt) {
        const target = playing ? 1 : 0;
        const speed = playing ? 0.55 : 0.38;
        morphT = lerp(morphT, target, Math.min(1, speed * dt));
    }

    function drawConstellation(audio, morph) {
        constellationCanvas.style.opacity = String(1 - smoothstep(morph));
        ctx.clearRect(0, 0, constellationCanvas.width, constellationCanvas.height);

        for (let i = 0; i < particles.length; i += 1) {
            particles[i].update(audio.bins, audio.bass, activeMix, morph);
            particles[i].draw(morph);
        }
    }

    function animate(now) {
        const dt = Math.min(0.05, (now - lastTime) / 1000);
        lastTime = now;

        const audio = readAudio();
        const targetMix = audio.playing ? 1 : 0;
        activeMix = lerp(activeMix, targetMix, audio.playing ? 0.14 : 0.07);
        updateMorph(audio.playing, dt);

        drawConstellation(audio, morphT);

        if (audio.playing || morphT > 0.01) {
            ensureWormhole();
        }

        if (wormhole && morphT > 0.01) {
            wormhole.render(now, morphT, {
                bass: audio.bass * activeMix,
                mid: audio.mid * activeMix,
                high: audio.high * activeMix,
                level: audio.level * activeMix,
            }, dt);
        } else if (wormholeCanvas) {
            wormholeCanvas.style.opacity = "0";
        }

        requestAnimationFrame(animate);
    }

    syncStageInset();

    buildParticles().then(function () {
        requestAnimationFrame(animate);
    });

    window.addEventListener("resize", function () {
        syncStageInset();
        buildParticles();
    });

    const mixerPanel = document.getElementById("mixerPanel");
    if (mixerPanel && typeof ResizeObserver !== "undefined") {
        const observer = new ResizeObserver(syncStageInset);
        observer.observe(mixerPanel);

        const classObserver = new MutationObserver(syncStageInset);
        classObserver.observe(mixerPanel, {
            attributes: true,
            attributeFilter: ["class"],
        });
    }
});
