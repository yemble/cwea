import React from 'react';
import ReactDOM from 'react-dom';

import 'mapbox-gl/dist/mapbox-gl.css';
import './index.css';

import App from './App';

try {
  ReactDOM.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
    document.getElementById('root')
  );
}
catch(err) {
  window.reload();
}