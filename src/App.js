import React, { useRef, useEffect, useState } from 'react';
import mapboxgl from '!mapbox-gl'; // eslint-disable-line import/no-webpack-loader-syntax

import { toDate, formatInTimeZone } from 'date-fns-tz'
import Cookies from 'js-cookie';

mapboxgl.accessToken = 'pk.eyJ1IjoieWVtYmxlIiwiYSI6ImNtMDl3Y2J3ajEzZTEybHB5dHRheXhlMzcifQ.T8Qw5LTnRFY09SCfrpnwSA';

const CURRENT_POLY = 'currentPoly';
const DEFAULT_LOC_COOKIE = 'defaultLoc';

let dataCache = {}; // url => object

const getDefaultLoc = () => {
  let loc = Cookies.get(DEFAULT_LOC_COOKIE);
  if (loc) {
    return JSON.parse(loc);
  }
  else {
    return {
      lng:-105.75505156380228,
      lat:40.441373439936406,
    };
  }
};
const saveDefaultLoc = (loc) => {
  Cookies.set(DEFAULT_LOC_COOKIE, JSON.stringify(loc));
};

export default function App() {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const [loc, setLoc] = useState( getDefaultLoc() );
  const [locName, setLocName] = useState('');

  const [apiPoint, setApiPoint] = useState(null);
  const [apiHourly, setApiHourly] = useState(null);

  const [forecastDays, setForecastDays] = useState([]);

  // init map
  useEffect(() => {
    if (map.current) return;

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: [loc.lng, loc.lat],
      zoom: 11
    });

    map.current.on('load', () => map.current.resize());

    map.current.on('click', (e) => setLoc(e.lngLat));

    map.current.addControl(new mapboxgl.NavigationControl(), 'bottom-right');

    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition((position) => {
        let loc = {lat:position.coords.latitude, lng:position.coords.longitude};
        saveDefaultLoc(loc);
        setLoc(loc);
      });      
    }
  });

  // move to new location
  useEffect(() => {
    if (! ("lng" in loc)) return;

    clearCurrentDisplay();
    
    map.current.flyTo({center: loc});

    let url = `https://api.weather.gov/points/${loc.lat},${loc.lng}`;

    async function fetchPoint() {
      console.log(`Fetching ${url}`);
      await fetch(url)
      .then(r => r.json())
      .then(d => {
        setApiPoint(d);
      });
    }

    fetchPoint();
  }, [loc]);

  // then get forecast
  useEffect(() => {
    if (!apiPoint) return;
    // console.log({apiPoint});

    setLocName(apiPoint.properties.relativeLocation.properties.city ?? '');

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
    // console.log({apiHourly});

    // draw polygon
    if (apiHourly.geometry.type === 'Polygon') {
      updateCurrentPolygon(apiHourly.geometry.coordinates);
    }

    // update forecast display
    updateForecast();
  }, [apiHourly]);

  const clearCurrentDisplay = () => {
    setLocName('');
    let source = map.current.getSource(CURRENT_POLY);
    if(source) {
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
      if (! [6, 9, 12, 15, 18].includes(hour)) continue;

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
        // windDirectionDeg: direction(per.windDirection),
        shortForecast: per.shortForecast,
        icon: per.icon,
      })
    }

    let sorted = Object.keys(days).sort().map(key => days[key]);
    console.log('sorted', sorted);
    setForecastDays(sorted);
  };

  const windSpeedEval = (mph) => {
    if (mph <= 12) return 'low';
    if (mph >= 16) return 'high';
    return 'medium';
  }

  return (
    <>
      <div className="forecastInfo">
        {forecastDays.map(d => <ForecastDay data={d} />)}
      </div>
      <div className="locationInfo">
        {locName} ({loc.lng.toFixed(4)},{loc.lat.toFixed(4)})
      </div>
      <div ref={mapContainer} className="map-container" />
    </>
  );
}

function ForecastDay({data}) {
  return (<div className="day">
    <div className="date">{data.dateStr}</div>
    <div className="hours">{data.hours.map(h => <ForecastHour data={h} />)}</div>
  </div>);
};

function ForecastHour({data}) {
  return (<div className="hour" title={data.shortForecast}>
    <div className="time">{data.timeStr}</div>
    <div className={`wind ${data.windSpeedEval}`}>
      <div className={`emoji arrow ${data.windDirection}`}>↑</div>
      <div className="text">{data.windSpeed}</div>
    </div>
    <div className="precip"><span className="emoji">☂️</span>{data.probabilityOfPrecipitation.value}%</div>
    <div className="icon"><img src={data.icon} alt={data.shortForecast} /></div>
  </div>);
};
