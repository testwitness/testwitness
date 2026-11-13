export async function startServer(port: number): Promise<{ close(): void }> {
  return { close() {} };
}
