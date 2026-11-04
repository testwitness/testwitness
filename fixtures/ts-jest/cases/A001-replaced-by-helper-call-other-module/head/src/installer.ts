export interface InstallResult {
  filesCreated: string[];
  code: number;
}

export function install(name: string): InstallResult {
  const root = `node_modules/${name}`;
  return { filesCreated: [root, `${root}/index.js`], code: 0 };
}
