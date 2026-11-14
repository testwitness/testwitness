/** XML errors kept per file; the rest are counted. */
export const XML_MAX_ERRORS = 5;

/**
 * Collects the errors of one XML file. saxes keeps reading after an error, and a hostile file can hold one error per
 * few bytes: 900 kB of `&x;` gave 300,000 warnings (8.7 MB of text), and a file at the 500 MB results cap would have
 * exhausted memory. The first few errors are kept as notes and the rest are counted.
 */
export class XmlErrors {
  private n = 0;
  constructor(
    private readonly source: string,
    private readonly warnings: string[],
    private readonly max = XML_MAX_ERRORS,
  ) {}

  add(message: string): void {
    this.n++;
    if (this.n <= this.max) this.warnings.push(`${this.source}: ${message.slice(0, 300)}`);
  }

  /** Call once at the end of the file. */
  done(): void {
    if (this.n > this.max) this.warnings.push(`${this.source}: ${this.n - this.max} more XML errors`);
  }
}
