import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('mirachpos', {
  platform: process.platform,
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron,
  },
});
