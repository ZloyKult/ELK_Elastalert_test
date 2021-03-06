import { resolve } from 'path';
import glob from 'glob';
import { ExportTypesRegistry } from '../../common/export_types_registry';
import { oncePerServer } from './once_per_server';

function scan(pattern) {
  return new Promise((resolve, reject) => {
    glob(pattern, {}, (err, files) => {
      if (err) {
        return reject(err);
      }

      resolve(files);
    });
  });
}

const pattern = resolve(__dirname, '../../export_types/*/server/index.js');
async function exportTypesRegistryFn(server) {
  const exportTypesRegistry = new ExportTypesRegistry();
  const files = await scan(pattern);
  files.forEach(file => {
    server.log(['reporting', 'debug', 'exportTypes'], `Found exportType at ${file}`);

    const { register } = require(file);
    register(exportTypesRegistry);
  });
  return exportTypesRegistry;
}

export const exportTypesRegistryFactory = oncePerServer(exportTypesRegistryFn);
