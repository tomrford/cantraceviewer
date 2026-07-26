import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('canTraceFixture', {
	readFixture: (name) => ipcRenderer.invoke('fixture:read', name),
	runNodePath: () => ipcRenderer.invoke('fixture:node'),
	report: (result) => ipcRenderer.send('fixture:result', result)
});
