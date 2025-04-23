/* ───────────────────────── Config ───────────────────────── */
const WIDTH  = 800;
const HEIGHT = 500;
const INITIAL_SCALE = 250;
const MAG_COLORS = [
    { limit: 8, color: '#F44336', radius: 8 },   // >8  -> red
    { limit: 7, color: '#FF5722', radius: 6 },   // 7‑8 -> orange
    { limit: 6, color: '#FFC107', radius: 4 }    // 6‑7 -> yellow
];
const MAG_BINS = [
    { key: 'small',  label: '≤6.0',      color: '#4CAF50' },
    { key: 'medium', label: '6.1-7.0',   color: '#FFC107' },
    { key: 'large',  label: '7.1-8.0',   color: '#FF5722' },
    { key: 'major',  label: '>8.0',      color: '#F44336' }
];
const BAR_MARGIN = { top: 20, right: 60, bottom: 95, left: 80 };

const BAR_METRICS = [
    { key: 'count', label: 'Number of Earthquakes' },
    { key: 'deaths', label: 'Deaths' },
    { key: 'missing', label: 'Missing' },
    { key: 'injuries', label: 'Injuries' },
    { key: 'damage', label: 'Damage ($Mil)' },
    { key: 'housesDestroyed', label: 'Houses Destroyed' },
    { key: 'housesDamaged', label: 'Houses Damaged' },
];

const Q_FIELDS = [
    'magnitude', 'depth', 'deaths', 'missing', 'injuries', 'damage', 'housesDestroyed', 'housesDamaged'
];

/* ───────────────────────── State ───────────────────────── */
const state = {
    width: WIDTH,
    height: HEIGHT,
    projection: null,
    path: null,
    svg: null,
    globe: null,
    years: [],
    yearRange: [null, null], // [start, end]
    earthquakeData: [],
    dataByYear: [],
    zoom: null,
    currentZoom: 1,
    rotate: [0, 0, 0],
    isAnimating: false,
    animationTimer: null,
    slider: null,
    filters: { tsunami: false, volcano: false, noHazard: false },
    bar: {},
    mapView: 'map' // 'globe' or 'map'
};

/* ───────────────────────── Helpers ───────────────────────── */
const tooltip = d3.select('body').append('div').attr('class', 'tooltip');

const getRadius = m => (MAG_COLORS.find(d => m > d.limit)?.radius) ?? 3;
const getColor  = m => (MAG_COLORS.find(d => m > d.limit)?.color)  ?? '#4CAF50';

function getMagnitudeBin(mag) {
    if (mag > 8) return 'major';
    if (mag > 7) return 'large';
    if (mag > 6) return 'medium';
    return 'small';
}

const debounce = (fn, ms) => { let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); } };

/* ───────────────────────── Init ───────────────────────── */
document.addEventListener('DOMContentLoaded', init);

async function init () {
    buildSvg();
    await loadEarthquakeData();
    state.faultLines = await d3.json('https://raw.githubusercontent.com/fraxen/tectonicplates/master/GeoJSON/PB2002_boundaries.json'); // <-- load tectonic fault lines
    initializeQuantitativeFilters(); // <-- initialize quantitative filter ranges
    await drawGlobe();
    buildYearSlider();
    wireInteractions();
    populateBarMetricDropdown();
    initBarChart();
    updateBarChart();
    wireTopXInput();
    initTopBarChart();
    updateTopBarChart();
    updateEarthquakes();
    wireMapViewSelect();
    addZoomButtons();
}

function wireMapViewSelect() {
    const select = document.getElementById('map-view-select');
    select.value = state.mapView;
    select.onchange = function() {
        state.mapView = this.value;
        d3.select('#visualization').selectAll('*').remove();
        buildSvg();
        drawGlobe().then(() => {
            wireInteractions();
            updateEarthquakes();
            addZoomButtons();
        });
    };
}

/* ───────────────────────── Data ───────────────────────── */
async function loadEarthquakeData () {
    const raw = await d3.tsv('earthquakes-2025-04-19_10-45-30_+0100.tsv');

    state.earthquakeData = raw
    .filter(d =>
        d.Year && d.Latitude && d.Longitude &&
        +d.Year >= 1900 &&
        ![d.Year, d.Latitude, d.Longitude].some(v => isNaN(+v)))
    .map(d => ({
        year: +d.Year,
        month: +d.Mo,
        day: +d.Dy,
        latitude: +d.Latitude,
        longitude: +d.Longitude,
        magnitude: +d.Mag || 0,
        location: d['Location Name'] || 'Unknown',
        depth: +d['Focal Depth (km)'] || 0,
        deaths: +d.Deaths || 0,
        missing: +d.Missing || 0,
        injuries: +d.Injuries || 0,
        damage: +d['Damage ($Mil)'] || 0,
        housesDestroyed: +d['Houses Destroyed'] || 0,
        housesDamaged: +d['Houses Damaged'] || 0,
        tsunami: Boolean(d.Tsu?.trim()),
        volcano: Boolean(d.Vol?.trim())
    }));

    state.years = [...new Set(state.earthquakeData.map(d => d.year))].sort();
    // Set default year range to the maximum
    state.yearRange = [state.years[0], state.years[state.years.length - 1]];

    state.dataByYear = Array.from(
    d3.rollup(state.earthquakeData, v => d3.sum(v, d => d.deaths), d => d.year),
    ([year, earthquakeDeaths]) => ({ year, earthquakeDeaths })
    );
}

function initializeQuantitativeFilters() {
    const fields = [
        { key: 'magnitude', label: 'Magnitude' },
        { key: 'depth', label: 'Focal Depth (km)' },
        { key: 'deaths', label: 'Deaths' },
        { key: 'missing', label: 'Missing' },
        { key: 'injuries', label: 'Injuries' },
        { key: 'damage', label: 'Damage ($Mil)' },
        { key: 'housesDestroyed', label: 'Houses Destroyed' },
        { key: 'housesDamaged', label: 'Houses Damaged' }
    ];
    fields.forEach(f => {
        const values = state.earthquakeData.map(d => d[f.key]);
        const min = Math.min(...values);
        const max = Math.max(...values);
        state.filters[f.key] = { min, max, current: [min, max] };
    });
}

/* ───────────────────────── SVG / Projection ───────────────────────── */
function buildSvg () {
    state.svg = d3.select('#visualization')
    .append('svg')
    .attr('class', state.mapView === 'globe' ? 'globe' : 'map')
    .attr('width', state.width)
    .attr('height', state.height);

    if (state.mapView === 'globe') {
        state.projection = d3.geoOrthographic()
            .scale(INITIAL_SCALE)
            .translate([state.width / 2, state.height / 2])
            .clipAngle(90);
    } else {
        // Mercator projection, infinite drag
        state.projection = d3.geoEquirectangular()
            .scale(state.width / (2 * Math.PI))
            .translate([state.width / 2, state.height / 2])
            .rotate([state.rotate2D?.lon || 0, state.rotate2D?.lat || 0]);
        // Store rotation state for 2D
        if (!state.rotate2D) state.rotate2D = { lon: 0, lat: 0 };
    }
    state.path = d3.geoPath().projection(state.projection);
    state.globe = state.svg.append('g');

    if (state.mapView === 'globe') {
        state.svg.append('defs').append('clipPath')
            .attr('id', 'globe-clip')
            .append('circle')
            .attr('cx', state.width / 2)
            .attr('cy', state.height / 2)
            .attr('r', state.projection.scale());
    } else {
        d3.select('#globe-clip').remove();
    }
}

/* ───────────────────────── Globe ───────────────────────── */
async function drawGlobe () {
    const world = await d3.json('https://unpkg.com/world-atlas@2/countries-110m.json');

    // Graticule & countries
    state.globe.append('path')
    .datum(d3.geoGraticule())
    .attr('class', 'graticule')
    .attr('d', state.path);

    state.globe.selectAll('.country')
    .data(topojson.feature(world, world.objects.countries).features)
    .enter().append('path')
    .attr('class', 'country')
    .attr('d', state.path);

    // Draw fault lines
    state.globe.append('g')
    .attr('class', 'fault-lines')
    .selectAll('path')
    .data(state.faultLines.features)
    .enter().append('path')
    .attr('d', state.path)
    .attr('fill', 'none')
    .attr('stroke', '#9933CC')
    .attr('stroke-width', 1)
    .attr('stroke-dasharray', '4 2')
    .attr('opacity', 0.7);

    if (state.mapView === 'globe') {
    state.globe.select('.fault-lines').attr('clip-path', 'url(#globe-clip)');
    }

    if (state.mapView === 'globe') {
        // Sphere outline for globe only
        state.globe.append('path')
        .datum({ type: 'Sphere' })
        .attr('class', 'sphere')
        .attr('fill', 'none')
        .attr('stroke', '#000')
        .attr('stroke-width', '1.5px')
        .attr('d', state.path);
    }
}

/* ───────────────────────── Zoom Buttons ───────────────────────── */
function applyZoom (delta) {
    const k = Math.max(0.8, Math.min(10, state.currentZoom + delta));
    state.svg.call(state.zoom.transform, d3.zoomIdentity.scale(k));
}

function addZoomButtons () {
    const wrap = d3.select('#visualization').append('div').attr('class', 'zoom-controls');

    [['+', 'zoom-in', 0.2], ['-', 'zoom-out', -0.2]].forEach(([txt, id, delta], idx) => {
        wrap.append('button').attr('class', 'zoom-button').attr('id', id).text(txt)
        .attr('aria-label', txt === '+' ? 'Zoom in' : 'Zoom out')
        .on('click', () => applyZoom(delta));
        
        if (idx === 0) wrap.append('div').attr('class', 'zoom-separator');
    });
}

/* ───────────────────────── Year Slider & Controls ───────────────────────── */
function buildYearSlider () {
    const sliderWrap = document.getElementById('year-slider-container');
    sliderWrap.innerHTML = '';
    noUiSlider.create(sliderWrap, {
    start: state.yearRange,
    connect: true,
    range: { min: d3.min(state.years), max: d3.max(state.years) },
    step: 1,
    tooltips: true,
    format: { to: Math.round, from: Number }
    });
    state.slider = sliderWrap.noUiSlider;

    const startLbl = document.getElementById('start-year');
    const endLbl   = document.getElementById('end-year');
    state.slider.on('update', v => {
        state.yearRange = v.map(Number);
        [startLbl.textContent, endLbl.textContent] = state.yearRange;
    });
    state.slider.on('set', () => {
        updateEarthquakes();
        updateAllBarCharts(); // update both bar charts
    });

    addYearControls();
}

function addYearControls () {
    const controls = document.querySelector('.year-control');

    // Play / Pause
    let playBtn = document.getElementById('play-button');
    if (!playBtn) {
        playBtn = document.createElement('button');
        playBtn.id = 'play-button';
        playBtn.className = 'control-button';
        controls.appendChild(playBtn);
    }
    playBtn.textContent = '▶ Play';
    playBtn.onclick = toggleAnimation;

    // Speed slider
    if (!controls.querySelector('#speed-slider')) {
    controls.insertAdjacentHTML('beforeend', `
        <label for="speed-slider">Speed:</label>
        <input type="range" id="speed-slider" min="250" max="2000" value="1000" class="speed-slider">
        <div class="speed-labels"><span>Slow</span><span>Fast</span></div>
    `);
    }

    // Filters
    if (!document.getElementById('filter-controls')) {
        controls.insertAdjacentHTML('beforeend', `
            <div id="filter-controls" class="filter-controls">
                <div class="filter-title">Associated Hazards:</div>
                <label class="filter-checkbox"><input type="checkbox" id="tsunami-filter"> <span class="tsunami-icon">🌊</span> Tsunami</label>
                <label class="filter-checkbox"><input type="checkbox" id="volcano-filter"> <span class="volcano-icon">🌋</span> Volcano</label>
                <label class="filter-checkbox"><input type="checkbox" id="nohazard-filter"> <span class="nohazard-icon">🚫</span> None</label>
                <div class="advanced-filters-container">
                    <button id="advanced-filters-toggle" class="advanced-filters-toggle" aria-expanded="false">Advanced Filters ▼</button>
                    <div id="advanced-filters-panel" class="advanced-filters-panel" style="display:none;">
                        <div id="quantitative-filters" class="quantitative-filters"></div>
                    </div>
                </div>
            </div>`);
    }
    document.getElementById('tsunami-filter').onchange = e => { state.filters.tsunami = e.target.checked; updateEarthquakes(); updateAllBarCharts(); };
    document.getElementById('volcano-filter').onchange = e => { state.filters.volcano = e.target.checked; updateEarthquakes(); updateAllBarCharts(); };
    document.getElementById('nohazard-filter').onchange = e => { state.filters.noHazard = e.target.checked; updateEarthquakes(); updateAllBarCharts(); };
    // Advanced filters toggle
    const advToggle = document.getElementById('advanced-filters-toggle');
    const advPanel = document.getElementById('advanced-filters-panel');
    advToggle.onclick = function() {
        const expanded = advPanel.style.display === 'block';
        advPanel.style.display = expanded ? 'none' : 'block';
        this.setAttribute('aria-expanded', !expanded);
        this.textContent = expanded ? 'Advanced Filters ▼' : 'Advanced Filters ▲';
        if (!expanded) addQuantitativeFilterSliders();
    };
    // Only render sliders if open by default (should be closed)
}

/* ───────────────────────── Quantitative Filter Sliders ───────────────────────── */
function addQuantitativeFilterSliders() {
    const container = document.getElementById('quantitative-filters');
    if (!container || container.offsetParent === null) return; // Only render if visible
    container.innerHTML = '';
    // Add minimal section title (no 'Range')
    const title = document.createElement('div');
    title.className = 'quant-filters-title';
    title.textContent = 'Filters';
    container.appendChild(title);
    const fields = [
        { key: 'magnitude', label: 'Magnitude', step: 0.1 },
        { key: 'depth', label: 'Focal Depth (km)', step: 1 },
        { key: 'deaths', label: 'Deaths', step: 1 },
        { key: 'missing', label: 'Missing', step: 1 },
        { key: 'injuries', label: 'Injuries', step: 1 },
        { key: 'damage', label: 'Damage ($Mil)', step: 1 },
        { key: 'housesDestroyed', label: 'Houses Destroyed', step: 1 },
        { key: 'housesDamaged', label: 'Houses Damaged', step: 1 }
    ];
    fields.forEach(f => {
        const filter = state.filters[f.key];
        const min = filter.min;
        const max = filter.max;
        const [curMin, curMax] = filter.current;
        // Wrapper for label and slider (horizontal)
        const wrapper = document.createElement('div');
        wrapper.className = 'quant-filter-row';
        // Label only (no min-max)
        const labelWrap = document.createElement('div');
        labelWrap.className = 'quant-label-wrap';
        labelWrap.innerHTML = `<span class="quant-label">${f.label}</span>`;
        wrapper.appendChild(labelWrap);
        // Slider container
        const sliderDiv = document.createElement('div');
        sliderDiv.id = `${f.key}-slider-container`;
        sliderDiv.className = 'quant-slider-container';
        wrapper.appendChild(sliderDiv);
        container.appendChild(wrapper);
        // Create noUiSlider
        noUiSlider.create(sliderDiv, {
            start: [curMin, curMax],
            connect: true,
            range: { min, max },
            step: f.step,
            tooltips: [true, true],
            format: {
                to: v => (f.step < 1 ? (+v).toFixed(1) : Math.round(v)),
                from: Number
            }
        });
        // Update state and UI on slider change
        sliderDiv.noUiSlider.on('update', (values) => {
            const minVal = f.step < 1 ? +(+values[0]).toFixed(1) : Math.round(values[0]);
            const maxVal = f.step < 1 ? +(+values[1]).toFixed(1) : Math.round(values[1]);
            state.filters[f.key].current = [minVal, maxVal];
        });
        sliderDiv.noUiSlider.on('set', () => {
            updateEarthquakes();
            updateAllBarCharts();
        });
    });
}

/* ───────────────────────── Interactions (Drag, Zoom) ───────────────────────── */
function wireInteractions () {
    if (state.mapView === 'globe') {
        // Drag -> rotate
        state.svg.call(
        d3.drag()
            .on('start', stopAnimation)
            .on('drag', ({ dx, dy }) => {
            const [x, y, z] = state.projection.rotate();
            state.rotate = [x + dx * 0.25, Math.max(-90, Math.min(90, y - dy * 0.25)), z];
            state.projection.rotate(state.rotate);
            redrawGlobe();
            })
        ).style('cursor', 'grab');

        // Zoom → scale
        state.zoom = d3.zoom()
        .scaleExtent([0.8, 10])
        .on('zoom', ({ transform }) => {
            state.currentZoom = transform.k;
            const s = INITIAL_SCALE * transform.k;
            state.projection.scale(s);
            d3.select('#globe-clip circle').attr('r', s);
            redrawGlobe();
        });

        state.svg.call(state.zoom).on('dblclick.zoom', null);

    } else {
        // Infinite drag for 2D map with correct direction and zoom
        let last = null;
        state.zoom = d3.zoom()
            .filter(event => event.type === 'wheel')
            .scaleExtent([0.5, 10])
            .on('zoom', function(event) {
                state.currentZoom = event.transform.k;
                // Keep the current y translation when zooming
                const currentTranslate = state.projection.translate();
                state.projection
                    .scale((state.width / (2 * Math.PI)) * state.currentZoom)
                    .translate([state.width / 2, currentTranslate[1]]);
                redrawGlobe();
            });

        state.svg.call(state.zoom);
        // Attach drag to SVG for panning (y) and rotating (x) the projection
        state.svg.call(
            d3.drag()
                .on('start', function(event) {
                    last = { x: event.x, y: event.y };
                })
                .on('drag', function(event) {
                    if (!last) return;
                    const dx = event.x - last.x;
                    const dy = event.y - last.y;
                    last = { x: event.x, y: event.y };
                    // Horizontal drag changes longitude (rotation)
                    const scale = state.projection.scale();
                    const dLon = dx / scale * 180 / Math.PI;
                    state.rotate2D.lon = ((state.rotate2D.lon + dLon + 540) % 360) - 180;
                    // Vertical drag pans (slides) the map (translate y)
                    const currentTranslate = state.projection.translate();
                    state.projection.translate([currentTranslate[0], currentTranslate[1] + dy]);
                    state.projection.rotate([state.rotate2D.lon, 0]);
                    redrawGlobe();
                })
        ).style('cursor', 'grab');
    }
}

function redrawGlobe () {
    d3.selectAll('.country, .graticule, .sphere, .fault-lines path').attr('d', state.path);
    updateEarthquakePositions();
}

/* ───────────────────────── Animation ───────────────────────── */
function toggleAnimation () {
    state.isAnimating ? stopAnimation() : startAnimation();
}

function startAnimation () {
    if (state.isAnimating) return;
    state.isAnimating = true;
    document.getElementById('play-button').textContent = '⏸ Pause';

    const speedSlider = document.getElementById('speed-slider');
    const maxYear = d3.max(state.years);

    state.animationTimer = setInterval(() => {
    const [s, e] = state.slider.get().map(Number);
    if (e < maxYear) state.slider.set([s, e + 1]);
    else if (s < maxYear) state.slider.set([s + 1, s + 1]);
    else state.slider.set([d3.min(state.years), d3.min(state.years)]);
    }, 2250 - speedSlider.value);
}

function stopAnimation () {
    clearInterval(state.animationTimer);
    state.isAnimating = false;
    document.getElementById('play-button').textContent = '▶ Play';
}

/* ───────────────────────── Get Filtered Earthquake Data ───────────────────────── */
function getFilteredEarthquakeData() {
    // Returns the currently filtered data (year, hazard, quantitative filters)
    const [start, end] = state.yearRange;
    let data = state.earthquakeData.filter(d => d.year >= start && d.year <= end);
    if (state.filters.tsunami) data = data.filter(d => d.tsunami);
    if (state.filters.volcano) data = data.filter(d => d.volcano);
    if (state.filters.noHazard) data = data.filter(d => !d.tsunami && !d.volcano);
    Q_FIELDS.forEach(key => {
        const [min, max] = state.filters[key].current;
        data = data.filter(d => d[key] >= min && d[key] <= max);
    });
    return data;
}

/* ───────────────────────── Earthquakes ───────────────────────── */
function updateEarthquakes () {
    let data;
    if (state.regionBrush && state.regionBrush.filteredData) {
        data = state.regionBrush.filteredData;
    } else {
        data = getFilteredEarthquakeData();
    }
    state.globe.selectAll('.earthquake-container').remove();
    const g = state.globe.append('g').attr('class', 'earthquake-container');
    if (state.mapView === 'globe') {
        g.attr('clip-path', 'url(#globe-clip)');
    }

    const quakes = g.selectAll('.earthquake').data(data).enter().append('g').attr('class', 'earthquake')
    .on('mouseover', showQuakeTooltip).on('mouseout', hideTooltip);

    quakes.append('circle')
    .attr('r', d => getRadius(d.magnitude))
    .attr('fill', d => getColor(d.magnitude))
    .attr('stroke', '#fff').attr('stroke-width', '0.5px')
    .attr('fill-opacity', 0.7);

    quakes.filter(d => d.tsunami).append('circle')
    .attr('r', d => getRadius(d.magnitude) * 1.5)
    .attr('fill', 'none').attr('stroke', '#00BFFF')
    .attr('stroke-width', '1.5px').attr('stroke-dasharray', '2 2');

    quakes.filter(d => d.volcano).append('circle')
    .attr('r', d => getRadius(d.magnitude) * 1.3)
    .attr('fill', 'none').attr('stroke', '#FF4500')
    .attr('stroke-width', '1.5px');

    updateEarthquakePositions();
    updateAllBarCharts();
}

function updateEarthquakePositions () {
    if (state.mapView === 'globe') {
        const [λ, φ] = state.projection.rotate();
        d3.selectAll('.earthquake').style('visibility', 'hidden').attr('transform', function (d) {
        const [x, y] = state.projection([d.longitude, d.latitude]) || [];
        const visible = d3.geoDistance([d.longitude, d.latitude], [-λ, -φ]) < Math.PI / 2;
        if (visible) {
            d3.select(this).style('visibility', 'visible');
            return `translate(${x},${y})`;
        }
        });
    } else {
        d3.selectAll('.earthquake').style('visibility', 'visible').attr('transform', function (d) {
            // Normalize longitude to [-180, 180]
            let lon = ((d.longitude + 180) % 360 + 360) % 360 - 180;
            const [x, y] = state.projection([lon, d.latitude]) || [];
            return `translate(${x},${y})`;
        });
    }
}

/* ───────────────────────── Tooltip ───────────────────────── */
function showQuakeTooltip (event, d) {
    // Format date as YYYY-MM-DD, with leading zeros or '?' if missing
    const pad = v => v ? String(v).padStart(2, '0') : '?';
    const dateStr = `${d.year}-${pad(d.month)}-${pad(d.day)}`;
    
    tooltip.html(`
        <div style="min-width:180px">
        <strong>Date:</strong> ${dateStr}<br/>
        <strong>Location:</strong> ${d.location}<br/>
        <strong>Coordinates:</strong> ${d.latitude.toFixed(2)}, ${d.longitude.toFixed(2)}<br/>
        <strong>Magnitude:</strong> ${d.magnitude ? d.magnitude.toFixed(1) : 'Unknown'}<br/>
        <strong>Deaths:</strong> ${d.deaths ?? 0}<br/>
        ${d.depth > 0 ? `<strong>Depth:</strong> ${d.depth} km<br/>` : ''}
        ${d.tsunami ? '<strong>Tsunami:</strong> Yes<br/>' : ''}
        ${d.volcano ? '<strong>Volcano:</strong> Yes<br/>' : ''}
        </div>
    `)
    .style('left', event.pageX + 10 + 'px')
    .style('top', event.pageY + 10 + 'px')
    .style('opacity', 1);

    d3.select(event.currentTarget).selectAll('circle').attr('stroke-width', 2).attr('fill-opacity', 1);
}

function hideTooltip (event) {
    tooltip.style('opacity', 0);
    d3.select(event.currentTarget).selectAll('circle').attr('stroke-width', 1.5).attr('fill-opacity', 0.7);
}

/* ───────────────────────── Bar Chart ───────────────────────── */
function initBarChart () {
    const container = document.getElementById('bar-chart-container');
    state.bar.width  = container.clientWidth  - BAR_MARGIN.left - BAR_MARGIN.right;
    state.bar.height = (container.clientHeight || 300) - BAR_MARGIN.top - BAR_MARGIN.bottom;

    state.bar.svg = d3.select('#bar-chart-container').append('svg')
    .attr('width',  state.bar.width + BAR_MARGIN.left + BAR_MARGIN.right)
    .attr('height', state.bar.height + BAR_MARGIN.top + BAR_MARGIN.bottom)
    .append('g').attr('transform', `translate(${BAR_MARGIN.left},${BAR_MARGIN.top})`);

    state.bar.x = d3.scaleBand().range([0, state.bar.width]).padding(0.2);
    state.bar.y = d3.scaleLinear().range([state.bar.height, 0]);

    state.bar.xAxis = state.bar.svg.append('g')
    .attr('class', 'axis x-axis')
    .attr('transform', `translate(0,${state.bar.height})`);
    state.bar.yAxis = state.bar.svg.append('g').attr('class', 'axis y-axis');

    state.bar.svg.append('text').attr('class', 'axis-label')
    .attr('x', state.bar.width / 2).attr('y', state.bar.height + 40)
    .attr('text-anchor', 'middle').text('Year');

    // Set y-axis label to selected metric
    const metricLabel = BAR_METRICS.find(m => m.key === state.selectedBarMetric)?.label || 'Deaths';
    state.bar.svg.append('text').attr('class', 'axis-label')
    .attr('transform', 'rotate(-90)')
    .attr('x', -state.bar.height / 2).attr('y', -55)
    .attr('text-anchor', 'middle').text(metricLabel);
}

function updateBarChart () {
    const [start, end] = state.yearRange;
    const metricKey = state.selectedBarMetric;
    let data;
    if (state.regionBrush && state.regionBrush.filteredData) {
        data = state.regionBrush.filteredData;
    } else {
        data = getFilteredEarthquakeData();
    }

    // Aggregate selected metric per year per magnitude bin
    const dataAgg = [];
    for (let year = start; year <= end; year++) {
        const yearData = data.filter(d => d.year === year);
        const bins = { year };
        MAG_BINS.forEach(bin => bins[bin.key] = 0);
        yearData.forEach(d => {
            const bin = getMagnitudeBin(d.magnitude);
            let value = 0;
            if (metricKey === 'count') {
                value = 1;
            } else {
                switch (metricKey) {
                    case 'deaths': value = +d.Deaths || d.deaths || 0; break;
                    case 'missing': value = +d.Missing || d.missing || 0; break;
                    case 'injuries': value = +d.Injuries || d.injuries || 0; break;
                    case 'damage': value = +d['Damage ($Mil)'] || d.damage || 0; break;
                    case 'housesDestroyed': value = +d['Houses Destroyed'] || d.housesDestroyed || 0; break;
                    case 'housesDamaged': value = +d['Houses Damaged'] || d.housesDamaged || 0; break;
                    default: value = d.deaths || 0;
                }
            }
            bins[bin] += value;
        });
        dataAgg.push(bins);
    }

    state.bar.x.domain(dataAgg.map(d => d.year));
    // Y domain: max total for selected metric in any year
    state.bar.y.domain([0, d3.max(dataAgg, d => MAG_BINS.reduce((sum, bin) => sum + d[bin.key], 0)) || 0]);

    // Axes
    state.bar.xAxis.transition().duration(500).call(
        d3.axisBottom(state.bar.x).tickValues(
            state.bar.x.domain().filter((_, i) => i % Math.ceil(dataAgg.length / 10) === 0)
        ));
    state.bar.yAxis.transition().duration(500).call(d3.axisLeft(state.bar.y));

    // Stack data
    const stack = d3.stack().keys(MAG_BINS.map(b => b.key));
    const series = stack(dataAgg);

    // Remove old bars
    state.bar.svg.selectAll('.bar-group').remove();

    // Draw stacked bars
    const groups = state.bar.svg.selectAll('.bar-group')
        .data(series, d => d.key)
        .enter().append('g')
        .attr('class', 'bar-group')
        .attr('fill', d => MAG_BINS.find(b => b.key === d.key).color);

    groups.selectAll('rect')
        .data(d => d)
        .enter().append('rect')
        .attr('x', d => state.bar.x(d.data.year))
        .attr('y', d => state.bar.y(d[1]))
        .attr('height', d => state.bar.y(d[0]) - state.bar.y(d[1]))
        .attr('width', state.bar.x.bandwidth())
        .on('mouseover', function(event, d) {
            // Find bin key from parent group
            const binKey = d3.select(this.parentNode).datum().key;
            const bin = MAG_BINS.find(b => b.key === binKey);
            const metricLabel = BAR_METRICS.find(m => m.key === metricKey)?.label || metricKey;
            tooltip.html(`<strong>${d.data.year}</strong><br/>${bin.label} ${metricLabel}: ${d.data[bin.key]}`)
                .style('left', event.pageX + 10 + 'px')
                .style('top', event.pageY + 10 + 'px')
                .style('opacity', 1);
            d3.select(this).attr('fill-opacity', 1);
        })
        .on('mouseout', function(event) {
            tooltip.style('opacity', 0);
            d3.select(this).attr('fill-opacity', 0.7);
        })
        .attr('fill-opacity', 0.7);
}

// Set default selected metric in state
state.selectedBarMetric = 'count';
// Populate the bar metric dropdown and set up event listener
function populateBarMetricDropdown() {
    const select = document.getElementById('bar-metric-select');
    select.innerHTML = '';
    BAR_METRICS.forEach(metric => {
        const option = document.createElement('option');
        option.value = metric.key;
        option.textContent = metric.label;
        if (metric.key === state.selectedBarMetric) option.selected = true;
        select.appendChild(option);
    });
    select.onchange = function() {
        state.selectedBarMetric = this.value;
        d3.select('#bar-chart-container').html('');
        d3.select('#top-bar-chart-container').html('');
        initBarChart();
        updateBarChart();
        initTopBarChart();
        updateTopBarChart();
    };
}

/* ───────────────────────── Top X Earthquakes Bar Chart ───────────────────────── */
function initTopBarChart() {
    const container = document.getElementById('top-bar-chart-container');
    // Use same width/height as main bar chart for consistency and to avoid 0 size
    state.topBar = {};
    state.topBar.width  = state.bar?.width || 640;
    state.topBar.height = state.bar?.height || 300;

    state.topBar.svg = d3.select('#top-bar-chart-container').append('svg')
        .attr('width',  state.topBar.width + BAR_MARGIN.left + BAR_MARGIN.right)
        .attr('height', state.topBar.height + BAR_MARGIN.top + BAR_MARGIN.bottom)
        .append('g').attr('transform', `translate(${BAR_MARGIN.left},${BAR_MARGIN.top})`);

    state.topBar.x = d3.scaleBand().range([0, state.topBar.width]).padding(0.1);
    state.topBar.y = d3.scaleLinear().range([state.topBar.height, 0]);

    state.topBar.xAxis = state.topBar.svg.append('g')
        .attr('class', 'axis x-axis')
        .attr('transform', `translate(0,${state.topBar.height})`);
    state.topBar.yAxis = state.topBar.svg.append('g').attr('class', 'axis y-axis');

    // Set y-axis label to selected metric, but if metric is 'count', label as 'Magnitude'
    let yLabel = BAR_METRICS.find(m => m.key === state.selectedBarMetric)?.label || 'Deaths';
    if (state.selectedBarMetric === 'count') yLabel = 'Magnitude';
    state.topBar.svg.selectAll('.axis-label').remove();
    state.topBar.svg.append('text').attr('class', 'axis-label')
        .attr('transform', 'rotate(-90)')
        .attr('x', -state.topBar.height / 2).attr('y', -55)
        .attr('text-anchor', 'middle').text(yLabel);
}

function updateTopBarChart() {
    const [start, end] = state.yearRange;
    const metricKey = state.selectedBarMetric;
    const topX = parseInt(document.getElementById('top-x-input').value) || 10;
    let data;
    if (state.regionBrush && state.regionBrush.filteredData) {
        data = state.regionBrush.filteredData.slice();
    } else {
        data = getFilteredEarthquakeData();
    }
    // Sort by selected metric
    data = data.slice(); // copy
    if (metricKey === 'count') {
        // Sort by magnitude descending for 'Number of Earthquakes'
        data.sort((a, b) => b.magnitude - a.magnitude);
    } else {
        data.sort((a, b) => {
            let va = getMetricValue(a, metricKey);
            let vb = getMetricValue(b, metricKey);
            return vb - va;
        });
    }
    data = data.slice(0, topX);

    // X: label (location only, but unique for domain)
    function getShortLoc(d) {
        return d.location ? d.location.split(',')[0].split(' ')[0].slice(0, 15) : '';
    }
    // Unique key for domain
    function getDomainKey(d, i) {
        return `${getShortLoc(d)}-${d.year}-${d.magnitude}-${i}`;
    }
    // For axis label, just show the short location
    state.topBar.x.domain(data.map(getDomainKey));
    // Change y-axis: if metric is 'count', y is magnitude, else as before
    if (metricKey === 'count') {
        state.topBar.y.domain([0, d3.max(data, d => d.magnitude) || 0]);
    } else {
        state.topBar.y.domain([0, d3.max(data, d => getMetricValue(d, metricKey)) || 0]);
    }

    // Axes
    state.topBar.yAxis.transition().duration(500).call(d3.axisLeft(state.topBar.y));

    // Remove old bars
    state.topBar.svg.selectAll('.top-bar').remove();

    // Draw bars
    state.topBar.svg.selectAll('.top-bar')
        .data(data)
        .enter().append('rect')
        .attr('class', 'top-bar')
        .attr('x', (d, i) => state.topBar.x(getDomainKey(d, i)))
        .attr('y', d => metricKey === 'count' ? state.topBar.y(d.magnitude) : state.topBar.y(getMetricValue(d, metricKey)))
        .attr('width', state.topBar.x.bandwidth())
        .attr('height', d => metricKey === 'count' ? state.topBar.height - state.topBar.y(d.magnitude) : state.topBar.height - state.topBar.y(getMetricValue(d, metricKey)))
        .attr('fill', '#3498db')
        .attr('fill-opacity', 0.8)
        .on('mouseover', function(event, d) {
            const metricLabel = BAR_METRICS.find(m => m.key === metricKey)?.label || metricKey;
            tooltip.html(`<strong>${d.location}</strong><br/>Year: ${d.year}<br/>Magnitude: ${d.magnitude}<br/>${metricLabel}: ${getMetricValue(d, metricKey)}`)
                .style('left', event.pageX + 10 + 'px')
                .style('top', event.pageY + 10 + 'px')
                .style('opacity', 1);
            d3.select(this).attr('fill-opacity', 1);

            // Animate/enlarge and pulsate corresponding earthquake marker on the map
            d3.selectAll('.earthquake')
                .filter(q =>
                    q.year === d.year &&
                    Math.abs(q.magnitude - d.magnitude) < 0.01 &&
                    Math.abs(q.latitude - d.latitude) < 0.01 &&
                    Math.abs(q.longitude - d.longitude) < 0.01
                )
                .each(function(q) {
                    const circle = d3.select(this).select('circle');
                    let baseR = getRadius(q.magnitude);
                    let growR = baseR * 2;
                    let t = 0;
                    // Store interval id on DOM node for cleanup
                    if (this._pulseInterval) clearInterval(this._pulseInterval);
                    this._pulseInterval = setInterval(() => {
                        t += 0.15;
                        let r = baseR + Math.abs(Math.sin(t)) * (growR - baseR);
                        circle
                            .attr('r', r)
                            .attr('fill-opacity', 1)
                            .attr('stroke', '#FFD700')
                            .attr('stroke-width', 3);
                    }, 30);
                })
                .raise();
        })
        .on('mouseout', function(event, d) {
            tooltip.style('opacity', 0);
            d3.select(this).attr('fill-opacity', 0.8);

            // Revert earthquake marker animation and stop pulsating
            d3.selectAll('.earthquake')
                .filter(q =>
                    q.year === d.year &&
                    Math.abs(q.magnitude - d.magnitude) < 0.01 &&
                    Math.abs(q.latitude - d.latitude) < 0.01 &&
                    Math.abs(q.longitude - d.longitude) < 0.01
                )
                .each(function(q) {
                    if (this._pulseInterval) {
                        clearInterval(this._pulseInterval);
                        this._pulseInterval = null;
                    }
                    d3.select(this).select('circle')
                        .transition()
                        .duration(200)
                        .attr('r', getRadius(q.magnitude))
                        .attr('fill-opacity', 0.7)
                        .attr('stroke', '#fff')
                        .attr('stroke-width', 0.5);
                });
        });

    // Add x-axis labels (rotated)
    state.topBar.svg.selectAll('.top-bar-label').remove();
    state.topBar.svg.selectAll('.top-bar-label')
        .data(data)
        .enter().append('text')
        .attr('class', 'top-bar-label')
        .attr('x', (d, i) => state.topBar.x(getDomainKey(d, i)) + state.topBar.x.bandwidth() / 2)
        .attr('y', state.topBar.height + 15)
        .attr('text-anchor', 'end')
        .attr('transform', (d, i) => `rotate(-45,${state.topBar.x(getDomainKey(d, i)) + state.topBar.x.bandwidth() / 2},${state.topBar.height + 15})`)
        .text((d) => getShortLoc(d))
        .style('font-size', '10px');
}

function getMetricValue(d, metricKey) {
    switch (metricKey) {
        case 'deaths': return +d.Deaths || d.deaths || 0;
        case 'missing': return +d.Missing || d.missing || 0;
        case 'injuries': return +d.Injuries || d.injuries || 0;
        case 'damage': return +d['Damage ($Mil)'] || d.damage || 0;
        case 'housesDestroyed': return +d['Houses Destroyed'] || d.housesDestroyed || 0;
        case 'housesDamaged': return +d['Houses Damaged'] || d.housesDamaged || 0;
        case 'count': return 1;
        default: return d.deaths || 0;
    }
}

// Wire up top X input
function wireTopXInput() {
    const input = document.getElementById('top-x-input');
    input.onchange = function() {
        d3.select('#top-bar-chart-container').html('');
        initTopBarChart();
        updateTopBarChart();
    };
}

/* ───────────────────────── Update All Bar Charts ───────────────────────── */
function updateAllBarCharts() {
    d3.select('#bar-chart-container').html('');
    d3.select('#top-bar-chart-container').html('');
    initBarChart();
    updateBarChart();
    initTopBarChart();
    updateTopBarChart();
}

/* ───────────────────────── Responsive ───────────────────────── */
window.addEventListener('resize', debounce(() => {
    const vis = document.getElementById('visualization');
    state.width = Math.min(800, vis.clientWidth);
    state.height = Math.min(500, state.width * (500 / 800));

    state.svg.attr('width', state.width).attr('height', state.height);
    state.projection.translate([state.width / 2, state.height / 2]);
    d3.select('#globe-clip circle').attr('r', state.projection.scale());

    redrawGlobe();

    d3.select('#bar-chart-container').html('');
    d3.select('#top-bar-chart-container').html('');
    initBarChart();
    updateBarChart();
    initTopBarChart();
    updateTopBarChart();
}, 150));

/* ───────────────────────── Region Selection Brush ───────────────────────── */

// Add to state: region selection
state.regionBrush = {
    active: false,
    selection: null,
    filteredData: null,
    state: 'idle' // 'idle' | 'select' | 'selecting' | 'done'
};

function setRegionBrushState(newState) {
    state.regionBrush.state = newState;
    const btn = document.getElementById('select-region-btn');
    if (!btn) return;
    btn.classList.remove('active', 'selecting', 'done');
    switch (newState) {
        case 'select':
            btn.textContent = 'Click and drag to select';
            btn.classList.add('active');
            break;
        case 'selecting':
            btn.textContent = 'Selecting...';
            btn.classList.add('selecting');
            break;
        case 'done':
            btn.textContent = 'Selection done (Click to clear)';
            btn.classList.add('done');
            break;
        default:
            btn.textContent = 'Select Region';
    }
}

// --- Brush logic ---
function enableRegionBrush() {
    if (state.regionBrush.g) state.regionBrush.g.remove();
    const svg = state.svg;
    const brush = d3.brush()
        .extent([[0, 0], [state.width, state.height]])
        .on('start', brushStarted)
        .on('brush', brushed)
        .on('end', brushEnded);
    state.regionBrush.g = svg.append('g').attr('class', 'region-brush').call(brush);
    state.regionBrush.brush = brush;
    svg.style('cursor', 'crosshair');
    setRegionBrushState('select');
    disableMapInteractions();
}

function disableRegionBrush() {
    if (state.regionBrush.g) state.regionBrush.g.remove();
    state.regionBrush.active = false;
    state.regionBrush.selection = null;
    state.regionBrush.filteredData = null;
    setRegionBrushState('idle');
    state.svg.style('cursor', state.mapView === 'globe' ? 'grab' : 'default');
    enableMapInteractions();
    updateEarthquakes();
    updateAllBarCharts();
}

function brushStarted(event) {
    setRegionBrushState('selecting');
}

function brushed(event) {
    // Highlight the brush rectangle (default d3.brush style is fine)
}

function brushEnded(event) {
    if (!event.selection) {
        // Brush cleared
        disableRegionBrush();
        return;
    }
    const [[x0, y0], [x1, y1]] = event.selection;
    // Project all earthquakes to x/y and filter those inside
    let data = getFilteredEarthquakeData();
    const selected = data.filter(d => {
        let coords = state.projection([d.longitude, d.latitude]);
        if (!coords) return false;
        const [x, y] = coords;
        return x >= x0 && x <= x1 && y >= y0 && y <= y1;
    });
    state.regionBrush.selection = event.selection;
    state.regionBrush.filteredData = selected;
    setRegionBrushState('done');
    state.regionBrush.active = true;
    state.svg.style('cursor', 'default');
    enableMapInteractions(); // allow map interaction after selection is done
    updateEarthquakes();
    updateAllBarCharts();
}

function disableMapInteractions() {
    // Remove drag/zoom handlers
    if (state.svg) {
        state.svg.on('.zoom', null);
        state.svg.on('.drag', null);
        state.svg.on('mousedown.zoom', null);
        state.svg.on('mousemove.zoom', null);
        state.svg.on('mouseup.zoom', null);
        state.svg.on('touchstart.zoom', null);
        state.svg.on('touchmove.zoom', null);
        state.svg.on('touchend.zoom', null);
        state.svg.on('wheel.zoom', null);
        state.svg.on('dblclick.zoom', null);
    }
}

function enableMapInteractions() {
    // Re-wire interactions
    wireInteractions();
}

// --- Button wiring ---
document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('select-region-btn');
    if (!btn) return;
    setRegionBrushState('idle');
    btn.onclick = function(e) {
        if (state.regionBrush.state === 'idle') {
            state.regionBrush.active = true;
            enableRegionBrush();
        } else if (state.regionBrush.state === 'done') {
            disableRegionBrush();
        }
        // If selecting, ignore click
    };
    // Cancel brush on click outside SVG
    document.addEventListener('mousedown', function(ev) {
        if (!state.regionBrush.active) return;
        const svgNode = state.svg.node();
        if (!svgNode.contains(ev.target) && ev.target !== btn) {
            disableRegionBrush();
        }
    });
});