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
let animationTimer = null;
let isAnimating = false;

// Global noUiSlider reference
let yearSlider = null;

// Add tooltip div
const tooltip = d3.select('body').append('div').attr('class', 'tooltip');

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
        .scale(250)
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
        .attr('r', projection.scale());
    
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
        
        // Setup drag behavior
        setupGlobeDrag();
        
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
                deaths: +d.Deaths || 0
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

// Setup drag behavior for the globe
function setupGlobeDrag() {
    drag = d3.drag()
        .on('start', dragStarted)
        .on('drag', dragged);
    
    svg.call(drag);
}

// Handle drag start
function dragStarted() {
    // Stop animation when user starts dragging
    stopAnimation();
    
    d3.select(this).attr('cursor', 'grabbing');
}

// Handle dragging
function dragged(event) {
    const sensitivity = 0.25;
    rotate[0] += event.dx * sensitivity;
    rotate[1] -= event.dy * sensitivity;
    rotate[1] = Math.max(-90, Math.min(90, rotate[1]));
    
    projection.rotate(rotate);
    
    // Redraw all elements
    d3.selectAll('.country').attr('d', path);
    d3.selectAll('.graticule').attr('d', path);
    d3.selectAll('.sphere').attr('d', path);
    
    // Update earthquake positions
    updateEarthquakePositions();
}

// Update earthquake positions when the globe rotates
function updateEarthquakePositions() {
    const [lambda, phi] = projection.rotate();
    d3.selectAll('.earthquake').each(function(d) {
        const point = d3.select(this);
        const coord = projection([d.longitude, d.latitude]);
        // Determine if on front hemisphere
        const visible = d3.geoDistance([d.longitude, d.latitude], [-lambda, -phi]) < Math.PI / 2;
        if (coord && visible) {
            point.attr('cx', coord[0])
                 .attr('cy', coord[1])
                 .attr('visibility', 'visible');
        } else {
            point.attr('visibility', 'hidden');
        }
    });
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

// Update earthquakes based on the selected year range
function updateEarthquakes() {
    // Filter earthquakes for the selected year range
    const filteredData = earthquakeData.filter(d => d.year >= startYear && d.year <= endYear);
    
    // Remove existing earthquakes
    globe.selectAll('.earthquake').remove();
    globe.selectAll('.earthquake-container').remove();
    
    // Create a group for earthquakes with clip path
    const earthquakesGroup = globe.append('g')
        .attr('class', 'earthquake-container')
        .attr('clip-path', 'url(#globe-clip)');
    
    // Add earthquakes as points
    earthquakesGroup.selectAll('.earthquake')
        .data(filteredData)
        .enter()
        .append('circle')
        .attr('class', 'earthquake')
        .attr('r', d => getRadiusByMagnitude(d.magnitude))
        .attr('fill', d => getColorByMagnitude(d.magnitude))
        .attr('stroke', '#fff')
        .attr('stroke-width', '0.5px')
        .attr('fill-opacity', 0.7)
        .on('mouseover', showEarthquakeInfo)
        .on('mouseout', hideEarthquakeInfo);
    
    // Set initial positions
    updateEarthquakePositions();
    
    // Log count for debugging
    console.log(`Displaying ${filteredData.length} earthquakes for year range ${startYear}-${endYear}`);
}

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

// Show earthquake information on hover
function showEarthquakeInfo(event, d) {
    const info = `
        <strong>Date:</strong> ${d.year}/${d.month || '?'} / ${d.day || '?'}<br/>
        <strong>Location:</strong> ${d.location}<br/>
        <strong>Coordinates:</strong> ${d.latitude.toFixed(2)}, ${d.longitude.toFixed(2)}<br/>
        <strong>Magnitude:</strong> ${d.magnitude ? d.magnitude.toFixed(1) : 'Unknown'}<br/>
        ${d.deaths > 0 ? `<strong>Deaths:</strong> ${d.deaths}<br/>` : ''}
        ${d.depth > 0 ? `<strong>Depth:</strong> ${d.depth} km<br/>` : ''}
    `;
    tooltip.html(info)
        .style('left', (event.pageX + 10) + 'px')
        .style('top', (event.pageY + 10) + 'px')
        .style('opacity', 1);
    d3.select(event.currentTarget)
        .attr('stroke-width', '2px')
        .attr('fill-opacity', 1);
}

// Hide earthquake information on mouseout
function hideEarthquakeInfo(event) {
    tooltip.style('opacity', 0);
    d3.select(event.currentTarget)
        .attr('stroke-width', '0.5px')
        .attr('fill-opacity', 0.7);
}

// Call init when the document is loaded
document.addEventListener('DOMContentLoaded', function() {
    init();
    
    // Handle window resize
    window.addEventListener('resize', function() {
        const container = document.getElementById('visualization');
        if (container) {
            const containerWidth = container.clientWidth;
            if (containerWidth < width) {
                width = containerWidth;
                height = Math.min(500, containerWidth * 0.75);
                
                // Update SVG dimensions
                svg.attr('width', width).attr('height', height);
                
                // Update projection
                projection.translate([width / 2, height / 2]);
                
                // Redraw paths
                d3.selectAll('path').attr('d', path);
                
                // Update earthquake positions
                updateEarthquakePositions();
            }
        }
    });
});