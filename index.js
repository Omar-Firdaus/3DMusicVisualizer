window.addEventListener("DOMContentLoaded", function () {
    const mixerPanel = document.getElementById("mixerPanel");
    const mixerToggle = document.getElementById("mixerToggle");
    const trackGrid = document.getElementById("trackGrid");

    const TRACKS = [
        "Master",
        "Kick",
        "Snare",
        "HiHat",
        "Bass",
        "Piano",
        "Guitar",
        "Synth",
        "Lead",
        "Pad",
        "FX",
        "Vox"
    ];

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function valueToY(value) {
        const railTop = 15;
        const railHeight = 220;
        const thumbHeight = 16;
        const ratio = clamp(value, 0, 100) / 100;
        return railTop + (1 - ratio) * (railHeight - thumbHeight);
    }

    function valueToFill(value) {
        const maxFill = 205;
        return (clamp(value, 0, 100) / 100) * maxFill;
    }

    function createTrack(name, initialValue) {
        const channel = document.createElement("div");
        channel.className = "trackChannel";

        const nameEl = document.createElement("div");
        nameEl.className = "trackName";
        nameEl.textContent = name;

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
        });

        fader.appendChild(rail);
        fader.appendChild(fill);
        fader.appendChild(thumb);
        fader.appendChild(input);

        channel.appendChild(nameEl);
        channel.appendChild(fader);
        channel.appendChild(valueEl);

        render(initialValue);
        return channel;
    }

    TRACKS.forEach(function (trackName, i) {
        const startValue = i === 0 ? 85 : 55;
        trackGrid.appendChild(createTrack(trackName, startValue));
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
});
