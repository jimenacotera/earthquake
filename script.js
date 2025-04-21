// Global variables
let width = 800;
let height = 500;
let earthquakeData = [];
let years = [];
let startYear = null;
let endYear = null;
let globe = null;
let projection = null;
let path = null;
let svg = null;
let rotate = [0, 0, 0];
let drag = null;
let zoom = null;
let initialScale = 250;
let currentZoomLevel = 1; // Track current zoom level
let animationTimer = null;
let isAnimating = false;
// Filter states
let showTsunamiOnly = false;
let showVolcanoOnly = false;

// Global noUiSlider reference
let yearSlider = null;

// Add tooltip div
const tooltip = d3.select('body').append('div').attr('class', 'tooltip');

// Get the radius of an earthquake based on its magnitude
function getRadiusByMagnitude(magnitude) {
    if (!magnitude || isNaN(magnitude)) return 3;
    if (magnitude > 8) return 8;
    if (magnitude > 7) return 6;
    if (magnitude > 6) return 4;
    return 3;
}

// Get the color of an earthquake based on its magnitude
function getColorByMagnitude(magnitude) {
    if (!magnitude || isNaN(magnitude)) return '#4CAF50';
    
    if (magnitude > 8) return '#F44336'; // Red
    if (magnitude > 7) return '#FF5722'; // Orange
    if (magnitude > 6) return '#FFC107'; // Yellow
    return '#4CAF50'; // Green
}

// Initialize the visualization
async function init() {
    // Create the SVG element
    svg = d3.select('#visualization')
        .append('svg')
        .attr('width', width)
        .attr('height', height)
        .attr('class', 'globe');

    // Create a projection for the globe
    projection = d3.geoOrthographic()
        .scale(initialScale) // Use initial scale
        .translate([width / 2, height / 2])
        .clipAngle(90);

    // Create a path generator for the globe
    path = d3.geoPath().projection(projection);

    // Create a group for the globe
    globe = svg.append('g');

    // Add a clipping path for the globe
    svg.append('defs')
        .append('clipPath')
        .attr('id', 'globe-clip')
        .append('circle')
        .attr('cx', width / 2)
        .attr('cy', height / 2)
        .attr('r', projection.scale()); // Use current projection scale

    // Load the world map data and earthquake data
    try {
        const [worldData] = await Promise.all([
            d3.json('https://unpkg.com/world-atlas@2/countries-110m.json')
        ]);

        // Load earthquake data from the TSV file
        await loadEarthquakeData();

        // Draw the globe
        drawGlobe(worldData);

        // Setup year selector
        setupYearSelector();

        // Setup drag behavior for rotation
        setupGlobeDrag();

        // Setup zoom behavior for scaling
        setupGlobeZoom();

        // Add initial earthquakes
        updateEarthquakes();
    } catch (error) {
        console.error('Error loading data:', error);
    }
}

// Load earthquake data from the TSV file
async function loadEarthquakeData() {
    try {
        const data = await d3.tsv('earthquakes-2025-04-19_10-45-30_+0100.tsv');
        
        // Process earthquake data
        earthquakeData = data.filter(d => {
            // Exclude rows without valid coordinates or year
            return d.Year && d.Latitude && d.Longitude &&
                   !isNaN(+d.Year) && !isNaN(+d.Latitude) && !isNaN(+d.Longitude) &&
                   +d.Year >= 1900; // We're focusing on earthquakes from 1900 onwards
        }).map(d => {
            return {
                year: +d.Year,
                month: +d.Mo,
                day: +d.Dy,
                latitude: +d.Latitude,
                longitude: +d.Longitude,
                magnitude: +d.Mag || 0,
                location: d['Location Name'] || 'Unknown',
                depth: +d['Focal Depth (km)'] || 0,
                deaths: +d.Deaths || 0,
                tsunami: d.Tsu && d.Tsu.trim() !== '',  // Has tsunami flag
                volcano: d.Vol && d.Vol.trim() !== '',  // Has volcano flag
            };
        });
        
        // Get unique years for the selector
        years = [...new Set(earthquakeData.map(d => d.year))].sort();
        
        // Set default year range to the first year
        if (years.length > 0) {
            startYear = years[0];
            endYear = years[0]; // Initially, the range is just the first year
        }
    } catch (error) {
        console.error('Error loading earthquake data:', error);
    }
}

// Draw the globe
function drawGlobe(worldData) {
    // Draw graticule
    const graticule = d3.geoGraticule();
    globe.append('path')
        .datum(graticule)
        .attr('class', 'graticule')
        .attr('d', path);
    
    // Draw countries
    globe.selectAll('.country')
        .data(topojson.feature(worldData, worldData.objects.countries).features)
        .enter()
        .append('path')
        .attr('class', 'country')
        .attr('d', path);
    
    // Draw globe outline
    globe.append('path')
        .datum({type: 'Sphere'})
        .attr('class', 'sphere')
        .attr('fill', 'none')
        .attr('stroke', '#000')
        .attr('stroke-width', '1.5px')
        .attr('d', path);
}

// Setup drag behavior for the globe rotation
function setupGlobeDrag() {
    drag = d3.drag()
        .on('start', dragStarted)
        .on('drag', dragged)
        .on('end', dragEnded); // Add end handler

    svg.call(drag)
       .on("dblclick.zoom", null); // Disable double-click zoom if drag is active

    svg.style('cursor', 'grab'); // Set initial cursor
}

// Setup zoom behavior for the globe scaling
function setupGlobeZoom() {
    zoom = d3.zoom()
        .scaleExtent([0.8, 10]) // Limit zoom scale (80% to 1000%)
        .on('zoom', zoomed);

    svg.call(zoom);
    
    // Add the zoom buttons
    addZoomControls();
}

// Handle zooming - update scale
function zoomed(event) {
    const { transform } = event;

    // Update projection scale based on zoom transform's k
    const newScale = initialScale * transform.k;
    projection.scale(newScale);

    // Update clipping path radius to match new scale
    svg.select('#globe-clip circle').attr('r', newScale);
    
    // Store current zoom level
    currentZoomLevel = transform.k;

    // Redraw elements affected by scale change
    redrawGlobeElements();
}

// Handle drag start
function dragStarted(event) { // event is passed automatically by d3
    // Stop animation when user starts dragging
    stopAnimation();
    d3.select(this).style('cursor', 'grabbing');
}

// Handle dragging - update rotation based on delta
function dragged(event) { // event is passed automatically by d3
    const sensitivity = 0.25;
    const r = projection.rotate(); // Get current rotation

    // Calculate new rotation based on drag delta (event.dx, event.dy)
    rotate[0] = r[0] + event.dx * sensitivity;
    rotate[1] = r[1] - event.dy * sensitivity;
    rotate[1] = Math.max(-90, Math.min(90, rotate[1])); // Clamp latitude rotation

    projection.rotate(rotate);

    // Redraw elements affected by rotation
    redrawGlobeElements();
}

// Handle drag end - reset cursor
function dragEnded(event) { // event is passed automatically by d3
    d3.select(this).style('cursor', 'grab');
}

// Helper function to redraw elements affected by projection changes
function redrawGlobeElements() {
    // Redraw paths using the updated projection
    d3.selectAll('.country').attr('d', path);
    d3.selectAll('.graticule').attr('d', path);
    d3.selectAll('.sphere').attr('d', path);

    // Update earthquake positions based on the updated projection
    updateEarthquakePositions();
}


// Setup year selector
function setupYearSelector() {
    const minYear = Math.min(...years);
    const maxYear = Math.max(...years);
    const startYearDisplay = document.getElementById('start-year');
    const endYearDisplay = document.getElementById('end-year');
    const sliderContainer = document.getElementById('year-slider-container');
    sliderContainer.innerHTML = '';
    noUiSlider.create(sliderContainer, {
        start: [startYear, endYear],
        connect: true,
        range: { min: minYear, max: maxYear },
        step: 1,
        tooltips: [true, true],
        format: { to: v => Math.round(v), from: v => +v }
    });
    const slider = sliderContainer.noUiSlider;
    yearSlider = slider;
    slider.on('update', (values) => {
        startYear = +values[0];
        endYear = +values[1];
        startYearDisplay.textContent = startYear;
        endYearDisplay.textContent = endYear;
    });
    slider.on('set', () => {
        updateEarthquakes();
    });
    // Play/Pause and speed controls appended below
    const controlsDiv = document.querySelector('.year-control');
    let controlsWrapper = controlsDiv.querySelector('.controls-wrapper');
    if (!controlsWrapper) {
        controlsWrapper = document.createElement('div');
        controlsWrapper.className = 'controls-wrapper';
        controlsDiv.appendChild(controlsWrapper);
    }
    let playButton = document.getElementById('play-button');
    if (!playButton) {
        playButton = document.createElement('button');
        playButton.id = 'play-button';
        playButton.innerHTML = '▶ Play';
        playButton.className = 'control-button';
        playButton.addEventListener('click', toggleAnimation);
        controlsWrapper.appendChild(playButton);
    }
    let speedControl = controlsDiv.querySelector('.speed-control');
    if (!speedControl) {
        speedControl = document.createElement('div');
        speedControl.className = 'speed-control';
        speedControl.innerHTML = `
            <label for="speed-slider">Speed:</label>
            <input type="range" id="speed-slider" min="250" max="2000" value="1000" class="speed-slider">
            <div class="speed-labels"><span>Slow</span><span>Fast</span></div>
        `;
        controlsWrapper.appendChild(speedControl);
    }
    
    // Add filter checkboxes
    let filterControls = document.getElementById('filter-controls');
    if (!filterControls) {
        filterControls = document.createElement('div');
        filterControls.id = 'filter-controls';
        filterControls.className = 'filter-controls';
        filterControls.innerHTML = `
            <div class="filter-title">Event Filters:</div>
            <label class="filter-checkbox">
                <input type="checkbox" id="tsunami-filter"> 
                <span class="tsunami-icon">🌊</span> Tsunami
            </label>
            <label class="filter-checkbox">
                <input type="checkbox" id="volcano-filter">
                <span class="volcano-icon">🌋</span> Volcano
            </label>
        `;
        controlsDiv.appendChild(filterControls);
        
        // Add event listeners for the checkboxes
        document.getElementById('tsunami-filter').addEventListener('change', function(e) {
            showTsunamiOnly = e.target.checked;
            updateEarthquakes();
        });
        
        document.getElementById('volcano-filter').addEventListener('change', function(e) {
            showVolcanoOnly = e.target.checked;
            updateEarthquakes();
        });
    }
}

// Toggle animation play/pause
function toggleAnimation() {
    const playButton = document.getElementById('play-button');
    
    if (isAnimating) {
        stopAnimation();
        playButton.innerHTML = '▶ Play';
    } else {
        startAnimation();
        playButton.innerHTML = '⏸ Pause';
    }
}

// Play animation for the year range using noUiSlider
function startAnimation() {
    if (isAnimating) return;
    isAnimating = true;
    
    const speedSlider = document.getElementById('speed-slider');
    const playButton = document.getElementById('play-button');
    const maxYear = Math.max(...years);
    
    playButton.innerHTML = '⏸ Pause';
    
    animationTimer = setInterval(() => {
        if (!yearSlider) return;
        
        const values = yearSlider.get();
        let cs = +values[0];
        let ce = +values[1];
        
        if (ce < maxYear) {
            // Increment end year
            ce++;
            yearSlider.set([cs, ce]);
        } else if (cs < maxYear) {
            // If end year reached max, increment both
            cs++;
            ce = cs;
            yearSlider.set([cs, ce]);
        } else {
            // Reset to beginning when both reach max
            cs = Math.min(...years);
            ce = cs;
            yearSlider.set([cs, ce]);
        }
        
    }, 2250 - speedSlider.value); // Speed calculation
}

function stopAnimation() {
    if (!isAnimating) return;
    clearInterval(animationTimer);
    isAnimating = false;
    const playButton = document.getElementById('play-button');
    if (playButton) playButton.innerHTML = '▶ Play';
}

// Update earthquakes based on the selected year range and filters
function updateEarthquakes() {
    // Filter earthquakes for the selected year range and applied filters
    let filteredData = earthquakeData.filter(d => d.year >= startYear && d.year <= endYear);
    
    // Apply tsunami filter if enabled
    if (showTsunamiOnly) {
        filteredData = filteredData.filter(d => d.tsunami);
    }
    
    // Apply volcano filter if enabled
    if (showVolcanoOnly) {
        filteredData = filteredData.filter(d => d.volcano);
    }
    
    // Remove existing earthquakes
    globe.selectAll('.earthquake').remove();
    globe.selectAll('.earthquake-container').remove();
    
    // Create a group for earthquakes with clip path
    const earthquakesGroup = globe.append('g')
        .attr('class', 'earthquake-container')
        .attr('clip-path', 'url(#globe-clip)');
    
    // Add earthquakes as points
    const earthquakes = earthquakesGroup.selectAll('.earthquake')
        .data(filteredData)
        .enter()
        .append('g')
        .attr('class', 'earthquake')
        .on('mouseover', showEarthquakeInfo)
        .on('mouseout', hideEarthquakeInfo);
        
    // Add the main earthquake circle
    earthquakes.append('circle')
        .attr('r', d => getRadiusByMagnitude(d.magnitude))
        .attr('fill', d => getColorByMagnitude(d.magnitude))
        .attr('stroke', '#fff')
        .attr('stroke-width', '0.5px')
        .attr('fill-opacity', 0.7);
    
    // Add tsunami indicator if applicable
    earthquakes.filter(d => d.tsunami)
        .append('circle')
        .attr('r', d => getRadiusByMagnitude(d.magnitude) * 1.5)
        .attr('fill', 'none')
        .attr('stroke', '#00BFFF')
        .attr('stroke-width', '1.5px')
        .attr('stroke-dasharray', '2,2');
        
    // Add volcano indicator if applicable
    earthquakes.filter(d => d.volcano)
        .append('circle')
        .attr('r', d => getRadiusByMagnitude(d.magnitude) * 1.3)
        .attr('fill', 'none')
        .attr('stroke', '#FF4500')
        .attr('stroke-width', '1.5px');
    
    // Set initial positions
    updateEarthquakePositions();
    
    // Log count for debugging
    console.log(`Displaying ${filteredData.length} earthquakes for year range ${startYear}-${endYear}, tsunami: ${showTsunamiOnly}, volcano: ${showVolcanoOnly}`);
}

// Update earthquake positions when the globe rotates or zooms
function updateEarthquakePositions() {
    // No change needed here, but ensure it uses the current projection state implicitly
    const [lambda, phi] = projection.rotate();
    d3.selectAll('.earthquake').each(function(d) {
        const point = d3.select(this);
        const coord = projection([d.longitude, d.latitude]);
        // Determine if on front hemisphere
        const visible = d3.geoDistance([d.longitude, d.latitude], [-lambda, -phi]) < Math.PI / 2;
        if (coord && visible) {
            point.attr('transform', `translate(${coord[0]}, ${coord[1]})`)
                 .style('visibility', 'visible');
        } else {
            point.style('visibility', 'hidden');
        }
    });
}

// Show earthquake information on hover
function showEarthquakeInfo(event, d) {
    const info = `
        <strong>Date:</strong> ${d.year}/${d.month || '?'} / ${d.day || '?'}<br/>
        <strong>Location:</strong> ${d.location}<br/>
        <strong>Coordinates:</strong> ${d.latitude.toFixed(2)}, ${d.longitude.toFixed(2)}<br/>
        <strong>Magnitude:</strong> ${d.magnitude ? d.magnitude.toFixed(1) : 'Unknown'}<br/>
        ${d.deaths > 0 ? `<strong>Deaths:</strong> ${d.deaths}<br/>` : ''}
        ${d.depth > 0 ? `<strong>Depth:</strong> ${d.depth} km<br/>` : ''}
        ${d.tsunami ? '<strong>Tsunami:</strong> Yes<br/>' : ''}
        ${d.volcano ? '<strong>Volcano:</strong> Yes<br/>' : ''}
    `;
    tooltip.html(info)
        .style('left', (event.pageX + 10) + 'px')
        .style('top', (event.pageY + 10) + 'px')
        .style('opacity', 1);
    d3.select(event.currentTarget).selectAll('circle')
        .attr('stroke-width', '2px')
        .attr('fill-opacity', 1);
}

// Hide earthquake information on mouseout
function hideEarthquakeInfo(event) {
    tooltip.style('opacity', 0);
    d3.select(event.currentTarget).selectAll('circle')
        .attr('stroke-width', function() {
            return d3.select(this).classed('earthquake-circle') ? '0.5px' : '1.5px';
        })
        .attr('fill-opacity', 0.7);
}

// Add zoom control buttons
function addZoomControls() {
    // Create container for zoom controls
    const container = d3.select('#visualization');
    const zoomControls = container.append('div')
        .attr('class', 'zoom-controls');
    
    // Add zoom in button with inline styles
    zoomControls.append('button')
        .attr('class', 'zoom-button')
        .attr('id', 'zoom-in')
        .attr('aria-label', 'Zoom in')
        .style('width', '36px')
        .style('height', '36px')
        .style('background-color', '#000000')
        .style('color', '#FFFFFF')
        .style('border', 'none')
        .style('border-radius', '50%')
        .style('font-size', '24px')
        .style('font-weight', 'bold')
        .style('cursor', 'pointer')
        .style('display', 'flex')
        .style('align-items', 'center')
        .style('justify-content', 'center')
        .text('+')
        .on('click', () => zoomByDelta(0.2));
    
    // Add separator
    zoomControls.append('div')
        .attr('class', 'zoom-separator');
    
    // Add zoom out button with inline styles
    zoomControls.append('button')
        .attr('class', 'zoom-button')
        .attr('id', 'zoom-out')
        .attr('aria-label', 'Zoom out')
        .style('width', '36px')
        .style('height', '36px')
        .style('background-color', '#000000')
        .style('color', '#FFFFFF')
        .style('border', 'none')
        .style('border-radius', '50%')
        .style('font-size', '24px')
        .style('font-weight', 'bold')
        .style('cursor', 'pointer')
        .style('display', 'flex')
        .style('align-items', 'center')
        .style('justify-content', 'center')
        .text('−')
        .on('click', () => zoomByDelta(-0.2));
}

// Zoom in/out by a delta amount
function zoomByDelta(delta) {
    // Get current zoom level
    const newZoomLevel = Math.max(0.8, Math.min(10, currentZoomLevel + delta));
    
    // Apply the zoom transform
    svg.call(zoom.transform, d3.zoomIdentity.scale(newZoomLevel));
}

// Call init when the document is loaded
document.addEventListener('DOMContentLoaded', function() {
    init();

    // Handle window resize
    window.addEventListener('resize', function() {
        const container = document.getElementById('visualization');
        if (container) {
            const containerWidth = container.clientWidth;
            // Adjust width/height based on container, respecting max initial size
            width = Math.min(800, containerWidth); // Use initial width as max
            height = Math.min(500, width * (500/800)); // Maintain aspect ratio

            // Update SVG dimensions
            svg.attr('width', width).attr('height', height);

            // Update projection translation (center) and potentially initialScale if base size changes drastically
            projection.translate([width / 2, height / 2]);
            // Note: initialScale remains fixed unless explicitly recalculated based on new width/height
            // The current zoom level (transform.k) will adapt the scale relative to initialScale

            // Update clipping path center and radius based on current scale
            const currentScale = projection.scale();
            svg.select('#globe-clip circle')
               .attr('cx', width / 2)
               .attr('cy', height / 2)
               .attr('r', currentScale); // Use current scale, not initial

            // Redraw everything with new dimensions and projection settings
            redrawGlobeElements();
        }
    });
});