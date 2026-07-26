export const minimalRepoFiles = [
  {
    filePath: 'src/main.ts',
    description: 'Application entry point that bootstraps the NestJS module',
  },
  {
    filePath: 'src/app.module.ts',
    description: 'Root module that imports all feature modules',
  },
  {
    filePath: 'src/app.service.ts',
    description: 'Application service providing health check functionality',
  },
];

export const minimalRepoRelationships = [
  {
    fromFilePath: 'src/main.ts',
    toFilePath: 'src/app.module.ts',
    type: 'IMPORTS',
    hopDistance: 1,
    edgeId: 'edge-1',
  },
  {
    fromFilePath: 'src/app.module.ts',
    toFilePath: 'src/app.service.ts',
    type: 'IMPORTS',
    hopDistance: 1,
    edgeId: 'edge-2',
  },
];

export const minimalRepoClusters = [
  {
    name: 'Application Core',
    filePaths: ['src/main.ts', 'src/app.module.ts', 'src/app.service.ts'],
  },
];
