/* ───────────────────────── Config ───────────────────────── */
const WIDTH  = 800;
const HEIGHT = 500;
const INITIAL_SCALE = 250;
const MAG_COLORS = [
    { limit: 8, color: '#F44336', radius: 8 },   // >8  ⇒ red
    { limit: 7, color: '#FF5722', radius: 6 },   // 7‑8 ⇒ orange
    { limit: 6, color: '#FFC107', radius: 4 }    // 6‑7 ⇒ yellow
];
const MAG_BINS = [
    { key: 'small',  label: '≤6.0',      color: '#4CAF50' },
    { key: 'medium', label: '6.1-7.0',   color: '#FFC107' },
    { key: 'large',  label: '7.1-8.0',   color: '#FF5722' },
    { key: 'major',  label: '>8.0',      color: '#F44336' }
];
const BAR_MARGIN = { top: 20, right: 30, bottom: 80, left: 80 };

const BAR_METRICS = [
    { key: 'count', label: 'Number of Earthquakes' },
    { key: 'deaths', label: 'Deaths' },
    { key: 'missing', label: 'Missing' },
    { key: 'injuries', label: 'Injuries' },
    { key: 'damage', label: 'Damage ($Mil)' },
    { key: 'housesDestroyed', label: 'Houses Destroyed' },
    { key: 'housesDamaged', label: 'Houses Damaged' },
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
    filters: { tsunami: false, volcano: false },
    bar: {}
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
    await drawGlobe();
    buildYearSlider();
    wireInteractions();
    populateBarMetricDropdown(); // NEW: populate dropdown
    initBarChart();
    updateEarthquakes();
}

/* ───────────────────────── SVG / Projection ───────────────────────── */
function buildSvg () {
    state.svg = d3.select('#visualization')
    .append('svg')
    .attr('class', 'globe')
    .attr('width', state.width)
    .attr('height', state.height);

    state.projection = d3.geoOrthographic()
    .scale(INITIAL_SCALE)
    .translate([state.width / 2, state.height / 2])
    .clipAngle(90);

    state.path = d3.geoPath().projection(state.projection);
    state.globe = state.svg.append('g');

    state.svg.append('defs').append('clipPath')
    .attr('id', 'globe-clip')
    .append('circle')
    .attr('cx', state.width / 2)
    .attr('cy', state.height / 2)
    .attr('r', state.projection.scale());
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
    state.yearRange = [state.years[0], state.years[0]];

    state.dataByYear = Array.from(
    d3.rollup(state.earthquakeData, v => d3.sum(v, d => d.deaths), d => d.year),
    ([year, earthquakeDeaths]) => ({ year, earthquakeDeaths })
    );
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

    // Sphere outline
    state.globe.append('path')
    .datum({ type: 'Sphere' })
    .attr('class', 'sphere')
    .attr('fill', 'none')
    .attr('stroke', '#000')
    .attr('stroke-width', '1.5px')
    .attr('d', state.path);
}

/* ───────────────────────── Zoom Buttons ───────────────────────── */
function applyZoom (delta) {
    const k = Math.max(0.8, Math.min(10, state.currentZoom + delta));
    state.svg.call(state.zoom.transform, d3.zoomIdentity.scale(k));
}

function addZoomButtons () {
    const wrap = d3.select('#visualization').append('div').attr('class', 'zoom-controls');

    [['+', 'zoom-in', 0.2], ['−', 'zoom-out', -0.2]].forEach(([txt, id, delta], idx) => {
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
        updateBarChart();
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
        <div class="filter-title">Event Filters:</div>
        <label class="filter-checkbox"><input type="checkbox" id="tsunami-filter"> <span class="tsunami-icon">🌊</span> Tsunami</label>
        <label class="filter-checkbox"><input type="checkbox" id="volcano-filter"> <span class="volcano-icon">🌋</span> Volcano</label>
        </div>`);
    }

    document.getElementById('tsunami-filter').onchange = e => { state.filters.tsunami = e.target.checked; updateEarthquakes(); };
    document.getElementById('volcano-filter').onchange = e => { state.filters.volcano = e.target.checked; updateEarthquakes(); };
}

/* ───────────────────────── Interactions (Drag, Zoom) ───────────────────────── */
function wireInteractions () {
    // Drag → rotate
    state.svg.call(
    d3.drag()
        .on('start', stopAnimation)
        .on('drag', ({ dx, dy }) => {
        const [λ, φ, γ] = state.projection.rotate();
        state.rotate = [λ + dx * 0.25, Math.max(-90, Math.min(90, φ - dy * 0.25)), γ];
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

    addZoomButtons();
}

function redrawGlobe () {
    d3.selectAll('.country, .graticule, .sphere').attr('d', state.path);
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

/* ───────────────────────── Earthquakes ───────────────────────── */
function updateEarthquakes () {
    const [start, end] = state.yearRange;
    let data = state.earthquakeData.filter(d => d.year >= start && d.year <= end);
    if (state.filters.tsunami) data = data.filter(d => d.tsunami);
    if (state.filters.volcano) data = data.filter(d => d.volcano);

    state.globe.selectAll('.earthquake-container').remove();
    const g = state.globe.append('g').attr('class', 'earthquake-container').attr('clip-path', 'url(#globe-clip)');

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
    updateBarChart();
}

function updateEarthquakePositions () {
    const [λ, φ] = state.projection.rotate();
    d3.selectAll('.earthquake').style('visibility', 'hidden').attr('transform', function (d) {
    const [x, y] = state.projection([d.longitude, d.latitude]) || [];
    const visible = d3.geoDistance([d.longitude, d.latitude], [-λ, -φ]) < Math.PI / 2;
    if (visible) {
        d3.select(this).style('visibility', 'visible');
        return `translate(${x},${y})`;
    }
    });
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

    state.bar.x = d3.scaleBand().range([0, state.bar.width]).padding(0.1);
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
    // Aggregate selected metric per year per magnitude bin
    const data = [];
    for (let year = start; year <= end; year++) {
        const yearData = state.earthquakeData.filter(d => d.year === year);
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
        data.push(bins);
    }

    state.bar.x.domain(data.map(d => d.year));
    // Y domain: max total for selected metric in any year
    state.bar.y.domain([0, d3.max(data, d => MAG_BINS.reduce((sum, bin) => sum + d[bin.key], 0)) || 0]);

    // Axes
    state.bar.xAxis.transition().duration(500).call(
        d3.axisBottom(state.bar.x).tickValues(
            state.bar.x.domain().filter((_, i) => i % Math.ceil(data.length / 10) === 0)
        ));
    state.bar.yAxis.transition().duration(500).call(d3.axisLeft(state.bar.y));

    // Stack data
    const stack = d3.stack().keys(MAG_BINS.map(b => b.key));
    const series = stack(data);

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
        initBarChart();
        updateBarChart();
    };
}

/* ───────────────────────── Responsive ───────────────────────── */
window.addEventListener('resize', debounce(() => {
    const vis = document.getElementById('visualization');
    state.width = Math.min(800, vis.clientWidth);
    state.height = Math.min(500, state.width * (500 / 800));

    state.svg.attr('width', state.width).attr('height', state.height);
    state.projection.translate([state.width / 2, state.height / 2]);
    d3.select('#globe-clip circle').attr('cx', state.width / 2).attr('cy', state.height / 2);

    redrawGlobe();

    d3.select('#bar-chart-container').html('');
    initBarChart();
    updateBarChart();
}, 150));