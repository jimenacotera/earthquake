// Global variables
let width = 800;
let height = 500;
let earthquakeData = [];
let years = [];
let currentYear = null;
let globe = null;
let projection = null;
let path = null;
let svg = null;
let rotate = [0, 0, 0];
let drag = null;
let animationTimer = null;
let isAnimating = false;

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
        
        // Set default year to the first year
        if (years.length > 0) {
            currentYear = years[0];
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
    // Get min and max years from the data
    const minYear = Math.min(...years);
    const maxYear = Math.max(...years);
    
    // Get the slider element
    const yearSlider = document.getElementById('year-slider');
    const currentYearDisplay = document.getElementById('current-year');
    const sliderMin = document.querySelector('.slider-min');
    const sliderMax = document.querySelector('.slider-max');
    
    // Configure the slider
    yearSlider.min = minYear;
    yearSlider.max = maxYear;
    yearSlider.value = currentYear;
    
    // Update the labels
    sliderMin.textContent = minYear;
    sliderMax.textContent = maxYear;
    currentYearDisplay.textContent = currentYear;
    
    // Add event listener for the slider
    yearSlider.addEventListener('input', function() {
        // Update the current year display while dragging
        currentYearDisplay.textContent = this.value;
    });
    
    // Add event listener for when slider value is changed (on release)
    yearSlider.addEventListener('change', function() {
        // Stop any ongoing animation when manually changing the year
        stopAnimation();
        
        currentYear = +this.value;
        updateEarthquakes();
    });
    
    // Add play/pause button to container
    const controlsDiv = document.querySelector('.year-control');
    
    // Add controls wrapper
    const controlsWrapper = document.createElement('div');
    controlsWrapper.className = 'controls-wrapper';
    
    // Add play button
    const playButton = document.createElement('button');
    playButton.id = 'play-button';
    playButton.innerHTML = '▶ Play';
    playButton.className = 'control-button';
    playButton.addEventListener('click', toggleAnimation);
    controlsWrapper.appendChild(playButton);
    
    // Add animation speed control
    const speedControl = document.createElement('div');
    speedControl.className = 'speed-control';
    speedControl.innerHTML = `
        <label for="speed-slider">Speed:</label>
        <input type="range" id="speed-slider" min="250" max="2000" value="1000" class="speed-slider">
        <div class="speed-labels">
            <span>Slow</span>
            <span>Fast</span>
        </div>
    `;
    controlsWrapper.appendChild(speedControl);
    
    controlsDiv.appendChild(controlsWrapper);
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

// Start animation through years
function startAnimation() {
    if (isAnimating) return;
    
    isAnimating = true;
    
    const yearSlider = document.getElementById('year-slider');
    const currentYearDisplay = document.getElementById('current-year');
    const speedSlider = document.getElementById('speed-slider');
    const maxYear = +yearSlider.max;
    
    // Get animation speed (invert for intuitive control - lower value = faster)
    const animationSpeed = 2250 - speedSlider.value;
    
    animationTimer = setInterval(() => {
        // Increment year
        currentYear++;
        
        // If we reached the end, loop back to the beginning
        if (currentYear > maxYear) {
            currentYear = +yearSlider.min;
        }
        
        // Update slider and display
        yearSlider.value = currentYear;
        currentYearDisplay.textContent = currentYear;
        
        // Update visualization
        updateEarthquakes();
    }, animationSpeed);
}

// Stop animation
function stopAnimation() {
    if (!isAnimating) return;
    
    clearInterval(animationTimer);
    isAnimating = false;
}

// Update earthquakes based on the selected year
function updateEarthquakes() {
    // Filter earthquakes for the selected year
    const filteredData = earthquakeData.filter(d => d.year === currentYear);
    
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
    console.log(`Displaying ${filteredData.length} earthquakes for year ${currentYear}`);
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