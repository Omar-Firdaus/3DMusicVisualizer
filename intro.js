window.onload = function () {
    const canvas = document.getElementById("canvas");
    const ctx = canvas.getContext("2d");
    const nameButton = document.getElementById("nameButton");
    const emailField = document.getElementById("emailField");
    const emailInput = document.getElementById("emailInput");

    const particleSize = .9;
    const particleSpacing = 2.8;
    const svgScale = 1.23;
    const mouseRadius = 70;
    const mouse = {
        x: null,
        y: null,
        radius: mouseRadius,
    };

    let particlesArray = [];

    function setCanvasSize() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }

    setCanvasSize();

    window.addEventListener("mousemove", function (event) {
        mouse.x = event.x;
        mouse.y = event.y;
    });

    if (nameButton) {
        nameButton.addEventListener("click", function () {
            const emailValue = emailInput?.value?.trim() || "";
            alert(emailValue ? `Starting with: ${emailValue}` : "Please enter your email.");
        });
    }

    if (emailField) {
        emailField.addEventListener("submit", function (event) {
            event.preventDefault();
        });
    }

    class Particle {
        constructor(x, y) {
            this.x = Math.random() * canvas.width;
            this.y = Math.random() * canvas.height;
            this.size = particleSize;
            this.color = "#FFFFFF";
            this.baseX = x;
            this.baseY = y;
            this.density = Math.random() * 30 + 1;
        }

        draw() {
            ctx.fillStyle = this.color;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            ctx.closePath();
            ctx.fill();
        }

        update() {
            if (mouse.x === null || mouse.y === null) {
                return;
            }

            const dx = mouse.x - this.x;
            const dy = mouse.y - this.y;
            const distance = Math.sqrt(dx * dx + dy * dy) || 1;
            const forceDirectionX = dx / distance;
            const forceDirectionY = dy / distance;
            const maxDistance = mouse.radius;
            const force = (maxDistance - distance) / maxDistance;
            const directionX = forceDirectionX * force * this.density;
            const directionY = forceDirectionY * force * this.density;

            if (distance < mouse.radius) {
                this.x -= directionX;
                this.y -= directionY;
            } else {
                if (this.x !== this.baseX) {
                    const returnDx = this.x - this.baseX;
                    this.x -= returnDx / 10;
                }

                if (this.y !== this.baseY) {
                    const returnDy = this.y - this.baseY;
                    this.y -= returnDy / 10;
                }
            }
        }
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
            if (!transformString) return matrix;

            const transformRegex = /(\w+)\(([^)]+)\)/g;
            let match = transformRegex.exec(transformString);
            while (match) {
                const type = match[1];
                const values = match[2]
                    .split(/[\s,]+/)
                    .map(Number)
                    .filter((value) => !Number.isNaN(value));

                if (type === "translate") {
                    matrix.translateSelf(values[0] || 0, values[1] || 0);
                } else if (type === "scale") {
                    matrix.scaleSelf(values[0] || 1, values[1] ?? values[0] ?? 1);
                } else if (type === "rotate") {
                    matrix.rotateSelf(values[0] || 0);
                } else if (type === "skewX") {
                    matrix.skewXSelf(values[0] || 0);
                } else if (type === "skewY") {
                    matrix.skewYSelf(values[0] || 0);
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
            chain.forEach((transform) => {
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
                .map((path) => ({
                    d: path.getAttribute("d"),
                    transform: getCombinedTransform(path),
                }))
                .filter((entry) => Boolean(entry.d)),
        };
    }

    function buildTransformedPath(pathData, transform) {
        const path = new Path2D(pathData);
        const transformedPath = new Path2D();
        transformedPath.addPath(path, transform);
        return transformedPath;
    }

    async function main() {
        particlesArray = [];
        const loaded = await loadSVG("FIRDAUS.svg");
        const transformedPaths = loaded.paths.map((entry) =>
            buildTransformedPath(entry.d, entry.transform)
        );

        const fitScale =
            Math.min(
                canvas.width / loaded.viewBox.width,
                canvas.height / loaded.viewBox.height
            ) * svgScale;
        const fitOffsetX = (canvas.width - loaded.viewBox.width * fitScale) / 2;
        const fitOffsetY = (canvas.height - loaded.viewBox.height * fitScale) / 2;

        const allPositions = [];
        for (let y = 0; y < canvas.height; y += particleSpacing) {
            for (let x = 0; x < canvas.width; x += particleSpacing) {
                const svgX = (x - fitOffsetX) / fitScale + loaded.viewBox.x;
                const svgY = (y - fitOffsetY) / fitScale + loaded.viewBox.y;

                for (let i = 0; i < transformedPaths.length; i += 1) {
                    if (ctx.isPointInPath(transformedPaths[i], svgX, svgY)) {
                        allPositions.push({ x, y });
                        break;
                    }
                }
            }
        }

        allPositions.forEach((pos) => {
            particlesArray.push(new Particle(pos.x, pos.y));
        });
    }

    function animate() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        for (let i = 0; i < particlesArray.length; i += 1) {
            particlesArray[i].draw();
            particlesArray[i].update();
        }
        requestAnimationFrame(animate);
    }

    main().then(animate);

    window.addEventListener("resize", function () {
        setCanvasSize();
        main();
    });
};