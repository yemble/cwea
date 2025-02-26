import React, { useRef, useEffect, useState } from 'react';
import mapboxgl from '!mapbox-gl'; // eslint-disable-line import/no-webpack-loader-syntax

import { toDate, formatInTimeZone } from 'date-fns-tz'
import Cookies from 'js-cookie';

mapboxgl.accessToken = 'pk.eyJ1IjoieWVtYmxlIiwiYSI6ImNtMDl3Y2J3ajEzZTEybHB5dHRheXhlMzcifQ.T8Qw5LTnRFY09SCfrpnwSA';

const tzdbKey = 'A7PC72T17P3L';

const MAP_LOC_LAYER_ID = 'mapLocLayer';
let mapMarker = null;

const SETTING_DEFAULT_LOC = 'defaultLoc';
const SETTING_INTERVAL_HOUR = 'intervalHour';
const SETTING_UNITS = 'units';

const SOURCE_NWS = 'USA NWS';
const SOURCE_OPENMETEO = 'Open-Meteo';
const dataSource = SOURCE_OPENMETEO;

let dataCache = {}; // url => object

const getSettings = () => {
  let settings = {};

  let loc = Cookies.get(SETTING_DEFAULT_LOC);
  settings[SETTING_DEFAULT_LOC] = loc ? JSON.parse(loc) : {
    lng:-105.75505156380228,
    lat:40.441373439936406,
  };

  let ih = Cookies.get(SETTING_INTERVAL_HOUR);
  settings[SETTING_INTERVAL_HOUR] = ih ? parseInt(ih) : 3;

  let u = Cookies.get(SETTING_UNITS);
  settings[SETTING_UNITS] = u || 'imperial';

  return settings;
};
const saveDefaultLoc = (loc) => {
  Cookies.set(SETTING_DEFAULT_LOC, JSON.stringify(loc), {expires: 365});
};
const saveIntervalHour = (hr) => {
  Cookies.set(SETTING_INTERVAL_HOUR, hr, {expires: 365});
};
const saveUnits = (u) => {
  Cookies.set(SETTING_UNITS, u, {expires: 365});
};

export default function App() {
  const mapContainer = useRef(null);
  const map = useRef(null);

  const [mapReady, setMapReady] = useState(false);

  const [loc, setLocation] = useState( getSettings()[SETTING_DEFAULT_LOC] );

  const [displayedLocHash, setDisplayedLocHash] = useState(null);

  const [currentPointMetadata, setCurrentPointMetadata] = useState(null);
  const [apiHourly, setApiHourly] = useState(null);

  const [forecastDays, setForecastDays] = useState([]);

  const [intervalHour, setIntervalHour] = useState( getSettings()[SETTING_INTERVAL_HOUR] )
  const [units, setUnits] = useState( getSettings()[SETTING_UNITS] )
  const [displayedTimeZone, setDisplayedTimeZone] = useState(null);

  const locHash = (loc) => {
    return `${loc.lat.toFixed(4)},${loc.lng.toFixed(4)}`;
  }

  // init map
  useEffect(() => {
    if (map.current) return;

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [loc.lng, loc.lat],
      zoom: 11,
      attributionControl: false,
    });

    map.current.on('load', () => {
      map.current.resize();

      map.current.addControl(new mapboxgl.AttributionControl({customAttribution: `Data from ${dataSource}`}));
      map.current.addControl(new mapboxgl.NavigationControl(), 'bottom-right');

      map.current.getCanvas().style.cursor = 'crosshair';
      map.current.on('click', (e) => setLocation(e.lngLat));

      setMapReady(true);

      if ("geolocation" in navigator) {
        // window.setTimeout(() => {
          navigator.geolocation.getCurrentPosition((position) => {
            let loc = {lat:position.coords.latitude, lng:position.coords.longitude};
            saveDefaultLoc(loc);
            setLocation(loc);
          });
        // }, 3000);
      }
    });
  });

  // move to new location
  useEffect(() => {
    // console.log({mapReady, loc: locHash(loc), displayedLocHash});

    if (! (mapReady) || ! ("lng" in loc) || locHash(loc) === displayedLocHash) return;

    clearCurrentDisplay();
    
    map.current.flyTo({center: loc});

    switch(dataSource) {
      case SOURCE_NWS:
        let url = `https://api.weather.gov/points/${loc.lat.toFixed(4)},${loc.lng.toFixed(4)}`;
        if (url in dataCache) {
          if (dataCache[url] === null) return; // debounce
          setApiHourly(null);
          setCurrentPointMetadata({
            lat: loc.lat,
            lng: loc.lng,
            source: SOURCE_NWS,
            hourlyURL: dataCache[url].properties.forecastHourly,
            timeZone: dataCache[url].properties.timeZone,
          });
        }
        else {
          async function fetchPoint() {
            console.log(`Fetching ${url}`);
            dataCache[url] = null; // debounce
            await fetch(url).then(r => r.json()).then(d => {
              dataCache[url] = d;
              setApiHourly(null);
              setCurrentPointMetadata({
                lat: loc.lat,
                lng: loc.lng,
                source: SOURCE_NWS,
                hourlyURL: d.properties.forecastHourly,
                timeZone: d.properties.timeZone,
              });
            });
          }
          fetchPoint();      
        }
        break;

      case SOURCE_OPENMETEO:
        async function fetchTimezone() {
          let url = `http://api.timezonedb.com/v2.1/get-time-zone?key=${tzdbKey}&format=json&fields=zoneName&by=position&lat=${loc.lat.toFixed(4)}&lng=${loc.lng.toFixed(4)}`;
          console.log(`Fetching ${url}`);
          await fetch(url).then(r => r.json()).then(d => {
            setApiHourly(null);
            setCurrentPointMetadata({
              lat: loc.lat,
              lng: loc.lng,
              source: SOURCE_OPENMETEO,
              timeZone: d.zoneName || Intl.DateTimeFormat().resolvedOptions().timeZone,
            });
          });
        }
        fetchTimezone();
        break;
      
      default:
        throw new Error("Unknown data source: " + dataSource);
    }
  }, [mapReady, loc, displayedLocHash]);

  // then get forecast
  useEffect(() => {
    if (!currentPointMetadata) return;

    setDisplayedTimeZone(currentPointMetadata.timeZone);

    switch(dataSource) {
      case SOURCE_NWS:
        let nwsURL = currentPointMetadata.hourlyURL;

        if (nwsURL in dataCache) {
          setApiHourly(dataCache[nwsURL])
        }
        else {
          async function fetchNwsHourly() {
            console.log(`Fetching ${nwsURL}`);
            await fetch(nwsURL)
            .then(r => r.json())
            .then(d => {
              dataCache[nwsURL] = d;
              setApiHourly(d);
            });
          }
          fetchNwsHourly();
        }    
        break;

      case SOURCE_OPENMETEO:
        let unitArgs = units === 'imperial'
          ? '&temperature_unit=fahrenheit&wind_speed_unit=mph&timeformat=unixtime'
          : '&temperature_unit=celsius&timeformat=unixtime';

        let omURL = `https://api.open-meteo.com/v1/forecast?forecast_days=14`
        + `&latitude=${currentPointMetadata.lat.toFixed(4)}&longitude=${currentPointMetadata.lng.toFixed(4)}`
        + `&hourly=temperature_2m,precipitation_probability,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m`
        + unitArgs
        + `&timezone=${currentPointMetadata.timeZone}`;

        if (omURL in dataCache) {
          setApiHourly(dataCache[omURL])
        }
        else {
          async function fetchOmHourly() {
            console.log(`Fetching ${omURL}`);
            await fetch(omURL)
            .then(r => r.json())
            .then(d => {
              dataCache[omURL] = d;
              setApiHourly(d);
            });
          }
          fetchOmHourly();
        }    
        break;
      
      default:
        throw new Error("Unknown data source: " + dataSource);
    }
  }, [currentPointMetadata, units]);

  // and draw it all
  useEffect(() => {
    if (!apiHourly) return;

    // console.log({currentPointMetadata,apiHourly});
    console.log(`Redrawing.`);

    setDisplayedLocHash(locHash(loc));

    switch(dataSource) {
      case SOURCE_NWS:
        if (apiHourly.geometry.type) {
          updateCurrentFeature(apiHourly.geometry.coordinates, apiHourly.geometry.type);
        }
        break;
      case SOURCE_OPENMETEO:
        updateCurrentFeature([currentPointMetadata.lng, currentPointMetadata.lat], 'Marker');
        break;
      default:
    }

    updateForecast();
  // eslint-disable-next-line
  }, [currentPointMetadata, apiHourly, intervalHour]);


  const clearCurrentDisplay = () => {
    let source = map.current.getSource(MAP_LOC_LAYER_ID);
    if(source) {
      map.current.removeLayer(MAP_LOC_LAYER_ID);
      map.current.removeSource(MAP_LOC_LAYER_ID);
    }

    if(mapMarker) {
      mapMarker.remove();
    }

    setForecastDays([]);
  };

  const updateCurrentFeature = (coords, shape) => {
    switch(shape) {
      case 'Polygon':
        let geoData = {
          type: 'Feature',
          geometry: {
            type: shape,
            coordinates: coords,
          }
        };

        let source = map.current.getSource(MAP_LOC_LAYER_ID);

        if (source) {
          source.setData(geoData);
        }
        else {
          map.current.addSource(MAP_LOC_LAYER_ID, {
            type: 'geojson',
            data: geoData,
          });

          map.current.addLayer({
            id: MAP_LOC_LAYER_ID,
            type: 'fill',
            source: MAP_LOC_LAYER_ID,
            // layout: {},
            paint: {'fill-color': '#ff5555', 'fill-opacity': 0.2},
          });
        }
        break;

      case 'Marker':
        if(! mapMarker) {
          mapMarker = new mapboxgl.Marker()
        }
        mapMarker
            .setLngLat(coords)
            .addTo(map.current);  
        break;
      default:
    }
  };

  const updateForecast = () => {
    const tz = apiHourly.timezone || currentPointMetadata.timeZone;

    const days = {};

    switch(dataSource) {
      case SOURCE_NWS:
        for(let per of apiHourly.properties.periods) {
          let date = toDate(per.startTime);
          let hour = parseInt(formatInTimeZone(date, tz, 'H'));
    
          if (hour < 6 || hour > 18) continue;
    
          let dayKey = formatInTimeZone(date, tz, 'yyyy-MM-dd');
          let timeStr = formatInTimeZone(date, tz, 'haaa');
          let dateStr = formatInTimeZone(date, tz, 'eee L/d');

          if (! (dayKey in days)) {
            days[dayKey] = {
              dateStr,
              tz,
              hours: [],
              minTemp: parseInt(per.temperature),
              maxTemp: parseInt(per.temperature),
            };
          }

          days[dayKey].minTemp = Math.min(days[dayKey].minTemp, parseInt(per.temperature));
          days[dayKey].maxTemp = Math.max(days[dayKey].maxTemp, parseInt(per.temperature));

          if ((hour % intervalHour) !== 0) continue;

          days[dayKey].hours.push({
            timeStr,
            temperature: parseInt(per.temperature),
            temperatureUnit: `°${per.temperatureUnit}`,
            probabilityOfPrecipitation: per.probabilityOfPrecipitation.value,
            windSpeed: parseInt(per.windSpeed),
            windSpeedUnit: 'mph',
            windSpeedEval: windSpeedEval(parseFloat(per.windSpeed)),
            windDirection: per.windDirection,
            description: per.shortForecast,
            // icon: per.icon,
          })
        }
        break;

      case SOURCE_OPENMETEO:
        for(let [idx,timestamp] of Object.entries(apiHourly.hourly.time)) {
          if (timestamp < Date.now()/1000 - 2*3600) continue;

          let date = toDate(new Date(timestamp*1000));
          let hour = parseInt(formatInTimeZone(date, tz, 'H'));

          if (hour < 6 || hour > 18) continue;
    
          let dayKey = formatInTimeZone(date, tz, 'yyyy-MM-dd');
          let timeStr = formatInTimeZone(date, tz, 'haaa');
          let dateStr = formatInTimeZone(date, tz, 'eee L/d');
    
          // console.log(idx, timestamp, date, hour, dayKey, dateStr, timeStr);

          if (! (dayKey in days)) {
            days[dayKey] = {
              dateStr,
              tz,
              hours: [],
              minTemp: parseInt(apiHourly.hourly.temperature_2m[idx]),
              maxTemp: parseInt(apiHourly.hourly.temperature_2m[idx]),
            };
          }

          days[dayKey].minTemp = Math.min(days[dayKey].minTemp, parseInt(apiHourly.hourly.temperature_2m[idx]));
          days[dayKey].maxTemp = Math.max(days[dayKey].maxTemp, parseInt(apiHourly.hourly.temperature_2m[idx]));

          if ((hour % intervalHour) !== 0) continue;
    
          days[dayKey].hours.push({
            timeStr,
            temperature: parseInt(apiHourly.hourly.temperature_2m[idx]),
            temperatureUnit: apiHourly.hourly_units.temperature_2m,
            probabilityOfPrecipitation: apiHourly.hourly.precipitation_probability[idx],
            windSpeed: parseInt(apiHourly.hourly.wind_speed_10m[idx]),
            gustSpeed: parseInt(apiHourly.hourly.wind_gusts_10m[idx]),
            windSpeedUnit: apiHourly.hourly_units.wind_speed_10m,
            windSpeedEval: windSpeedEval(parseFloat(apiHourly.hourly.wind_speed_10m[idx]), apiHourly.hourly_units.wind_speed_10m),
            windDirection: windDirEval(apiHourly.hourly.wind_direction_10m[idx]),
            description: parseWmoCode(apiHourly.hourly.weather_code[idx]) || '',
          });
        }
        break;
      
      default:
    }

    let sortedDays = Object.keys(days).sort().map(key => days[key]);

    // console.log({sortedDays});

    setForecastDays(sortedDays);
  };

  const windSpeedEval = (spd, unit='mph') => {
    switch(unit) {
      case 'kph':
      case 'km/h':
        spd /= 1.62;
        break;
      case 'kt':
      case 'knots':
        spd /= 1.15078;
        break;
      default:
    }
    if (spd <  12) return 'low';
    if (spd >= 16) return 'high';
    return 'medium';
  }

  const windDirEval = (deg) => {
    const arc = 22.5;
    const half = arc/2.0;

    if(deg > (360-half) || deg < half) return 'N';
    if(deg < 22.5+half) return 'NNE';
    if(deg < 45.0+half) return 'NE';
    if(deg < 67.5+half) return 'ENE';
    if(deg < 90.0+half) return 'E';
    if(deg < 112.5+half) return 'ESE';
    if(deg < 135.0+half) return 'SE';
    if(deg < 157.5+half) return 'SSE';
    if(deg < 180.0+half) return 'S';
    if(deg < 202.5+half) return 'SSW';
    if(deg < 225.0+half) return 'SW';
    if(deg < 247.5+half) return 'WSW';
    if(deg < 270.0+half) return 'W';
    if(deg < 292.5+half) return 'WNW';
    if(deg < 315.0+half) return 'NW';
    if(deg < 337.5+half) return 'NNW';
  }

  const parseWmoCode = (code) => {
    switch(parseInt(code)) {
      case 0: return 'Clear';
      case 1: return 'Mainly clear';
      case 2: return 'Partly cloudy';
      case 3: return 'Overcast';
      case 45: case 48: return 'Fog';
      case 51: return 'Light drizzle';
      case 53: return 'Moderate drizzle';
      case 55: return 'Dense drizzle';
      case 61: return 'Slight rain';
      case 63: return 'Moderate rain';
      case 65: return 'Heavy rain';
      case 66: case 67: return 'Freezing rain';
      case 71: return 'Slight snow';
      case 73: return 'Moderate snow';
      case 75: return 'Heavy snow';
      case 77: return 'Snow grains';
      case 80: return 'Slight showers';
      case 81: return 'Moderate showers';
      case 82: return 'Violent showers';
      case 85: return 'Slight snow showers';
      case 86: return 'Heavy snow showers';
      case 95: return 'Thunderstorm';
      case 96: case 99: return 'Thunderstorm and hail';
      default: return null;
    }
  }

  const handleInterval = (hr) => {
    saveIntervalHour(hr);
    setIntervalHour(hr);
  };

  const handleUnits = (u) => {
    saveUnits(u);
    setUnits(u);
  };

  return (
    <>
      <div className="forecastInfo">
        {forecastDays.map(d => <ForecastDay data={d} key={d.dateStr} />)}
      </div>
      <div className="metaBox">
      <div>lat: {loc.lat.toFixed(4)}, lng: {loc.lng.toFixed(4)}</div>
      <div>tz: {(displayedTimeZone||'').toLowerCase()}</div>
      <div className="options">
          Interval:&nbsp;
          <button className={`btn-link ${intervalHour === 3 ? 'active' : 'inactive'}`} onClick={(e) => handleInterval(3)}>3h</button>&nbsp;
          <button className={`btn-link ${intervalHour === 2 ? 'active' : 'inactive'}`} onClick={(e) => handleInterval(2)}>2h</button>&nbsp;
          <button className={`btn-link ${intervalHour === 1 ? 'active' : 'inactive'}`} onClick={(e) => handleInterval(1)}>1h</button>
        </div>
        <div className="options">
          Units:&nbsp;
          <button className={`btn-link ${units === 'imperial' ? 'active' : 'inactive'}`} onClick={(e) => handleUnits('imperial')}>imperial</button>&nbsp;
          <button className={`btn-link ${units === 'metric' ? 'active' : 'inactive'}`} onClick={(e) => handleUnits('metric')}>metric</button>
        </div>
      </div>
      <div ref={mapContainer} className="map-container" />
    </>
  );
}

function ForecastDay({data}) {
  return (<div className="day">
    <div className="dateLine"><span>
      <span className="date" title={data.tz}>{data.dateStr}</span>&nbsp;
      <span className="temp min" title="minimum">{data.minTemp}°</span>&nbsp;
      <span className="temp max" title="maximum">{data.maxTemp}°</span>
    </span></div>
    <div className="hours">{data.hours.map(h => <ForecastHour data={h} key={h.timeStr} />)}</div>
  </div>);
};

function ForecastHour({data}) {
  return (<div className="hour" title={data.shortForecast}>
    <div className="time">{data.timeStr}</div>
    <div className={`pair wind ${data.windSpeedEval}`}>
      <div className={`left emoji arrow ${data.windDirection}`}><span className="material-symbols-outlined">north</span></div>
      <div className="text">
        {data.windSpeed}
        {data.gustSpeed ? (<span><span className="tilde">&nbsp;~&nbsp;</span>{data.gustSpeed}</span>) : null}
        <span className="unit below"><br/>{data.windSpeedUnit}</span>
      </div>
    </div>

    <div className="pair precip">
      <span className="left emoji"><span className="material-symbols-outlined">rainy</span></span>
      <span>{data.probabilityOfPrecipitation}%</span>
    </div>

    <div className="pair temp">
      <span className="left emoji"><span className="material-symbols-outlined">device_thermostat</span></span>
      <span>{data.temperature} <span className="unit after">{data.temperatureUnit}</span></span>
    </div>
    <div className="description">{data.description}</div>
  </div>);
};
