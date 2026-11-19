import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, MemoryRouter } from 'react-router-dom';
import App from './App';
import brand from './brand';
import './styles.css';

export const DEMO = process.env.REACT_APP_DEMO === 'true';
if (DEMO) require('./demo/mockApi').installMockApi();
const Router = DEMO ? MemoryRouter : BrowserRouter;

const root = document.documentElement;
Object.entries(brand.colors).forEach(([k, v]) => root.style.setProperty(`--${k}`, v));
document.title = brand.name; // título de la pestaña con el nombre del cliente

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Router>
      <App />
    </Router>
  </React.StrictMode>
);
