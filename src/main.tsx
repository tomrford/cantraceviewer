import './app.css';
import { StrictMode } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { App } from './app.js';

const container = document.getElementById('app');
if (!container) throw new Error('missing #app container');

const app = (
	<StrictMode>
		<App />
	</StrictMode>
);

if (container.firstElementChild) hydrateRoot(container, app);
else createRoot(container).render(app);
