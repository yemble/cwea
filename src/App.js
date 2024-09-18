import React, { useRef, useEffect, useState } from 'react';
import mapboxgl from '!mapbox-gl'; // eslint-disable-line import/no-webpack-loader-syntax

import { toDate, formatInTimeZone } from 'date-fns-tz'
import Cookies from 'js-cookie';

mapboxgl.accessToken = 'pk.eyJ1IjoieWVtYmxlIiwiYSI6ImNtMDl3Y2J3ajEzZTEybHB5dHRheXhlMzcifQ.T8Qw5LTnRFY09SCfrpnwSA';

const CURRENT_POLY = 'currentPoly';
const SETTING_DEFAULT_LOC = 'defaultLoc';
const SETTING_INTERVAL_HOUR = 'intervalHour';

let dataCache = {}; // url => object

const getSettings = () => {
  let settings = {};

  let loc = Cookies.get(SETTING_DEFAULT_LOC);
  if (loc) {
    settings[SETTING_DEFAULT_LOC] = JSON.parse(loc);
  }
  else {
    settings[SETTING_DEFAULT_LOC] = {
      lng:-105.75505156380228,
      lat:40.441373439936406,
    };
  }

  let ih = Cookies.get(SETTING_INTERVAL_HOUR);
  if (ih) {
    settings[SETTING_INTERVAL_HOUR] = parseInt(ih);
  }
  else {
    settings[SETTING_INTERVAL_HOUR] = 3;
  }

  return settings;
};
const saveDefaultLoc = (loc) => {
  Cookies.set(SETTING_DEFAULT_LOC, JSON.stringify(loc), {expires: 365});
};
const saveIntervalHour = (hr) => {
  Cookies.set(SETTING_INTERVAL_HOUR, hr, {expires: 365});
};

export default function App() {
  const mapContainer = useRef(null);
  const map = useRef(null);

  const [mapReady, setMapReady] = useState(false);

  const [loc, setLocation] = useState( getSettings()[SETTING_DEFAULT_LOC] );
  const [locName, setLocName] = useState('');

  const [displayedLocHash, setDisplayedLocHash] = useState(null);

  const [apiPoint, setApiPoint] = useState(null);
  const [apiHourly, setApiHourly] = useState(null);

  const [forecastDays, setForecastDays] = useState([]);

  const [intervalHour, setIntervalHour] = useState( getSettings()[SETTING_INTERVAL_HOUR] )

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

      map.current.addControl(new mapboxgl.AttributionControl({customAttribution: 'Data from NWS'}));
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
    console.log({mapReady, loc: locHash(loc), displayedLocHash});

    if (! (mapReady) || ! ("lng" in loc) || locHash(loc) === displayedLocHash) return;

    clearCurrentDisplay();
    
    map.current.flyTo({center: loc});

    let url = `https://api.weather.gov/points/${loc.lat.toFixed(4)},${loc.lng.toFixed(4)}`;

    if (url in dataCache) {
      if (dataCache[url] === null) return; // debounce
      setApiHourly(null);
      setApiPoint(dataCache[url]);
    }
    else {
      async function fetchPoint() {
        console.log(`Fetching ${url}`);
        dataCache[url] = null; // debounce
        await fetch(url)
        .then(r => r.json())
        .then(d => {
          dataCache[url] = d;
          setApiHourly(null);
          setApiPoint(d);
        });
      }
      fetchPoint();      
    }
  }, [mapReady, loc, displayedLocHash]);

  // then get forecast
  useEffect(() => {
    if (!apiPoint) return;

    let url = apiPoint.properties.forecastHourly;

    if (url in dataCache) {
      setApiHourly(dataCache[url])
    }
    else {
      async function fetchHourly() {
        console.log(`Fetching ${url}`);
        await fetch(url)
        .then(r => r.json())
        .then(d => {
          dataCache[url] = d;
          setApiHourly(d);
        });
      }
      fetchHourly();
    }
  }, [apiPoint]);

  // and draw it all
  useEffect(() => {
    if (!apiHourly) return;

    // console.log({apiPoint,apiHourly});
    console.log(`Redrawing.`);

    setDisplayedLocHash(locHash(loc));

    setLocName(apiPoint.properties.relativeLocation.properties.city ?? '');

    if (apiHourly.geometry.type === 'Polygon') {
      updateCurrentPolygon(apiHourly.geometry.coordinates);
    }

    updateForecast();
  // eslint-disable-next-line
  }, [apiPoint, apiHourly, intervalHour]);


  const clearCurrentDisplay = () => {
    setLocName('');
    let source = map.current.getSource(CURRENT_POLY);
    if(source) {
      map.current.removeLayer(CURRENT_POLY);
      map.current.removeSource(CURRENT_POLY);
    }
    setForecastDays([]);
  };

  const updateCurrentPolygon = (coordsList) => {
    let geoData = {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: coordsList,
      }
    };

    let source = map.current.getSource(CURRENT_POLY);

    if (source) {
      source.setData(geoData);
    }
    else {
      map.current.addSource(CURRENT_POLY, {
        type: 'geojson',
        data: geoData,
      });
      map.current.addLayer({
          id: CURRENT_POLY,
          type: 'fill',
          source: CURRENT_POLY,
          layout: {},
          paint: {
              'fill-color': '#ff5555',
              'fill-opacity': 0.2,
          }
      });
    }
  };

  const updateForecast = () => {
    // const localTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const pointTimeZone = apiPoint.properties.timeZone;
    const tz = pointTimeZone;

    const days = {};

    for(let per of apiHourly.properties.periods) {
      let date = toDate(per.startTime);
      let hour = parseInt(formatInTimeZone(date, tz, 'H'));

      if (hour < 6 || hour > 18 || (hour % intervalHour) !== 0) continue;

      let dayKey = formatInTimeZone(date, tz, 'yyyy-MM-dd');
      let timeStr = formatInTimeZone(date, tz, 'haaa');
      let dateStr = formatInTimeZone(date, tz, 'eee L/d');

      if (! (dayKey in days)) {
        days[dayKey] = {
          dateStr,
          hours: [],
        };
      }

      days[dayKey].hours.push({
        timeStr,
        temperature: per.temperature,
        temperatureUnit: per.temperatureUnit,
        probabilityOfPrecipitation: per.probabilityOfPrecipitation,
        windSpeed: per.windSpeed,
        windSpeedEval: windSpeedEval(parseInt(per.windSpeed)),
        windDirection: per.windDirection,
        shortForecast: per.shortForecast,
        icon: per.icon,
      })
    }

    let sortedDays = Object.keys(days).sort().map(key => {
      let day = days[key];
      let temps = day.hours.map(h => h.temperature);
      day.minTemp = parseInt(Math.min(...temps));
      day.maxTemp = parseInt(Math.max(...temps));
      return day;
    });
    setForecastDays(sortedDays);
  };

  const windSpeedEval = (mph) => {
    if (mph <= 12) return 'low';
    if (mph >= 16) return 'high';
    return 'medium';
  }

  const handleInterval = (hr) => {
    saveIntervalHour(hr);
    setIntervalHour(hr);
  };

  return (
    <>
      <div className="forecastInfo">
        {forecastDays.map(d => <ForecastDay data={d} key={d.dateStr} />)}
      </div>
      <div className="metaBox">
        <div>{locName} ({loc.lng.toFixed(4)},{loc.lat.toFixed(4)})</div>
        <div className="options">
          Interval:&nbsp;
          <button className={`btn-link ${intervalHour === 3 ? 'active' : 'inactive'}`} onClick={(e) => handleInterval(3)}>3h</button>&nbsp;
          <button className={`btn-link ${intervalHour === 2 ? 'active' : 'inactive'}`} onClick={(e) => handleInterval(2)}>2h</button>&nbsp;
          <button className={`btn-link ${intervalHour === 1 ? 'active' : 'inactive'}`} onClick={(e) => handleInterval(1)}>1h</button>
        </div>
      </div>
      <div ref={mapContainer} className="map-container" />
    </>
  );
}

function ForecastDay({data}) {
  return (<div className="day">
    <div className="dateLine"><span>
      <span className="date">{data.dateStr}</span>&nbsp;
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
      <div className={`left emoji arrow ${data.windDirection}`}>↑</div>
      <div className="text">{data.windSpeed}</div>
    </div>

    <div className="pair precip"><span className="left emoji">🌧️</span><span>{data.probabilityOfPrecipitation.value}%</span></div>

    <div className="pair temp"><span className="left emoji">🌡️</span>{data.temperature}°{data.temperatureUnit}</div>
    <div className="icon"><img src={data.icon} alt={data.shortForecast} /></div>
  </div>);
};
