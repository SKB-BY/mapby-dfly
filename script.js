let map;
let flyZonesGeoJSON = null;
let flyZonesLayer = null;
let rblaMode = false;
let centerPoint = null;
let tempLine = null;
let tempLabel = null;
let tempCircle = null;
let radiusMeters = null;

function initMap() {
  // Инициализация карты — ДОЛЖНА работать всегда
  map = L.map('map', {
    zoomControl: true,
    attributionControl: false
  }).setView([53.9, 27.5667], 10);

  // Слои
  const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {});
  const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {});
  const streetMap = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {});
  const hybrid = L.layerGroup([satellite, streetMap]);

  L.control.layers({
    'OSM': osm,
    'Спутник': satellite,
    'Гибрид': hybrid
  }, {}, { position: 'topright' }).addTo(map);

  osm.addTo(map); // 🔥 Обязательно!

  // Загрузка KML — но не ломаем карту, если ошибка
  loadKML();

  // Кнопки
  initButtons();
}

function loadKML() {
  fetch('Fly_Zones_BY.txt')
    .then(res => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.text();
    })
    .then(kmlText => {
      const kml = new DOMParser().parseFromString(kmlText, 'text/xml');
      if (kml.querySelector('parsererror')) {
        throw new Error('Ошибка XML');
      }
      const geojson = toGeoJSON.kml(kml);
      flyZonesGeoJSON = geojson;

      // Создаём слой, но НЕ добавляем сразу — будем фильтровать по видимой области
      const fullLayer = L.geoJSON(geojson, {
        onEachFeature: (feature, layer) => {
          const name = feature.properties.name || 'Зона';
          layer.bindPopup(`<b>${name}</b>`);
        },
        style: { color: '#ff0000', weight: 2, fillOpacity: 0.1 }
      });

      // Фильтрация по видимой области
      function updateVisibleZones() {
        if (flyZonesLayer) map.removeLayer(flyZonesLayer);
        const bounds = map.getBounds();
        const visibleFeatures = geojson.features.filter(feature => {
          try {
            const geom = feature.geometry;
            if (geom.type === 'Point') {
              const coord = L.latLng(geom.coordinates[1], geom.coordinates[0]);
              return bounds.contains(coord);
            } else if (geom.type === 'Polygon' || geom.type === 'MultiPolygon') {
              // Упрощённая проверка: центр полигона
              const bbox = turf.bbox(feature);
              const center = turf.center(turf.bboxPolygon(bbox));
              const latlng = L.latLng(center.geometry.coordinates[1], center.geometry.coordinates[0]);
              return bounds.contains(latlng);
            }
          } catch (e) {
            return false;
          }
          return false;
        });

        if (visibleFeatures.length > 0) {
          flyZonesLayer = L.geoJSON({ type: 'FeatureCollection', features: visibleFeatures }, {
            onEachFeature: (feature, layer) => {
              const name = feature.properties.name || 'Зона';
              layer.bindPopup(`<b>${name}</b>`);
            },
            style: { color: '#ff0000', weight: 2, fillOpacity: 0.1 }
          }).addTo(map);
        }
      }

      // Обновляем при движении/зуме
      map.on('moveend zoomend', updateVisibleZones);
      updateVisibleZones(); // первый раз

      console.log('✅ KML загружен. Объектов:', geojson.features.length);
    })
    .catch(err => {
      console.error('❌ KML не загружен:', err);
      // Карта продолжает работать!
    });
}

function initButtons() {
  const btnRbla = document.getElementById('btn-rbla');
  const btnGps = document.getElementById('btn-gps');
  const btnCalculate = document.getElementById('btn-calculate');

  btnGps.addEventListener('click', () => {
    map.locate({ setView: true, maxZoom: 16 });
  });

  btnRbla.addEventListener('click', () => {
    if (rblaMode) return;

    rblaMode = true;
    btnRbla.disabled = true;
    centerPoint = map.getCenter();

    map.dragging.disable();
    map.on('mousemove', drawTempLine);
    map.once('click', finishRadius); // ⚠️ once — только один раз!
  });

  btnCalculate.addEventListener('click', () => {
    if (!tempCircle || !flyZonesGeoJSON) {
      alert('Нет данных для расчёта.');
      return;
    }

    const centerArr = [centerPoint.lng, centerPoint.lat];
    const circleFeature = turf.circle(centerArr, radiusMeters / 1000, { steps: 64 });

    const intersectingNames = [];
    flyZonesGeoJSON.features.forEach(zone => {
      try {
        if (turf.booleanIntersects(circleFeature, zone)) {
          const name = zone.properties.name || 'Зона';
          if (!intersectingNames.includes(name)) {
            intersectingNames.push(name);
          }
        }
      } catch (e) {}
    });

    let content = `
      <b>Центр:</b> ${centerPoint.lat.toFixed(6)}, ${centerPoint.lng.toFixed(6)}<br>
      <b>Радиус:</b> ${radiusMeters} м<br>
    `;
    if (intersectingNames.length > 0) {
      content += `<b>Пересекает зоны:</b><br>• ${intersectingNames.join('<br>• ')}`;
    } else {
      content += `<b>Пересечений нет</b>`;
    }

    tempCircle.bindPopup(content).openPopup();
    btnCalculate.style.display = 'none';
  });
}

function drawTempLine(e) {
  if (!rblaMode || !centerPoint) return;

  const distance = map.distance(centerPoint, e.latlng);
  if (isNaN(distance)) return;

  if (tempLine) map.removeLayer(tempLine);
  if (tempLabel) map.removeLayer(tempLabel);

  tempLine = L.polyline([centerPoint, e.latlng], {
    color: 'blue',
    weight: 2,
    dashArray: '5,5'
  }).addTo(map);

  tempLabel = L.marker(e.latlng, {
    icon: L.divIcon({
      className: 'distance-label',
      html: `${Math.round(distance)} м`,
      iconSize: [0, 0]
    })
  }).addTo(map);
}

function finishRadius(e) {
  if (!rblaMode) return;

  const distance = map.distance(centerPoint, e.latlng);
  if (isNaN(distance)) {
    resetRBLA();
    return;
  }

  radiusMeters = Math.ceil(distance / 50) * 50;

  if (tempLine) map.removeLayer(tempLine);
  if (tempLabel) map.removeLayer(tempLabel);

  // Удаляем старый круг, если есть
  if (tempCircle) map.removeLayer(tempCircle);

  tempCircle = L.circle(centerPoint, {
    radius: radiusMeters,
    color: 'red',
    fillOpacity: 0.2
  }).addTo(map);

  document.getElementById('btn-calculate').style.display = 'block';
  resetRBLA();
}

function resetRBLA() {
  rblaMode = false;
  document.getElementById('btn-rbla').disabled = false;
  map.dragging.enable();
  map.off('mousemove', drawTempLine);
  // click уже отключён благодаря map.once()
}

document.addEventListener('DOMContentLoaded', () => {
  initMap();
});
