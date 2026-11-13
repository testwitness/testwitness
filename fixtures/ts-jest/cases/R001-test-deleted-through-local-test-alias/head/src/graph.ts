export async function load(id: string): Promise<number> {
  return id === "a" ? 1 : 42;
}
