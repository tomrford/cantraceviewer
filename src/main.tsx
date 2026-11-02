import './app.css';
import { StrictMode } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';

import { App } from '@/app';
import { mountWebMcp } from '@/lib/webmcp';
import { loadDbcLibrary } from '@/store/dbc-files';
import { connectPreferences } from '@/store/preferences';

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
