export function install(name: string): { filesCreated: string[]; code: number } {
  const root = `node_modules/${name}`;
  return { filesCreated: [root, `${root}/index.js`], code: 0 };
}
