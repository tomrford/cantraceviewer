import './app.css';
import { StrictMode } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { loadDbcLibrary } from '#lib/stores/dbc-files.js';
import { connectPreferences } from '#lib/stores/preferences.js';
import { mountWebMcp } from '#lib/webmcp.js';
import { App } from './app.js';

// One-time browser startup. The prerender loads src/server.tsx instead, so none of this runs there.
connectPreferences();
void loadDbcLibrary();
mountWebMcp();

const container = document.getElementById('app');
if (!container) throw new Error('missing #app container');

const app = (
	<StrictMode>
		<App />
	</StrictMode>
);

if (container.firstElementChild) hydrateRoot(container, app);
else createRoot(container).render(app);
